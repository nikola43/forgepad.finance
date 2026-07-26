// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Fyuz.sol";
import "../src/FyuzLiquidityManager.sol";
import {FyuzDeploy} from "../src/FyuzDeploy.sol";

/// @notice Deploys Fyuz + FyuzLiquidityManager to Robinhood Chain (chainId 4663,
///         native gas token ETH) against Uniswap V2 and V3.
///
///         V4 IS DISABLED. Pool type 3 (V4) reverts in Fyuz.createToken.
///
/// Run:
///   PRIVATE_KEY=0x... MULTISIG=0x... forge script script/DeployRobinhood.s.sol \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast
///
/// NOTE: DISTRIBUTOR env var is optional. If not set, the deployer EOA is used
///       as a temporary distributor address. Call fyuz.setDistributorAddress()
///       later to point at the real Distributor contract once deployed.
contract DeployRobinhood is Script {

    function _proxyAdmin(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT))));
    }

    // ---- Uniswap V2 (Robinhood) ----
    address constant V2_ROUTER = 0x89e5DB8B5aA49aA85AC63f691524311AEB649eba;
    address constant V2_FACTORY = 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f;

    // ---- Uniswap V3 (Robinhood) ----
    address constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant V3_POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;

    // ---- V4 DISABLED (sentinel, never called) ----
    address constant V4_DISABLED_SENTINEL = 0x000000000000000000000000000000000000dEaD;

    // ---- Shared / canonical ----
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    // Chainlink ETH/USD on Robinhood Chain (8 decimals)
    address constant DATA_FEED = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        require(block.chainid == 4663, "DeployRobinhood targets Robinhood Chain (4663)");

        address deployer = vm.addr(pk);
        // Distributor: use env if set, otherwise fall back to deployer as a
        // temporary placeholder. The real Distributor can be wired later via
        // fyuz.setDistributorAddress() without an upgrade.
        address distributor = vm.envOr("DISTRIBUTOR", deployer);
        address multisig = vm.envAddress("MULTISIG");
        require(multisig != address(0), "Set MULTISIG (Gnosis Safe) env var");
        require(multisig != deployer, "MULTISIG must not be the deployer EOA");
        address treasury = vm.envOr("TREASURY", multisig);
        require(treasury != address(0), "treasury unset");

        console.log("Deployer:  ", deployer);
        console.log("Multisig:  ", multisig);
        console.log("Treasury:  ", treasury);
        console.log("Distributor:", distributor);
        console.log("Balance:   ", deployer.balance / 1e18, "ETH");
        console.log("ChainId:   ", block.chainid);

        vm.startBroadcast(pk);

        FyuzLiquidityManager lm = FyuzDeploy.deployLiquidityManager(
            V2_ROUTER,
            V3_FACTORY,
            V3_POSITION_MANAGER,
            V4_DISABLED_SENTINEL,
            V4_DISABLED_SENTINEL,
            V4_DISABLED_SENTINEL,
            PERMIT2,
            deployer,
            multisig
        );
        console.log("FyuzLiquidityManager:", address(lm));

        Fyuz fyuz = FyuzDeploy.deployFyuz(
            DATA_FEED,
            address(lm),
            treasury,
            distributor,
            multisig
        );
        console.log("Fyuz:", address(fyuz));

        lm.setAuthorizedCaller(address(fyuz), true);

        fyuz.setPlatformBuyFeeBps(80);
        fyuz.setPlatformSellFeeBps(80);
        fyuz.setTokenOwnerFeeBps(20);
        fyuz.setPlatformTreasuryShareBps(6250);
        fyuz.setMaxBuyPercent(10000);
        fyuz.setMaxSellPercent(10000);

        // Robinhood Chain is an Arbitrum Orbit L2 — Chainlink feed timestamps
        // originate from L1 and can lag hours behind L2 block time. Use 24h
        // staleness to tolerate L1→L2 propagation delays.
        fyuz.setPriceStalenessThreshold(86400);

        lm.transferOwnership(multisig);
        fyuz.transferOwnership(multisig);

        vm.stopBroadcast();

        require(fyuz.owner() == multisig, "Fyuz owner != multisig");
        require(lm.owner() == multisig, "LM owner != multisig");
        require(_proxyAdmin(address(fyuz)) != address(0), "Fyuz ProxyAdmin unset");
        require(fyuz.distributorAddress() == distributor, "distributor mismatch");
        require(fyuz.PLATFORM_BUY_FEE_BPS() == 80, "buy fee != 80");
        require(fyuz.PLATFORM_SELL_FEE_BPS() == 80, "sell fee != 80");
        require(fyuz.TOKEN_OWNER_FEE_BPS() == 20, "creator fee != 20");
        require(fyuz.platformTreasuryShareBps() == 6250, "treasury share != 6250");
        require(fyuz.priceStalenessThreshold() == 86400, "staleness != 86400");
        require(fyuz.owner() != deployer && lm.owner() != deployer, "deployer still owner");

        console.log("");
        console.log("=================================================");
        console.log("ROBINHOOD DEPLOYMENT COMPLETE (V2 + V3, V4 DISABLED)");
        console.log("=================================================");
        console.log("Fyuz:         ", address(fyuz));
        console.log("  ProxyAdmin:     ", _proxyAdmin(address(fyuz)));
        console.log("LiquidityManager: ", address(lm));
        console.log("  ProxyAdmin:     ", _proxyAdmin(address(lm)));
        console.log("Distributor:      ", distributor);
        console.log("Data feed (ETH/USD):", DATA_FEED);
        console.log("Target MCAP (USD):", fyuz.TARGET_MARKET_CAP_USD() / 1e18);
        console.log("Staleness (s):    ", fyuz.priceStalenessThreshold());
        console.log("=================================================");
    }
}
