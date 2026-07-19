// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Fyuz.sol";
import "../src/FyuzLiquidityManager.sol";
import "../src/MockPriceFeed.sol";
import {FyuzDeploy} from "../src/FyuzDeploy.sol";

contract DeployFyuz is Script {

    /// @dev The proxies each deploy their own ProxyAdmin and record it in the
    ///      ERC-1967 admin slot. Log it: it is the only key that can upgrade, and
    ///      recovering it later means digging through deployment logs.
    function _proxyAdmin(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT))));
    }
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

        FyuzLiquidityManager liquidityManager = FyuzDeploy.deployLiquidityManager(
            UNISWAP_V2_ROUTER,
            V3_FACTORY,
            V3_POS_MGR,
            V4_POOL_MGR,
            UNIVERSAL_ROUTER,
            V4_POS_MGR,
            PERMIT2_ADDR,
            deployer,
            deployer
        );
        console.log("FyuzLiquidityManager:", address(liquidityManager));

        Fyuz fyuz = FyuzDeploy.deployFyuz(
            priceFeed,
            address(liquidityManager),
            FEE_WALLET,
            DIST_ADDR,
            deployer
        );
        console.log("Fyuz:", address(fyuz));

        liquidityManager.setAuthorizedCaller(address(fyuz), true);
        console.log("Fyuz authorized as LiquidityManager caller");

        fyuz.setPlatformBuyFeeBps(300);
        fyuz.setPlatformSellFeeBps(300);
        fyuz.setMaxBuyPercent(10000);
        fyuz.setMaxSellPercent(10000);
        console.log("Fees configured: 3% buy/sell, 100% max buy/sell");

        vm.stopBroadcast();

        console.log("");
        console.log("==================================================");
        console.log("DEPLOYMENT COMPLETE");
        console.log("==================================================");
        console.log("PriceFeed:        ", priceFeed);
        console.log("Fyuz:         ", address(fyuz));
        console.log("  ProxyAdmin:     ", _proxyAdmin(address(fyuz)));
        console.log("LiquidityManager: ", address(liquidityManager));
        console.log("  ProxyAdmin:     ", _proxyAdmin(address(liquidityManager)));
        console.log("==================================================");
    }
}
