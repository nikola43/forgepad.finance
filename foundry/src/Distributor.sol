// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Fyuz leaderboard fee Distributor (BSC)
/// @notice Receives the protocol's 0.3% leaderboard fee stream (BNB) from Fyuz
///         and periodically distributes it to leaderboard participants:
///           - 90% pro-rata by leaderboard share (points in the round window)
///           - 10% to ONE participant picked uniformly by Chainlink VRF —
///             every participant holds one lottery ticket regardless of size,
///             which keeps small traders engaged.
///
/// @dev Chain reality check: Chainlink Functions does NOT exist on BSC, so the
///      previous design (DON fetches shares from our API) cannot run here. The
///      shares are instead posted by an authorized `poster` key operated by the
///      backend — the SAME trust root as before, since Functions only ever
///      relayed what our API returned. Winner selection stays trustless via
///      VRF v2.5 (native-BNB payment; no LINK juggling, no Uniswap LINK buys).
///
/// Round lifecycle (driven by the backend round-runner, see scripts/):
///   1. startRound(from, to)  — snapshots the pot, requests VRF
///   2. postShares(id, bytes) — packed (address,uint32-share) entries
///   3. VRF fulfills          — stores the random word
///   4. distribute(id)        — anyone; pays 90% pro-rata + 10% to the winner
///   Stuck rounds (VRF outage, bad shares) are cancelled by the poster/owner;
///   the pot simply rolls into the next round.
///
/// @dev Steps 1, 2 and 4 are all driven by the CRE workflow through CREPoster
///      (see cre/distributor-runner). Chainlink Automation used to run step 4,
///      but Automation v2.1 sunsets 2026-07-31, so that entrypoint is gone —
///      distribute() is permissionless anyway, so any keeper, cron or human can
///      finish a round if CRE is down.
contract Distributor is VRFConsumerBaseV2Plus, Pausable {

    // Custom errors (one per former require/revert string).
    error BpsTooHigh(); // was: "Cannot exceed 100%"
    error ClaimTransferFailed(); // was: "Claim transfer failed"
    error InvalidPackedLength(); // was: "Invalid packed length"
    error NoActiveRound(); // was: "No active round"
    error NotPoster(); // was: "Not poster"
    error NothingToClaim(); // was: "Nothing to claim"
    error NothingToDistribute(); // was: "Nothing to distribute"
    error PeriodNotElapsed(); // was: "Period not elapsed"
    error RandomAlreadyRevealed(); // was: "Random already revealed"
    error RandomnessPending(); // was: "Randomness pending"
    error RoundAlreadyActive(); // was: "Round already active"
    error SharesExceedTotal(); // was: "Shares exceed 100%"
    error SharesPending(); // was: "Shares pending"
    error TokenTransferFailed(); // was: "Token transfer failed"
    error TooManyHolders(); // was: "Too many holders"
    error WithdrawFailed(); // was: "Withdraw failed"
    error ZeroKeyHash(); // was: "Zero keyHash"
    error ZeroPoster(); // was: "Zero poster"
    error ZeroSubId(); // was: "Zero subId"
    // ---- round state -------------------------------------------------------

    // status: 0 = none, 1 = active (awaiting shares and/or VRF), 2 = paid, 3 = cancelled
    struct Round {
        uint8 status;
        uint64 timeStart;   // leaderboard window covered by this round (informational,
        uint64 timeEnd;     // echoed in events so payouts are auditable off-chain)
        bool hasRandom;
        uint256 pot;        // balance snapshot at startRound
        uint256 random;
        uint256 vrfRequestId;
        bytes shares;       // packed 24-byte entries: address(20) ++ uint32 share(4)
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

    uint256 public period = 1 weeks;
    uint256 public percentForWinner = 1000;     // 10% of the pot, basis points
    uint256 public percentForDistribute = 9000; // 90% of the pot, basis points
    /// @notice Backend key allowed to run rounds and post shares.
    address public poster;

    uint256 public vrfSubscriptionId;
    bytes32 public vrfKeyHash;
    uint32 public vrfGasLimit = 200000; // fulfill only stores one word
    uint16 public vrfConfirmations = 3;
    bool public vrfNativePayment = true;

    // ---- events ------------------------------------------------------------

    event RoundStarted(uint256 indexed roundId, uint256 pot, uint64 timeStart, uint64 timeEnd, uint256 vrfRequestId);
    event SharesPosted(uint256 indexed roundId, uint256 holderCount);
    event RandomFulfilled(uint256 indexed roundId, uint256 random);
    event RoundDistributed(uint256 indexed roundId, address indexed winner, uint256 winnerAmount, uint256 distributedAmount, uint256 holderCount);
    event RoundCancelled(uint256 indexed roundId);
    event TransferFailed(address indexed to, uint256 amount);

    // ---- setup -------------------------------------------------------------

    constructor(
        address _vrfCoordinator,
        uint256 _vrfSubscriptionId,
        bytes32 _vrfKeyHash,
        address _poster
    ) VRFConsumerBaseV2Plus(_vrfCoordinator) {
        if (_poster == address(0)) revert ZeroPoster();
        if (_vrfKeyHash == bytes32(0)) revert ZeroKeyHash();
        if (_vrfSubscriptionId == 0) revert ZeroSubId();
        vrfSubscriptionId = _vrfSubscriptionId;
        vrfKeyHash = _vrfKeyHash;
        poster = _poster;
    }

    /// Max holders per round — must match the top-N the backend posts. Bounds
    /// the distribute() loop so a bad/oversized shares payload can't push the
    /// round past the block gas limit and freeze the pot.
    uint256 public constant MAX_HOLDERS = 100;

    /// @notice Fyuz streams the 0.3% leaderboard fee here on every trade.
    receive() external payable {}

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

    modifier onlyPoster() {
        if (!(msg.sender == poster || msg.sender == owner())) revert NotPoster();
        _;
    }

    // ---- round lifecycle ---------------------------------------------------

    /// @notice Open a distribution round for the leaderboard window [_timeStart, _timeEnd].
    ///         Snapshots the current balance as the pot and requests VRF randomness.
    function startRound(uint64 _timeStart, uint64 _timeEnd) external onlyPoster whenNotPaused returns (uint256) {
        if (rounds[roundId].status == 1) revert RoundAlreadyActive();
        if (block.timestamp < lastRoundTime + period) revert PeriodNotElapsed();
        // Only the distributable balance is a pot — funds already owed to
        // holders via claim() must not be handed out a second time.
        uint256 _distributable = distributable();
        if (_distributable == 0) revert NothingToDistribute();

        roundId += 1;
        lastRoundTime = block.timestamp;
        Round storage r = rounds[roundId];
        r.status = 1;
        r.timeStart = _timeStart;
        r.timeEnd = _timeEnd;
        r.pot = _distributable;

        // VRF is requested in postShares (once the shares are committed), NOT here.
        // Requesting it here created a race: a fast fulfillment could set hasRandom
        // before postShares landed, and postShares then reverted RandomAlreadyRevealed,
        // freezing the round until a manual cancel. Deferring the request removes the
        // race entirely AND strengthens the original guarantee — the winner index is
        // provably unpredictable at commit time because the randomness does not even
        // exist as a request until after the holder set is locked in.
        emit RoundStarted(roundId, r.pot, _timeStart, _timeEnd, 0);
        return roundId;
    }

    /// @notice Post the leaderboard shares for the active round. Packed 24-byte
    ///         entries: 20-byte address ++ big-endian uint32 share, where a share
    ///         is the holder's fraction of 2^32. The backend serves the exact
    ///         payload at GET /distributor/shares.
    function postShares(uint256 _roundId, bytes calldata _packed) external onlyPoster {
        Round storage r = rounds[_roundId];
        if (!(_roundId == roundId && r.status == 1)) revert NoActiveRound();
        // The VRF request goes out at the END of this call, so a first postShares
        // can never race a fulfillment. Once requested (vrfRequestId set), reposting
        // is rejected: reshaping the holder set after randomness is in flight is
        // exactly the attack the commit-before-reveal ordering exists to prevent.
        if (r.vrfRequestId != 0) revert RandomAlreadyRevealed();
        if (!(_packed.length > 0 && _packed.length % 24 == 0)) revert InvalidPackedLength();
        uint256 _count = _packed.length / 24;
        if (_count > MAX_HOLDERS) revert TooManyHolders();

        // Sum of shares must not exceed 2^32 (100%). If it did, early holders in
        // the loop would be over-paid and later holders/the winner starved when
        // the balance runs out. Rejecting here catches an honest backend bug too.
        uint256 _sum;
        for (uint256 i = 0; i < _count; i++) {
            // share is the 4 bytes after each 20-byte address
            uint256 _off = i * 24 + 20;
            uint32 _share = uint32(bytes4(_packed[_off:_off + 4]));
            _sum += _share;
        }
        if (!(_sum <= uint256(type(uint32).max) + 1)) revert SharesExceedTotal();

        r.shares = _packed;

        // Shares are now committed — request randomness. Fulfillment can only ever
        // arrive after this point, so distribute()'s inputs are always ordered
        // (shares first, random second) and postShares has no race to lose.
        uint256 _requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubscriptionId,
                requestConfirmations: vrfConfirmations,
                callbackGasLimit: vrfGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: vrfNativePayment})
                )
            })
        );
        r.vrfRequestId = _requestId;
        vrfRequests[_requestId] = _roundId;

        emit SharesPosted(_roundId, _count);
    }

    function fulfillRandomWords(uint256 _requestId, uint256[] calldata _randomWords) internal override {
        uint256 _rid = vrfRequests[_requestId];
        Round storage r = rounds[_rid];
        // Stale fulfillments (cancelled/paid rounds) are ignored, not reverted —
        // reverting would burn the VRF payment for nothing.
        if (_rid == 0 || r.status != 1) return;
        r.random = _randomWords[0];
        r.hasRandom = true;
        emit RandomFulfilled(_rid, _randomWords[0]);
    }

    /// @notice True when `_roundId` has everything it needs to be paid out.
    ///         Free off-chain read — the CRE workflow polls this to decide
    ///         whether this tick should drive a distribution.
    function isPayable(uint256 _roundId) public view returns (bool) {
        Round storage r = rounds[_roundId];
        return
            !paused() &&
            _roundId == roundId &&
            r.status == 1 &&
            r.hasRandom &&
            r.shares.length > 0;
    }

    /// @notice Pay the round out once both the shares and the randomness are in.
    ///         Anyone can call — all inputs are already committed on-chain, and
    ///         every precondition is re-checked here, so an untrusted caller
    ///         (CRE's forwarder, a cron, a human) can only ever pay a round that
    ///         was genuinely payable.
    function distribute(uint256 _roundId) external whenNotPaused {
        Round storage r = rounds[_roundId];
        if (!(_roundId == roundId && r.status == 1)) revert NoActiveRound();
        if (!r.hasRandom) revert RandomnessPending();
        if (r.shares.length <= 0) revert SharesPending();
        r.status = 2;

        (address[] memory _holders, uint32[] memory _shares) = _unpackShares(r.shares);

        // The pot was snapshotted at startRound; fees keep streaming in during
        // the round and stay for the NEXT round. Cap at the distributable
        // balance in case an emergencyWithdraw shrank it, and never dip into
        // funds already owed via claim().
        uint256 _pot = r.pot;
        uint256 _distributable = distributable();
        if (_pot > _distributable) _pot = _distributable;

        uint256 _winnerAmount = (_pot * percentForWinner) / 10000;
        uint256 _distributeAmount = (_pot * percentForDistribute) / 10000;

        uint256 _paid;
        for (uint256 i = 0; i < _holders.length; i++) {
            uint256 _amount = (_distributeAmount * uint256(_shares[i])) / (uint256(type(uint32).max) + 1);
            _paid += _payOrCredit(_holders[i], _amount);
        }

        // One uniform lottery ticket per participant — small traders have the
        // same shot at the 10% bonus as whales.
        address _winner = _holders[r.random % _holders.length];
        _paid += _payOrCredit(_winner, _winnerAmount);

        emit RoundDistributed(_roundId, _winner, _winnerAmount, _paid, _holders.length);
    }

    /// @notice Void a stuck round (VRF outage, wrong shares). The pot stays in
    ///         the contract and is included in the next round's snapshot.
    function cancelRound() external onlyPoster {
        Round storage r = rounds[roundId];
        if (r.status != 1) revert NoActiveRound();
        r.status = 3;
        // A cancelled round paid nobody, so it must not consume the period.
        // Leaving lastRoundTime where startRound put it meant a VRF outage cost
        // holders a full extra period (a week) on top of the outage itself;
        // clearing it lets the next round open as soon as the poster is ready.
        lastRoundTime = 0;
        emit RoundCancelled(roundId);
    }

    // ---- internals ---------------------------------------------------------

    function _unpackShares(bytes memory _data) internal pure returns (address[] memory, uint32[] memory) {
        uint256 _count = _data.length / 24;
        address[] memory _holders = new address[](_count);
        uint32[] memory _shares = new uint32[](_count);
        assembly {
            let _dataPtr := add(_data, 20)
            let _holderPtr := add(_holders, 32)
            let _sharePtr := add(_shares, 32)
            for { let i := 0 } lt(i, _count) { i := add(i, 1) } {
                let _addr := and(mload(_dataPtr), 0xffffffffffffffffffffffffffffffffffffffff)
                _dataPtr := add(_dataPtr, 4)
                let _share := and(mload(_dataPtr), 0xffffffff)
                _dataPtr := add(_dataPtr, 20)
                mstore(_holderPtr, _addr)
                mstore(_sharePtr, _share)
                _holderPtr := add(_holderPtr, 32)
                _sharePtr := add(_sharePtr, 32)
            }
        }
        return (_holders, _shares);
    }

    /// Pay `_to` directly, or credit `claimable` if the push fails. Returns the
    /// amount accounted for (paid or credited) so distribute() can track it.
    /// Push-then-credit keeps distribute() non-blocking: a holder that reverts,
    /// runs out of the gas stipend (contract/AA wallets), or is address(0)
    /// never stalls the round — their funds wait in claimable for withdraw().
    function _payOrCredit(address _to, uint256 _amount) internal returns (uint256) {
        if (_amount == 0 || _to == address(0)) return 0;
        (bool _success, ) = payable(_to).call{value: _amount, gas: 30000}("");
        if (!_success) {
            claimable[_to] += _amount;
            totalClaimable += _amount;
            emit TransferFailed(_to, _amount);
        }
        return _amount;
    }

    /// @notice Withdraw funds credited to you by a failed payout push.
    function claim() external {
        uint256 _amount = claimable[msg.sender];
        if (_amount <= 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= _amount;
        (bool _success, ) = payable(msg.sender).call{value: _amount}("");
        if (!_success) revert ClaimTransferFailed();
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

    function setPeriod(uint256 _period) external onlyOwner {
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Drain the pot in an emergency. Withdraws the distributable balance
    ///         only — money already credited to holders by a failed payout push
    ///         stays behind so claim() keeps working. Taking the whole balance
    ///         here both stole those funds and left totalClaimable pointing at
    ///         money that no longer existed.
    function emergencyWithdraw(address _to) external onlyOwner whenPaused {
        (bool _success, ) = payable(_to).call{value: distributable()}("");
        if (!_success) revert WithdrawFailed();
    }

    function withdrawToken(address _token, address _to) external onlyOwner whenPaused {
        if (!(IERC20(_token).transfer(_to, IERC20(_token).balanceOf(address(this))))) revert TokenTransferFailed();
    }
}
