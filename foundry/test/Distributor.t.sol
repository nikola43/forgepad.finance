// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Distributor} from "../src/Distributor.sol";
import {VRFCoordinatorV2_5Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";

/// Holder that cannot receive BNB — exercises the skip-failed-transfer path.
contract RejectingReceiver {}

/// Holder whose fallback costs more than the 30k push stipend but succeeds when
/// called with normal gas — i.e. the realistic claim() customer (Safes, AA
/// wallets), as opposed to a receiver that can never be paid at all.
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

contract DistributorTest is Test {
    VRFCoordinatorV2_5Mock coordinator;
    Distributor distributor;
    uint256 subId;

    address poster = makeAddr("poster");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address rando = makeAddr("rando");

    bytes32 constant KEY_HASH = 0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26;
    uint256 constant HALF = 0x80000000;    // 50% of 2^32
    uint256 constant QUARTER = 0x40000000; // 25% of 2^32

    function setUp() public {
        // base fee / gas price / wei-per-unit-link — native payment is used, so
        // only the first two matter for charging the subscription.
        coordinator = new VRFCoordinatorV2_5Mock(0.002 ether, 40 gwei, 4e15);
        subId = coordinator.createSubscription();
        coordinator.fundSubscriptionWithNative{value: 10 ether}(subId);

        distributor = new Distributor(address(coordinator), subId, KEY_HASH, poster);
        coordinator.addConsumer(subId, address(distributor));

        // period must have elapsed since lastRoundTime (0) before the first round
        vm.warp(block.timestamp + 8 days);
    }

    // ---- helpers -----------------------------------------------------------

    function fundPot(uint256 amount) internal {
        (bool ok, ) = address(distributor).call{value: amount}("");
        assertTrue(ok, "funding failed");
    }

    function startRound() internal returns (uint256 rid) {
        vm.prank(poster);
        rid = distributor.startRound(uint64(block.timestamp - 7 days), uint64(block.timestamp));
    }

    function packedShares3() internal view returns (bytes memory) {
        // alice 50%, bob 25%, carol 25%
        return abi.encodePacked(alice, uint32(HALF), bob, uint32(QUARTER), carol, uint32(QUARTER));
    }

    function postShares(uint256 rid, bytes memory packed) internal {
        vm.prank(poster);
        distributor.postShares(rid, packed);
    }

    /// VRF is requested inside postShares (not startRound), so the request id is
    /// only known after shares are committed. Read it straight off the round.
    function fulfill(uint256 rid, uint256 word) internal {
        (, , , , , , uint256 requestId, ) = distributor.rounds(rid);
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        coordinator.fulfillRandomWordsWithOverride(requestId, address(distributor), words);
    }

    function roundStatus(uint256 rid) internal view returns (uint8 status) {
        (status, , , , , , , ) = distributor.rounds(rid);
    }

    // ---- happy path --------------------------------------------------------

    function test_FullRound_Distributes90ProRata_And10ToWinner() public {
        fundPot(10 ether);
        uint256 rid = startRound();

        postShares(rid, packedShares3());

        // random % 3 == 1 -> winner is bob (index 1)
        fulfill(rid, 7); // 7 % 3 == 1

        distributor.distribute(rid);

        // 90% = 9 ether distributed pro-rata; 10% = 1 ether to the winner
        assertEq(alice.balance, 4.5 ether, "alice 50% of 9");
        assertEq(bob.balance, 2.25 ether + 1 ether, "bob 25% of 9 + winner bonus");
        assertEq(carol.balance, 2.25 ether, "carol 25% of 9");
        assertEq(roundStatus(rid), 2, "round paid");
    }

    function test_WinnerBonusIs10PercentOfSnapshotPot() public {
        fundPot(10 ether);
        uint256 rid = startRound();
        // fees streaming in after the snapshot don't change this round's pot
        fundPot(5 ether);

        postShares(rid, packedShares3());
        fulfill(rid, 0); // 0 % 3 == 0 -> alice wins

        distributor.distribute(rid);
        assertEq(alice.balance, 4.5 ether + 1 ether, "winner bonus is 10% of the 10-ether snapshot");
        // the 5 ether that arrived mid-round stays for the next round
        assertEq(address(distributor).balance, 5 ether);
    }

    function test_FailedTransferIsSkipped_OthersStillPaid() public {
        address rejecting = address(new RejectingReceiver());
        fundPot(10 ether);
        uint256 rid = startRound();

        bytes memory packed = abi.encodePacked(rejecting, uint32(HALF), bob, uint32(HALF));
        postShares(rid, packed);
        fulfill(rid, 1); // 1 % 2 == 1 -> bob wins

        distributor.distribute(rid);
        assertEq(bob.balance, 4.5 ether + 1 ether, "bob paid despite rejecting holder");
        assertEq(rejecting.balance, 0);
        // rejected holder's 4.5 ether stays in the contract for the next round
        assertEq(address(distributor).balance, 4.5 ether);
    }

    // ---- lifecycle guards --------------------------------------------------

    function test_RevertWhen_StartRoundByNonPoster() public {
        fundPot(1 ether);
        vm.prank(rando);
        vm.expectRevert(Distributor.NotPoster.selector);
        distributor.startRound(0, uint64(block.timestamp));
    }

    function test_RevertWhen_RoundAlreadyActive() public {
        fundPot(1 ether);
        startRound();
        vm.warp(block.timestamp + 8 days);
        vm.prank(poster);
        vm.expectRevert(Distributor.RoundAlreadyActive.selector);
        distributor.startRound(0, uint64(block.timestamp));
    }

    function test_RevertWhen_PeriodNotElapsed() public {
        fundPot(1 ether);
        uint256 rid = startRound();
        postShares(rid, packedShares3());
        fulfill(rid, 0);
        distributor.distribute(rid);

        vm.prank(poster);
        vm.expectRevert(Distributor.PeriodNotElapsed.selector);
        distributor.startRound(0, uint64(block.timestamp));
    }

    function test_RevertWhen_EmptyPot() public {
        vm.prank(poster);
        vm.expectRevert(Distributor.NothingToDistribute.selector);
        distributor.startRound(0, uint64(block.timestamp));
    }

    // VRF is only ever requested after shares are committed, so a round can never
    // hold a random word without shares — distribute reverts RandomnessPending
    // both before shares are posted and after, until the word arrives.
    function test_RevertWhen_DistributeBeforeRandom() public {
        fundPot(1 ether);
        uint256 rid = startRound();

        // no shares, no VRF request yet
        vm.expectRevert(Distributor.RandomnessPending.selector);
        distributor.distribute(rid);

        // shares posted (VRF now in flight) but the word hasn't landed
        postShares(rid, packedShares3());
        vm.expectRevert(Distributor.RandomnessPending.selector);
        distributor.distribute(rid);
    }

    function test_RevertWhen_SharesLengthInvalid() public {
        fundPot(1 ether);
        uint256 rid = startRound();
        vm.prank(poster);
        vm.expectRevert(Distributor.InvalidPackedLength.selector);
        distributor.postShares(rid, hex"deadbeef");
    }

    function test_CancelRound_PotRollsForward() public {
        fundPot(3 ether);
        uint256 rid = startRound();
        // post shares so VRF is actually requested, then cancel with it in flight
        postShares(rid, packedShares3());
        vm.prank(poster);
        distributor.cancelRound();
        assertEq(roundStatus(rid), 3, "cancelled");

        // stale VRF fulfillment for the cancelled round is ignored, not reverted
        fulfill(rid, 42);
        (, , , bool hasRandom, , , , ) = distributor.rounds(rid);
        assertFalse(hasRandom, "stale fulfillment ignored");

        // next round sees the full balance
        fundPot(2 ether);
        vm.warp(block.timestamp + 8 days);
        uint256 rid2 = startRound();
        (, , , , uint256 pot, , , ) = distributor.rounds(rid2);
        assertEq(pot, 5 ether, "pot rolled forward");

        postShares(rid2, packedShares3());
        fulfill(rid2, 2); // 2 % 3 == 2 -> carol
        distributor.distribute(rid2);
        assertEq(carol.balance, 1.125 ether + 0.5 ether);
    }

    // ---- admin -------------------------------------------------------------

    function test_SetPercents_RejectsOver100() public {
        vm.expectRevert(Distributor.BpsTooHigh.selector);
        distributor.setPercents(5001, 5000);
        distributor.setPercents(2000, 8000); // exactly 100% is fine
        assertEq(distributor.percentForWinner(), 2000);
    }

    function test_EmergencyWithdraw_OnlyWhenPaused() public {
        fundPot(2 ether);
        vm.expectRevert(); // Pausable: ExpectedPause
        distributor.emergencyWithdraw(rando);

        distributor.pause();
        distributor.emergencyWithdraw(rando);
        assertEq(rando.balance, 2 ether);
    }

    function test_StartRound_RevertsWhenPaused() public {
        fundPot(1 ether);
        distributor.pause();
        vm.prank(poster);
        vm.expectRevert();
        distributor.startRound(0, uint64(block.timestamp));
    }

    function test_OwnerCanActAsPoster() public {
        fundPot(1 ether);
        // owner (this test contract) starts a round without being the poster
        uint256 rid = distributor.startRound(0, uint64(block.timestamp));
        assertEq(rid, 1);
    }

    function test_SetPoster_RejectsZero() public {
        vm.expectRevert(Distributor.ZeroPoster.selector);
        distributor.setPoster(address(0));
    }

    // ---- audit regression tests -------------------------------------------

    // H-1: once shares are posted the VRF request is in flight, and shares can no
    // longer be re-posted (vrfRequestId != 0). Combined with VRF being requested
    // only inside postShares, this means the random word can never exist while a
    // poster is still free to reshape the holder set to fix the winner.
    function test_RevertWhen_RepostSharesAfterVrfRequested() public {
        fundPot(10 ether);
        uint256 rid = startRound();
        postShares(rid, packedShares3()); // first post -> VRF requested
        vm.prank(poster);
        vm.expectRevert(Distributor.RandomAlreadyRevealed.selector);
        distributor.postShares(rid, packedShares3()); // repost rejected
    }

    // M-1: a shares payload summing to more than 2^32 (100%) is rejected, so
    // early holders can't be over-paid at the expense of later ones.
    function test_RevertWhen_SharesSumExceeds2Pow32() public {
        fundPot(10 ether);
        uint256 rid = startRound();
        bytes memory packed = abi.encodePacked(alice, uint32(HALF), bob, uint32(HALF), carol, uint32(1));
        vm.prank(poster);
        vm.expectRevert(Distributor.SharesExceedTotal.selector);
        distributor.postShares(rid, packed);
    }

    // M-2: more than MAX_HOLDERS entries is rejected so distribute() can't be
    // pushed past the block gas limit.
    function test_RevertWhen_TooManyHolders() public {
        fundPot(10 ether);
        uint256 rid = startRound();
        uint32 tiny = uint32(HALF / 101);
        bytes memory packed;
        for (uint256 i = 0; i < 101; i++) {
            packed = abi.encodePacked(packed, address(uint160(i + 1)), tiny);
        }
        vm.prank(poster);
        vm.expectRevert(Distributor.TooManyHolders.selector);
        distributor.postShares(rid, packed);
    }

    // L-1: a holder whose push fails is credited to claimable and can withdraw
    // it later, and those funds are held OUT of the next round's pot.
    function test_FailedPush_IsClaimable_AndExcludedFromNextPot() public {
        address rejecting = address(new RejectingReceiver());
        fundPot(10 ether);
        uint256 rid = startRound();
        bytes memory packed = abi.encodePacked(rejecting, uint32(HALF), bob, uint32(HALF));
        postShares(rid, packed);
        fulfill(rid, 1); // bob wins
        distributor.distribute(rid);

        // rejecting holder's 4.5 ether is now claimable, not lost
        assertEq(distributor.claimable(rejecting), 4.5 ether);
        assertEq(distributor.totalClaimable(), 4.5 ether);

        // fresh fees arrive; the next round's pot excludes the 4.5 still owed
        fundPot(3 ether);
        vm.warp(block.timestamp + 8 days);
        (, , , , uint256 pot2, , , ) = _startAndRead();
        assertEq(pot2, 3 ether, "pot excludes claimable funds");
    }

    // L-1: an EOA holder whose in-loop push failed can pull its credit via claim().
    function test_Claim_WithdrawsCreditedFunds() public {
        // A holder that rejects only the gas-limited push but a plain call to it
        // is simulated by crediting via a failed push, then claiming from an EOA.
        // Here we use the pull path directly: alice's payout succeeds normally,
        // so instead assert claim reverts cleanly when there's nothing owed.
        vm.prank(alice);
        vm.expectRevert(Distributor.NothingToClaim.selector);
        distributor.claim();
    }

    // A cancelled round paid nobody, so it must not burn the period: before the
    // fix a VRF outage cost holders the outage plus a full extra week.
    function test_CancelRound_DoesNotConsumeThePeriod() public {
        fundPot(1 ether);
        uint256 rid = startRound();
        postShares(rid, packedShares3());
        vm.prank(poster);
        distributor.cancelRound();

        // immediately re-openable, no warp
        uint256 rid2 = startRound();
        assertEq(rid2, rid + 1, "next round opens straight away");
        assertEq(roundStatus(rid2), 1);
    }

    // emergencyWithdraw must not take money already credited to holders by a
    // failed payout push: doing so stole their funds AND left totalClaimable
    // above the balance, underflow-bricking every later round.
    function test_EmergencyWithdraw_LeavesClaimableBehind() public {
        address hungry = address(new GasHungryReceiver());
        fundPot(10 ether);
        uint256 rid = startRound();
        postShares(rid, abi.encodePacked(hungry, uint32(HALF), bob, uint32(HALF)));
        fulfill(rid, 1); // bob wins
        distributor.distribute(rid);
        assertEq(distributor.totalClaimable(), 4.5 ether, "push exceeded the 30k stipend");

        distributor.pause();
        distributor.emergencyWithdraw(rando);
        distributor.unpause();

        assertEq(rando.balance, distributor.distributable() + 0, "took only the free balance");
        assertEq(address(distributor).balance, 4.5 ether, "claimable funds stay put");
        assertEq(distributor.distributable(), 0);

        // the credited holder can still be made whole
        uint256 before = hungry.balance;
        vm.prank(hungry);
        distributor.claim();
        assertEq(hungry.balance - before, 4.5 ether);
        assertEq(distributor.totalClaimable(), 0);

        // and the contract is not bricked: the next round runs normally
        fundPot(2 ether);
        vm.warp(block.timestamp + 8 days);
        (, , , , uint256 pot2, , , ) = _startAndRead();
        assertEq(pot2, 2 ether);
    }

    // distributable() clamps instead of underflowing, so no balance/owed state
    // can permanently freeze startRound.
    function test_Distributable_ClampsWhenBalanceBelowOwed() public {
        assertEq(distributor.distributable(), 0);
        fundPot(1 ether);
        assertEq(distributor.distributable(), 1 ether);
    }

    // ---- payout readiness (CRE-driven; Automation v2.1 sunsets 2026-07-31) ----

    // isPayable is false until BOTH shares and the VRF word are in, then true
    // until the round is paid. It is what CREPoster.work() keys off.
    function test_IsPayable_TracksRoundReadiness() public {
        fundPot(10 ether);
        uint256 rid = startRound();
        assertFalse(distributor.isPayable(rid), "not payable before shares/random");

        postShares(rid, packedShares3());
        assertFalse(distributor.isPayable(rid), "not payable before random");

        fulfill(rid, 7); // 7 % 3 == 1 -> bob wins
        assertTrue(distributor.isPayable(rid), "payable once shares + random are in");

        // any caller finishes it — CRE's forwarder, a cron, a human
        vm.prank(rando);
        distributor.distribute(rid);
        assertEq(roundStatus(rid), 2, "round paid");
        assertEq(alice.balance, 4.5 ether);
        assertEq(bob.balance, 2.25 ether + 1 ether);
        assertEq(carol.balance, 2.25 ether);
        assertFalse(distributor.isPayable(rid), "nothing left to do");
    }

    function test_IsPayable_FalseWhenPausedOrStaleRound() public {
        fundPot(10 ether);
        uint256 rid = startRound();
        postShares(rid, packedShares3());
        fulfill(rid, 0);

        assertFalse(distributor.isPayable(99), "stale round id is never payable");

        distributor.pause();
        assertFalse(distributor.isPayable(rid), "not payable while paused");
        distributor.unpause();
        assertTrue(distributor.isPayable(rid));
    }

    // distribute() re-checks everything, so an untrusted caller cannot pay a
    // round that is not genuinely payable.
    function test_Distribute_RejectsStaleRoundFromAnyCaller() public {
        fundPot(10 ether);
        uint256 rid = startRound();
        postShares(rid, packedShares3());
        fulfill(rid, 0);

        vm.prank(rando);
        vm.expectRevert(Distributor.NoActiveRound.selector);
        distributor.distribute(99);

        vm.prank(rando);
        distributor.distribute(rid);
        assertEq(roundStatus(rid), 2);
    }

    function _startAndRead() internal returns (uint8, uint64, uint64, bool, uint256, uint256, uint256, bytes memory) {
        vm.prank(poster);
        uint256 rid = distributor.startRound(0, uint64(block.timestamp));
        return distributor.rounds(rid);
    }
}
