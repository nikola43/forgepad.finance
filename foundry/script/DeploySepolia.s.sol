// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Arrowpad.sol";
import "../src/ArrowpadLiquidityManager.sol";
import {ArrowpadDeploy} from "../src/ArrowpadDeploy.sol";

/// @notice Deploys Arrowpad + ArrowpadLiquidityManager to Sepolia with V2, V3 and
///         V4 all enabled. The DEX version is chosen per token via createToken's
///         `poolType` argument: 1 = Uniswap V2, 2 = Uniswap V3, 3 = Uniswap V4.
contract DeployArrowpadSepolia is Script {

    /// @dev The proxies each deploy their own ProxyAdmin and record it in the
    ///      ERC-1967 admin slot. Log it: it is the only key that can upgrade, and
    ///      recovering it later means digging through deployment logs.
    function _proxyAdmin(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT))));
    }
    // ---- Uniswap V2 (Sepolia) ----
    address constant V2_ROUTER = 0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3;

    // ---- Uniswap V3 (Sepolia) ----
    address constant V3_FACTORY = 0x0227628f3F023bb0B980b67D528571c95c6DaC1c;
    address constant V3_POSITION_MANAGER =
        0x1238536071E1c677A632429e3655c799b22cDA52;

    // ---- Uniswap V4 (Sepolia) ----
    address constant V4_POOL_MANAGER =
        0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant V4_POSITION_MANAGER =
        0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address constant UNIVERSAL_ROUTER =
        0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;

    // ---- Shared ----
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    // Chainlink ETH/USD (Sepolia, 8 decimals)
    address constant DATA_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        address deployer = vm.addr(pk);

        console.log("Deployer:", deployer);
        console.log("Balance :", deployer.balance / 1e18, "ETH");

        vm.startBroadcast(pk);

        // All V2/V3/V4 addresses wired so every poolType is usable.
        ArrowpadLiquidityManager lm = ArrowpadDeploy.deployLiquidityManager(
            V2_ROUTER,
            V3_FACTORY,
            V3_POSITION_MANAGER,
            V4_POOL_MANAGER,
            UNIVERSAL_ROUTER,
            V4_POSITION_MANAGER,
            PERMIT2,
            deployer, // _marginRecipient (leftover ETH at graduation)
            deployer, // _owner
            10000, // 100% ETH to LP
            10000, // 100% tokens to LP
            deployer
        );
        console.log("ArrowpadLiquidityManager:", address(lm));

        Arrowpad arrowpad = ArrowpadDeploy.deployArrowpad(
            DATA_FEED,
            address(lm),
            deployer, // _feeAddress
            deployer, // _distributorAddress
            deployer
        );
        console.log("Arrowpad:", address(arrowpad));

        // Authorize Arrowpad to drive the liquidity manager at graduation.
        lm.setAuthorizedCaller(address(arrowpad), true);

        // 1% buy / 1% sell (100 bps), full buy/sell size allowed.
        arrowpad.setPlatformBuyFeeBps(100);
        arrowpad.setPlatformSellFeeBps(100);
        arrowpad.setMaxBuyPercent(10000);
        arrowpad.setMaxSellPercent(10000);

        vm.stopBroadcast();

        console.log("");
        console.log("=================================================");
        console.log("SEPOLIA DEPLOYMENT COMPLETE (V2 + V3 + V4 enabled)");
        console.log("=================================================");
        console.log("Arrowpad:         ", address(arrowpad));
        console.log("  ProxyAdmin:     ", _proxyAdmin(address(arrowpad)));
        console.log("LiquidityManager: ", address(lm));
        console.log("  ProxyAdmin:     ", _proxyAdmin(address(lm)));
        console.log("Target MCAP (USD):", arrowpad.TARGET_MARKET_CAP_USD() / 1e18);
        console.log("poolType 1=V2  2=V3  3=V4 (choose in createToken)");
        console.log("=================================================");
    }
}
