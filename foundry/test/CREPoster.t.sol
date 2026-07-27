// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Distributor} from "../src/Distributor.sol";
import {CREPoster} from "../src/CREPoster.sol";
import {VRFCoordinatorV2_5Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";

contract CREPosterTest is Test {
    VRFCoordinatorV2_5Mock coordinator;
    Distributor distributor;
    CREPoster poster;

    address forwarder = makeAddr("forwarder");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    bytes32 constant KEY_HASH = 0x8596b430971ac45bdf6088665b9ad8e8630c9d5049ab54b14dff711bee7c0e26;
    uint256 constant HALF = 0x80000000;

    function setUp() public {
        coordinator = new VRFCoordinatorV2_5Mock(0.002 ether, 40 gwei, 4e15);
        uint256 subId = coordinator.createSubscription();
        coordinator.fundSubscriptionWithNative{value: 10 ether}(subId);

        distributor = new Distributor(address(coordinator), subId, KEY_HASH, address(this));
        coordinator.addConsumer(subId, address(distributor));

        poster = new CREPoster(distributor, forwarder);
        distributor.setPoster(address(poster));

        vm.warp(block.timestamp + 8 days);
    }

    function report() internal view returns (bytes memory) {
        bytes memory packed = abi.encodePacked(alice, uint32(HALF), bob, uint32(HALF));
        return abi.encode(uint64(block.timestamp - 7 days), uint64(block.timestamp), packed);
    }

    function test_OnReport_StartsRoundAndPostsShares() public {
        (bool ok, ) = address(distributor).call{value: 1 ether}("");
        assertTrue(ok);
        assertTrue(poster.ready());

        vm.prank(forwarder);
        poster.onReport("", report());

        assertEq(distributor.roundId(), 1);
        (uint8 status, , , , uint256 pot, , uint256 vrfRequestId, bytes memory shares) = distributor.rounds(1);
        assertEq(status, 1, "round active");
        assertEq(pot, 1 ether);
        assertEq(shares.length, 48, "two holders posted");
        assertTrue(vrfRequestId != 0, "VRF requested by postShares");
        assertFalse(poster.ready(), "not ready while round in flight");
    }

    function test_OnReport_RejectsNonForwarder() public {
        vm.expectRevert(CREPoster.NotForwarder.selector);
        poster.onReport("", report());
    }

    function test_OnReport_NoopWhenNotDue() public {
        // pot is empty -> ready() false -> report ignored, no revert
        vm.prank(forwarder);
        poster.onReport("", report());
        assertEq(distributor.roundId(), 0);

        // funded but period not elapsed since a round just ran
        (bool ok, ) = address(distributor).call{value: 1 ether}("");
        assertTrue(ok);
        vm.prank(forwarder);
        poster.onReport("", report());
        assertEq(distributor.roundId(), 1);
        vm.prank(forwarder);
        poster.onReport("", report()); // active round -> ignored
        assertEq(distributor.roundId(), 1);
    }

    // CRE drives the whole round: one tick starts it, a later tick (after VRF
    // lands) pays it out. This replaces Chainlink Automation, which sunsets
    // 2026-07-31.
    function test_OnReport_SecondTickDistributes() public {
        (bool ok, ) = address(distributor).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(poster.work(), poster.WORK_START_ROUND());

        vm.prank(forwarder);
        poster.onReport("", report());
        assertEq(poster.work(), poster.WORK_NONE(), "waiting on VRF - nothing to do");

        // a tick while VRF is still pending must not pay for a report
        vm.prank(forwarder);
        poster.onReport("", report());
        assertEq(distributor.roundId(), 1, "no second round opened");

        (, , , , , , uint256 reqId, ) = distributor.rounds(1);
        coordinator.fulfillRandomWords(reqId, address(distributor));
        assertEq(poster.work(), poster.WORK_DISTRIBUTE(), "payout is now the job");

        // the payout tick ignores the report payload entirely
        uint256 aliceBefore = alice.balance;
        vm.prank(forwarder);
        poster.onReport("", abi.encode(uint64(0), uint64(0), bytes("")));

        (uint8 status, , , , , , , ) = distributor.rounds(1);
        assertEq(status, 2, "round paid by CRE");
        assertGt(alice.balance, aliceBefore, "holder got paid");
        assertEq(poster.work(), poster.WORK_NONE(), "period must elapse before the next round");
    }

    // A paused Distributor rejects startRound, so ready() must say "not due".
    // Otherwise the workflow pays for a report every tick and onReport reverts
    // invisibly behind the forwarder.
    function test_Ready_FalseWhileDistributorPaused() public {
        (bool ok, ) = address(distributor).call{value: 1 ether}("");
        assertTrue(ok);
        assertTrue(poster.ready());

        distributor.pause();
        assertFalse(poster.ready(), "paused distributor is never ready");

        distributor.unpause();
        assertTrue(poster.ready());
    }

    function test_OnReport_IgnoresEmptyShares() public {
        (bool ok, ) = address(distributor).call{value: 1 ether}("");
        assertTrue(ok);
        vm.prank(forwarder);
        poster.onReport("", abi.encode(uint64(0), uint64(block.timestamp), bytes("")));
        assertEq(distributor.roundId(), 0, "empty leaderboard starts no round");
    }
}
