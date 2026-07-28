// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {IVRFCoordinatorV2Plus} from
    "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {IVRFMigratableConsumerV2Plus} from
    "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFMigratableConsumerV2Plus.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @title Proxy-safe VRF v2.5 consumer base.
///
/// @dev Chainlink's own `VRFConsumerBaseV2Plus` CANNOT sit behind a proxy, which
///      is the whole reason this exists. It sets `s_vrfCoordinator` in its
///      constructor and inherits `ConfirmedOwner`, whose `s_owner` is `private`
///      and also constructor-set. Constructor code runs against the
///      IMPLEMENTATION's storage, never the proxy's, so a proxied Distributor
///      would come up with `owner() == address(0)` and `s_vrfCoordinator ==
///      address(0)`: every `onlyOwner` call reverts, no randomness can ever be
///      requested, and because `s_owner` is private there is no way to repair it
///      from a child contract. The failure is silent at deploy time and total
///      afterwards.
///
///      This mirrors the upstream behaviour exactly — same `rawFulfillRandomWords`
///      coordinator guard, same `setCoordinator` migration hook, same
///      `onlyOwnerOrCoordinator` modifier — with the two constructor writes moved
///      into an initializer and ownership delegated to `OwnableUpgradeable`.
abstract contract VRFConsumerBaseV2PlusUpgradeable is
    Initializable,
    OwnableUpgradeable,
    IVRFMigratableConsumerV2Plus
{
    error OnlyCoordinatorCanFulfill(address have, address want);
    error OnlyOwnerOrCoordinator(address have, address owner, address coordinator);
    error ZeroAddress();

    /// @notice Coordinator consumers must call to request randomness. Mutable so a
    ///         Chainlink-initiated migration can repoint it (see setCoordinator).
    IVRFCoordinatorV2Plus public s_vrfCoordinator;

    // solhint-disable-next-line func-name-mixedcase
    function __VRFConsumerBaseV2Plus_init(address _vrfCoordinator, address _initialOwner)
        internal
        onlyInitializing
    {
        __Ownable_init(_initialOwner);
        _setCoordinator(_vrfCoordinator);
    }

    /// @notice Randomness callback, implemented by the consumer.
    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal virtual;

    /// @notice Coordinator entrypoint. Only the coordinator may deliver randomness;
    ///         anything else could forge the winner.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(s_vrfCoordinator)) {
            revert OnlyCoordinatorCanFulfill(msg.sender, address(s_vrfCoordinator));
        }
        fulfillRandomWords(requestId, randomWords);
    }

    /// @inheritdoc IVRFMigratableConsumerV2Plus
    function setCoordinator(address _vrfCoordinator) external override onlyOwnerOrCoordinator {
        _setCoordinator(_vrfCoordinator);
    }

    function _setCoordinator(address _vrfCoordinator) internal {
        if (_vrfCoordinator == address(0)) revert ZeroAddress();
        s_vrfCoordinator = IVRFCoordinatorV2Plus(_vrfCoordinator);
        emit CoordinatorSet(_vrfCoordinator);
    }

    modifier onlyOwnerOrCoordinator() {
        if (msg.sender != owner() && msg.sender != address(s_vrfCoordinator)) {
            revert OnlyOwnerOrCoordinator(msg.sender, owner(), address(s_vrfCoordinator));
        }
        _;
    }

    /// @dev Reserved so this base can gain state without shifting the layout of
    ///      every inheriting contract already deployed behind a proxy. Decrement
    ///      when adding a variable above.
    uint256[49] private __gap;
}
