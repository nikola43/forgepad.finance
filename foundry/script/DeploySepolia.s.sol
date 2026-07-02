// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Forgepad.sol";
import "../src/ForgepadLiquidityManager.sol";

/// @notice Deploys Forgepad + ForgepadLiquidityManager to Sepolia with V2, V3 and
///         V4 all enabled. The DEX version is chosen per token via createToken's
///         `poolType` argument: 1 = Uniswap V2, 2 = Uniswap V3, 3 = Uniswap V4.
contract DeployForgepadSepolia is Script {
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
        ForgepadLiquidityManager lm = new ForgepadLiquidityManager(
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
            10000 // 100% tokens to LP
        );
        console.log("ForgepadLiquidityManager:", address(lm));

        Forgepad forgepad = new Forgepad(
            DATA_FEED,
            address(lm),
            deployer, // _feeAddress
            deployer // _distributorAddress
        );
        console.log("Forgepad:", address(forgepad));

        // Authorize Forgepad to drive the liquidity manager at graduation.
        lm.setAuthorizedCaller(address(forgepad), true);

        // 1% buy / 1% sell (100 bps), full buy/sell size allowed.
        forgepad.setPlatformBuyFeeBps(100);
        forgepad.setPlatformSellFeeBps(100);
        forgepad.setMaxBuyPercent(10000);
        forgepad.setMaxSellPercent(10000);

        vm.stopBroadcast();

        console.log("");
        console.log("=================================================");
        console.log("SEPOLIA DEPLOYMENT COMPLETE (V2 + V3 + V4 enabled)");
        console.log("=================================================");
        console.log("Forgepad:         ", address(forgepad));
        console.log("LiquidityManager: ", address(lm));
        console.log("Target MCAP (USD):", forgepad.TARGET_MARKET_CAP_USD() / 1e18);
        console.log("poolType 1=V2  2=V3  3=V4 (choose in createToken)");
        console.log("=================================================");
    }
}
