// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Arrowpad.sol";
import "../src/ArrowpadLiquidityManager.sol";

/// @notice Deploys Arrowpad + ArrowpadLiquidityManager to Robinhood Chain
///         (Arbitrum Orbit L2, chainId 4663, ETH gas token) with V2, V3 and V4
///         all enabled. DEX version is chosen per token via createToken's
///         `poolType` argument: 1 = Uniswap V2, 2 = Uniswap V3, 3 = Uniswap V4.
///
/// Run against a fork:
///   anvil --fork-url https://rpc.mainnet.chain.robinhood.com &
///   PRIVATE_KEY=0x... forge script script/DeployRobinhood.s.sol \
///     --rpc-url http://127.0.0.1:8545 --broadcast
/// @notice Verified Robinhood Chain addresses (chainId 4663).
///         RPC: https://rpc.mainnet.chain.robinhood.com
///         Explorer: https://explorer.mainnet.chain.robinhood.com
///
///         V2:   factory=0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f
///               router=0x89e5db8b5aa49aa85ac63f691524311aeb649eba
///         V3:   factory=0x1f7d7550b1b028f7571e69a784071f0205fd2efa
///               positionMgr=0x73991a25c818bf1f1128deaab1492d45638de0d3
///         V4:   poolMgr=0x8366a39cc670b4001a1121b8f6a443a643e40951
///               positionMgr=0x58daec3116aae6d93017baaea7749052e8a04fa7
contract DeployArrowpadRobinhood is Script {
    // ---- Uniswap V2 (Robinhood) ----
    address constant V2_ROUTER = 0x89e5DB8B5aA49aA85AC63f691524311AEB649eba;
    address constant V2_FACTORY = 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f;

    // ---- Uniswap V3 (Robinhood) ----
    address constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant V3_POSITION_MANAGER =
        0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;

    // ---- Uniswap V4 (Robinhood) ----
    address constant V4_POOL_MANAGER =
        0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant V4_POSITION_MANAGER =
        0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant UNIVERSAL_ROUTER =
        0x8876789976dEcBfCbBbe364623C63652db8C0904;

    // ---- Shared ----
    // Multicall3 (not used in contract, but useful for batch operations post-deploy)
    address constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    // Chainlink ETH/USD (Robinhood, 8 decimals)
    address constant DATA_FEED = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    // Distributor (receives distributor role on Arrowpad)
    address constant DISTRIBUTOR = 0x5941B12F8a511811a06133F7b2f56484faD60F1d;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        address deployer = vm.addr(pk);

        console.log("Deployer:", deployer);
        console.log("Balance :", deployer.balance / 1e18, "ETH");

        vm.startBroadcast(pk);

        // All V2/V3/V4 addresses wired so every poolType is usable.
        ArrowpadLiquidityManager lm = new ArrowpadLiquidityManager(
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
        console.log("ArrowpadLiquidityManager:", address(lm));

        Arrowpad arrowpad = new Arrowpad(
            DATA_FEED,
            address(lm),
            deployer, // _feeAddress
            DISTRIBUTOR // _distributorAddress
        );
        console.log("Arrowpad:", address(arrowpad));

        // Authorize Arrowpad to drive the liquidity manager at graduation.
        lm.setAuthorizedCaller(address(arrowpad), true);

        // 1% buy / 1% sell (100 bps), full buy/sell size allowed.
        arrowpad.setPlatformBuyFeeBps(100);
        arrowpad.setPlatformSellFeeBps(100);
        arrowpad.setMaxBuyPercent(10000);
        arrowpad.setMaxSellPercent(10000);

        // On Robinhood Chain (Arbitrum Orbit L2) the Chainlink feed timestamp
        // originates from L1 and can lag hours behind the L2 block time. Use a
        // 24h staleness window so graduation and fee calculations aren't bricked.
        arrowpad.setPriceStalenessThreshold(86400);

        vm.stopBroadcast();

        console.log("");
        console.log("=================================================");
        console.log("ROBINHOOD DEPLOYMENT COMPLETE (V2 + V3 + V4 enabled)");
        console.log("=================================================");
        console.log("Arrowpad:         ", address(arrowpad));
        console.log("LiquidityManager: ", address(lm));
        console.log("Target MCAP (USD):", arrowpad.TARGET_MARKET_CAP_USD() / 1e18);
        console.log("poolType 1=V2  2=V3  3=V4 (choose in createToken)");
        console.log("=================================================");
    }
}
