// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TransparentUpgradeableProxy} from
    "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Distributor} from "../src/Distributor.sol";
import {VRFCoordinatorV2_5Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";

/// Holder that cannot receive BNB — exercises the credit-to-claimable path.
contract RejectingReceiver {}

/// Holder whose fallback costs more than the 30k push stipend but succeeds when
/// called with normal gas — the realistic claim() customer (Safes, AA wallets).
contract GasHungryReceiver {
    uint256 public sink;

    receive() external payable {
        uint256 x = sink;
        for (uint256 i = 0; i < 500; i++) {
            x = uint256(keccak256(abi.encode(x, i)));
        }
        sink = x;
    }
}

/// Worst-case holder for gas: burns the entire 30k push stipend and THEN fails,
/// so the round pays the stipend and the cold `claimable` writes on top.
contract StipendBurner {
    receive() external payable {
        uint256 x;
        while (gasleft() > 400) {
            x = uint256(keccak256(abi.encode(x)));
        }
        revert();
    }
}

/// Holder that re-enters distributeBatch from its payout hook. The stored cursor
/// is stale until the payout loop finishes, so an unguarded _distribute would read
/// it, pay this holder a SECOND time, and hand it a surplus drawn from the winner's
/// share and the next round's fees. Uses a low-level call so the guard's revert is
/// observed rather than propagated — the outer push must still report success.
contract ReentrantHolder {
    address public dist;
    uint256 public rid;
    bool public attempted;
    bool public reentrySucceeded;

    function arm(address _dist, uint256 _rid) external {
        dist = _dist;
        rid = _rid;
        attempted = false;
        reentrySucceeded = false;
    }

    receive() external payable {
        if (attempted || dist == address(0)) return;
        attempted = true;
        (bool ok,) = dist.call(abi.encodeWithSignature("distributeBatch(uint256,uint16)", rid, uint16(1)));
        reentrySucceeded = ok;
    }
}

contract DistributorTest is Test {
    VRFCoordinatorV2_5Mock coordinator;
    Distributor distributor;
    uint256 subId;

    address poster = makeAddr("poster");
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address rando = makeAddr("rando");

    bytes32 constant KEY_HASH = 0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26;
    uint256 constant UNIT = 0x100000000; // 2^32 == 100%
    uint256 constant HALF = 0x80000000;
    uint256 constant QUARTER = 0x40000000;

    uint8 constant A_NONE = 0;
    uint8 constant A_START = 1;
    uint8 constant A_DISTRIBUTE = 2;
    uint8 constant A_RETRY_VRF = 3;
    uint8 constant A_CANCEL = 4;

    function setUp() public {
        coordinator = new VRFCoordinatorV2_5Mock(0.002 ether, 40 gwei, 4e15);
        subId = coordinator.createSubscription();
        coordinator.fundSubscriptionWithNative{value: 100 ether}(subId);

        // Deployed behind a proxy exactly as in production: Distributor is
        // upgradeable, so a constructor-built one would not exercise the
        // initializer path the real contract takes.
        Distributor distImpl = new Distributor();
        distributor = Distributor(
            payable(
                address(
                    new TransparentUpgradeableProxy(
                        address(distImpl),
                        address(this),
                        abi.encodeCall(
                            Distributor.initialize, (address(coordinator), subId, KEY_HASH, poster, address(this))
                        )
                    )
                )
            )
        );
        coordinator.addConsumer(subId, address(distributor));

        // Run the whole suite on the real schedule: the first slot (Monday
        // 2026-07-27 08:00 UTC). lastRoundTime is 0, so this first round is due
        // immediately.
        vm.warp(MON_2026_07_27_0800);
    }

    // ---- helpers -----------------------------------------------------------

    function fundPot(uint256 amount) internal {
        (bool ok,) = address(distributor).call{value: amount}("");
        assertTrue(ok, "funding failed");
    }

    function packedShares3() internal view returns (bytes memory) {
        // alice 50%, bob 25%, carol 25%
        return abi.encodePacked(alice, uint32(HALF), bob, uint32(QUARTER), carol, uint32(QUARTER));
    }

    function postShares(uint256 rid, bytes memory packed) internal {
        vm.prank(poster);
        distributor.postShares(rid, packed);
    }

    function fulfill(uint256 rid, uint256 word) internal {
        (,,,,,,, uint256 requestId) = roundHeader(rid);
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        coordinator.fulfillRandomWordsWithOverride(requestId, address(distributor), words);
    }

    /// The generated `rounds` getter drops the trailing bytes, so this mirrors it
    /// in the order the struct declares.
    function roundHeader(uint256 rid)
        internal
        view
        returns (
            uint8 status,
            bool hasRandom,
            uint8 vrfRetries,
            uint16 cursor,
            uint16 holderCount,
            uint64 timeStart,
            uint64 timeEnd,
            uint256 vrfRequestId
        )
    {
        uint64 sharesAt;
        uint256 pot;
        uint256 random;
        bytes memory shares;
        (
            status,
            timeStart,
            timeEnd,
            hasRandom,
            pot,
            random,
            vrfRequestId,
            shares,
            vrfRetries,
            cursor,
            holderCount,
            sharesAt
        ) = distributor.rounds(rid);
    }

    function roundStatus(uint256 rid) internal view returns (uint8 status) {
        (status,,,,,,,) = roundHeader(rid);
    }

    function checkUpkeep() internal view returns (bool needed, uint8 action, uint256 rid) {
        bytes memory data;
        (needed, data) = distributor.checkUpkeep("");
        (action, rid) = abi.decode(data, (uint8, uint256));
    }

    /// Drive the whole round the way the deployment does: keeper opens it, the
    /// poster posts shares, VRF answers, keeper pays it out.
    function runRound(uint256 word) internal returns (uint256 rid) {
        performUpkeep(A_START);
        rid = distributor.roundId();
        postShares(rid, packedShares3());
        fulfill(rid, word);
        performUpkeep(A_DISTRIBUTE);
    }

    function performUpkeep(uint8 expectedAction) internal {
        (bool needed, uint8 action,) = checkUpkeep();
        assertTrue(needed, "no upkeep due");
        assertEq(action, expectedAction, "unexpected upkeep action");
        vm.prank(keeper);
        distributor.performUpkeep("");
    }

    // ---- automation state machine ------------------------------------------

    function test_checkUpkeep_idleWhenNoPot() public view {
        (bool needed, uint8 action,) = checkUpkeep();
        assertFalse(needed);
        assertEq(action, A_NONE);
    }

    function test_checkUpkeep_startsRoundWhenPotAndPeriodElapsed() public {
        fundPot(10 ether);
        (bool needed, uint8 action, uint256 rid) = checkUpkeep();
        assertTrue(needed);
        assertEq(action, A_START);
        assertEq(rid, 1);
    }

    function test_upkeep_startsRoundWithOnChainWindow() public {
        uint64 deployedAt = distributor.windowStart();
        fundPot(10 ether);
        performUpkeep(A_START);

        uint256 rid = distributor.roundId();
        assertEq(rid, 1);
        (uint8 status,,,,, uint64 timeStart, uint64 timeEnd,) = roundHeader(rid);
        assertEq(status, 1);
        assertEq(timeStart, deployedAt, "window must start where the last one ended");
        assertEq(timeEnd, uint64(block.timestamp));
    }

    function test_checkUpkeep_idleWhileWaitingOnPoster() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        // Shares are the poster's job; automation must not act before the timeout.
        (bool needed,,) = checkUpkeep();
        assertFalse(needed, "keeper should wait for the poster");
    }

    function test_checkUpkeep_idleWhileWaitingOnVRF() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        postShares(distributor.roundId(), packedShares3());
        (bool needed,,) = checkUpkeep();
        assertFalse(needed, "keeper should wait for VRF");
    }

    function test_upkeep_distributesOnceSharesAndRandomLand() public {
        fundPot(10 ether);
        uint256 rid = runRound(0);

        assertEq(roundStatus(rid), 2);
        // 90% pool: alice 50%, bob+carol 25% each. word 0 -> alice wins the 10%.
        assertEq(alice.balance, 4.5 ether + 1 ether);
        assertEq(bob.balance, 2.25 ether);
        assertEq(carol.balance, 2.25 ether);
    }

    function test_upkeep_revertsWhenNothingDue() public {
        vm.prank(keeper);
        vm.expectRevert(Distributor.UpkeepNotNeeded.selector);
        distributor.performUpkeep("");
    }

    function test_upkeep_ignoresAttackerSuppliedPerformData() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());
        // A keeper claiming "distribute round 1 now" while VRF is still pending
        // must not be able to force it — the contract re-derives the action.
        vm.prank(rando);
        vm.expectRevert(Distributor.UpkeepNotNeeded.selector);
        distributor.performUpkeep(abi.encode(A_DISTRIBUTE, rid));
    }

    function test_upkeep_onlyForwarderWhenConfigured() public {
        address forwarder = makeAddr("forwarder");
        distributor.setAutomationConfig(true, forwarder, 6 hours, 30 minutes, 3, 100, 250000);
        fundPot(10 ether);

        vm.prank(rando);
        vm.expectRevert(Distributor.NotForwarder.selector);
        distributor.performUpkeep("");

        vm.prank(forwarder);
        distributor.performUpkeep("");
        assertEq(distributor.roundId(), 1);
    }

    function test_checkUpkeep_silentWhenAutomationDisabled() public {
        distributor.setAutomationConfig(false, address(0), 6 hours, 30 minutes, 3, 100, 250000);
        fundPot(10 ether);
        (bool needed,,) = checkUpkeep();
        assertFalse(needed);
        // The permissionless path still works — automation is liveness, not safety.
        distributor.startRound();
        assertEq(distributor.roundId(), 1);
    }

    // ---- timeouts ----------------------------------------------------------

    function test_upkeep_cancelsWhenPosterNeverPosts() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();

        vm.warp(block.timestamp + 6 hours);
        performUpkeep(A_CANCEL);

        assertEq(roundStatus(rid), 3);
        // Cancelling must not consume the period, and the pot stays put.
        assertEq(distributor.lastRoundTime(), 0);
        assertEq(address(distributor).balance, 10 ether);
        // ...so the next round can open immediately over the SAME window.
        uint64 windowStart = distributor.windowStart();
        performUpkeep(A_START);
        (,,,,, uint64 timeStart,,) = roundHeader(distributor.roundId());
        assertEq(timeStart, windowStart, "cancelled window must not be skipped");
    }

    function test_upkeep_retriesStalledVRFThenCancels() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());
        (,,,,,,, uint256 firstRequest) = roundHeader(rid);

        uint256 clock = block.timestamp;
        for (uint8 attempt = 1; attempt <= 3; attempt++) {
            clock += 30 minutes;
            vm.warp(clock);
            performUpkeep(A_RETRY_VRF);
            (, , uint8 retries,,,,,) = roundHeader(rid);
            assertEq(retries, attempt);
        }
        (,,,,,,, uint256 lastRequest) = roundHeader(rid);
        assertTrue(lastRequest != firstRequest, "retry must issue a new request");

        // Out of retries -> stop paying for draws and roll the pot forward.
        vm.warp(clock + 30 minutes);
        performUpkeep(A_CANCEL);
        assertEq(roundStatus(rid), 3);
    }

    function test_lateFulfillmentOfSupersededRequestIsIgnored() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());
        (,,,,,,, uint256 firstRequest) = roundHeader(rid);

        vm.warp(block.timestamp + 30 minutes);
        performUpkeep(A_RETRY_VRF);
        fulfill(rid, 1); // the retry answers first
        (, bool hasRandom,,,,,,) = roundHeader(rid);
        assertTrue(hasRandom);

        // The original request landing afterwards must not overwrite the word.
        uint256[] memory words = new uint256[](1);
        words[0] = 999;
        coordinator.fulfillRandomWordsWithOverride(firstRequest, address(distributor), words);
        (,,,,, uint256 random,,,,,,) = distributor.rounds(rid);
        assertEq(random, 1, "first-in wins; late fulfillment must be ignored");
    }

    function test_retryVRFRevertsBeforeTimeout() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        postShares(distributor.roundId(), packedShares3());
        vm.prank(keeper);
        vm.expectRevert(Distributor.UpkeepNotNeeded.selector);
        distributor.performUpkeep("");
    }

    // ---- chunked distribution ----------------------------------------------

    function test_distributeIsChunkedAndResumes() public {
        // 100 holders at 1% each, batch size 25 -> four batches, then the winner.
        distributor.setAutomationConfig(true, address(0), 6 hours, 30 minutes, 3, 25, 250000);
        fundPot(100 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();

        bytes memory packed;
        address[] memory holders = new address[](100);
        for (uint256 i = 0; i < 100; i++) {
            holders[i] = address(uint160(0x1000 + i));
            packed = abi.encodePacked(packed, holders[i], uint32(UNIT / 100));
        }
        postShares(rid, packed);
        fulfill(rid, 7); // winner = holders[7]

        for (uint256 batch = 1; batch <= 4; batch++) {
            performUpkeep(A_DISTRIBUTE);
            (, , , uint16 cursor,,,,) = roundHeader(rid);
            assertEq(cursor, batch * 25, "cursor must advance one batch at a time");
        }
        assertEq(roundStatus(rid), 2, "round closes on the final batch");

        // 2^32 is not divisible by 100, so each 1% share floors to just under
        // 0.9 BNB; the shortfall stays as dust for the next round.
        uint256 each = (90 ether * (UNIT / 100)) / UNIT;
        assertTrue(each < 0.9 ether && each > 0.8999 ether, "share should floor just under 0.9");
        assertEq(holders[0].balance, each);
        assertEq(holders[99].balance, each);
        assertEq(holders[7].balance, each + 10 ether);
    }

    function test_distributeBatchAllowsManualSize() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());
        fulfill(rid, 0);

        distributor.distributeBatch(rid, 1);
        (,,, uint16 cursor,,,,) = roundHeader(rid);
        assertEq(cursor, 1);
        assertEq(alice.balance, 4.5 ether);
        assertEq(roundStatus(rid), 1, "still open mid-batch");

        distributor.distributeBatch(rid, 10); // overshoot clamps to the holder count
        assertEq(roundStatus(rid), 2);
        assertEq(carol.balance, 2.25 ether);
    }

    function test_distributeBatchRejectsZero() public {
        fundPot(10 ether);
        uint256 rid = runRound(0);
        vm.expectRevert(Distributor.ZeroBatchSize.selector);
        distributor.distributeBatch(rid, 0);
    }

    /// The normal case the deployment is tuned for: 100 ordinary EOA holders are
    /// paid in a SINGLE upkeep, inside the 5M gas limit the deploy script asks
    /// the registry for.
    function test_normalHolderSetPaysAllHundredInOneCall() public {
        fundPot(100 ether);
        distributor.startRound();
        uint256 rid = distributor.roundId();

        bytes memory packed;
        for (uint256 i = 0; i < 100; i++) {
            packed = abi.encodePacked(packed, address(uint160(0x1000 + i)), uint32(UNIT / 100));
        }
        postShares(rid, packed);
        fulfill(rid, 0);

        uint256 before = gasleft();
        vm.prank(keeper);
        distributor.performUpkeep("");
        uint256 used = before - gasleft();

        emit log_named_uint("100 EOA holders, one upkeep, gas", used);
        assertEq(roundStatus(rid), 2, "all 100 must be paid in one call");
        assertLt(used, 5_000_000, "must fit UPKEEP_GAS_LIMIT in the deploy script");
    }

    /// The case that would freeze a fixed-batch design: 100 holders that each
    /// burn the full stipend and fail (~65k each, ~6.6M total) cannot fit one
    /// call. The loop must bank its progress and resume instead of reverting and
    /// retrying identically forever.
    function test_gasStarvedPayoutResumesInsteadOfFreezing() public {
        fundPot(100 ether);
        distributor.startRound();
        uint256 rid = distributor.roundId();

        bytes memory packed;
        for (uint256 i = 0; i < 100; i++) {
            packed = abi.encodePacked(packed, address(new StipendBurner()), uint32(UNIT / 100));
        }
        postShares(rid, packed);
        fulfill(rid, 0);

        uint256 calls;
        uint16 lastCursor;
        while (roundStatus(rid) == 1) {
            calls++;
            assertLt(calls, 10, "must converge, not spin");
            // A realistic upkeep gas grant — deliberately too small for all 100.
            (bool ok,) = address(distributor).call{gas: 3_000_000}(
                abi.encodeWithSelector(Distributor.distribute.selector, rid)
            );
            assertTrue(ok, "a gas-starved batch must commit progress, not revert");
            (,,, uint16 cursor,,,,) = roundHeader(rid);
            assertGt(cursor, lastCursor, "every call must make forward progress");
            lastCursor = cursor;
        }

        emit log_named_uint("worst-case holders, calls needed", calls);
        assertGt(calls, 1, "this set should NOT have fit in one call");
        assertEq(roundStatus(rid), 2);
        // Everything that could not be pushed is still owed, not lost. Shares
        // floor (2^32 is not divisible by 100), so the dust stays in the pot.
        uint256 each = (90 ether * (UNIT / 100)) / UNIT;
        assertEq(distributor.totalClaimable(), each * 100 + 10 ether);
    }

    function test_setAutomationConfigRejectsLowGasFloor() public {
        vm.expectRevert(Distributor.GasFloorTooLow.selector);
        distributor.setAutomationConfig(true, address(0), 6 hours, 30 minutes, 3, 100, 50000);
    }

    // ---- schedule (Monday 08:00 UTC) ---------------------------------------

    uint256 constant MON_2026_07_27_0800 = 1785139200; // the deployed anchor
    uint256 constant WEEK = 7 days;

    function test_scheduleAnchorIsAMondayAt0800Utc() public view {
        // Unix epoch was a Thursday; day 0 = Thursday, so Monday is day % 7 == 4.
        uint256 anchor = distributor.scheduleAnchor();
        assertEq(anchor, MON_2026_07_27_0800);
        assertEq(anchor % 1 days, 8 hours, "must land at 08:00:00 UTC");
        assertEq((anchor / 1 days) % 7, 4, "must land on a Monday");
    }

    function test_roundsOpenOnlyOnScheduledSlots() public {
        // Consume this week's slot.
        fundPot(10 ether);
        uint256 rid = distributor.roundId() + 1;
        distributor.startRound();
        postShares(rid, packedShares3());
        fulfill(rid, 0);
        distributor.distribute(rid);
        assertEq(distributor.nextRoundAt(), MON_2026_07_27_0800 + WEEK);

        // One second before next Monday 08:00: still closed, pot or no pot.
        fundPot(10 ether);
        vm.warp(MON_2026_07_27_0800 + WEEK - 1);
        vm.expectRevert(Distributor.PeriodNotElapsed.selector);
        distributor.startRound();
        (bool needed,,) = checkUpkeep();
        assertFalse(needed, "keeper must not fire early either");

        // Exactly on the slot: open.
        vm.warp(MON_2026_07_27_0800 + WEEK);
        distributor.startRound();
        assertEq(distributor.roundId(), rid + 1);
    }

    function test_lateRoundDoesNotDragTheScheduleForward() public {
        fundPot(10 ether);
        // The keeper fires 4 hours late (congestion, an unfunded upkeep, ...).
        vm.warp(MON_2026_07_27_0800 + 4 hours);
        uint256 rid = distributor.roundId() + 1;
        distributor.startRound();
        postShares(rid, packedShares3());
        fulfill(rid, 0);
        distributor.distribute(rid);

        // The next round is still due Monday 08:00, NOT Monday 12:00. A
        // lastRoundTime + period gate would have drifted 4 hours every week.
        assertEq(distributor.nextRoundAt(), MON_2026_07_27_0800 + WEEK);
        assertEq(distributor.nextRoundAt() % 1 days, 8 hours);
        assertEq((distributor.nextRoundAt() / 1 days) % 7, 4, "still a Monday");
    }

    function test_scheduleHoldsOverManyWeeks() public {
        uint256 due = MON_2026_07_27_0800;
        for (uint256 week = 0; week < 10; week++) {
            assertEq(distributor.nextRoundAt(), due);
            assertEq((due / 1 days) % 7, 4, "every slot is a Monday");
            assertEq(due % 1 days, 8 hours, "every slot is 08:00 UTC");

            fundPot(1 ether);
            vm.warp(due + 37 minutes); // keeper is always a little late
            uint256 rid = distributor.roundId() + 1;
            distributor.startRound();
            postShares(rid, packedShares3());
            fulfill(rid, 0);
            distributor.distribute(rid);
            due += WEEK;
        }
    }

    function test_missedWeeksCatchUpOnceNotOncePerWeek() public {
        fundPot(10 ether);
        vm.warp(MON_2026_07_27_0800);
        distributor.startRound();
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());
        fulfill(rid, 0);
        distributor.distribute(rid);

        // Nobody traded for a month, then fees arrive again.
        vm.warp(MON_2026_07_27_0800 + 4 * WEEK + 3 days);
        fundPot(10 ether);
        (bool needed, uint8 action,) = checkUpkeep();
        assertTrue(needed);
        assertEq(action, A_START, "the overdue round opens immediately");

        distributor.startRound();
        // ...and the schedule snaps back to the next Monday, not four of them.
        assertEq(distributor.nextRoundAt(), MON_2026_07_27_0800 + 5 * WEEK);
    }

    function test_setScheduleRejectsZeroPeriod() public {
        vm.expectRevert(Distributor.ZeroPeriod.selector);
        distributor.setSchedule(uint64(MON_2026_07_27_0800), 0);
    }

    // ---- no eligible users -> no distribution -------------------------------

    function test_noPotMeansNoRound() public {
        // An empty pot must not open a round that would just be cancelled later.
        (bool needed,,) = checkUpkeep();
        assertFalse(needed);
        vm.expectRevert(Distributor.NothingToDistribute.selector);
        distributor.startRound();
    }

    function test_distributeRefusesWhenNoUsersWerePosted() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        // No shares posted means no VRF request was ever made, so the round can
        // never even reach the randomness stage.
        (, bool hasRandom,,,,,,) = roundHeader(rid);
        assertFalse(hasRandom);

        // No holder list -> nothing may be paid out, by any caller.
        vm.expectRevert(Distributor.RandomnessPending.selector);
        distributor.distribute(rid);
        vm.prank(poster);
        vm.expectRevert(Distributor.RandomnessPending.selector);
        distributor.distributeBatch(rid, 10);
    }

    function test_emptyHolderListIsRejectedOutright() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        vm.prank(poster);
        vm.expectRevert(Distributor.InvalidPackedLength.selector);
        distributor.postShares(rid, "");
    }

    function test_potRollsForwardWhenNobodyQualifies() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();

        // The runner found no eligible users and cancelled instead of posting.
        vm.prank(poster);
        distributor.cancelRound();
        assertEq(roundStatus(rid), 3);
        assertEq(address(distributor).balance, 10 ether, "pot untouched");

        // Next round picks up the SAME window plus the untouched pot.
        uint64 windowStart = distributor.windowStart();
        fundPot(5 ether);
        performUpkeep(A_START);
        (,,,,, uint64 timeStart,,) = roundHeader(distributor.roundId());
        assertEq(timeStart, windowStart, "the skipped window is not lost");
        (,,,, uint256 pot,,,,,,,) = distributor.rounds(distributor.roundId());
        assertEq(pot, 15 ether, "the unpaid pot rolls into the next round");
    }

    // ---- manual (admin) operation ------------------------------------------

    function test_posterCanRunTheWholeRoundWithoutAutomation() public {
        // Automation off entirely: the poster/admin wallet must still be able to
        // post shares and push the payout by hand.
        distributor.setAutomationConfig(false, address(0), 6 hours, 30 minutes, 3, 100, 250000);
        fundPot(10 ether);

        vm.prank(poster);
        distributor.startRound();
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());
        fulfill(rid, 0);
        vm.prank(poster);
        distributor.distribute(rid);

        assertEq(roundStatus(rid), 2);
        assertEq(alice.balance, 4.5 ether + 1 ether);
    }

    function test_forceStartRoundBypassesTheSchedule() public {
        // Consume this week's slot, so a scheduled round is a week away.
        fundPot(10 ether);
        uint256 rid = distributor.roundId() + 1;
        distributor.startRound();
        postShares(rid, packedShares3());
        fulfill(rid, 0);
        distributor.distribute(rid);

        vm.warp(MON_2026_07_27_0800 + 2 days); // a Wednesday
        fundPot(4 ether);
        vm.expectRevert(Distributor.PeriodNotElapsed.selector);
        distributor.startRound();

        // The admin wallet can still force a payout out of band.
        vm.prank(poster);
        uint256 forced = distributor.forceStartRound();
        assertEq(roundStatus(forced), 1);

        postShares(forced, packedShares3());
        fulfill(forced, 0);
        vm.prank(poster);
        distributor.distribute(forced);
        assertEq(roundStatus(forced), 2);

        // Forcing does NOT move the schedule: the next round is still the very
        // next Monday 08:00 slot (5 days out here), not a week after the forced
        // one. The rhythm is fixed to the calendar; a manual round is an extra
        // payout inserted between slots, not a reset of them.
        assertEq(distributor.nextRoundAt(), MON_2026_07_27_0800 + WEEK);
        assertEq((distributor.nextRoundAt() / 1 days) % 7, 4, "still a Monday");
    }

    function test_forceStartRoundIsAdminOnly() public {
        fundPot(10 ether);
        vm.prank(rando);
        vm.expectRevert(Distributor.NotPoster.selector);
        distributor.forceStartRound();
    }

    function test_forceStartRoundStillRequiresAPot() public {
        vm.prank(poster);
        vm.expectRevert(Distributor.NothingToDistribute.selector);
        distributor.forceStartRound();
    }

    // ---- window bookkeeping ------------------------------------------------

    function test_windowAdvancesOnlyOnPaidRounds() public {
        fundPot(10 ether);
        uint256 rid1 = runRound(0);
        (,,,,,, uint64 end1,) = roundHeader(rid1);
        assertEq(distributor.windowStart(), end1, "paid round advances the window");

        vm.warp(block.timestamp + 8 days);
        fundPot(10 ether);
        performUpkeep(A_START);
        (,,,,, uint64 start2,,) = roundHeader(distributor.roundId());
        assertEq(start2, end1, "next window starts where the last one ended");
    }

    function test_setWindowStartBlockedDuringActiveRound() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        vm.expectRevert(Distributor.RoundAlreadyActive.selector);
        distributor.setWindowStart(uint64(block.timestamp));
    }

    // ---- shares validation -------------------------------------------------

    function test_postSharesRejectsNonPoster() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        vm.prank(rando);
        vm.expectRevert(Distributor.NotPoster.selector);
        distributor.postShares(rid, packedShares3());
    }

    function test_postSharesRejectsRepost() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());
        // Reshaping the holder set after randomness is in flight is the attack
        // the commit-before-reveal ordering exists to prevent.
        vm.prank(poster);
        vm.expectRevert(Distributor.SharesAlreadyPosted.selector);
        distributor.postShares(rid, packedShares3());
    }

    function test_postSharesRejectsOversizedSet() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        bytes memory packed;
        for (uint256 i = 0; i < 101; i++) {
            packed = abi.encodePacked(packed, address(uint160(0x1000 + i)), uint32(1));
        }
        uint256 rid = distributor.roundId();
        vm.prank(poster);
        vm.expectRevert(Distributor.TooManyHolders.selector);
        distributor.postShares(rid, packed);
    }

    function test_postSharesRejectsOverAllocation() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        bytes memory packed = abi.encodePacked(alice, uint32(HALF), bob, uint32(HALF), carol, uint32(1));
        uint256 rid = distributor.roundId();
        vm.prank(poster);
        vm.expectRevert(Distributor.SharesExceedTotal.selector);
        distributor.postShares(rid, packed);
    }

    function test_postSharesRejectsRaggedPayload() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        vm.prank(poster);
        vm.expectRevert(Distributor.InvalidPackedLength.selector);
        distributor.postShares(rid, hex"deadbeef");
    }

    function test_holderAtMatchesPostedSet() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());

        (address h0, uint32 s0) = distributor.holderAt(rid, 0);
        (address h2, uint32 s2) = distributor.holderAt(rid, 2);
        assertEq(h0, alice);
        assertEq(s0, uint32(HALF));
        assertEq(h2, carol);
        assertEq(s2, uint32(QUARTER));
    }

    // ---- lottery -----------------------------------------------------------

    function test_winnerIsUniformOverParticipants() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());
        fulfill(rid, 4); // 4 % 3 == 1 -> bob, despite holding only 25%
        performUpkeep(A_DISTRIBUTE);
        assertEq(bob.balance, 2.25 ether + 1 ether, "small holder can win the lottery");
    }

    // ---- payout robustness -------------------------------------------------

    function test_failedPushIsCreditedNotLost() public {
        RejectingReceiver bad = new RejectingReceiver();
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, abi.encodePacked(address(bad), uint32(HALF), bob, uint32(HALF)));
        fulfill(rid, 1); // winner = bob
        performUpkeep(A_DISTRIBUTE);

        assertEq(distributor.claimable(address(bad)), 4.5 ether);
        assertEq(distributor.totalClaimable(), 4.5 ether);
        assertEq(bob.balance, 4.5 ether + 1 ether);
    }

    function test_claimPaysGasHungryWallet() public {
        GasHungryReceiver safe = new GasHungryReceiver();
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, abi.encodePacked(address(safe), uint32(HALF), bob, uint32(HALF)));
        fulfill(rid, 1);
        performUpkeep(A_DISTRIBUTE);

        assertEq(distributor.claimable(address(safe)), 4.5 ether);
        vm.prank(address(safe));
        distributor.claim();
        assertEq(address(safe).balance, 4.5 ether);
        assertEq(distributor.totalClaimable(), 0);
    }

    function test_claimableIsExcludedFromTheNextPot() public {
        RejectingReceiver bad = new RejectingReceiver();
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, abi.encodePacked(address(bad), uint32(HALF), bob, uint32(HALF)));
        fulfill(rid, 1);
        performUpkeep(A_DISTRIBUTE);

        // The whole pot is spent; the 4.5 owed to `bad` is all that is left, and
        // it is NOT distributable.
        assertEq(address(distributor).balance, 4.5 ether);
        assertEq(distributor.distributable(), 0);

        // Fresh fees arrive — the next pot must be those fees alone.
        fundPot(5 ether);
        vm.warp(block.timestamp + 8 days);
        performUpkeep(A_START);
        (,,,, uint256 pot,,,,,,,) = distributor.rounds(distributor.roundId());
        assertEq(pot, 5 ether, "owed funds must never be re-distributed");
        assertEq(address(distributor).balance, 9.5 ether);
    }

    // ---- pause / emergency -------------------------------------------------

    function test_pauseSilencesUpkeep() public {
        fundPot(10 ether);
        distributor.pause();
        (bool needed,,) = checkUpkeep();
        assertFalse(needed);
        vm.prank(keeper);
        vm.expectRevert();
        distributor.performUpkeep("");
    }

    function test_emergencyWithdrawCancelsActiveRound() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());
        fulfill(rid, 0);
        distributor.distributeBatch(rid, 1); // half-paid round

        distributor.pause();
        distributor.emergencyWithdraw(rando);

        // Leaving the round active would strand a cursor pointing at a pot that
        // no longer exists and inflate totalClaimable past the real balance.
        assertEq(roundStatus(rid), 3);
        assertEq(rando.balance, 5.5 ether); // 10 - alice's 4.5
        assertEq(distributor.distributable(), 0);
    }

    function test_emergencyWithdrawLeavesClaimableBehind() public {
        RejectingReceiver bad = new RejectingReceiver();
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, abi.encodePacked(address(bad), uint32(HALF), bob, uint32(HALF)));
        fulfill(rid, 1);
        performUpkeep(A_DISTRIBUTE);

        distributor.pause();
        distributor.emergencyWithdraw(rando);
        assertEq(address(distributor).balance, 4.5 ether, "owed funds stay for claim()");

        vm.prank(address(bad));
        vm.expectRevert(Distributor.ClaimTransferFailed.selector);
        distributor.claim();
    }

    // ---- config ------------------------------------------------------------

    function test_setPercentsRejectsOver100() public {
        vm.expectRevert(Distributor.BpsTooHigh.selector);
        distributor.setPercents(5000, 5001);
    }

    function test_setAutomationConfigRejectsZeroBatch() public {
        vm.expectRevert(Distributor.ZeroBatchSize.selector);
        distributor.setAutomationConfig(true, address(0), 6 hours, 30 minutes, 3, 0, 250000);
    }

    function test_onlyOwnerCanConfigure() public {
        vm.prank(rando);
        vm.expectRevert();
        distributor.setAutomationConfig(false, address(0), 1, 1, 1, 1, 250000);
    }

    function test_startRoundRespectsPeriod() public {
        fundPot(10 ether);
        runRound(0);
        fundPot(10 ether);
        vm.expectRevert(Distributor.PeriodNotElapsed.selector);
        distributor.startRound();
    }

    function test_startRoundRejectsEmptyPot() public {
        vm.expectRevert(Distributor.NothingToDistribute.selector);
        distributor.startRound();
    }

    // ---- reentrancy regressions -------------------------------------------

    /// A holder re-entering distributeBatch from its payout hook must not be paid
    /// twice off the stale cursor, and the round must still pay out exactly the pot.
    function test_reentrantDistributeCannotDoublePay() public {
        ReentrantHolder attacker = new ReentrantHolder();

        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();

        // Attacker is holder 0 with 50%; two EOAs take the rest.
        bytes memory packed =
            abi.encodePacked(address(attacker), uint32(HALF), bob, uint32(QUARTER), carol, uint32(QUARTER));
        postShares(rid, packed);
        fulfill(rid, 1); // random % 3 == 1 -> bob wins, keeps the assertions simple
        attacker.arm(address(distributor), rid);

        uint256 balanceBefore = address(distributor).balance;
        distributor.distribute(rid);

        assertTrue(attacker.attempted(), "attacker hook never ran");
        assertFalse(attacker.reentrySucceeded(), "reentrancy was NOT blocked");

        // Paid exactly its 50% of the 90% distribute leg, once.
        assertEq(address(attacker).balance, 4.5 ether, "attacker double-paid");
        assertEq(roundStatus(rid), 2, "round should have closed");

        // No surplus left the contract: 90% distributed + 10% to the winner.
        assertEq(balanceBefore - address(distributor).balance, 10 ether, "paid out more than the pot");
        assertEq(distributor.totalClaimable(), 0, "nothing should have failed into claimable");
    }

    /// The guard must not break the legitimate resumable path: a holder that simply
    /// receives ETH (no reentry) is still paid across successive batches.
    function test_guardDoesNotBlockSequentialBatches() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());
        fulfill(rid, 0);

        distributor.distributeBatch(rid, 1);
        distributor.distributeBatch(rid, 1);
        distributor.distributeBatch(rid, 1);

        assertEq(roundStatus(rid), 2, "three batches should close a 3-holder round");
        // random 0 -> 0 % 3 == 0, so holder 0 (alice) also takes the 10% winner leg.
        assertEq(alice.balance, 4.5 ether + 1 ether, "alice: 50% share + winner draw");
        assertEq(bob.balance, 2.25 ether);
        assertEq(carol.balance, 2.25 ether);
    }

    // ---- partial-cancel window regression ---------------------------------

    /// Cancelling a round that already paid someone must advance the window, or the
    /// paid holders get scored again and paid a second time from the next pot.
    function test_cancelAfterPartialPayoutAdvancesWindow() public {
        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());
        fulfill(rid, 0);

        distributor.distributeBatch(rid, 1); // alice paid, cursor = 1
        (,,, uint16 cursor,, , uint64 timeEnd,) = roundHeader(rid);
        assertEq(cursor, 1, "expected a half-paid round");

        vm.prank(poster);
        distributor.cancelRound();

        assertEq(roundStatus(rid), 3);
        assertEq(distributor.windowStart(), timeEnd, "partial payout must advance the window");
    }

    /// The unpaid case keeps the original roll-forward behaviour: nobody was paid,
    /// so the whole window folds into the next round.
    function test_cancelBeforeAnyPayoutKeepsWindow() public {
        uint64 windowBefore = distributor.windowStart();

        fundPot(10 ether);
        performUpkeep(A_START);
        uint256 rid = distributor.roundId();
        postShares(rid, packedShares3());

        vm.prank(poster);
        distributor.cancelRound();

        assertEq(roundStatus(rid), 3);
        assertEq(distributor.windowStart(), windowBefore, "untouched round must roll its window forward");
    }
}
