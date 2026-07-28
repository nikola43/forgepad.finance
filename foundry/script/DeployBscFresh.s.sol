// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {TransparentUpgradeableProxy} from
    "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {IVRFCoordinatorV2Plus} from
    "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";

import {Fyuz} from "../src/Fyuz.sol";
import {FyuzDeploy} from "../src/FyuzDeploy.sol";
import {FyuzLiquidityManager} from "../src/FyuzLiquidityManager.sol";
import {Distributor} from "../src/Distributor.sol";

/// @title Fresh BSC mainnet deploy — single owner EOA, everything upgradeable.
///
/// @dev Differs from DeployBsc.s.sol in exactly two ways, both deliberate:
///
///      1. NO MULTISIG. DeployBsc hands every ProxyAdmin and contract owner to a
///         Gnosis Safe and refuses to run if the owner is the deployer. That Safe
///         is 2-of-3 and the deployer is not one of its owners, so nothing could
///         be upgraded without collecting other people's signatures. For a stack
///         being iterated on, this script keeps ONE EOA as owner of everything so
///         upgrades need one key.
///
///         The trade-off is stated rather than hidden: a single EOA holding every
///         ProxyAdmin means one compromised key can replace all the logic and
///         drain the pot. This is the right shape for testing and the wrong shape
///         for holding other people's money — hand the ProxyAdmins to a multisig
///         before real volume arrives.
///
///      2. The Distributor is deployed BEHIND A PROXY like the other two, so a bug
///         in round logic is a code push instead of a migration. That is why
///         Distributor now initializes instead of using a constructor.
///
///      Order matters: the Distributor must exist before Fyuz, because Fyuz's
///      initializer takes the distributor address and rejects zero — the 0.3%
///      leaderboard stream has nowhere to go otherwise.
///
///      Run:
///        PRIVATE_KEY=0x... VRF_SUB_ID=<id> \
///        forge script script/DeployBscFresh.s.sol --rpc-url $BSC_RPC --broadcast
contract DeployBscFresh is Script {
    // ---- PancakeSwap / infra, BSC mainnet ----------------------------------
    address constant V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address constant V3_FACTORY = 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865;
    address constant V3_POSITION_MANAGER = 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364;
    address constant V4_DISABLED_SENTINEL = 0x000000000000000000000000000000000000dEaD;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    /// Chainlink BNB/USD, BSC mainnet.
    address constant DATA_FEED = 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE;
    /// VRF v2.5 coordinator + 200 gwei key hash, BSC mainnet.
    address constant VRF_COORDINATOR = 0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9;
    bytes32 constant KEY_HASH_200_GWEI =
        0x130dba50ad435d4ecc214aad0d5820474137bd68e7e77724144f27c3c377d3d4;

    function _proxyAdmin(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT))));
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY");
        require(block.chainid == 56, "DeployBscFresh targets BSC mainnet (56)");
        address deployer = vm.addr(pk);

        // Owner of everything: proxy admins, contract owners, treasury stream.
        address owner = vm.envOr("OWNER", deployer);
        address poster = vm.envOr("POSTER", deployer);
        address treasury = vm.envOr("TREASURY", owner);

        // VRF subscription. Pass VRF_SUB_ID to reuse an existing one, or leave it
        // unset to create a fresh subscription in this same broadcast.
        //
        // Creating it here rather than by hand is deliberate: the deployer must
        // own the subscription to call addConsumer, and a subscription that
        // exists but is owned by someone else fails LATE — after the contracts
        // are already deployed and paid for.
        uint256 subId = vm.envOr("VRF_SUB_ID", uint256(0));
        // Defaults to 0: the existing subscription is already funded, and this
        // deployer's balance is small enough that a stray 0.005 BNB top-up would
        // be a meaningful fraction of it.
        uint256 vrfFund = vm.envOr("VRF_FUND_BNB", uint256(0));
        // 18-decimal USD. Matches MIN_CREATE_BUY_USD on the create page; 0 disables.
        uint256 minCreateBuyUSD = vm.envOr("MIN_CREATE_BUY_USD", uint256(10 ether));
        // addConsumer is callable only by the SUBSCRIPTION owner. Off by default
        // so a deployer who does not own the sub gets a clean printout to action
        // in the Chainlink UI instead of a failed broadcast halfway through.
        bool addConsumer = vm.envOr("ADD_CONSUMER", false);

        console.log("Deployer :", deployer);
        console.log("Owner    :", owner);
        console.log("Poster   :", poster);
        console.log("Treasury :", treasury);
        console.log("Balance  :", deployer.balance);
        console.log("ChainId  :", block.chainid);

        vm.startBroadcast(pk);

        // ---- 0. VRF subscription -------------------------------------------
        IVRFCoordinatorV2Plus coord = IVRFCoordinatorV2Plus(VRF_COORDINATOR);
        if (subId == 0) {
            subId = coord.createSubscription();
            console.log("Created VRF subscription:", subId);
            addConsumer = true; // we own it, so we can wire the consumer directly
        }

        // ---- 1. Distributor (proxied) --------------------------------------
        Distributor distImpl = new Distributor();
        bytes memory distInit = abi.encodeCall(
            Distributor.initialize,
            (VRF_COORDINATOR, subId, KEY_HASH_200_GWEI, poster, owner)
        );
        Distributor distributor = Distributor(
            payable(address(new TransparentUpgradeableProxy(address(distImpl), owner, distInit)))
        );
        console.log("Distributor:", address(distributor));

        if (addConsumer) {
            coord.addConsumer(subId, address(distributor));
        }
        if (vrfFund > 0) {
            coord.fundSubscriptionWithNative{value: vrfFund}(subId);
        }

        // ---- 2. Liquidity manager ------------------------------------------
        FyuzLiquidityManager lm = FyuzDeploy.deployLiquidityManager(
            V2_ROUTER,
            V3_FACTORY,
            V3_POSITION_MANAGER,
            V4_DISABLED_SENTINEL,
            V4_DISABLED_SENTINEL,
            V4_DISABLED_SENTINEL,
            PERMIT2,
            deployer, // owner during setup; handed to `owner` below
            owner // proxy admin
        );
        console.log("LiquidityManager:", address(lm));

        // ---- 3. Fyuz --------------------------------------------------------
        Fyuz fyuz = FyuzDeploy.deployFyuz(
            DATA_FEED,
            address(lm),
            treasury,
            address(distributor),
            owner // proxy admin
        );
        console.log("Fyuz:", address(fyuz));

        lm.setAuthorizedCaller(address(fyuz), true);

        // 1% per trade = 0.5% treasury + 0.3% leaderboard + 0.2% creator. The
        // platform 80 bps splits 5:3 via platformTreasuryShareBps (6250).
        fyuz.setPlatformBuyFeeBps(80);
        fyuz.setPlatformSellFeeBps(80);
        fyuz.setTokenOwnerFeeBps(20);
        fyuz.setPlatformTreasuryShareBps(6250);
        fyuz.setMaxBuyPercent(10000);
        fyuz.setMaxSellPercent(10000);
        // 1h: BNB/USD on BSC is a native ~60s-heartbeat feed, so a feed silent for
        // an hour is broken and must not price a trade.
        fyuz.setPriceStalenessThreshold(3600);
        // Mandatory initial buy, enforced on-chain. The create page has shown a $10
        // floor for a while, but a frontend check is advice — a scripted caller
        // could launch for free and farm creator grants at the cost of gas.
        fyuz.setMinCreateBuyUSD(minCreateBuyUSD);

        if (owner != deployer) {
            lm.transferOwnership(owner);
            fyuz.transferOwnership(owner);
        }

        vm.stopBroadcast();

        // ---- post-deploy assertions: fail the run rather than ship a misconfig
        require(fyuz.owner() == owner, "Fyuz owner");
        require(lm.owner() == owner, "LM owner");
        require(distributor.owner() == owner, "Distributor owner");
        require(distributor.poster() == poster, "poster");
        require(distributor.vrfSubscriptionId() == subId, "subId");
        require(distributor.vrfKeyHash() == KEY_HASH_200_GWEI, "keyhash");
        require(fyuz.feeAddress() == treasury, "feeAddress");
        require(fyuz.distributorAddress() == address(distributor), "distributor wired");
        require(fyuz.PLATFORM_BUY_FEE_BPS() == 80, "buy fee");
        require(fyuz.PLATFORM_SELL_FEE_BPS() == 80, "sell fee");
        require(fyuz.TOKEN_OWNER_FEE_BPS() == 20, "creator fee");
        require(fyuz.platformTreasuryShareBps() == 6250, "treasury share");
        require(fyuz.priceStalenessThreshold() == 3600, "staleness");
        require(fyuz.minCreateBuyUSD() == minCreateBuyUSD, "min create buy");
        require(_proxyAdmin(address(fyuz)) != address(0), "Fyuz proxy admin");
        require(_proxyAdmin(address(distributor)) != address(0), "Distributor proxy admin");

        console.log("");
        console.log("================ FRESH BSC DEPLOY ================");
        console.log("Fyuz:             ", address(fyuz));
        console.log("  ProxyAdmin:     ", _proxyAdmin(address(fyuz)));
        console.log("LiquidityManager: ", address(lm));
        console.log("  ProxyAdmin:     ", _proxyAdmin(address(lm)));
        console.log("Distributor:      ", address(distributor));
        console.log("  ProxyAdmin:     ", _proxyAdmin(address(distributor)));
        console.log("Owner (all):      ", owner);
        console.log("Poster:           ", poster);
        console.log("VRF sub:          ", subId);
        console.log("Min create buy USD:", minCreateBuyUSD);
        console.log("consumer added:   ", addConsumer);
        console.log("=================================================");
        if (!addConsumer) {
            console.log("ACTION: add the Distributor as a consumer on VRF sub", subId);
        }
    }
}
