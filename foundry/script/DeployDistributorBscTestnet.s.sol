// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Distributor} from "../src/Distributor.sol";
import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";

/// Deploys the Distributor on BSC TESTNET (chain 97) with a fresh VRF v2.5
/// subscription, adds the Distributor as a consumer, funds the subscription
/// with native BNB, and prints the follow-up steps.
///
///   PRIVATE_KEY=0x...   deployer/owner key
///   VRF_SUB_ID=...      EXISTING VRF v2.5 subscription id (see below)
///   POSTER=0x...        backend round-runner address (defaults to deployer)
///   VRF_FUND_BNB        BNB to preload the VRF subscription (default 0.05)
///
/// v2.5 subIds are derived from the blockhash at inclusion time, so a
/// subscription created inside this script would get a different id on
/// broadcast than in simulation and every follow-up call would target a
/// nonexistent subscription. Create it as its own transaction first:
///   cast send 0xDA3b641D438362C440Ac5458c57e00a712b66700 "createSubscription()" \
///     --rpc-url <rpc> --private-key <pk>
///   subId = topic[1] of the SubscriptionCreated log in the receipt.
///
///   VRF_SUB_ID=<id> forge script script/DeployDistributorBscTestnet.s.sol \
///     --rpc-url https://bsc-testnet.rpc.sentio.xyz --broadcast
///
/// After deploy: point the Fyuz fee stream here with
///   fyuz.setDistributorAddress(<distributor>)
contract DeployDistributorBscTestnet is Script {
    // Chainlink VRF v2.5 on BSC testnet (docs.chain.link/vrf/v2-5/supported-networks)
    address constant VRF_COORDINATOR = 0xDA3b641D438362C440Ac5458c57e00a712b66700;
    bytes32 constant KEY_HASH_50_GWEI = 0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        address deployer = vm.addr(pk);
        address poster = vm.envOr("POSTER", deployer);
        uint256 vrfFund = vm.envOr("VRF_FUND_BNB", uint256(0.05 ether));

        uint256 subId = vm.envUint("VRF_SUB_ID");
        require(subId != 0, "Create the VRF subscription first and set VRF_SUB_ID (see header)");

        require(block.chainid == 97, "This script targets BSC testnet (97)");
        console.log("Deployer:", deployer);
        console.log("Poster  :", poster);

        vm.startBroadcast(pk);

        IVRFCoordinatorV2Plus coordinator = IVRFCoordinatorV2Plus(VRF_COORDINATOR);
        // Distributor is upgradeable now, so it goes behind a proxy and is
        // initialized rather than constructed. The proxy admin is the
        // deployer on testnet, which is who operates this stack.
        Distributor distImpl = new Distributor();
        Distributor distributor = Distributor(payable(address(new TransparentUpgradeableProxy(
            address(distImpl),
            deployer,
            abi.encodeCall(Distributor.initialize, (VRF_COORDINATOR, subId, KEY_HASH_50_GWEI, poster, deployer))
        ))));
        coordinator.addConsumer(subId, address(distributor));
        coordinator.fundSubscriptionWithNative{value: vrfFund}(subId);

        vm.stopBroadcast();

        console.log("Distributor:      ", address(distributor));
        console.log("VRF subscription: ", subId);
        console.log("");
        console.log("Next steps:");
        console.log("  1. fyuz.setDistributorAddress(distributor)  -- route the 0.2% fee here");
        console.log("  2. Set DISTRIBUTOR_ADDRESS + POSTER_PRIVATE_KEY in .env");
        console.log("  3. Cron scripts/distributor-round.sh (e.g. weekly)");
    }
}
