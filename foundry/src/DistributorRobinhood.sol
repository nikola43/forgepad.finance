// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AutomationCompatibleInterface} from "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Fyuz leaderboard fee Distributor (Robinhood Chain)
/// @notice Identical to Distributor.sol but without Chainlink VRF — Robinhood
///         Chain (Arbitrum Orbit L2, chainId 4663) does not support VRF v2.5.
///         Uses commit-reveal randomness: the poster commits a keccak256 hash
///         before the round, then reveals after the shares are locked. The
///         winner index is derived from the revealed salt XOR blockhash.
///
/// Round lifecycle (driven by the backend round-runner):
///   1. commitRandom(roundId, hash)  — poster commits keccak256(salt)
///   2. startRound(from, to)          — snapshots the pot
///   3. postShares(id, bytes)          — packed (address,uint32-share) entries
///   4. revealRandom(roundId, salt)    — poster reveals; winner index derived
///   5. distribute(id)                 — anyone; pays 90% pro-rata + 10% winner
///   Stuck rounds are cancelled by the poster/owner; the pot rolls into next.
contract DistributorRobinhood is Ownable, Pausable, AutomationCompatibleInterface {

    error BpsTooHigh();
    error ClaimTransferFailed();
    error InvalidPackedLength();
    error NoActiveRound();
    error NotPoster();
    error NothingToClaim();
    error NothingToDistribute();
    error PeriodNotElapsed();
    error RandomAlreadyRevealed();
    error RandomNotCommitted();
    error RoundAlreadyActive();
    error SharesExceedTotal();
    error SharesPending();
    error TokenTransferFailed();
    error TooManyHolders();
    error WithdrawFailed();
    error ZeroPoster();

    struct Round {
        uint8 status;       // 0=none, 1=active, 2=paid, 3=cancelled
        uint64 timeStart;
        uint64 timeEnd;
        bool hasRandom;
        uint256 pot;
        uint256 random;
        bytes32 commitHash; // keccak256(salt) committed before round
        bytes shares;
    }

    uint256 public roundId;
    uint256 public lastRoundTime;
    mapping(uint256 => Round) public rounds;

    mapping(address => uint256) public claimable;
    uint256 public totalClaimable;

    uint256 public period = 1 weeks;
    uint256 public percentForWinner = 1000;
    uint256 public percentForDistribute = 9000;
    address public poster;
    bool public automationEnabled = true;

    event RoundStarted(uint256 indexed roundId, uint256 pot, uint64 timeStart, uint64 timeEnd);
    event RandomCommitted(uint256 indexed roundId, bytes32 commitHash);
    event RandomRevealed(uint256 indexed roundId, uint256 random);
    event SharesPosted(uint256 indexed roundId, uint256 holderCount);
    event RoundDistributed(uint256 indexed roundId, address indexed winner, uint256 winnerAmount, uint256 distributedAmount, uint256 holderCount);
    event RoundCancelled(uint256 indexed roundId);
    event TransferFailed(address indexed to, uint256 amount);

    uint256 public constant MAX_HOLDERS = 100;

    constructor(address _poster) Ownable(msg.sender) {
        if (_poster == address(0)) revert ZeroPoster();
        poster = _poster;
    }

    receive() external payable {}

    modifier onlyPoster() {
        if (!(msg.sender == poster || msg.sender == owner())) revert NotPoster();
        _;
    }

    // ---- commit-reveal randomness ------------------------------------------

    /// @notice Commit a hash for the next round's randomness. Must be called
    ///         BEFORE startRound. hash = keccak256(abi.encodePacked(salt)).
    function commitRandom(uint256 _roundId, bytes32 _commitHash) external onlyPoster {
        Round storage r = rounds[_roundId];
        if (r.commitHash != bytes32(0)) revert RandomAlreadyRevealed();
        r.commitHash = _commitHash;
        emit RandomCommitted(_roundId, _commitHash);
    }

    /// @notice Reveal the salt after shares are posted. The random word is
    ///         derived as keccak256(abi.encodePacked(_salt, blockhash(_revealBlock))).
    function revealRandom(uint256 _roundId, bytes32 _salt) external onlyPoster {
        Round storage r = rounds[_roundId];
        if (!(_roundId == roundId && r.status == 1)) revert NoActiveRound();
        if (r.hasRandom) revert RandomAlreadyRevealed();
        if (r.commitHash == bytes32(0)) revert RandomNotCommitted();
        bytes32 _computed = keccak256(abi.encodePacked(_salt));
        if (_computed != r.commitHash) revert RandomNotCommitted(); // wrong salt
        // Use blockhash of the previous block as additional entropy
        r.random = uint256(keccak256(abi.encodePacked(_salt, blockhash(block.number - 1))));
        r.hasRandom = true;
        emit RandomRevealed(_roundId, r.random);
    }

    // ---- round lifecycle ---------------------------------------------------

    function startRound(uint64 _timeStart, uint64 _timeEnd) external onlyPoster whenNotPaused returns (uint256) {
        if (rounds[roundId].status == 1) revert RoundAlreadyActive();
        if (block.timestamp < lastRoundTime + period) revert PeriodNotElapsed();
        uint256 _distributable = address(this).balance - totalClaimable;
        if (_distributable <= 0) revert NothingToDistribute();

        roundId += 1;
        lastRoundTime = block.timestamp;
        Round storage r = rounds[roundId];
        r.status = 1;
        r.timeStart = _timeStart;
        r.timeEnd = _timeEnd;
        r.pot = _distributable;

        emit RoundStarted(roundId, r.pot, _timeStart, _timeEnd);
        return roundId;
    }

    function postShares(uint256 _roundId, bytes calldata _packed) external onlyPoster {
        Round storage r = rounds[_roundId];
        if (!(_roundId == roundId && r.status == 1)) revert NoActiveRound();
        if (r.hasRandom) revert RandomAlreadyRevealed();
        if (!(_packed.length > 0 && _packed.length % 24 == 0)) revert InvalidPackedLength();
        uint256 _count = _packed.length / 24;
        if (_count > MAX_HOLDERS) revert TooManyHolders();

        uint256 _sum;
        for (uint256 i = 0; i < _count; i++) {
            uint256 _off = i * 24 + 20;
            uint32 _share = uint32(bytes4(_packed[_off:_off + 4]));
            _sum += _share;
        }
        if (!(_sum <= uint256(type(uint32).max) + 1)) revert SharesExceedTotal();

        r.shares = _packed;
        emit SharesPosted(_roundId, _count);
    }

    function distribute(uint256 _roundId) external whenNotPaused {
        _distribute(_roundId);
    }

    // ---- Chainlink Automation ----------------------------------------------

    function checkUpkeep(bytes calldata)
        external view override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        if (paused() || !automationEnabled) return (false, "");
        uint256 _rid = roundId;
        Round storage r = rounds[_rid];
        if (r.status == 1 && r.hasRandom && r.shares.length > 0) {
            return (true, abi.encode(_rid));
        }
        return (false, "");
    }

    function performUpkeep(bytes calldata performData) external override whenNotPaused {
        if (!automationEnabled) revert NoActiveRound();
        uint256 _roundId = abi.decode(performData, (uint256));
        _distribute(_roundId);
    }

    function _distribute(uint256 _roundId) internal {
        Round storage r = rounds[_roundId];
        if (!(_roundId == roundId && r.status == 1)) revert NoActiveRound();
        if (!r.hasRandom) revert RandomNotCommitted();
        if (r.shares.length <= 0) revert SharesPending();
        r.status = 2;

        (address[] memory _holders, uint32[] memory _shares) = _unpackShares(r.shares);

        uint256 _pot = r.pot;
        uint256 _distributable = address(this).balance - totalClaimable;
        if (_pot > _distributable) _pot = _distributable;

        uint256 _winnerAmount = (_pot * percentForWinner) / 10000;
        uint256 _distributeAmount = (_pot * percentForDistribute) / 10000;

        uint256 _paid;
        for (uint256 i = 0; i < _holders.length; i++) {
            uint256 _amount = (_distributeAmount * uint256(_shares[i])) / (uint256(type(uint32).max) + 1);
            _paid += _payOrCredit(_holders[i], _amount);
        }

        address _winner = _holders[r.random % _holders.length];
        _paid += _payOrCredit(_winner, _winnerAmount);

        emit RoundDistributed(_roundId, _winner, _winnerAmount, _paid, _holders.length);
    }

    function cancelRound() external onlyPoster {
        Round storage r = rounds[roundId];
        if (r.status != 1) revert NoActiveRound();
        r.status = 3;
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

    function claim() external {
        uint256 _amount = claimable[msg.sender];
        if (_amount <= 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= _amount;
        (bool _success, ) = payable(msg.sender).call{value: _amount}("");
        if (!_success) revert ClaimTransferFailed();
    }

    // ---- admin -------------------------------------------------------------

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

    function setAutomationEnabled(bool _enabled) external onlyOwner {
        automationEnabled = _enabled;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function emergencyWithdraw(address _to) external onlyOwner whenPaused {
        (bool _success, ) = payable(_to).call{value: address(this).balance}("");
        if (!_success) revert WithdrawFailed();
    }

    function withdrawToken(address _token, address _to) external onlyOwner whenPaused {
        if (!(IERC20(_token).transfer(_to, IERC20(_token).balanceOf(address(this))))) revert TokenTransferFailed();
    }
}
