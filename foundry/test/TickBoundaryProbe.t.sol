// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {FyuzLiquidityManager} from "../src/FyuzLiquidityManager.sol";
import {FyuzDeploy} from "../src/FyuzDeploy.sol";
import {Token} from "../src/Token.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TickMath} from "../src/v4-core/libraries/TickMath.sol";
import {
    IUniswapV2Router02
} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

/// Regression guard for the single-sided V4 launch tick boundary.
///
/// Pools pair against WETH, so a token sorts either side of it and BOTH currency
/// orderings are reachable. When the token is currency0 the position must sit STRICTLY
/// above spot, and the mint hard-caps the currency1 (WETH) side at zero. Aligning
/// startTick alone fails when startTick is already a multiple of TICK_SPACING (~1 in
/// 60 launches): tickLower lands on spot, the position straddles the price, the mint
/// needs WETH it cannot pay, and the launch reverts with MaximumAmountExceeded.
/// Deleting the `+ 1` in the source makes this test revert.
contract TickBoundaryProbe is Test {
    FyuzLiquidityManager internal liquidityManager;

    int24 internal constant TICK_SPACING = 60;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;
    uint256 internal constant Q96 = 2 ** 96;

    address internal constant PERMIT2_ADDR =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal weth;

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("FORK_URL", string("https://ethereum-rpc.publicnode.com"))
        );

        vm.deal(address(this), 10_000 ether);

        liquidityManager = FyuzDeploy.deployLiquidityManager(
            vm.envOr("V2_ROUTER", 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D),
            vm.envOr("V3_FACTORY", 0x1F98431c8aD98523631AE4a59f267346ea31F984),
            vm.envOr("V3_POS_MGR", 0xC36442b4a4522E871399CD717aBDD847Ab11FE88),
            vm.envOr("V4_POOL_MGR", 0x000000000004444c5dc75cB358380D2e3dE08A90),
            vm.envOr("UNIVERSAL_ROUTER", 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af),
            vm.envOr("V4_POS_MGR", 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e),
            PERMIT2_ADDR,
            address(this),
            address(this),
            10000,
            10000,
            address(this)
        );
        liquidityManager.setAuthorizedCaller(address(this), true);
        weth = IUniswapV2Router02(
            vm.envOr("V2_ROUTER", 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D)
        ).WETH();
    }

    // Mirrors the manager's internal calculateSqrtPriceX96 — used only to SEARCH for
    // an input that lands on an aligned tick. The assertion drives the real contract.
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function _sqrtPriceX96(uint256 amount0, uint256 amount1)
        internal
        pure
        returns (uint160)
    {
        uint256 price = (amount1 * 1e18) / amount0;
        return uint160((_sqrt(price * 1e18) * Q96) / 1e18);
    }

    /// Deploy tokens until we get one that sorts as currency0 (token < weth).
    function _deployCurrency0Token() internal returns (Token t) {
        for (uint256 i = 0; i < 200; i++) {
            t = new Token(
                string.concat("T", vm.toString(i)),
                string.concat("T", vm.toString(i)),
                TOTAL_SUPPLY
            );
            if (address(t) < weth) return t;
        }
        revert("no currency0 token found");
    }

    /// Find an ethAmountForPrice whose resulting startTick is exactly aligned.
    function _findAlignedEthAmount() internal pure returns (uint256) {
        for (uint256 eth = 1 ether; eth < 400 ether; eth += 1e12) {
            uint160 sp = _sqrtPriceX96(TOTAL_SUPPLY, eth);
            if (sp == 0) continue;
            int24 tick = TickMath.getTickAtSqrtPrice(sp);
            if (tick % TICK_SPACING == 0) return eth;
        }
        revert("no aligned tick found");
    }

    /// SKIPPED: gated off with the V4 / direct-launch paths, not deleted.
    ///
    /// createToken now accepts only poolType 1 (V2) and 2 (V3), createTokenDirect is
    /// gone from the ABI, and the BSC deploy wires the V4 slots to the non-contract
    /// sentinel 0x...dEaD — so addLiquidityV4SingleSided reverts at the first
    /// PoolManager extsload, long before reaching the tick maths below.
    ///
    /// This is NOT repointable at V3. addLiquidityV3 mints FULL-RANGE and TWO-SIDED
    /// via getFullRangeTicks(POOL_FEE): it never derives a startTick, and both sides
    /// are funded, so a position cannot straddle spot with an unpayable capped side.
    /// The `+ 1` this guards — and _alignUp/_alignDown — are reachable ONLY from
    /// addLiquidityV4SingleSided. Pointing this test at V3 would make it vacuous
    /// (deleting the `+ 1` would not fail it) while still looking like coverage.
    ///
    /// Kept because src/FyuzLiquidityManager.sol still CONTAINS that `+ 1` and both
    /// align helpers — the V4 internals were "intentionally left in place". Deleting
    /// the only guard for live code is how a subtle fix gets refactored away. Drop the
    /// vm.skip if V4 is ever un-gated; delete this file if the V4 internals are removed.
    function test_singleSidedLaunch_survivesAlignedStartTick() public {
        vm.skip(true);

        uint256 ethForPrice = _findAlignedEthAmount();

        // Setup must genuinely hit the boundary case, else this test is vacuous.
        int24 startTick = TickMath.getTickAtSqrtPrice(
            _sqrtPriceX96(TOTAL_SUPPLY, ethForPrice)
        );
        assertEq(startTick % TICK_SPACING, 0, "setup: startTick must be aligned");

        Token token = _deployCurrency0Token();
        token.launch(); // lift the pre-launch transfer gate
        IERC20(address(token)).approve(address(liquidityManager), TOTAL_SUPPLY);

        // With tickLower aligned to spot this reverts (mint needs WETH, capped at 0).
        liquidityManager.addLiquidityV4SingleSided(
            address(token),
            TOTAL_SUPPLY,
            ethForPrice,
            address(0xdEaD)
        );

        assertGt(
            liquidityManager.v4PositionOf(address(token)),
            0,
            "position minted at aligned start tick"
        );
    }
}
