// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {Arrowpad} from "../src/Arrowpad.sol";
import {ArrowpadLiquidityManager} from "../src/ArrowpadLiquidityManager.sol";
import {ArrowpadDeploy} from "../src/ArrowpadDeploy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IUniswapV2Router02
} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {IPoolManager} from "../src/v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "../src/v4-core/libraries/StateLibrary.sol";
import {PoolKey} from "../src/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../src/v4-core/types/PoolId.sol";
import {Currency} from "../src/v4-core/types/Currency.sol";
import {IHooks} from "../src/v4-core/interfaces/IHooks.sol";

/// Reads the market cap the DEX itself reports after a direct V4 launch — straight
/// from the pool's sqrtPriceX96, not from any Arrowpad view. createTokenDirect claims
/// the pool opens at TARGET_MARKET_CAP_USD; this holds it to that claim.
///
/// Pools pair against WETH, so whether a token is currency0 or currency1 comes down to
/// how its address sorts against WETH. A single launch only ever exercises one branch,
/// and the currency0 branch is where the tick-boundary DoS lived — so cover both.
contract DirectV4MarketCapTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    Arrowpad internal arrowpad;
    ArrowpadLiquidityManager internal lm;

    address internal constant PERMIT2 =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant BURN =
        0x000000000000000000000000000000000000dEaD;
    address internal V4_POOL_MGR;
    address internal weth;
    uint24 internal constant POOL_FEE = 100;
    int24 internal constant TICK_SPACING = 60;
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;

    receive() external payable {}

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("FORK_URL", string("https://ethereum-rpc.publicnode.com"))
        );
        address v2router = vm.envOr(
            "V2_ROUTER",
            0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
        );
        V4_POOL_MGR = vm.envOr(
            "V4_POOL_MGR",
            0x000000000004444c5dc75cB358380D2e3dE08A90
        );

        lm = ArrowpadDeploy.deployLiquidityManager(
            v2router,
            vm.envOr("V3_FACTORY", 0x1F98431c8aD98523631AE4a59f267346ea31F984),
            vm.envOr("V3_POS_MGR", 0xC36442b4a4522E871399CD717aBDD847Ab11FE88),
            V4_POOL_MGR,
            vm.envOr("UNIVERSAL_ROUTER", 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af),
            vm.envOr("V4_POS_MGR", 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e),
            PERMIT2,
            address(this),
            address(this),
            10000,
            10000,
            address(this)
        );
        arrowpad = ArrowpadDeploy.deployArrowpad(
            vm.envOr("DATA_FEED", 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419),
            address(lm),
            address(this),
            address(this),
            address(this)
        );
        lm.setAuthorizedCaller(address(arrowpad), true);
        arrowpad.setPriceStalenessThreshold(86400);

        weth = IUniswapV2Router02(v2router).WETH();
        vm.deal(address(this), 10_000 ether);
    }

    function _key(address t) internal view returns (PoolKey memory) {
        bool c0 = t < weth;
        return
            PoolKey({
                currency0: Currency.wrap(c0 ? t : weth),
                currency1: Currency.wrap(c0 ? weth : t),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(address(0))
            });
    }

    /// FDV in USD (18dp), derived from the pool's own sqrtPriceX96.
    function _dexFdvUsd(address t) internal view returns (uint256) {
        (uint160 sp, , , ) = IPoolManager(V4_POOL_MGR).getSlot0(_key(t).toId());
        require(sp > 0, "pool not initialised");

        // price = (sp/2^96)^2 = currency1 per currency0.
        uint256 p = (uint256(sp) * uint256(sp)) >> 96; // Q96 of c1-per-c0
        uint256 ethPerToken = t < weth
            ? (p * 1e18) >> 96 // token is c0: price is already ETH per token
            : ((uint256(1) << 96) * 1e18) / p; // token is c1: invert
        return ((ethPerToken * arrowpad.getETHPriceByUSD()) / 1e18) * 1e9;
    }

    /// Launch tokens until one lands on the requested side of WETH.
    /// @dev Each createTokenDirect bumps Arrowpad's nonce, so the CREATE address moves
    ///      on every pass. Do NOT snapshot/revert to retry: that rewinds the nonce too
    ///      and regenerates the identical address forever.
    function _launchWithOrdering(bool wantCurrency0) internal returns (address t) {
        for (uint256 i = 0; i < 40; i++) {
            t = arrowpad.createTokenDirect{
                value: arrowpad.CREATE_TOKEN_FEE_AMOUNT()
            }(
                string.concat("D", vm.toString(i)),
                string.concat("D", vm.toString(i)),
                0,
                block.timestamp + 1
            );
            if ((t < weth) == wantCurrency0) return t;
        }
        revert("could not land the requested currency ordering");
    }

    function _assertOpensAtTarget(address t, string memory label) internal view {
        uint256 fdv = _dexFdvUsd(t);
        uint256 target = arrowpad.TARGET_MARKET_CAP_USD();
        console.log(label);
        console.log("  DEX FDV (USD) :", fdv / 1e18);
        console.log("  Target  (USD) :", target / 1e18);
        // 2% covers tick-alignment rounding: the opening tick snaps to spacing.
        assertApproxEqRel(fdv, target, 0.02e18, "DEX must open at TARGET_MARKET_CAP_USD");
    }

    /// Token sorts ABOVE weth => token is currency1, range sits below spot.
    function test_directV4_marketCap_tokenIsCurrency1() public {
        address t = _launchWithOrdering(false);
        assertTrue(t > weth, "setup: token must be currency1");
        _assertOpensAtTarget(t, "token = currency1");
        assertEq(IERC20(t).balanceOf(address(this)), 0, "creator keeps nothing");
    }

    /// Token sorts BELOW weth => token is currency0, range sits strictly above spot.
    /// This is the branch the tick-boundary fix protects.
    function test_directV4_marketCap_tokenIsCurrency0() public {
        address t = _launchWithOrdering(true);
        assertTrue(t < weth, "setup: token must be currency0");
        _assertOpensAtTarget(t, "token = currency0");
        assertEq(IERC20(t).balanceOf(address(this)), 0, "creator keeps nothing");
    }

    /// The opening price must not drift with the nonce / currency ordering.
    function test_directV4_targetHoldsAcrossLaunches() public {
        uint256 target = arrowpad.TARGET_MARKET_CAP_USD();
        for (uint256 i = 0; i < 6; i++) {
            address t = arrowpad.createTokenDirect{
                value: arrowpad.CREATE_TOKEN_FEE_AMOUNT()
            }(
                string.concat("M", vm.toString(i)),
                string.concat("M", vm.toString(i)),
                0,
                block.timestamp + 1
            );
            assertApproxEqRel(_dexFdvUsd(t), target, 0.02e18, "every launch opens at target");
        }
    }

    /// The whole supply must be working in the pool, minus rounding dust.
    function test_directV4_wholeSupplyInPool() public {
        address t = _launchWithOrdering(false);
        uint256 pooled = IERC20(t).balanceOf(V4_POOL_MGR);
        uint256 burned = IERC20(t).balanceOf(BURN);
        assertEq(pooled + burned, TOTAL_SUPPLY, "supply pooled or burned");
        assertLt(burned, 1e12, "burn is rounding dust only");
    }
}
