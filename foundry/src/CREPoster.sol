// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Distributor} from "./Distributor.sol";

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// Chainlink CRE report receiver (keystone forwarder calls onReport).
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @notice Bridges Chainlink CRE to the Distributor. A CRE workflow fetches the
///         top-100 leaderboard shares from the backend and delivers them here as
///         a signed report; this contract (set as the Distributor's poster)
///         drives startRound + postShares in one tx, so an active round always
///         means "shares committed, waiting on VRF" — no resume path needed.
///
///         CRE drives the payout too. Chainlink Automation used to call
///         distribute() once VRF landed, but Automation v2.1 sunsets 2026-07-31,
///         so a later tick of the same workflow finishes the round instead:
///         work() tells the workflow which of the two jobs is outstanding.
///
///         Report payload: abi.encode(uint64 timeStart, uint64 timeEnd, bytes packed)
///         where packed is the Distributor's 24-byte address++share format.
///         For a payout tick the payload is ignored — the chain state decides.
contract CREPoster is IReceiver {
    error NotForwarder();
    error NotOwner();

    event RoundDriven(uint256 indexed roundId, uint256 holderCount);
    event RoundPaid(uint256 indexed roundId);
    event ForwarderSet(address indexed forwarder, bool allowed);

    uint8 public constant WORK_NONE = 0;
    uint8 public constant WORK_START_ROUND = 1;
    uint8 public constant WORK_DISTRIBUTE = 2;

    Distributor public immutable distributor;
    address public owner;
    /// Keystone forwarders allowed to deliver reports. Both the production
    /// KeystoneForwarder and the MockKeystoneForwarder used by
    /// `cre workflow simulate --broadcast` can be enabled at once.
    mapping(address => bool) public forwarders;

    constructor(Distributor _distributor, address _forwarder) {
        distributor = _distributor;
        owner = msg.sender;
        forwarders[_forwarder] = true;
        emit ForwarderSet(_forwarder, true);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setForwarder(address _forwarder, bool _allowed) external onlyOwner {
        forwarders[_forwarder] = _allowed;
        emit ForwarderSet(_forwarder, _allowed);
    }

    function setOwner(address _owner) external onlyOwner {
        owner = _owner;
    }

    /// @notice What this tick should do, if anything. The CRE workflow reads it
    ///         first so it only submits a report (and pays gas) when there is
    ///         work — and so it knows whether it needs the shares API at all.
    ///         onReport re-derives it, so a stale or duplicate report is a no-op.
    /// @return WORK_NONE, WORK_START_ROUND or WORK_DISTRIBUTE.
    function work() public view returns (uint8) {
        // A paused Distributor rejects both jobs. Without this the workflow saw
        // "due", paid for a report every tick, and onReport reverted — invisibly,
        // because the forwarder swallows receiver reverts.
        if (distributor.paused()) return WORK_NONE;
        uint256 _rid = distributor.roundId();
        // Shares + VRF are both in: finish the round before opening another.
        if (distributor.isPayable(_rid)) return WORK_DISTRIBUTE;
        (uint8 _status, , , , , , , ) = distributor.rounds(_rid);
        if (_status == 1) return WORK_NONE; // in flight, still waiting on VRF
        if (block.timestamp < distributor.lastRoundTime() + distributor.period()) return WORK_NONE;
        return distributor.distributable() > 0 ? WORK_START_ROUND : WORK_NONE;
    }

    /// @notice True when a NEW round is due (WORK_START_ROUND).
    function ready() public view returns (bool) {
        return work() == WORK_START_ROUND;
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata, bytes calldata report) external {
        if (!forwarders[msg.sender]) revert NotForwarder();
        uint8 _work = work();

        if (_work == WORK_DISTRIBUTE) {
            // Payout tick: the report payload is irrelevant, every input was
            // committed on-chain rounds ago. Distributor.distribute re-checks.
            uint256 _rid = distributor.roundId();
            distributor.distribute(_rid);
            emit RoundPaid(_rid);
            return;
        }
        if (_work != WORK_START_ROUND) return; // stale/duplicate — ignore

        (uint64 _from, uint64 _to, bytes memory _packed) = abi.decode(report, (uint64, uint64, bytes));
        if (_packed.length == 0) return; // empty leaderboard — nothing to pay
        uint256 _newRid = distributor.startRound(_from, _to);
        distributor.postShares(_newRid, _packed);
        emit RoundDriven(_newRid, _packed.length / 24);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
