// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from
    "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Distributor.sol";

/// @notice Upgrades the live BSC-mainnet Distributor proxy to the Chainlink
///         Automation build: checkUpkeep/performUpkeep drive the whole round
///         (start, retry VRF, distribute, cancel), the round window is derived
///         on-chain, and the payout is batched so it can never outgrow an
///         upkeep's gas limit.
///
///         Storage is APPEND-ONLY versus the deployed layout — the automation
///         fields sit below `vrfNativePayment` and the new `Round` members sit at
///         the end of the struct — so the proxy keeps roundId, the pot, poster,
///         the VRF config and every claimable balance.
///
/// @dev TWO transactions, and the order matters:
///
///        1. ProxyAdmin.upgradeAndCall(proxy, impl, "") with EMPTY data.
///           Passing the initializer as `data` would run it with msg.sender ==
///           ProxyAdmin, and initializeAutomation() is onlyOwner — the owner is
///           the EOA, so it would revert and take the upgrade down with it.
///        2. Distributor(proxy).initializeAutomation() called DIRECTLY by the
///           owner EOA. A transparent proxy routes every non-admin caller to the
///           implementation, and the EOA is not the admin (the ProxyAdmin
///           contract is), so this lands in the logic as intended.
///
///      Until step 2 lands the appended fields are all zero, which means
///      automationEnabled == false and distributeBatchSize == 0: the upkeep stays
///      quiet and distribute() pays nobody. That is a safe intermediate state, not
///      a live one — do not stop between the two.
///
///      Run:
///        PRIVATE_KEY=0x... forge script \
///          script/UpgradeDistributorAutomationBsc.s.sol \
///          --rpc-url https://bsc-dataseed.bnbchain.org --broadcast
contract UpgradeDistributorAutomationBsc is Script {
    address constant DISTRIBUTOR_PROXY = 0x2C88255f6a80296a3AA8C328E5fF308D74615c7b;

    function _adminOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT))));
    }

    function _implOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.IMPLEMENTATION_SLOT))));
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        require(block.chainid == 56, "This script targets BSC mainnet (56)");
        address caller = vm.addr(pk);

        Distributor distributor = Distributor(payable(DISTRIBUTOR_PROXY));
        ProxyAdmin admin = ProxyAdmin(_adminOf(DISTRIBUTOR_PROXY));

        console.log("Caller       :", caller);
        console.log("Proxy        :", DISTRIBUTOR_PROXY);
        console.log("ProxyAdmin   :", address(admin));
        console.log("Admin owner  :", admin.owner());
        console.log("Distributor  :", distributor.owner());
        console.log("Old impl     :", _implOf(DISTRIBUTOR_PROXY));
        console.log("roundId      :", distributor.roundId());
        console.log("balance      :", DISTRIBUTOR_PROXY.balance);

        // Both steps are the EOA's to make: it owns the ProxyAdmin AND the
        // Distributor. Failing early beats a half-applied upgrade.
        require(admin.owner() == caller, "caller does not own the ProxyAdmin");
        require(distributor.owner() == caller, "caller does not own the Distributor");

        vm.startBroadcast(pk);

        Distributor impl = new Distributor();
        console.log("New impl     :", address(impl));

        // Step 1 — empty data; see the note above on why the initializer is not
        // passed here.
        admin.upgradeAndCall(ITransparentUpgradeableProxy(DISTRIBUTOR_PROXY), address(impl), "");

        // Step 2 — fill in the appended automation state (windowStart opens now,
        // weekly Monday-08:00 UTC anchor, timeouts and batch defaults).
        distributor.initializeAutomation();

        vm.stopBroadcast();

        console.log("--- after ---");
        console.log("impl         :", _implOf(DISTRIBUTOR_PROXY));
        console.log("automationOn :", distributor.automationEnabled());
        console.log("windowStart  :", distributor.windowStart());
        console.log("nextRoundAt  :", distributor.nextRoundAt());
        console.log("batchSize    :", distributor.distributeBatchSize());
        (uint8 action, uint256 rid) = distributor.pendingAction();
        console.log("pendingAction:", action, rid);
        console.log("");
        console.log("Next: register a Chainlink Automation custom-logic upkeep on");
        console.log("the proxy, then setAutomationConfig(...) with the forwarder.");
    }
}
