// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Fyuz.sol";
import "../src/FyuzLiquidityManager.sol";
import {FyuzDeploy} from "../src/FyuzDeploy.sol";

/// @notice Deploys Fyuz + FyuzLiquidityManager to BNB Smart Chain TESTNET
///         (chainId 97, native gas token tBNB) against PancakeSwap V2 and V3.
///         Testnet twin of DeployBsc.s.sol — same V2+V3-only wiring, only the
///         chain-specific addresses and the price feed differ.
///
///         V4 IS DISABLED, exactly as on mainnet. Fyuz.createToken accepts only
///         poolType 1 (V2) and 2 (V3); poolType 3 (V4) reverts. See the V4
///         sentinel note below.
///
/// Broadcast straight to BSC testnet:
///   PRIVATE_KEY=0x... forge script script/DeployBscTestnet.s.sol \
///     --rpc-url bsc_testnet --broadcast
///
/// Or against an anvil BSC-testnet fork:
///   anvil --fork-url https://bsc-testnet-rpc.publicnode.com --chain-id 97 &
///   PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
///     forge script script/DeployBscTestnet.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///
///   Get tBNB from https://testnet.bnbchain.org/faucet-smart
///
/// @notice Verified BSC Testnet addresses (chainId 97).
///         Explorer: https://testnet.bscscan.com
contract DeployFyuzBscTestnet is Script {

    /// @dev The proxies each deploy their own ProxyAdmin and record it in the
    ///      ERC-1967 admin slot. Log it: it is the only key that can upgrade, and
    ///      recovering it later means digging through deployment logs.
    function _proxyAdmin(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT))));
    }

    // ---- PancakeSwap V2 (BSC Testnet) ----
    address constant V2_ROUTER = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1;
    address constant V2_FACTORY = 0x6725F303b657a9451d8BA641348b6761A6CC7a17;

    // ---- PancakeSwap V3 (BSC Testnet) ----
    // POOL_FEE = 100 / tickSpacing 1 is wire-compatible here, same as mainnet.
    // The V3 FACTORY address is identical on testnet and mainnet; only the
    // NonfungiblePositionManager differs.
    address constant V3_FACTORY = 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865;
    address constant V3_POSITION_MANAGER =
        0x427bF5b37357632377eCbEC9de3626C71A5396c1;

    // ---- Uniswap/PancakeSwap V4: DISABLED (see DeployBsc.s.sol for the full
    //      rationale) ----
    // Non-contract sentinel purely to satisfy the initializer's non-zero check.
    // Safe ONLY because Fyuz gates poolType 3 off; every V4 call site is
    // unreachable. If V4 is ever un-gated on BSC testnet, replace these with real
    // addresses — the sentinel makes V4 fail closed rather than misbehave.
    address constant V4_DISABLED_SENTINEL =
        0x000000000000000000000000000000000000dEaD;

    // ---- Shared / canonical ----
    // WBNB (the "WETH" of BSC testnet). Not a deploy param — the liquidity
    // manager reads it from the router — but recorded here for reference.
    address constant WBNB = 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    // Chainlink BNB/USD on BSC TESTNET (8 decimals). Distinct from the mainnet
    // feed. Fyuz reads priceFeedDecimals dynamically, so 8 decimals is handled.
    address constant DATA_FEED = 0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        address deployer = vm.addr(pk);

        // No Distributor contract on BSC testnet; default to deployer and
        // override via DISTRIBUTOR once a real one is deployed. Fyuz rejects a
        // zero distributor.
        address distributor = vm.envOr("DISTRIBUTOR", deployer);

        // ponytail: staleness overridable — testnet Chainlink feeds lag far more
        // than mainnet's ~60s heartbeat, so bump STALENESS if graduation locks up
        // on a "stale price" revert. Default matches mainnet intent (1h).
        uint256 staleness = vm.envOr("STALENESS", uint256(3600));

        console.log("Deployer:", deployer);
        console.log("Balance :", deployer.balance / 1e18, "tBNB");
        console.log("ChainId :", block.chainid);

        vm.startBroadcast(pk);

        // V2 + V3 wired to PancakeSwap testnet; V4 slots take the disabled sentinel.
        FyuzLiquidityManager lm = FyuzDeploy.deployLiquidityManager(
            V2_ROUTER,
            V3_FACTORY,
            V3_POSITION_MANAGER,
            V4_DISABLED_SENTINEL, // _poolV4Manager    (V4 gated off in Fyuz)
            V4_DISABLED_SENTINEL, // _universalRouter  (stored, never called)
            V4_DISABLED_SENTINEL, // _v4PositionManager(V4 gated off in Fyuz)
            PERMIT2,
            deployer, // _marginRecipient (leftover tBNB at graduation)
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
        fyuz.setPriceStalenessThreshold(staleness);

        vm.stopBroadcast();

        console.log("");
        console.log("=================================================");
        console.log("BSC TESTNET DEPLOYMENT COMPLETE (V2 + V3, V4 DISABLED)");
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
        console.log("poolType 3=V4 is REJECTED");
        console.log("=================================================");
    }
}
