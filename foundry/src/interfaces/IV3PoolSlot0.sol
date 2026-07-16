// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

/**
 * @title IV3PoolSlot0
 * @notice slot0() for a Uniswap-V3-style pool, with `feeProtocol` widened to
 *         uint32 so it decodes on BOTH Uniswap V3 and PancakeSwap V3.
 *
 * @dev Why this exists. Uniswap V3 packs slot0.feeProtocol as `uint8`.
 *      PancakeSwap V3 forked the pool and widened it to `uint32` (it stores two
 *      packed 16-bit halves, e.g. 3400 | 3400<<16 = 222825800 on a live BSC
 *      pool). Solidity's ABI decoder validates narrow return types, so decoding
 *      a PancakeSwap slot0 through Uniswap's `uint8` signature reverts on any
 *      pool whose feeProtocol has been set — which the pool's own initialize()
 *      does. Reading through this wider signature decodes correctly on both:
 *      a Uniswap pool's uint8 value is zero-padded into the uint32 slot.
 *
 *      Only the fields before `feeProtocol` are safe to rely on cross-fork;
 *      we read `sqrtPriceX96` and ignore the rest.
 */
interface IV3PoolSlot0 {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint32 feeProtocol,
            bool unlocked
        );
}
