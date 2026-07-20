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
///         distribute() itself stays with Chainlink Automation.
///
///         Report payload: abi.encode(uint64 timeStart, uint64 timeEnd, bytes packed)
///         where packed is the Distributor's 24-byte address++share format.
contract CREPoster is IReceiver {
    error NotForwarder();
    error NotOwner();

    event RoundDriven(uint256 indexed roundId, uint256 holderCount);
    event ForwarderSet(address indexed forwarder, bool allowed);

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

    /// @notice True when a new round is due. The CRE workflow reads this first
    ///         so it only submits a report (and pays gas) when there is work.
    ///         onReport re-checks it, so a stale or duplicate report is a no-op.
    function ready() public view returns (bool) {
        (uint8 _status, , , , , , , ) = distributor.rounds(distributor.roundId());
        if (_status == 1) return false; // round in flight; Automation finishes it
        if (block.timestamp < distributor.lastRoundTime() + distributor.period()) return false;
        return address(distributor).balance > distributor.totalClaimable();
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata, bytes calldata report) external {
        if (!forwarders[msg.sender]) revert NotForwarder();
        (uint64 _from, uint64 _to, bytes memory _packed) = abi.decode(report, (uint64, uint64, bytes));
        if (!ready() || _packed.length == 0) return; // stale/duplicate/empty — ignore
        uint256 _rid = distributor.startRound(_from, _to);
        distributor.postShares(_rid, _packed);
        emit RoundDriven(_rid, _packed.length / 24);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
