// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from
    "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Distributor.sol";

/// @notice Upgrades the live BSC-mainnet Distributor proxy to the audit-fix build.
///
///         Fixes carried by this implementation:
///           HIGH   reentrancy in _distribute. The payout cursor is committed once
///                  after the loop, so mid-loop the STORED cursor is stale. A holder
///                  re-entering distributeBatch(rid, 1) from its payout hook read
///                  that stale cursor and was paid a second time — ~13k gas fits
///                  inside the 30k push stipend, so the stipend was never a guard.
///                  The surplus came out of the winner's 10% and the next round's
///                  fees; once the balance ran short the winner's push failed into
///                  `claimable`, pushing totalClaimable above the real balance and
///                  permanently zeroing distributable(). Now nonReentrant on
///                  distribute / distributeBatch / performUpkeep / claim /
///                  emergencyWithdraw.
///           MEDIUM cancelling a PARTIALLY-paid round left windowStart unadvanced,
///                  so the already-paid holders were scored again and paid twice
///                  out of the next pot. _cancelRound now advances the window when
///                  r.cursor > 0, and still rolls it forward when nothing was paid.
///
/// @dev ONE transaction, unlike the automation upgrade this supersedes.
///      initializeAutomation() must NOT be called: it is reinitializer(2) and the
///      live proxy already consumed it, so calling it reverts InvalidInitialization.
///      There is nothing to initialize anyway — this build adds NO storage:
///      ReentrancyGuard is OZ >=5.5, which is @custom:stateless and keeps its flag
///      in one ERC-7201 namespaced slot, so the layout below `vrfNativePayment` is
///      byte-identical to what the proxy already uses (verified with
///      `forge inspect storage-layout`: roundId is still slot 50). The guard also
///      trips only on `== ENTERED` (2), so the proxy's zero-valued guard slot reads
///      as not-entered on the first call after the upgrade.
///
///      Run:
///        PRIVATE_KEY=0x... forge script \
///          script/UpgradeDistributorSecurityFixBsc.s.sol \
///          --rpc-url https://bsc-dataseed.bnbchain.org --broadcast
contract UpgradeDistributorSecurityFixBsc is Script {
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

        // ---- snapshot the state the upgrade must not disturb ---------------
        uint256 roundIdBefore = distributor.roundId();
        uint256 totalClaimableBefore = distributor.totalClaimable();
        address posterBefore = distributor.poster();
        uint256 subIdBefore = distributor.vrfSubscriptionId();
        uint64 windowStartBefore = distributor.windowStart();
        uint16 batchBefore = distributor.distributeBatchSize();
        uint256 balanceBefore = DISTRIBUTOR_PROXY.balance;

        console.log("Caller       :", caller);
        console.log("Proxy        :", DISTRIBUTOR_PROXY);
        console.log("ProxyAdmin   :", address(admin));
        console.log("Old impl     :", _implOf(DISTRIBUTOR_PROXY));
        console.log("roundId      :", roundIdBefore);
        console.log("totalClaimable:", totalClaimableBefore);
        console.log("balance      :", balanceBefore);

        require(admin.owner() == caller, "caller does not own the ProxyAdmin");
        require(distributor.owner() == caller, "caller does not own the Distributor");

        vm.startBroadcast(pk);
        Distributor impl = new Distributor();
        console.log("New impl     :", address(impl));
        admin.upgradeAndCall(ITransparentUpgradeableProxy(DISTRIBUTOR_PROXY), address(impl), "");
        vm.stopBroadcast();

        // ---- prove the live state survived ---------------------------------
        require(_implOf(DISTRIBUTOR_PROXY) == address(impl), "implementation did not change");
        require(distributor.roundId() == roundIdBefore, "roundId moved");
        require(distributor.totalClaimable() == totalClaimableBefore, "totalClaimable moved");
        require(distributor.poster() == posterBefore, "poster moved");
        require(distributor.vrfSubscriptionId() == subIdBefore, "vrf subscription moved");
        require(distributor.windowStart() == windowStartBefore, "windowStart moved");
        require(distributor.distributeBatchSize() == batchBefore, "batch size moved");
        require(DISTRIBUTOR_PROXY.balance == balanceBefore, "balance moved");
        require(distributor.owner() == caller, "ownership moved");

        console.log("--- after ---");
        console.log("impl         :", _implOf(DISTRIBUTOR_PROXY));
        console.log("roundId      :", distributor.roundId());
        console.log("automationOn :", distributor.automationEnabled());
        console.log("batchSize    :", distributor.distributeBatchSize());
        console.log("gasFloor     :", distributor.gasFloor());
        (uint8 action, uint256 rid) = distributor.pendingAction();
        console.log("pendingAction:", action, rid);
        console.log("");
        console.log("State preserved. Reentrancy + partial-cancel fixes are live.");
    }
}
