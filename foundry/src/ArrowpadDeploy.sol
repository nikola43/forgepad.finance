// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {
    TransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Arrowpad} from "./Arrowpad.sol";
import {ArrowpadLiquidityManager} from "./ArrowpadLiquidityManager.sol";

/// @notice Deploys implementation + TransparentUpgradeableProxy + initialize in one
///         call, so scripts and tests can't drift apart on the wiring.
/// @dev TransparentUpgradeableProxy deploys its own ProxyAdmin owned by
///      `proxyAdminOwner`; that address is the only one that can upgrade. Read it
///      back off-chain from the ERC-1967 admin slot (see ArrowpadUpgrade.t.sol).
///      Callers are `internal`, so this library inlines — nothing extra deployed.
library ArrowpadDeploy {
    function deployLiquidityManager(
        address routerV2,
        address factoryV3,
        address v3PositionManager,
        address poolV4Manager,
        address universalRouter,
        address v4PositionManager,
        address permit2,
        address marginRecipient,
        address owner,
        uint16 ethAmountPercentToLP,
        uint16 tokenAmountPercentToLP,
        address proxyAdminOwner
    ) internal returns (ArrowpadLiquidityManager) {
        ArrowpadLiquidityManager impl = new ArrowpadLiquidityManager();
        bytes memory data = abi.encodeCall(
            ArrowpadLiquidityManager.initialize,
            (
                routerV2,
                factoryV3,
                v3PositionManager,
                poolV4Manager,
                universalRouter,
                v4PositionManager,
                permit2,
                marginRecipient,
                owner,
                ethAmountPercentToLP,
                tokenAmountPercentToLP
            )
        );
        return
            ArrowpadLiquidityManager(
                payable(
                    address(
                        new TransparentUpgradeableProxy(
                            address(impl),
                            proxyAdminOwner,
                            data
                        )
                    )
                )
            );
    }

    /// @dev Arrowpad.initialize sets the owner to msg.sender, which — because the
    ///      proxy constructor delegatecalls it — is whoever calls this function.
    function deployArrowpad(
        address dataFeed,
        address liquidityManager,
        address feeAddress,
        address distributorAddress,
        address proxyAdminOwner
    ) internal returns (Arrowpad) {
        Arrowpad impl = new Arrowpad();
        bytes memory data = abi.encodeCall(
            Arrowpad.initialize,
            (dataFeed, liquidityManager, feeAddress, distributorAddress)
        );
        return
            Arrowpad(
                payable(
                    address(
                        new TransparentUpgradeableProxy(
                            address(impl),
                            proxyAdminOwner,
                            data
                        )
                    )
                )
            );
    }
}
