// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {DistributorV2} from "../src/DistributorV2.sol";
import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Minimal view of AutomationRegistrar2_1 — see
/// lib/chainlink-brownie-contracts/contracts/src/v0.8/automation/v2_1/AutomationRegistrar2_1.sol
interface IAutomationRegistrar2_1 {
    struct RegistrationParams {
        string name;
        bytes encryptedEmail;
        address upkeepContract;
        uint32 gasLimit;
        address adminAddress;
        uint8 triggerType; // 0 = conditional (checkUpkeep), 1 = log trigger
        bytes checkData;
        bytes triggerConfig;
        bytes offchainConfig;
        uint96 amount; // LINK juels to prefund the upkeep with
    }

    function registerUpkeep(RegistrationParams calldata requestParams) external returns (uint256);
    function LINK() external view returns (address);
}

/// Deploys DistributorV2 on BSC MAINNET (chain 56):
///   1. deploys against the existing Chainlink VRF v2.5 subscription
///   2. adds the contract as a VRF consumer and funds the sub with native BNB
///   3. OPTIONALLY registers a Chainlink Automation v2.1 conditional upkeep
///   4. proposes ownership to the multisig (two-step; Safe must accept)
///
/// Required env:
///   PRIVATE_KEY=0x...   deployer key (must also own the VRF subscription)
///   MULTISIG=0x...      Gnosis Safe that becomes the DistributorV2 owner
/// Optional env:
///   VRF_SUB_ID=...      defaults to the V2 subscription baked in below
///   POSTER=0x...        admin/round-runner wallet (defaults to DEFAULT_POSTER)
///   ADD_CONSUMER=true   also call addConsumer + fund the sub. Only works when
///                       the DEPLOYER owns the VRF subscription; otherwise leave
///                       it off and add the printed address from the VRF UI.
///   VRF_FUND_BNB=...    native BNB to preload the subscription (default 0.005,
///                       only used when ADD_CONSUMER=true)
///
///   AUTOMATION_REGISTRAR=0x...  v2.1 registrar; when unset, registration is
///                               SKIPPED and you register via the UI instead
///   UPKEEP_LINK=...             LINK juels to prefund the upkeep (default 5e18)
///   UPKEEP_GAS_LIMIT=...        performUpkeep gas cap (default 5,000,000, which
///                               pays a normal 100-holder round in one call; the
///                               contract resumes across calls if a set needs
///                               more, so this is a throughput knob, not a
///                               correctness one). v2.1 registries cap this —
///                               registerUpkeep reverts GasLimitOutsideRange if
///                               5M is above the BSC registry's maxPerformGas;
///                               lower it and the round just takes two calls.
///
/// @dev The v2.1 registrar address is NOT hardcoded on purpose. Chainlink's
///      registry/registrar addresses are per-chain and get rotated, and a wrong
///      address here means LINK sent into nothing. Copy the BNB Chain mainnet
///      "Registrar" address from docs.chain.link/chainlink-automation/overview/
///      supported-networks and pass it in. The script sanity-checks it by
///      reading registrar.LINK() before approving any LINK.
///
///      Automation v2.1 is EOL on 2026-07-31. The consumer interface
///      (checkUpkeep/performUpkeep) is identical on the newer registries, so
///      DistributorV2 needs no code change to migrate — only the upkeep has to
///      be re-registered against the new registrar.
///
/// Run:
///   MULTISIG=0x... AUTOMATION_REGISTRAR=0x... \
///   forge script script/DeployDistributorV2Bsc.s.sol \
///     --rpc-url https://bsc-rpc.publicnode.com --broadcast
///
/// After deploy:
///   1. Safe calls acceptOwnership() on DistributorV2
///   2. Safe calls setAutomationConfig(true, <forwarder>, ...) with the upkeep's
///      forwarder address (registry.getForwarder(upkeepId)) to lock performUpkeep
///   3. fyuz.setDistributorAddress(<distributorV2>) to move the fee stream over
///   4. point scripts/distributor-v2-round.sh at DISTRIBUTOR_V2_ADDRESS
contract DeployDistributorV2Bsc is Script {
    // Chainlink VRF v2.5 on BSC mainnet (docs.chain.link/vrf/v2-5/supported-networks)
    address constant VRF_COORDINATOR = 0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9;
    // 200 gwei gas lane.
    bytes32 constant KEY_HASH_200_GWEI = 0x130dba50ad435d4ecc214aad0d5820474137bd68e7e77724144f27c3c377d3d4;
    // LINK on BSC mainnet — Automation upkeeps are LINK-funded.
    address constant LINK_BSC = 0x404460C6A5EdE2D891e8297795264fDe62ADBB75;
    // VRF v2.5 subscription provisioned for DistributorV2 (already funded).
    uint256 constant DEFAULT_VRF_SUB_ID =
        88793579770736784866831940297647545091858477888892507933158427707635269809126;
    // Admin wallet: posts leaderboard shares and can run a payout by hand.
    address constant DEFAULT_POSTER = 0x831e7d5AA39Aa71A3a76FeA8d9ae747021b39F9c;
    // Monday 2026-07-27 08:00:00 UTC — the weekly payout slot.
    uint64 constant MONDAY_0800_UTC = 1785139200;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        require(block.chainid == 56, "DeployDistributorV2Bsc targets BSC mainnet (56)");

        address deployer = vm.addr(pk);
        address poster = vm.envOr("POSTER", DEFAULT_POSTER);
        uint256 vrfFund = vm.envOr("VRF_FUND_BNB", uint256(0.005 ether));
        uint256 subId = vm.envOr("VRF_SUB_ID", DEFAULT_VRF_SUB_ID);
        require(subId != 0, "VRF_SUB_ID must not be zero");

        address multisig = vm.envAddress("MULTISIG");
        require(multisig != address(0), "Set MULTISIG (Gnosis Safe) env var");
        require(multisig != deployer, "MULTISIG must not be the deployer EOA");

        address registrar = vm.envOr("AUTOMATION_REGISTRAR", address(0));
        uint96 upkeepLink = uint96(vm.envOr("UPKEEP_LINK", uint256(5e18)));
        uint32 upkeepGasLimit = uint32(vm.envOr("UPKEEP_GAS_LIMIT", uint256(5_000_000)));

        console.log("Deployer :", deployer);
        console.log("Poster   :", poster);
        console.log("Multisig :", multisig);
        console.log("VRF sub  :", subId);
        console.log("Registrar:", registrar);

        vm.startBroadcast(pk);

        DistributorV2 distributor = new DistributorV2(VRF_COORDINATOR, subId, KEY_HASH_200_GWEI, poster);

        // Wiring the consumer requires the VRF SUBSCRIPTION OWNER, which is not
        // necessarily whoever runs this script — addConsumer reverts for anyone
        // else. Opt in with ADD_CONSUMER=true when the deployer owns the sub;
        // otherwise the address is printed below and added from the VRF UI.
        if (vm.envOr("ADD_CONSUMER", false)) {
            IVRFCoordinatorV2Plus coordinator = IVRFCoordinatorV2Plus(VRF_COORDINATOR);
            coordinator.addConsumer(subId, address(distributor));
            if (vrfFund > 0) {
                coordinator.fundSubscriptionWithNative{value: vrfFund}(subId);
            }
        }

        uint256 upkeepId;
        if (registrar != address(0)) {
            // Verify the registrar really is one before handing it LINK — a typo'd
            // address would otherwise swallow the approval silently.
            address registrarLink = IAutomationRegistrar2_1(registrar).LINK();
            require(registrarLink == LINK_BSC, "AUTOMATION_REGISTRAR is not the BSC LINK registrar");
            require(
                IERC20(LINK_BSC).balanceOf(deployer) >= upkeepLink,
                "Deployer has too little LINK to fund the upkeep"
            );

            IERC20(LINK_BSC).approve(registrar, upkeepLink);
            upkeepId = IAutomationRegistrar2_1(registrar).registerUpkeep(
                IAutomationRegistrar2_1.RegistrationParams({
                    name: "Fyuz DistributorV2 rounds",
                    encryptedEmail: "",
                    upkeepContract: address(distributor),
                    gasLimit: upkeepGasLimit,
                    // The Safe administers the upkeep (pause, top up, cancel), not the EOA.
                    adminAddress: multisig,
                    triggerType: 0, // conditional upkeep -> polls checkUpkeep
                    checkData: "",
                    triggerConfig: "",
                    offchainConfig: "",
                    amount: upkeepLink
                })
            );
            // A zero id means the registrar queued the request for manual approval
            // instead of auto-approving it — not a failure, but it needs a human.
            require(upkeepId != 0, "Upkeep registration pending manual approval in the Chainlink UI");
        }

        // Two-step: proposes ownership; multisig must acceptOwnership() to finalize.
        distributor.transferOwnership(multisig);

        vm.stopBroadcast();

        // Sanity: consumer wired, poster/keyhash/sub set, automation defaults sane.
        require(distributor.poster() == poster, "poster not set");
        require(distributor.vrfSubscriptionId() == subId, "subId mismatch");
        require(distributor.vrfKeyHash() == KEY_HASH_200_GWEI, "keyhash mismatch");
        require(distributor.automationEnabled(), "automation disabled");
        require(distributor.distributeBatchSize() > 0, "batch size zero");
        require(distributor.scheduleAnchor() == MONDAY_0800_UTC, "schedule anchor mismatch");
        require(distributor.period() == 1 weeks, "period must be weekly");
        // Monday == day 4 of the unix epoch week (epoch day 0 was a Thursday).
        require(uint256(MONDAY_0800_UTC) % 1 days == 8 hours, "anchor is not 08:00 UTC");
        require((uint256(MONDAY_0800_UTC) / 1 days) % 7 == 4, "anchor is not a Monday");

        console.log("");
        console.log("=================================================");
        console.log("DISTRIBUTOR V2 DEPLOYED (BSC mainnet)");
        console.log("=================================================");
        console.log("DistributorV2:    ", address(distributor));
        console.log("VRF coordinator:  ", VRF_COORDINATOR);
        console.log("VRF subscription: ", subId);
        console.log("Poster:           ", poster);
        console.log("Owner (pending):  ", multisig);
        console.log("Upkeep id:        ", upkeepId);
        console.log("Payout schedule:   every Monday 08:00 UTC (anchor 1785139200)");
        console.log("Next round opens: ", distributor.nextRoundAt());
        console.log("");
        console.log("=================================================");
        console.log("ADD THIS ADDRESS AS A VRF CONSUMER:");
        console.log("  ", address(distributor));
        console.log("  on subscription", subId);
        console.log("=================================================");
        console.log("");
        console.log("NEXT:");
        console.log("  1. Multisig calls acceptOwnership()");
        if (registrar == address(0)) {
            console.log("  2. Register a CONDITIONAL upkeep at automation.chain.link");
            console.log("     target =", address(distributor));
            console.log("     gas limit =", upkeepGasLimit);
        } else {
            console.log("  2. Read registry.getForwarder(upkeepId), then multisig calls");
            console.log("     setAutomationConfig(true, forwarder, 6h, 30m, 3, 100, 250k)");
        }
        console.log("  3. fyuz.setDistributorAddress(<above>) to move the fee stream");
        console.log("=================================================");
    }
}
