// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {Distributor} from "../src/Distributor.sol";
import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";

/// Deploys the Distributor on BSC MAINNET (chain 56) against a Chainlink VRF
/// v2.5 subscription, adds the Distributor as a consumer, funds the
/// subscription with native BNB, and proposes ownership to the multisig.
///
/// Required env:
///   PRIVATE_KEY=0x...   deployer key (also the VRF subscription owner)
///   VRF_SUB_ID=...      EXISTING VRF v2.5 subscription id (create it first, below)
///   MULTISIG=0x...      Gnosis Safe that becomes the Distributor owner
/// Optional env:
///   POSTER=0x...        backend round-runner (defaults to deployer)
///   VRF_FUND_BNB        native BNB to preload the subscription (default 0.005)
///
/// v2.5 subIds are derived from the blockhash at inclusion time, so a
/// subscription created inside this script would get a different id on
/// broadcast than in simulation. Create it as its own transaction FIRST:
///   cast send 0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9 "createSubscription()" \
///     --rpc-url <rpc> --private-key <pk>
///   subId = topic[1] of the SubscriptionCreated log in the receipt.
///
///   VRF_SUB_ID=<id> MULTISIG=0x... forge script script/DeployDistributorBsc.s.sol \
///     --rpc-url https://bsc-rpc.publicnode.com --broadcast
///
/// NOTE: Distributor uses Chainlink's two-step ConfirmedOwner. transferOwnership
/// only PROPOSES; the multisig must call acceptOwnership() to finalize. The
/// deployer stays owner until then, so there is no lockout window.
///
/// After deploy: point the Fyuz fee stream here (DeployBsc reads DISTRIBUTOR),
/// or on an already-deployed Fyuz: fyuz.setDistributorAddress(<distributor>).
contract DeployDistributorBsc is Script {
    // Chainlink VRF v2.5 on BSC mainnet (docs.chain.link/vrf/v2-5/supported-networks)
    address constant VRF_COORDINATOR = 0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9;
    // 200 gwei gas lane.
    bytes32 constant KEY_HASH_200_GWEI = 0x130dba50ad435d4ecc214aad0d5820474137bd68e7e77724144f27c3c377d3d4;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        require(block.chainid == 56, "DeployDistributorBsc targets BSC mainnet (56)");

        address deployer = vm.addr(pk);
        address poster = vm.envOr("POSTER", deployer);
        uint256 vrfFund = vm.envOr("VRF_FUND_BNB", uint256(0.005 ether));

        uint256 subId = vm.envUint("VRF_SUB_ID");
        require(subId != 0, "Create the VRF subscription first and set VRF_SUB_ID (see header)");

        address multisig = vm.envAddress("MULTISIG");
        require(multisig != address(0), "Set MULTISIG (Gnosis Safe) env var");
        require(multisig != deployer, "MULTISIG must not be the deployer EOA");

        console.log("Deployer:", deployer);
        console.log("Poster  :", poster);
        console.log("Multisig:", multisig);
        console.log("SubId   :", subId);
        console.log("Fund BNB:", vrfFund);

        vm.startBroadcast(pk);

        Distributor distributor = new Distributor(VRF_COORDINATOR, subId, KEY_HASH_200_GWEI, poster);

        IVRFCoordinatorV2Plus coordinator = IVRFCoordinatorV2Plus(VRF_COORDINATOR);
        coordinator.addConsumer(subId, address(distributor));
        if (vrfFund > 0) {
            coordinator.fundSubscriptionWithNative{value: vrfFund}(subId);
        }

        // Two-step: proposes ownership; multisig must acceptOwnership() to finalize.
        distributor.transferOwnership(multisig);

        vm.stopBroadcast();

        // Sanity: consumer wired, poster/keyhash/sub set, ownership proposed (not yet accepted).
        require(distributor.poster() == poster, "poster not set");
        require(distributor.vrfSubscriptionId() == subId, "subId mismatch");
        require(distributor.vrfKeyHash() == KEY_HASH_200_GWEI, "keyhash mismatch");

        console.log("");
        console.log("=================================================");
        console.log("DISTRIBUTOR DEPLOYED (BSC mainnet)");
        console.log("=================================================");
        console.log("Distributor:      ", address(distributor));
        console.log("VRF coordinator:  ", VRF_COORDINATOR);
        console.log("VRF subscription: ", subId);
        console.log("Poster:           ", poster);
        console.log("Owner (pending):  ", multisig);
        console.log("");
        console.log("NEXT:");
        console.log("  1. Multisig calls acceptOwnership() on the Distributor");
        console.log("  2. Pass DISTRIBUTOR=<above> to DeployBsc for the Fyuz deploy");
        console.log("=================================================");
    }
}
