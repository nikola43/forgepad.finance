// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Forgepad.sol";
import "../src/ForgepadLiquidityManager.sol";
import "../src/MockPriceFeed.sol";

contract DeployForgepad is Script {
    // Uniswap V2 Router on Ethereum
    address constant UNISWAP_V2_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    // Uniswap V3 Factory on Ethereum
    address constant V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    // Uniswap V3 Position Manager on Ethereum
    address constant V3_POS_MGR = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
    // Uniswap V4 Pool Manager on Ethereum
    address constant V4_POOL_MGR = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    // Universal Router for V4
    address constant UNIVERSAL_ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;
    // V4 Position Manager
    address constant V4_POS_MGR = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    // Permit2
    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Chainlink ETH/USD on Ethereum
    address constant DATA_FEED = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;

    address constant FEE_WALLET = 0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103;
    address constant DIST_ADDR = 0xF2917a81fF74406fbCf01c507057e101Db8f2F12;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        if (deployerPrivateKey == 0) {
            console.log("ERROR: Set PRIVATE_KEY env var");
            return;
        }
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying with account:", deployer);
        console.log("Account balance:", deployer.balance / 1e18, "ETH");

        vm.startBroadcast(deployerPrivateKey);

        // Use real Chainlink ETH/USD feed on mainnet fork
        address priceFeed = DATA_FEED;
        console.log("PriceFeed (Chainlink):", priceFeed);

        ForgepadLiquidityManager liquidityManager = new ForgepadLiquidityManager(
            UNISWAP_V2_ROUTER,
            V3_FACTORY,
            V3_POS_MGR,
            V4_POOL_MGR,
            UNIVERSAL_ROUTER,
            V4_POS_MGR,
            PERMIT2_ADDR,
            deployer,
            deployer,
            10000,
            10000
        );
        console.log("ForgepadLiquidityManager:", address(liquidityManager));

        Forgepad forgepad = new Forgepad(
            priceFeed,
            address(liquidityManager),
            FEE_WALLET,
            DIST_ADDR
        );
        console.log("Forgepad:", address(forgepad));

        liquidityManager.setAuthorizedCaller(address(forgepad), true);
        console.log("Forgepad authorized as LiquidityManager caller");

        forgepad.setPlatformBuyFeeBps(300);
        forgepad.setPlatformSellFeeBps(300);
        forgepad.setMaxBuyPercent(10000);
        forgepad.setMaxSellPercent(10000);
        console.log("Fees configured: 3% buy/sell, 100% max buy/sell");

        vm.stopBroadcast();

        console.log("");
        console.log("==================================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("==================================================");
        console.log("PriceFeed:        ", priceFeed);
        console.log("Forgepad:         ", address(forgepad));
        console.log("LiquidityManager: ", address(liquidityManager));
        console.log("==================================================");
    }
}
