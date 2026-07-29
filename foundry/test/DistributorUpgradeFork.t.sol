// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from
    "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Distributor} from "../src/Distributor.sol";

/// Runs the automation upgrade against the REAL BSC-mainnet Distributor proxy on
/// a fork. Unit tests deploy a fresh proxy and so can never catch the one failure
/// that actually matters here: the appended storage landing on top of state the
/// live proxy already wrote. This reads that state before the upgrade and asserts
/// it survived.
///
/// Skipped automatically when the fork RPC is unreachable, so it never turns a
/// network outage into a red suite.
contract DistributorUpgradeForkTest is Test {
    address constant PROXY = 0x2C88255f6a80296a3AA8C328E5fF308D74615c7b;

    Distributor distributor = Distributor(payable(PROXY));

    function _adminOf() internal view returns (address) {
        return address(uint160(uint256(vm.load(PROXY, ERC1967Utils.ADMIN_SLOT))));
    }

    function _implOf() internal view returns (address) {
        return address(uint160(uint256(vm.load(PROXY, ERC1967Utils.IMPLEMENTATION_SLOT))));
    }

    function setUp() public {
        try vm.createSelectFork(vm.envOr("BSC_FORK_URL", string("https://bsc-dataseed.bnbchain.org"))) {}
        catch {
            vm.skip(true);
        }
    }

    function test_upgradePreservesLiveStateAndEnablesAutomation() public {
        // Guard rather than assume: if this ever runs against a chain where the
        // proxy does not exist, fail loudly instead of asserting on zeroes.
        assertGt(PROXY.code.length, 0, "no proxy at the expected address");

        // ---- snapshot the live state the upgrade must not disturb ----------
        uint256 roundIdBefore = distributor.roundId();
        uint256 lastRoundBefore = distributor.lastRoundTime();
        uint256 totalClaimableBefore = distributor.totalClaimable();
        uint256 periodBefore = distributor.period();
        uint256 winnerBpsBefore = distributor.percentForWinner();
        uint256 distributeBpsBefore = distributor.percentForDistribute();
        address posterBefore = distributor.poster();
        address ownerBefore = distributor.owner();
        uint256 subIdBefore = distributor.vrfSubscriptionId();
        bytes32 keyHashBefore = distributor.vrfKeyHash();
        uint32 vrfGasBefore = distributor.vrfGasLimit();
        uint16 vrfConfBefore = distributor.vrfConfirmations();
        bool vrfNativeBefore = distributor.vrfNativePayment();
        address coordinatorBefore = address(distributor.s_vrfCoordinator());
        uint256 balanceBefore = PROXY.balance;
        address oldImpl = _implOf();

        // ---- step 1: upgrade the implementation, empty initializer data ----
        ProxyAdmin admin = ProxyAdmin(_adminOf());
        Distributor impl = new Distributor();
        vm.prank(admin.owner());
        admin.upgradeAndCall(ITransparentUpgradeableProxy(PROXY), address(impl), "");

        assertEq(_implOf(), address(impl), "implementation not replaced");
        assertTrue(_implOf() != oldImpl, "implementation unchanged");

        // Before initializeAutomation the appended fields are still zero, which
        // is exactly why the upkeep cannot fire in the gap between the two txs.
        assertFalse(distributor.automationEnabled(), "automation must stay off until initialized");
        (uint8 gapAction,) = distributor.pendingAction();
        assertEq(gapAction, distributor.ACTION_NONE(), "no upkeep may be due mid-upgrade");

        // ---- step 2: fill in the appended state, as the owner EOA ----------
        vm.prank(ownerBefore);
        distributor.initializeAutomation();

        // ---- the pre-existing state survived --------------------------------
        assertEq(distributor.roundId(), roundIdBefore, "roundId moved");
        assertEq(distributor.lastRoundTime(), lastRoundBefore, "lastRoundTime moved");
        assertEq(distributor.totalClaimable(), totalClaimableBefore, "totalClaimable moved");
        assertEq(distributor.period(), periodBefore, "period moved");
        assertEq(distributor.percentForWinner(), winnerBpsBefore, "winner bps moved");
        assertEq(distributor.percentForDistribute(), distributeBpsBefore, "distribute bps moved");
        assertEq(distributor.poster(), posterBefore, "poster moved");
        assertEq(distributor.owner(), ownerBefore, "owner moved");
        assertEq(distributor.vrfSubscriptionId(), subIdBefore, "vrf subscription moved");
        assertEq(distributor.vrfKeyHash(), keyHashBefore, "vrf key hash moved");
        assertEq(distributor.vrfGasLimit(), vrfGasBefore, "vrf gas limit moved");
        assertEq(distributor.vrfConfirmations(), vrfConfBefore, "vrf confirmations moved");
        assertEq(distributor.vrfNativePayment(), vrfNativeBefore, "vrf native payment moved");
        assertEq(address(distributor.s_vrfCoordinator()), coordinatorBefore, "coordinator moved");
        assertEq(PROXY.balance, balanceBefore, "balance moved");

        // ---- and the automation state is now live ---------------------------
        assertTrue(distributor.automationEnabled(), "automation not enabled");
        assertEq(distributor.windowStart(), uint64(block.timestamp), "window did not open now");
        assertEq(distributor.scheduleAnchor(), 1785139200, "anchor not set");
        assertEq(distributor.distributeBatchSize(), 100, "batch size not set");
        assertEq(distributor.gasFloor(), 250000, "gas floor not set");
        assertEq(distributor.maxVrfRetries(), 3, "vrf retries not set");
        assertEq(distributor.automationForwarder(), address(0), "forwarder should start open");
    }

    function test_initializeAutomationCannotRunTwice() public {
        ProxyAdmin admin = ProxyAdmin(_adminOf());
        Distributor impl = new Distributor();
        vm.prank(admin.owner());
        admin.upgradeAndCall(ITransparentUpgradeableProxy(PROXY), address(impl), "");

        address owner = distributor.owner();
        vm.prank(owner);
        distributor.initializeAutomation();

        // reinitializer(2) is one-shot: a second call can never reset the window
        // or re-open the schedule out from under a live round.
        vm.prank(owner);
        vm.expectRevert();
        distributor.initializeAutomation();
    }

    function test_upkeepGoesLiveOnceThereIsAPot() public {
        ProxyAdmin admin = ProxyAdmin(_adminOf());
        Distributor impl = new Distributor();
        vm.prank(admin.owner());
        admin.upgradeAndCall(ITransparentUpgradeableProxy(PROXY), address(impl), "");
        vm.prank(distributor.owner());
        distributor.initializeAutomation();

        // The live proxy holds only dust today, so fund it the way Fyuz does and
        // confirm the keeper picks the round up on the next scheduled slot.
        vm.deal(PROXY, 10 ether);
        vm.warp(distributor.nextRoundAt() + 1);

        (bool needed, bytes memory performData) = distributor.checkUpkeep("");
        assertTrue(needed, "upkeep should be due");
        (uint8 action,) = abi.decode(performData, (uint8, uint256));
        assertEq(action, distributor.ACTION_START(), "first action should be START");

        distributor.performUpkeep("");
        assertEq(distributor.roundId(), 1, "round did not open");
    }
}
