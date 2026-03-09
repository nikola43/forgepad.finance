// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Forgepad.sol";
import "../src/ForgepadLiquidityManager.sol";
import "../src/MockPriceFeed.sol";

contract DeployForgepad is Script {
    // BSC PancakeSwap addresses
    address constant PANCAKE_V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address constant UNISWAP_V3_POSITION_MANAGER = 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364;
    address constant UNISWAP_V4_POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address constant UNISWAP_UNIVERSAL_ROUTER = 0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB;
    address constant UNISWAP_V4_POSITION_MANAGER = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint256 constant TARGET_MARKET_CAP = 60000;
    uint256 constant TOTAL_SUPPLY = 10 ** 9;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying with account:", deployer);
        console.log("Account balance:", deployer.balance / 1e18, "BNB");

        vm.startBroadcast(deployerPrivateKey);

        // 0. Deploy MockPriceFeed (BNB ~$620, 8 decimals like Chainlink)
        MockPriceFeed mockFeed = new MockPriceFeed(62000000000, 8);
        console.log("MockPriceFeed:", address(mockFeed));

        // 1. Deploy ForgepadLiquidityManager
        ForgepadLiquidityManager liquidityManager = new ForgepadLiquidityManager(
            PANCAKE_V2_ROUTER,
            UNISWAP_V3_POSITION_MANAGER,
            UNISWAP_V4_POOL_MANAGER,
            UNISWAP_UNIVERSAL_ROUTER,
            UNISWAP_V4_POSITION_MANAGER,
            PERMIT2,
            deployer,   // marginRecipient
            deployer,   // burnAddress
            10000,      // tokenAmountPercentToLP (100%)
            5000        // ethAmountPercentToLP (50%)
        );
        console.log("ForgepadLiquidityManager:", address(liquidityManager));

        // 2. Deploy Forgepad with mock price feed
        Forgepad forgepad = new Forgepad(
            address(mockFeed),
            address(liquidityManager),
            deployer,              // feeWallet
            deployer,              // distributor
            TARGET_MARKET_CAP,
            TOTAL_SUPPLY
        );
        console.log("Forgepad:", address(forgepad));

        // 3. Authorize Forgepad on LiquidityManager
        liquidityManager.setAuthorizedCaller(address(forgepad), true);
        console.log("Forgepad authorized as LiquidityManager caller");

        // 4. Configure fees
        forgepad.setPlatformBuyFeePercent(3);
        forgepad.setPlatformSellFeePercent(3);
        forgepad.setMaxBuyPercent(300);
        forgepad.setMaxSellPercent(300);
        console.log("Fees configured: 3% buy/sell, 3% max buy/sell");

        vm.stopBroadcast();

        console.log("");
        console.log("==================================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("==================================================");
        console.log("MockPriceFeed:    ", address(mockFeed));
        console.log("Forgepad:         ", address(forgepad));
        console.log("LiquidityManager: ", address(liquidityManager));
        console.log("==================================================");
    }
}
