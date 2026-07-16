// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IV3PoolSlot0} from "../src/interfaces/IV3PoolSlot0.sol";
import {FakeToken} from "../src/FakeToken.sol";

/**
 * PancakeSwap V3 slot0 ABI compatibility, against a BSC mainnet fork.
 *
 * Regression cover for a real bug: FyuzLiquidityManager._createOrGetPoolV3 read
 * slot0() through Uniswap's IUniswapV3Pool, whose feeProtocol is uint8.
 * PancakeSwap widened that field to uint32, so the narrow decode reverts on any
 * initialized Pancake pool. The revert was swallowed by Fyuz's catch, which
 * silently rewrote the token to poolType 1 and seeded it on V2 — letting anyone
 * grief a V3 launch onto V2 (and out of its claimable LP fee position) with one
 * cheap createPool+initialize.
 *
 * Run: anvil --fork-url https://bsc-dataseed.bnbchain.org --chain-id 56
 *      forge test --match-path test/PancakeV3Slot0.t.sol
 */
contract PancakeV3Slot0Test is Test {
    address constant PANCAKE_V3_FACTORY =
        0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865;
    address constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    // Live, initialized PancakeSwap V3 WBNB/USDT 0.05% pool.
    address constant LIVE_POOL = 0x36696169C63e42cd08ce11f5deeBbCeBae652050;

    uint24 constant POOL_FEE = 100; // what FyuzLiquidityManager hardcodes

    function setUp() public {
        // Fork BSC at head by default. Point BSC_FORK_URL at a local anvil fork
        // to run offline — but note a long-lived anvil fork pins a block whose
        // state public nodes prune, which surfaces as "missing trie node".
        vm.createSelectFork(
            vm.envOr("BSC_FORK_URL", string("https://bsc-dataseed.bnbchain.org"))
        );
    }

    /// The wide signature must decode a live Pancake pool, and prove the field
    /// really does overflow uint8 (otherwise this test is vacuous).
    function test_wideSlot0_decodesLivePancakePool() public view {
        (uint160 sqrtPriceX96, , , , , uint32 feeProtocol, ) = IV3PoolSlot0(
            LIVE_POOL
        ).slot0();

        assertGt(sqrtPriceX96, 0, "live pool should have a price");
        assertGt(
            feeProtocol,
            type(uint8).max,
            "vacuous: feeProtocol fits in uint8, the bug would not reproduce"
        );
    }

    /// The old Uniswap-shaped read must fail on that same pool. This is the
    /// bug, pinned: if this ever stops reverting the narrow ABI became safe.
    function test_narrowSlot0_revertsOnLivePancakePool() public {
        vm.expectRevert();
        this.readNarrow(LIVE_POOL);
    }

    /// The griefer path end-to-end: a third party creates AND initializes the
    /// pool first. The wide read must survive and return their price so the
    /// caller can enforce its tolerance check — previously it reverted here.
    function test_wideSlot0_survivesGrieferInitializedPool() public {
        FakeToken token = new FakeToken(
            "Fyuz Test",
            "FYUZT",
            18,
            1_000_000,
            address(this)
        );

        address pool = IUniswapV3Factory(PANCAKE_V3_FACTORY).createPool(
            address(token),
            WBNB,
            POOL_FEE
        );
        assertTrue(pool != address(0), "pool not created");

        // Fresh pool: uninitialized, price reads zero through the wide ABI.
        (uint160 before, , , , , , ) = IV3PoolSlot0(pool).slot0();
        assertEq(before, 0, "fresh pool should be uninitialized");

        // Griefer initializes at an arbitrary price.
        uint160 grieferPrice = 79228162514264337593543950336; // 1:1
        IUniswapV3Pool(pool).initialize(grieferPrice);

        // The wide read still works and surfaces their price to the caller.
        (uint160 afterInit, , , , , , ) = IV3PoolSlot0(pool).slot0();
        assertEq(afterInit, grieferPrice, "wide slot0 must read griefer price");

        // ...while the old narrow read is exactly what used to break here.
        vm.expectRevert();
        this.readNarrow(pool);
    }

    function readNarrow(address pool) external view returns (uint160) {
        (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(pool).slot0();
        return sqrtPriceX96;
    }
}
