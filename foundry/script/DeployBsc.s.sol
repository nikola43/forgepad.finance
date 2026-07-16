// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Fyuz.sol";
import "../src/FyuzLiquidityManager.sol";
import {FyuzDeploy} from "../src/FyuzDeploy.sol";

/// @notice Deploys Fyuz + FyuzLiquidityManager to BNB Smart Chain (chainId 56,
///         native gas token BNB) against PancakeSwap V2 and V3.
///
///         V4 IS DISABLED. Fyuz.createToken accepts only poolType 1 (V2) and
///         2 (V3); poolType 3 (V4) reverts, recoverPoolType rejects it too, and
///         createTokenDirect no longer exists. The V4 code in the liquidity
///         manager is dormant and unreachable — see the V4 sentinel note below.
///
/// Run against an anvil BSC mainnet fork:
///   anvil --fork-url https://bsc-dataseed.binance.org --chain-id 56 &
///   PRIVATE_KEY=0x... forge script script/DeployBsc.s.sol \
///     --rpc-url http://127.0.0.1:8545 --broadcast
///
///   (anvil's default unlocked key works on a fork:
///    PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
///
/// @notice Verified BNB Smart Chain addresses (chainId 56).
///         Explorer: https://bscscan.com
///
///         PancakeSwap V2: router=0x10ED43C718714eb63d5aA57B78B54704E256024E
///                         factory=0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73
///         PancakeSwap V3: factory=0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865
///                         positionMgr=0x46A15B0b27311cedF172AB29E4f4766fbE7F4364
///         WBNB (the "WETH" of BSC): 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
contract DeployFyuzBsc is Script {

    /// @dev The proxies each deploy their own ProxyAdmin and record it in the
    ///      ERC-1967 admin slot. Log it: it is the only key that can upgrade, and
    ///      recovering it later means digging through deployment logs.
    function _proxyAdmin(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT))));
    }

    // ---- PancakeSwap V2 (BSC) ----
    address constant V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address constant V2_FACTORY = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;

    // ---- PancakeSwap V3 (BSC) ----
    // FyuzLiquidityManager hardcodes POOL_FEE = 100 and derives tickSpacing via
    // getTickSpacing(100) => 1. The live PancakeV3Factory reports fee=100 =>
    // tickSpacing 1, so the V3 path is wire-compatible with Uniswap here.
    // (Heads-up for anyone retuning POOL_FEE: PancakeSwap does NOT enable the
    //  3000 tier at all, and its 2500 tier has no entry in getTickSpacing.)
    address constant V3_FACTORY = 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865;
    address constant V3_POSITION_MANAGER =
        0x46A15B0b27311cedF172AB29E4f4766fbE7F4364;

    // ---- Uniswap/PancakeSwap V4: DISABLED ----
    // FyuzLiquidityManager.initialize REVERTS with ZeroAddress() on a zero
    // _poolV4Manager, _universalRouter or _v4PositionManager, so address(0)
    // cannot be passed. Weakening that validation to allow zeros is NOT an
    // option (it is a real safety check for chains that do use V4), and there is
    // no verified PancakeSwap V4/Infinity deployment to point at on BSC.
    //
    // So these are wired to a non-contract sentinel purely to satisfy the
    // initializer. This is safe ONLY because Fyuz gates poolType 3 off: every V4
    // call site (poolV4Manager.getSlot0/initialize, positionManager.*, permit2
    // approvals) is unreachable. If anyone ever un-gates V4 on BSC, these MUST be
    // replaced with real addresses — the sentinel makes V4 fail closed (calls to a
    // non-contract revert) rather than silently misbehave.
    address constant V4_DISABLED_SENTINEL =
        0x000000000000000000000000000000000000dEaD;

    // ---- Shared / canonical ----
    // Multicall3 (not used in contract, but useful for batch operations post-deploy)
    address constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    // Chainlink BNB/USD (BSC, 8 decimals). BSC's gas token is BNB, so the
    // "ETH/USD" feed slot is fed the BNB/USD feed. Fyuz reads priceFeedDecimals
    // dynamically, so 8 decimals is handled.
    address constant DATA_FEED = 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        address deployer = vm.addr(pk);

        // Robinhood's DISTRIBUTOR is a contract deployed on Robinhood Chain; it
        // does not exist on BSC, so it must not be copied over. Fyuz.initialize
        // rejects a zero distributor, and distributorAddress receives ETH
        // (_transferETHTolerant) on every fee split — default it to the deployer
        // and override once a real Distributor is deployed to BSC.
        address distributor = vm.envOr("DISTRIBUTOR", deployer);

        console.log("Deployer:", deployer);
        console.log("Balance :", deployer.balance / 1e18, "BNB");
        console.log("ChainId :", block.chainid);

        vm.startBroadcast(pk);

        // V2 + V3 wired to PancakeSwap; V4 slots take the disabled sentinel.
        FyuzLiquidityManager lm = FyuzDeploy.deployLiquidityManager(
            V2_ROUTER,
            V3_FACTORY,
            V3_POSITION_MANAGER,
            V4_DISABLED_SENTINEL, // _poolV4Manager    (V4 gated off in Fyuz)
            V4_DISABLED_SENTINEL, // _universalRouter  (stored, never called)
            V4_DISABLED_SENTINEL, // _v4PositionManager(V4 gated off in Fyuz)
            PERMIT2,
            deployer, // _marginRecipient (leftover BNB at graduation)
            deployer, // _owner
            10000, // 100% BNB to LP
            10000, // 100% tokens to LP
            deployer
        );
        console.log("FyuzLiquidityManager:", address(lm));

        Fyuz fyuz = FyuzDeploy.deployFyuz(
            DATA_FEED,
            address(lm),
            deployer, // _feeAddress
            distributor, // _distributorAddress
            deployer
        );
        console.log("Fyuz:", address(fyuz));

        // Authorize Fyuz to drive the liquidity manager at graduation.
        lm.setAuthorizedCaller(address(fyuz), true);

        // 1% buy / 1% sell (100 bps), full buy/sell size allowed.
        fyuz.setPlatformBuyFeeBps(100);
        fyuz.setPlatformSellFeeBps(100);
        fyuz.setMaxBuyPercent(10000);
        fyuz.setMaxSellPercent(10000);

        // Staleness: 1h, NOT Robinhood's 86400 (24h). That hack existed because
        // Robinhood Chain is an Arbitrum Orbit L2 whose Chainlink feed timestamp
        // originates from L1 and can lag hours behind L2 block time. BSC's
        // BNB/USD feed is a native, frequently-updated feed (~60s heartbeat), so
        // a tight window is correct: a feed silent for an hour here is genuinely
        // broken and must not be trusted for pricing. Pinned explicitly rather
        // than relying on the initializer default so the intent is auditable.
        fyuz.setPriceStalenessThreshold(3600);

        vm.stopBroadcast();

        console.log("");
        console.log("=================================================");
        console.log("BSC DEPLOYMENT COMPLETE (V2 + V3 only, V4 DISABLED)");
        console.log("=================================================");
        console.log("Fyuz:         ", address(fyuz));
        console.log("  ProxyAdmin:     ", _proxyAdmin(address(fyuz)));
        console.log("LiquidityManager: ", address(lm));
        console.log("  ProxyAdmin:     ", _proxyAdmin(address(lm)));
        console.log("Distributor:      ", distributor);
        console.log("Data feed (BNB/USD):", DATA_FEED);
        console.log("Target MCAP (USD):", fyuz.TARGET_MARKET_CAP_USD() / 1e18);
        console.log("Staleness (s):    ", fyuz.priceStalenessThreshold());
        console.log("poolType 1=V2  2=V3 (choose in createToken)");
        console.log("poolType 3=V4 is REJECTED; createTokenDirect is removed");
        console.log("=================================================");
    }
}
