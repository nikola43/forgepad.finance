// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

// PausableUpgradeable, not Pausable: the plain one inherits Context while
// OwnableUpgradeable inherits ContextUpgradeable, and Solidity refuses the
// ambiguous _msgSender/_msgData that results.
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
// OZ >=5.5 ReentrancyGuard is proxy-safe and adds NO sequential storage: it is
// @custom:stateless and keeps its flag in one ERC-7201 namespaced slot. That is
// what makes it safe to add to an ALREADY-DEPLOYED proxy here — the layout below
// does not shift. The guard also trips only on `== ENTERED` (2), so the live
// proxy's zero-valued slot reads as not-entered on the first call after upgrade.
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VRFConsumerBaseV2PlusUpgradeable} from "./VRFConsumerBaseV2PlusUpgradeable.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {AutomationCompatibleInterface} from
    "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Fyuz leaderboard fee Distributor (BSC)
/// @notice Receives the protocol's 0.3% leaderboard fee stream (BNB) from Fyuz
///         and pays it out every period:
///           - 90% pro-rata by leaderboard share (points in the round window)
///           - 10% to ONE participant picked uniformly by Chainlink VRF v2.5 —
///             every participant holds exactly one lottery ticket regardless of
///             size, which keeps small traders engaged.
///
/// @dev Chain reality check: Chainlink Functions does NOT exist on BSC, so the
///      shares cannot be fetched on-chain. They are posted by an authorized
///      `poster` key operated by the backend — the same trust root Functions
///      would have had, since it only ever relayed what our API returned.
///      Winner selection stays trustless via VRF v2.5 (native-BNB payment; no
///      LINK juggling).
///
/// @dev Chainlink Automation drives the WHOLE round. checkUpkeep reports the one
///      action that is due and performUpkeep executes it:
///        START      — period elapsed and there is a pot     -> startRound()
///        DISTRIBUTE — shares + randomness committed         -> distribute()
///        RETRY_VRF  — VRF silent past vrfTimeout            -> re-request
///        CANCEL     — poster never posted, or VRF gave up   -> cancelRound()
///      Only postShares still needs an off-chain key: the leaderboard lives in
///      our database and cannot be computed on-chain.
///
///      Every automation entrypoint is ALSO public and re-validates its own
///      preconditions on-chain, so Automation is a liveness convenience, never a
///      trust assumption — if the upkeep is unfunded, paused or deregistered,
///      any cron or human can call the same functions and the round still pays.
///
/// @dev The round window is derived ON-CHAIN (windowStart -> block.timestamp)
///      rather than passed in by the poster, because Automation has no opinion
///      about calendar time. windowStart advances only on a PAID round, so a
///      cancelled round folds its holders into the next one instead of dropping
///      them — the same rule the backend's epoch_start() uses.
///
/// @dev distribute() is GAS-AWARE and RESUMABLE. Pushing to all 100 holders in
///      one call costs ~1.4M gas normally but ~6.6M if every receiver burns its
///      stipend and fails, which is more than an upkeep can be given — and a
///      round that cannot fit is a frozen pot. The payout loop instead pays until
///      gas runs low, banks a cursor and resumes on the next call. Normal rounds
///      still finish in ONE transaction.
///
/// @dev UPGRADEABLE: deployed behind a TransparentUpgradeableProxy, so state lives
///      in the proxy and `initialize` replaces the constructor. The VRF base had
///      to be swapped for a proxy-safe one; see VRFConsumerBaseV2PlusUpgradeable
///      for why Chainlink's own base cannot be used here.
///
///      STORAGE LAYOUT IS APPEND-ONLY. Everything down to `vrfNativePayment` is
///      the layout the live proxy was initialized with; the automation state
///      below it was appended by the upgrade that introduced this file, and
///      `Round` grew new fields at the END for the same reason. Reordering any of
///      it silently repoints live storage. Add new variables at the bottom only.
contract Distributor is
    VRFConsumerBaseV2PlusUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable,
    AutomationCompatibleInterface
{
    // ---- errors ------------------------------------------------------------

    error BpsTooHigh();
    error ClaimTransferFailed();
    error GasFloorTooLow();
    error InvalidPackedLength();
    error NoActiveRound();
    error NotForwarder();
    error NotPoster();
    error NothingToClaim();
    error NothingToDistribute();
    error PeriodNotElapsed();
    error RandomAlreadyRevealed();
    error RandomnessPending();
    error RoundAlreadyActive();
    error SharesAlreadyPosted();
    error SharesExceedTotal();
    error SharesPending();
    error TokenTransferFailed();
    error TooManyHolders();
    error UpkeepNotNeeded();
    error VRFNotStalled();
    error WithdrawFailed();
    error ZeroBatchSize();
    error ZeroKeyHash();
    error ZeroPeriod();
    error ZeroPoster();
    error ZeroSubId();

    // ---- round state -------------------------------------------------------

    /// status: 0 = none, 1 = active (awaiting shares and/or VRF), 2 = paid, 3 = cancelled
    /// @dev The first eight fields are the layout the live proxy already uses and
    ///      must not move. `vrfRetries`/`cursor`/`holderCount`/`sharesAt` were
    ///      appended for automation: appending to a struct held in a mapping is
    ///      safe because each key's slots are keccak-derived, so growing the
    ///      struct cannot collide with another key's data.
    struct Round {
        uint8 status;
        uint64 timeStart; // leaderboard window covered by this round
        uint64 timeEnd; // == the block timestamp of startRound()
        bool hasRandom;
        uint256 pot; // balance snapshot at startRound
        uint256 random;
        uint256 vrfRequestId;
        bytes shares; // packed 24-byte entries: address(20) ++ uint32 share(4)
        uint8 vrfRetries;
        uint16 cursor; // holders paid so far (resume point for the next batch)
        uint16 holderCount;
        uint64 sharesAt; // when postShares landed; the VRF timeout runs from here
    }

    uint256 public roundId;
    uint256 public lastRoundTime;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => uint256) private vrfRequests; // requestId -> roundId

    /// Funds owed to holders whose payout push failed (contract/AA wallets,
    /// reverting receivers). Withdrawable via claim(). Held OUT of the pot so a
    /// later round can never re-distribute them.
    mapping(address => uint256) public claimable;
    uint256 public totalClaimable;

    // ---- config ------------------------------------------------------------
    //
    // Declared WITHOUT inline initializers on purpose. A field initializer is
    // compiled into the constructor, and a proxy never runs the implementation
    // constructor against its own storage — so `= 9000` here would leave the
    // PROXY reading 0. That is not a cosmetic default: percentForDistribute at
    // zero pays nobody and strands the pot, and vrfGasLimit at zero makes every
    // fulfilment run out of gas. Every one of these is set in an initializer.

    uint256 public period;
    uint256 public percentForWinner; // 10% of the pot, basis points
    uint256 public percentForDistribute; // 90% of the pot, basis points
    /// @notice Backend key allowed to post shares, force a round and cancel.
    address public poster;

    uint256 public vrfSubscriptionId;
    bytes32 public vrfKeyHash;
    uint32 public vrfGasLimit; // fulfill only stores one word
    uint16 public vrfConfirmations;
    bool public vrfNativePayment;

    // ---- appended by the automation upgrade --------------------------------
    //
    // Everything above this line is the layout the live proxy was initialized
    // with. Everything below was zero on that proxy until initializeAutomation()
    // set it, which is exactly why these are appends and not insertions.

    /// @notice Start of the window the next round will cover. Advances ONLY when
    ///         a round is fully paid, so a cancelled round rolls its window
    ///         forward into the next one instead of dropping those holders.
    uint64 public windowStart;
    /// @notice Anchor that pins rounds to a wall-clock slot: rounds open on the
    ///         first `period` boundary measured from here, NOT `period` after the
    ///         last round. 1785139200 = Monday 2026-07-27 08:00:00 UTC, so with
    ///         period = 1 week every round opens Monday 08:00 UTC.
    /// @dev A plain `lastRoundTime + period` gate drifts: each round opens
    ///      whenever the keeper happens to fire, and that lateness compounds week
    ///      over week until "Monday morning" has slid into Wednesday. Anchoring
    ///      absorbs the lateness instead — a round that opens at 08:04 still
    ///      leaves the next one due at 08:00 the following Monday.
    ///      UTC only: this does NOT observe daylight saving anywhere.
    uint64 public scheduleAnchor;

    /// Automation knobs. Timeouts exist so a round can never sit active forever
    /// waiting on an off-chain party that is never coming back.
    bool public automationEnabled;
    /// @notice Automation forwarder for this upkeep. When set, only it may call
    ///         performUpkeep — Chainlink's recommended hardening. Leave at zero
    ///         to keep the entrypoint open (every action is re-validated, so an
    ///         open entrypoint is safe, just noisier).
    address public automationForwarder;
    uint64 public sharesTimeout; // poster silent -> cancel
    uint64 public vrfTimeout; // VRF silent -> re-request
    uint8 public maxVrfRetries; // then cancel and roll the pot forward
    /// @notice Hard cap on holders paid per distribute() call. Defaults to the
    ///         whole leaderboard: with a 5M upkeep gas limit, a normal holder set
    ///         (EOAs, ~13k gas each) is paid in ONE transaction.
    uint16 public distributeBatchSize;
    /// @notice Gas the payout loop keeps in reserve before starting another
    ///         holder. This is what makes "all 100 at once" safe rather than
    ///         optimistic: the worst-case holder costs ~65k (burns the full 30k
    ///         push stipend, then fails, forcing two cold `claimable` writes), so
    ///         100 of them would need ~6.6M — above what an upkeep can be given.
    ///         Instead of guessing a batch size that fits every possible holder
    ///         set, the loop pays until gas runs low, banks the cursor, and lets
    ///         the next call resume. Must exceed one worst-case payout plus the
    ///         round-closing tail.
    uint32 public gasFloor;

    /// Max holders per round — must match the top-N the backend posts. Bounds
    /// the payload so a bad/oversized shares blob can't freeze a pot.
    uint256 public constant MAX_HOLDERS = 100;

    /// performData action codes (see checkUpkeep).
    uint8 public constant ACTION_NONE = 0;
    uint8 public constant ACTION_START = 1;
    uint8 public constant ACTION_DISTRIBUTE = 2;
    uint8 public constant ACTION_RETRY_VRF = 3;
    uint8 public constant ACTION_CANCEL = 4;

    // ---- events ------------------------------------------------------------

    /// `forced` distinguishes an admin override from a scheduled round, so the
    /// two are auditable apart off-chain.
    event RoundStarted(uint256 indexed roundId, uint256 pot, uint64 timeStart, uint64 timeEnd, bool forced);
    event SharesPosted(uint256 indexed roundId, uint256 holderCount, uint256 vrfRequestId);
    event RandomFulfilled(uint256 indexed roundId, uint256 random);
    event VRFRetried(uint256 indexed roundId, uint256 vrfRequestId, uint8 attempt);
    event RoundProgress(uint256 indexed roundId, uint256 cursor, uint256 holderCount);
    event RoundDistributed(
        uint256 indexed roundId,
        address indexed winner,
        uint256 winnerAmount,
        uint256 distributedAmount,
        uint256 holderCount
    );
    event RoundCancelled(uint256 indexed roundId, uint256 cursor);
    event TransferFailed(address indexed to, uint256 amount);
    event UpkeepPerformed(uint256 indexed roundId, uint8 action);

    // ---- setup -------------------------------------------------------------

    /// @dev Locks the IMPLEMENTATION so nobody can initialize it directly and take
    ///      ownership of the logic contract. State only ever lives in the proxy.
    constructor() {
        _disableInitializers();
    }

    /// @notice Proxy initializer for a FRESH deployment. Replaces the constructor
    ///         — see the contract-level note on why this contract cannot use one.
    /// @param _owner Receives ownership. Passed explicitly rather than defaulting to
    ///        msg.sender, because behind a proxy msg.sender is whatever deployed the
    ///        proxy, which is not necessarily who should own the contract.
    function initialize(
        address _vrfCoordinator,
        uint256 _vrfSubscriptionId,
        bytes32 _vrfKeyHash,
        address _poster,
        address _owner
    ) external initializer {
        if (_poster == address(0)) revert ZeroPoster();
        if (_vrfKeyHash == bytes32(0)) revert ZeroKeyHash();
        if (_vrfSubscriptionId == 0) revert ZeroSubId();
        __VRFConsumerBaseV2Plus_init(_vrfCoordinator, _owner);
        __Pausable_init();
        vrfSubscriptionId = _vrfSubscriptionId;
        vrfKeyHash = _vrfKeyHash;
        poster = _poster;

        // Defaults that used to be field initializers — see the config block.
        period = 1 weeks;
        percentForWinner = 1000; // 10% of the pot
        percentForDistribute = 9000; // 90% of the pot
        vrfGasLimit = 200000; // fulfill only stores one word
        vrfConfirmations = 3;
        vrfNativePayment = true;
        _setAutomationDefaults();
    }

    /// @notice Upgrade path for a proxy that was already initialized before the
    ///         automation state existed. Fills in the appended fields, which are
    ///         all zero on such a proxy — and a zero `distributeBatchSize` pays
    ///         nobody while a zero `windowStart` would open the first round over a
    ///         window starting at the unix epoch.
    /// @dev reinitializer(2), so it can run exactly once on a proxy that already
    ///      ran initialize() and can never run twice. Deliberately takes no
    ///      arguments: the window opens now and every other value is the audited
    ///      default. Use setSchedule/setWindowStart/setAutomationConfig to adjust.
    function initializeAutomation() external reinitializer(2) onlyOwner {
        _setAutomationDefaults();
    }

    function _setAutomationDefaults() internal {
        // The first round covers everything from this moment onward.
        windowStart = uint64(block.timestamp);
        scheduleAnchor = 1785139200; // Monday 2026-07-27 08:00:00 UTC
        automationEnabled = true;
        sharesTimeout = 6 hours; // poster silent -> cancel
        vrfTimeout = 30 minutes; // VRF silent -> re-request
        maxVrfRetries = 3; // then cancel and roll the pot forward
        distributeBatchSize = 100;
        gasFloor = 250000;
    }

    /// @notice Fyuz streams the 0.3% leaderboard fee here on every trade.
    receive() external payable {}

    modifier onlyPoster() {
        if (!(msg.sender == poster || msg.sender == owner())) revert NotPoster();
        _;
    }

    /// @notice Balance that may be paid into a round: everything except what is
    ///         already owed to holders whose payout push failed.
    /// @dev Clamped rather than `balance - totalClaimable`, which would revert on
    ///      underflow and brick startRound/distribute for good if the balance
    ///      ever dipped below what is owed. Nothing should push it there — the
    ///      only outbound paths are payouts, claim() and emergencyWithdraw(), and
    ///      all three respect totalClaimable — but a round freezing permanently
    ///      is too expensive a failure to leave resting on that argument.
    function distributable() public view returns (uint256) {
        uint256 _balance = address(this).balance;
        uint256 _owed = totalClaimable;
        return _balance > _owed ? _balance - _owed : 0;
    }

    // ---- Chainlink Automation ----------------------------------------------

    /// @notice Off-chain simulation hook. Reports the ONE action the round is
    ///         waiting on, if any, encoded as abi.encode(uint8 action, uint256 roundId).
    /// @dev performData is a hint only — performUpkeep re-derives the action
    ///      itself and ignores anything that disagrees, so a malicious keeper
    ///      cannot steer the contract by crafting it.
    function checkUpkeep(bytes calldata)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        (uint8 _action, uint256 _rid) = pendingAction();
        return (_action != ACTION_NONE, abi.encode(_action, _rid));
    }

    /// @notice The action this contract currently needs, or ACTION_NONE.
    ///         Public so the round-runner script and the frontend can show the
    ///         same state Automation sees without simulating an upkeep.
    function pendingAction() public view returns (uint8 action, uint256 rid) {
        if (paused() || !automationEnabled) return (ACTION_NONE, 0);
        rid = roundId;
        Round storage r = rounds[rid];

        if (r.status == 1) {
            if (r.shares.length == 0) {
                // Waiting on the poster. Give up only after sharesTimeout so the
                // pot rolls into a round someone is actually able to run.
                if (block.timestamp >= uint256(r.timeEnd) + sharesTimeout) return (ACTION_CANCEL, rid);
                return (ACTION_NONE, 0);
            }
            if (!r.hasRandom) {
                if (block.timestamp < uint256(r.sharesAt) + vrfTimeout) return (ACTION_NONE, 0);
                // Shares are already committed and immutable, so re-requesting
                // randomness cannot be used to reshape the holder set — it just
                // buys another draw. After maxVrfRetries, stop paying for
                // requests and roll the pot into the next round.
                if (r.vrfRetries >= maxVrfRetries) return (ACTION_CANCEL, rid);
                return (ACTION_RETRY_VRF, rid);
            }
            return (ACTION_DISTRIBUTE, rid);
        }

        // Nothing active: is the next scheduled round due, and is there anything
        // to pay out? No pot means no round — the keeper stays quiet rather than
        // opening an empty round that would just be cancelled hours later.
        if (block.timestamp >= nextRoundAt() && distributable() > 0) {
            return (ACTION_START, rid + 1);
        }
        return (ACTION_NONE, 0);
    }

    /// @notice Automation execution hook. Executes whatever action the contract
    ///         itself says is due — performData is never trusted.
    function performUpkeep(bytes calldata) external override whenNotPaused nonReentrant {
        address _forwarder = automationForwarder;
        if (_forwarder != address(0) && msg.sender != _forwarder) revert NotForwarder();

        (uint8 _action, uint256 _rid) = pendingAction();
        if (_action == ACTION_START) {
            _startRound(false);
        } else if (_action == ACTION_DISTRIBUTE) {
            _distribute(_rid, distributeBatchSize);
        } else if (_action == ACTION_RETRY_VRF) {
            _requestRandomness(_rid, true);
        } else if (_action == ACTION_CANCEL) {
            _cancelRound(_rid);
        } else {
            revert UpkeepNotNeeded();
        }
        emit UpkeepPerformed(_rid, _action);
    }

    // ---- round lifecycle ---------------------------------------------------

    /// @notice Open the next round over [windowStart, now] and snapshot the pot.
    /// @dev Permissionless: it takes no arguments, the window is derived on-chain
    ///      and the schedule gate means it can fire at most once per period, so an
    ///      untrusted caller can only ever do what the keeper would have done.
    ///      That keeps rounds running if Automation is down or unfunded.
    function startRound() external whenNotPaused returns (uint256) {
        return _startRound(false);
    }

    /// @notice Open a round RIGHT NOW, ignoring the schedule. Admin only (poster
    ///         or owner) — the manual override for a missed week, a one-off
    ///         payout, or testing on a fresh deployment.
    /// @dev Does NOT shift the schedule. The next round is still the next anchored
    ///      slot, which may be only hours away — a forced round is an extra payout
    ///      inserted between slots, not a reset of the rhythm. The pot for that
    ///      next round is just the fees earned since, and a round with an empty pot
    ///      never opens, so back-to-back rounds are self-limiting.
    function forceStartRound() external onlyPoster whenNotPaused returns (uint256) {
        return _startRound(true);
    }

    function _startRound(bool _ignoreSchedule) internal returns (uint256) {
        if (rounds[roundId].status == 1) revert RoundAlreadyActive();
        if (!_ignoreSchedule && block.timestamp < nextRoundAt()) revert PeriodNotElapsed();
        // Only the distributable balance is a pot — funds already owed to
        // holders via claim() must not be handed out a second time.
        uint256 _distributable = distributable();
        if (_distributable == 0) revert NothingToDistribute();

        roundId += 1;
        lastRoundTime = block.timestamp;
        Round storage r = rounds[roundId];
        r.status = 1;
        r.timeStart = windowStart;
        r.timeEnd = uint64(block.timestamp);
        r.pot = _distributable;

        // VRF is requested in postShares (once the holder set is committed), NOT
        // here. Requesting it here creates a race: a fast fulfillment sets
        // hasRandom before postShares lands, and the commit-before-reveal check
        // then freezes the round. Deferring removes the race AND strengthens the
        // guarantee — the winner index is provably unpredictable at commit time
        // because the randomness does not exist as a request until after the
        // holder set is locked in.
        emit RoundStarted(roundId, r.pot, r.timeStart, r.timeEnd, _ignoreSchedule);
        return roundId;
    }

    /// @notice Post the leaderboard shares for the active round. Packed 24-byte
    ///         entries: 20-byte address ++ big-endian uint32 share, where a share
    ///         is the holder's fraction of 2^32. The backend serves the exact
    ///         payload at GET /distributor/shares.
    function postShares(uint256 _roundId, bytes calldata _packed) external onlyPoster whenNotPaused {
        Round storage r = rounds[_roundId];
        if (!(_roundId == roundId && r.status == 1)) revert NoActiveRound();
        // Once randomness is in flight the holder set is final: reshaping it
        // afterwards is exactly the attack the commit-before-reveal ordering
        // exists to prevent.
        if (r.vrfRequestId != 0) revert SharesAlreadyPosted();
        if (!(_packed.length > 0 && _packed.length % 24 == 0)) revert InvalidPackedLength();
        uint256 _count = _packed.length / 24;
        if (_count > MAX_HOLDERS) revert TooManyHolders();

        // Sum of shares must not exceed 2^32 (100%). If it did, early holders in
        // the payout loop would be over-paid and later holders/the winner starved
        // when the balance ran out. This catches an honest backend bug too.
        uint256 _sum;
        for (uint256 i = 0; i < _count; i++) {
            uint256 _off = i * 24 + 20; // the 4 bytes after each 20-byte address
            _sum += uint32(bytes4(_packed[_off:_off + 4]));
        }
        if (_sum > uint256(type(uint32).max) + 1) revert SharesExceedTotal();

        r.shares = _packed;
        r.holderCount = uint16(_count);
        r.sharesAt = uint64(block.timestamp);

        // Shares are committed — now request randomness. Fulfillment can only
        // arrive after this point, so distribute()'s inputs are always ordered.
        uint256 _requestId = _requestRandomness(_roundId, false);
        emit SharesPosted(_roundId, _count, _requestId);
    }

    /// @dev `_isRetry` guards the Automation/manual re-request path: only a round
    ///      that has genuinely gone quiet past vrfTimeout may draw again.
    function _requestRandomness(uint256 _roundId, bool _isRetry) internal returns (uint256) {
        Round storage r = rounds[_roundId];
        if (_isRetry) {
            if (!(_roundId == roundId && r.status == 1)) revert NoActiveRound();
            if (r.shares.length == 0) revert SharesPending();
            if (r.hasRandom) revert RandomAlreadyRevealed();
            if (block.timestamp < uint256(r.sharesAt) + vrfTimeout) revert VRFNotStalled();
            if (r.vrfRetries >= maxVrfRetries) revert VRFNotStalled();
            r.vrfRetries += 1;
            // Restart the clock so the next retry waits another vrfTimeout.
            r.sharesAt = uint64(block.timestamp);
        }

        uint256 _requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubscriptionId,
                requestConfirmations: vrfConfirmations,
                callbackGasLimit: vrfGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: vrfNativePayment}))
            })
        );
        r.vrfRequestId = _requestId;
        vrfRequests[_requestId] = _roundId;
        if (_isRetry) emit VRFRetried(_roundId, _requestId, r.vrfRetries);
        return _requestId;
    }

    /// @notice Manually re-request randomness for a stalled round. Same guards as
    ///         the Automation path — permissionless because it can only fire on a
    ///         round that has already been quiet past vrfTimeout.
    function retryVRF(uint256 _roundId) external whenNotPaused returns (uint256) {
        return _requestRandomness(_roundId, true);
    }

    function fulfillRandomWords(uint256 _requestId, uint256[] calldata _randomWords) internal override {
        uint256 _rid = vrfRequests[_requestId];
        Round storage r = rounds[_rid];
        // Stale fulfillments (cancelled/paid rounds, or a retry racing the
        // original request) are ignored, not reverted — reverting would burn the
        // VRF payment for nothing and mark the request unfulfillable.
        if (_rid == 0 || r.status != 1 || r.hasRandom) return;
        r.random = _randomWords[0];
        r.hasRandom = true;
        emit RandomFulfilled(_rid, _randomWords[0]);
    }

    /// @notice True when `_roundId` still has payouts to push.
    function isPayable(uint256 _roundId) public view returns (bool) {
        Round storage r = rounds[_roundId];
        return !paused() && _roundId == roundId && r.status == 1 && r.hasRandom && r.shares.length > 0;
    }

    /// @notice Pay out the round once shares and randomness are in. Pays every
    ///         holder in one call when the gas allows (the normal case), otherwise
    ///         stops at `gasFloor`, banks the cursor and resumes on the next call.
    ///         Call until the round reports status 2.
    /// @dev Permissionless — every input is already committed on-chain and every
    ///      precondition is re-checked, so an untrusted caller (the Automation
    ///      forwarder, a cron, a human) can only pay a round that was payable.
    ///
    ///      `nonReentrant` IS LOAD-BEARING, do not remove it. The payout cursor is
    ///      committed once after the loop (banking it per holder would cost an
    ///      SSTORE each and defeat the gas-aware batching), so mid-loop the stored
    ///      cursor is stale. A holder that re-entered distributeBatch(rid, 1) would
    ///      read that stale cursor and be paid a SECOND time: ~13k gas covers the
    ///      re-entrant call for a modest holder set, comfortably inside the 30k
    ///      push stipend, so the stipend alone was never a sufficient guard. The
    ///      surplus payout came out of the winner's 10% and the next round's fees,
    ///      and once the balance ran short the winner's push failed into
    ///      `claimable`, pushing totalClaimable above the real balance and
    ///      permanently zeroing distributable() — a bricked contract, not just a
    ///      theft. See test_reentrantDistributeCannotDoublePay.
    function distribute(uint256 _roundId) external whenNotPaused nonReentrant {
        _distribute(_roundId, distributeBatchSize);
    }

    /// @notice distribute() with an explicit batch size, for manual recovery when
    ///         the configured size does not fit the caller's gas budget.
    function distributeBatch(uint256 _roundId, uint16 _max) external whenNotPaused nonReentrant {
        if (_max == 0) revert ZeroBatchSize();
        _distribute(_roundId, _max);
    }

    function _distribute(uint256 _roundId, uint16 _max) internal {
        Round storage r = rounds[_roundId];
        if (!(_roundId == roundId && r.status == 1)) revert NoActiveRound();
        if (!r.hasRandom) revert RandomnessPending();
        if (r.shares.length == 0) revert SharesPending();

        // The pot was snapshotted at startRound; fees that stream in during the
        // round stay for the NEXT one. Deliberately NOT clamped to the current
        // distributable balance: a resumable payout spends that balance down as
        // it goes, so clamping would shrink the pot between batches and underpay
        // everyone after the first. The snapshot can only outrun the balance if
        // an emergencyWithdraw drained it, and that cancels the active round
        // first precisely so this loop never sees a pot it cannot cover.
        uint256 _pot = r.pot;

        uint256 _count = r.holderCount;
        uint256 _cursor = r.cursor;
        uint256 _end = _cursor + _max;
        if (_end > _count) _end = _count;

        uint256 _distributeAmount = (_pot * percentForDistribute) / 10000;
        bytes memory _packed = r.shares;
        uint256 _floor = gasFloor;

        uint256 _paid;
        uint256 _i = _cursor;
        for (; _i < _end; _i++) {
            // Stop while there is still gas to COMMIT the progress made so far.
            // A batch that runs the tank dry reverts, loses the cursor, and gets
            // retried identically forever — the exact freeze this design exists
            // to avoid. Always pay at least one holder so the round cannot stall
            // on a caller that supplies a stingy gas limit.
            if (_i > _cursor && gasleft() < _floor) break;
            (address _holder, uint32 _share) = _entryAt(_packed, _i);
            uint256 _amount = (_distributeAmount * uint256(_share)) / (uint256(type(uint32).max) + 1);
            _paid += _payOrCredit(_holder, _amount);
        }
        r.cursor = uint16(_i);

        if (_i < _count) {
            emit RoundProgress(_roundId, _i, _count);
            return;
        }

        // Last batch: settle the lottery and close the round. One uniform ticket
        // per participant — small traders have the same shot at the 10% bonus as
        // whales.
        uint256 _winnerAmount = (_pot * percentForWinner) / 10000;
        (address _winner,) = _entryAt(_packed, r.random % _count);

        // Close the round BEFORE the last payout goes out. The 30k stipend makes
        // re-entry infeasible today, but ordering the state write first means the
        // guarantee does not rest on that stipend staying where it is.
        r.status = 2;
        // The window only advances on a PAID round, so the next round picks up
        // exactly where this one left off.
        windowStart = r.timeEnd;

        _paid += _payOrCredit(_winner, _winnerAmount);

        emit RoundDistributed(_roundId, _winner, _winnerAmount, _paid, _count);
    }

    /// @notice Void a stuck round (poster outage, bad shares). The pot stays in
    ///         the contract and is included in the next round's snapshot.
    function cancelRound() external onlyPoster {
        _cancelRound(roundId);
    }

    function _cancelRound(uint256 _roundId) internal {
        Round storage r = rounds[_roundId];
        if (r.status != 1) revert NoActiveRound();
        r.status = 3;
        // A cancelled round paid (almost) nobody, so it must not consume the
        // period: leaving lastRoundTime in place would cost holders a full extra
        // period on top of the outage itself.
        lastRoundTime = 0;
        // windowStart normally stays put so this window's holders are folded into
        // the next round. But if the payout loop already paid someone, the window
        // is PARTIALLY SETTLED: re-scoring it would pay those holders a second
        // time out of the next round's pot. Advance the window in that case. The
        // holders past the cursor forfeit this window rather than everyone before
        // it being double-paid, and the unspent pot still rolls forward.
        if (r.cursor > 0) windowStart = r.timeEnd;
        emit RoundCancelled(_roundId, r.cursor);
    }

    // ---- internals ---------------------------------------------------------

    /// Read entry `_i` out of the packed blob: 20-byte address ++ uint32 share.
    /// @dev The final entry's mload reads 8 bytes past the array; both are masked
    ///      away, and memory reads past the end are safe (the region is zero or
    ///      unrelated scratch, never a revert).
    function _entryAt(bytes memory _data, uint256 _i) internal pure returns (address _holder, uint32 _share) {
        assembly {
            let _word := mload(add(add(_data, 32), mul(_i, 24)))
            _holder := shr(96, _word)
            _share := and(shr(64, _word), 0xffffffff)
        }
    }

    /// Pay `_to` directly, or credit `claimable` if the push fails. Returns the
    /// amount accounted for (paid or credited) so distribute() can track it.
    /// Push-then-credit keeps payouts non-blocking: a holder that reverts, runs
    /// out of the gas stipend (contract/AA wallets), or is address(0) never
    /// stalls the round — their funds wait in claimable for claim().
    function _payOrCredit(address _to, uint256 _amount) internal returns (uint256) {
        if (_amount == 0 || _to == address(0)) return 0;
        (bool _success,) = payable(_to).call{value: _amount, gas: 30000}("");
        if (!_success) {
            claimable[_to] += _amount;
            totalClaimable += _amount;
            emit TransferFailed(_to, _amount);
        }
        return _amount;
    }

    /// @notice Withdraw funds credited to you by a failed payout push.
    function claim() external nonReentrant {
        uint256 _amount = claimable[msg.sender];
        if (_amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= _amount;
        (bool _success,) = payable(msg.sender).call{value: _amount}("");
        if (!_success) revert ClaimTransferFailed();
    }

    // ---- views -------------------------------------------------------------

    /// @notice Flat round header for scripts and the frontend — cheaper to parse
    ///         than the auto-generated `rounds` getter, which also returns the
    ///         full shares blob.
    function roundState(uint256 _roundId)
        external
        view
        returns (
            uint8 status,
            uint64 timeStart,
            uint64 timeEnd,
            bool hasRandom,
            uint256 pot,
            uint16 cursor,
            uint16 holderCount,
            uint8 vrfRetries
        )
    {
        Round storage r = rounds[_roundId];
        return (r.status, r.timeStart, r.timeEnd, r.hasRandom, r.pot, r.cursor, r.holderCount, r.vrfRetries);
    }

    /// @notice Timestamp of the next scheduled round opening — the first
    ///         anchor-aligned slot strictly after the last round. With the
    ///         defaults this is always a Monday at 08:00:00 UTC.
    /// @dev A round that opens late lands in the same slot, so lateness never
    ///      pushes the schedule forward. If the contract sat idle for weeks (no
    ///      pot, or repeated cancels) the returned slot is simply in the past and
    ///      the next round opens immediately — it catches up once, not once per
    ///      missed week.
    function nextRoundAt() public view returns (uint256) {
        uint256 _anchor = scheduleAnchor;
        uint256 _last = lastRoundTime;
        // Before the anchor (and after a cancel, which zeroes lastRoundTime) the
        // very next round is due right away.
        if (_last < _anchor) return _anchor;
        uint256 _period = period;
        return _anchor + ((_last - _anchor) / _period + 1) * _period;
    }

    /// @notice The (address, share) pair at `_i` in `_roundId`'s committed set.
    function holderAt(uint256 _roundId, uint256 _i) external view returns (address, uint32) {
        return _entryAt(rounds[_roundId].shares, _i);
    }

    // ---- admin -------------------------------------------------------------

    /// @notice Top up the VRF subscription with BNB (v2.5 native payment).
    function fundVRF() external payable onlyOwner {
        s_vrfCoordinator.fundSubscriptionWithNative{value: msg.value}(vrfSubscriptionId);
    }

    function setPoster(address _poster) external onlyOwner {
        if (_poster == address(0)) revert ZeroPoster();
        poster = _poster;
    }

    /// @notice Set the payout cadence and the wall-clock slot it lands on.
    ///         `_anchor` is any timestamp at the desired slot; every round then
    ///         opens at `_anchor + n * _period`. For Monday 08:00 UTC weekly:
    ///         setSchedule(1785139200, 1 weeks).
    function setSchedule(uint64 _anchor, uint256 _period) external onlyOwner {
        if (_period == 0) revert ZeroPeriod();
        scheduleAnchor = _anchor;
        period = _period;
    }

    function setPercents(uint256 _forWinner, uint256 _forDistribute) external onlyOwner {
        if (_forWinner + _forDistribute > 10000) revert BpsTooHigh();
        percentForWinner = _forWinner;
        percentForDistribute = _forDistribute;
    }

    function setVRFConfig(
        uint256 _subscriptionId,
        bytes32 _keyHash,
        uint32 _gasLimit,
        uint16 _confirmations,
        bool _nativePayment
    ) external onlyOwner {
        if (_subscriptionId > 0) vrfSubscriptionId = _subscriptionId;
        if (uint256(_keyHash) > 0) vrfKeyHash = _keyHash;
        if (_gasLimit > 0) vrfGasLimit = _gasLimit;
        if (_confirmations > 0) vrfConfirmations = _confirmations;
        vrfNativePayment = _nativePayment;
    }

    /// @notice Automation wiring. `_forwarder` may be zero to leave performUpkeep
    ///         open; set it to the registry's forwarder for this upkeep once the
    ///         upkeep is registered.
    function setAutomationConfig(
        bool _enabled,
        address _forwarder,
        uint64 _sharesTimeout,
        uint64 _vrfTimeout,
        uint8 _maxVrfRetries,
        uint16 _batchSize,
        uint32 _gasFloor
    ) external onlyOwner {
        if (_batchSize == 0) revert ZeroBatchSize();
        // A floor below one worst-case payout lets the loop start a holder it
        // cannot finish, which reverts the batch and loses the progress.
        if (_gasFloor < 100000) revert GasFloorTooLow();
        automationEnabled = _enabled;
        automationForwarder = _forwarder;
        sharesTimeout = _sharesTimeout;
        vrfTimeout = _vrfTimeout;
        maxVrfRetries = _maxVrfRetries;
        distributeBatchSize = _batchSize;
        gasFloor = _gasFloor;
    }

    /// @notice Move the scoring window by hand. Only needed to align the first
    ///         round with the backend's epoch — a live round would otherwise be
    ///         paying out a window the backend never scored.
    function setWindowStart(uint64 _windowStart) external onlyOwner {
        if (rounds[roundId].status == 1) revert RoundAlreadyActive();
        windowStart = _windowStart;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Drain the pot in an emergency. Withdraws the distributable balance
    ///         only — money already credited to holders by a failed payout push
    ///         stays behind so claim() keeps working.
    /// @dev Cancels the active round first. Without that, a half-paid round would
    ///      keep a cursor pointing into a pot that no longer exists, and the
    ///      remaining pushes would fail into `claimable`, inflating totalClaimable
    ///      past the real balance.
    function emergencyWithdraw(address _to) external onlyOwner whenPaused nonReentrant {
        if (rounds[roundId].status == 1) _cancelRound(roundId);
        (bool _success,) = payable(_to).call{value: distributable()}("");
        if (!_success) revert WithdrawFailed();
    }

    function withdrawToken(address _token, address _to) external onlyOwner whenPaused {
        if (!IERC20(_token).transfer(_to, IERC20(_token).balanceOf(address(this)))) revert TokenTransferFailed();
    }
}
