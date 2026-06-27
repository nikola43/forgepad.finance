// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Forgepad.sol";
import "../src/ForgepadLiquidityManager.sol";

contract DeployForgepadSepolia is Script {
    /// @notice Sepolia Uniswap V2 Router (provided by user)
    address constant UNISWAP_V2_ROUTER = 0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3;
    /// @notice Sepolia Uniswap V2 Factory (provided by user)
    address constant UNISWAP_V2_FACTORY = 0xF62c03E08ada871A0bEb309762E260a7a6a880E6;
    /// @notice Sepolia Chainlink ETH/USD feed (provided by user)
    address constant DATA_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    /// @notice Permit2 (same address on all chains)
    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        if (deployerPrivateKey == 0) {
            console.log("ERROR: Set PRIVATE_KEY env var");
            return;
        }
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying to Sepolia with account:", deployer);
        console.log("Account balance:", deployer.balance / 1e18, "ETH");
        console.log("V2 Router:", UNISWAP_V2_ROUTER);
        console.log("V2 Factory:", UNISWAP_V2_FACTORY);
        console.log("Data Feed:", DATA_FEED);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy LiquidityManager with Sepolia addresses.
        // V3/V4 addresses won't be called (V2-only) but must be non-zero.
        // We reuse the V2 router address for unused slots as it exists on Sepolia.
        ForgepadLiquidityManager liquidityManager = new ForgepadLiquidityManager(
            UNISWAP_V2_ROUTER,
            UNISWAP_V2_FACTORY, // _factoryV3 — stored but unused for V2
            UNISWAP_V2_ROUTER,  // _v3PositionManager — stored but unused for V2
            UNISWAP_V2_ROUTER,  // _poolV4Manager — stored but unused for V2
            UNISWAP_V2_ROUTER,  // _universalRouter — stored but unused for V2
            UNISWAP_V2_ROUTER,  // _v4PositionManager — stored but unused for V2
            PERMIT2_ADDR,
            deployer,           // _marginRecipient
            deployer,           // _owner
            10000,              // 100% ETH to LP
            10000               // 100% tokens to LP
        );
        console.log("ForgepadLiquidityManager:", address(liquidityManager));

        // Deploy Forgepad with real Chainlink data feed
        Forgepad forgepad = new Forgepad(
            DATA_FEED,
            address(liquidityManager),
            deployer,   // _feeAddress (deployer receives fees on Sepolia)
            deployer    // _distributorAddress
        );
        console.log("Forgepad:", address(forgepad));

        liquidityManager.setAuthorizedCaller(address(forgepad), true);
        console.log("Forgepad authorized as LiquidityManager caller");

        forgepad.setPlatformBuyFeePercent(3);
        forgepad.setPlatformSellFeePercent(3);
        forgepad.setMaxBuyPercent(10000);
        forgepad.setMaxSellPercent(10000);
        console.log("Fees configured: 3% buy/sell, 100% max buy/sell");

        vm.stopBroadcast();

        console.log("");
        console.log("==================================================");
        console.log("SEPOLIA DEPLOYMENT COMPLETE");
        console.log("==================================================");
        console.log("Chain:            Sepolia");
        console.log("Chain ID:         11155111");
        console.log("V2 Router:        ", UNISWAP_V2_ROUTER);
        console.log("V2 Factory:       ", UNISWAP_V2_FACTORY);
        console.log("DataFeed:         ", DATA_FEED);
        console.log("Forgepad:         ", address(forgepad));
        console.log("LiquidityManager: ", address(liquidityManager));
        console.log("==================================================");
    }
}
