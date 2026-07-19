// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {
    TransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Fyuz} from "./Fyuz.sol";
import {FyuzLiquidityManager} from "./FyuzLiquidityManager.sol";

/// @notice Deploys implementation + TransparentUpgradeableProxy + initialize in one
///         call, so scripts and tests can't drift apart on the wiring.
/// @dev TransparentUpgradeableProxy deploys its own ProxyAdmin owned by
///      `proxyAdminOwner`; that address is the only one that can upgrade. Read it
///      back off-chain from the ERC-1967 admin slot (see FyuzUpgrade.t.sol).
///      Callers are `internal`, so this library inlines — nothing extra deployed.
library FyuzDeploy {
    function deployLiquidityManager(
        address routerV2,
        address factoryV3,
        address v3PositionManager,
        address poolV4Manager,
        address universalRouter,
        address v4PositionManager,
        address permit2,
        address owner,
        uint16 ethAmountPercentToLP,
        uint16 tokenAmountPercentToLP,
        address proxyAdminOwner
    ) internal returns (FyuzLiquidityManager) {
        FyuzLiquidityManager impl = new FyuzLiquidityManager();
        bytes memory data = abi.encodeCall(
            FyuzLiquidityManager.initialize,
            (
                routerV2,
                factoryV3,
                v3PositionManager,
                poolV4Manager,
                universalRouter,
                v4PositionManager,
                permit2,
                owner,
                ethAmountPercentToLP,
                tokenAmountPercentToLP
            )
        );
        return
            FyuzLiquidityManager(
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

    /// @dev Fyuz.initialize sets the owner to msg.sender, which — because the
    ///      proxy constructor delegatecalls it — is whoever calls this function.
    function deployFyuz(
        address dataFeed,
        address liquidityManager,
        address feeAddress,
        address distributorAddress,
        address proxyAdminOwner
    ) internal returns (Fyuz) {
        Fyuz impl = new Fyuz();
        bytes memory data = abi.encodeCall(
            Fyuz.initialize,
            (dataFeed, liquidityManager, feeAddress, distributorAddress)
        );
        return
            Fyuz(
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
