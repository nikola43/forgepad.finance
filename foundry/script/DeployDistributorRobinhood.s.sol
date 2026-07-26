// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {DistributorRobinhood} from "../src/DistributorRobinhood.sol";

/// Deploys the Distributor on Robinhood Chain (chainId 4663).
/// No Chainlink VRF — uses commit-reveal randomness.
///
/// Required env:
///   PRIVATE_KEY=0x...   deployer key
///   MULTISIG=0x...      Gnosis Safe that becomes the Distributor owner
/// Optional env:
///   POSTER=0x...        backend round-runner (defaults to deployer)
///
///   MULTISIG=0x... forge script script/DeployDistributorRobinhood.s.sol \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast
///
/// After deploy: point the Fyuz fee stream here:
///   fyuz.setDistributorAddress(<distributor>)
contract DeployDistributorRobinhood is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        require(block.chainid == 4663, "DeployDistributorRobinhood targets Robinhood Chain (4663)");

        address deployer = vm.addr(pk);
        address poster = vm.envOr("POSTER", deployer);
        address multisig = vm.envAddress("MULTISIG");
        require(multisig != address(0), "Set MULTISIG (Gnosis Safe) env var");
        require(multisig != deployer, "MULTISIG must not be the deployer EOA");

        console.log("Deployer:", deployer);
        console.log("Poster  :", poster);
        console.log("Multisig:", multisig);

        vm.startBroadcast(pk);

        DistributorRobinhood distributor = new DistributorRobinhood(poster);
        distributor.transferOwnership(multisig);

        vm.stopBroadcast();

        require(distributor.poster() == poster, "poster not set");

        console.log("");
        console.log("=================================================");
        console.log("DISTRIBUTOR DEPLOYED (Robinhood Chain)");
        console.log("=================================================");
        console.log("Distributor:      ", address(distributor));
        console.log("Poster:           ", poster);
        console.log("Owner (pending):  ", multisig);
        console.log("");
        console.log("NEXT:");
        console.log("  1. Multisig calls acceptOwnership() on the Distributor");
        console.log("  2. Set distributor address on Fyuz:");
        console.log("     cast send <FYUZ_PROXY> \"setDistributorAddress(address)\" <DISTRIBUTOR> \\");
        console.log("       --rpc-url https://rpc.mainnet.chain.robinhood.com --private-key <KEY>");
        console.log("  3. Commit random hash before each round:");
        console.log("     cast send <DISTRIBUTOR> \"commitRandom(uint256,bytes32)\" <ROUND_ID> <HASH> \\");
        console.log("       --rpc-url https://rpc.mainnet.chain.robinhood.com");
        console.log("=================================================");
    }
}
