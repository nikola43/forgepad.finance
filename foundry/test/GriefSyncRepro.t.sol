// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {Arrowpad, IArrowpad} from "../src/Arrowpad.sol";
import {ArrowpadLiquidityManager} from "../src/ArrowpadLiquidityManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {IUniswapV2Factory} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

interface IWETHMin {
    function deposit() external payable;
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Repro: a griefer pre-donates WETH (>= the graduation LP ETH) to the
///         deterministic pair and calls sync() to fold it into RESERVES. The
///         manager's donation absorption reads balanceOf only, so it deposits 0
///         WETH; UniswapV2 mint() then sees a 0 WETH delta and underflow-reverts,
///         permanently bricking graduation. Verifies graduation still succeeds
///         at ~target price after the fix.
contract GriefSyncReproTest is Test {
    Arrowpad arrowpad;
    ArrowpadLiquidityManager lm;
    IUniswapV2Router02 router;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address buyer;
    uint256 constant TOTAL_SUPPLY = 1_000_000_000e18;

    function setUp() public {
        vm.createSelectFork(vm.envOr("FORK_URL", string("https://ethereum-rpc.publicnode.com")));
        address V2_ROUTER = vm.envOr("V2_ROUTER", 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
        address V3_FACTORY = vm.envOr("V3_FACTORY", 0x1F98431c8aD98523631AE4a59f267346ea31F984);
        address V3_POS = vm.envOr("V3_POS_MGR", 0xC36442b4a4522E871399CD717aBDD847Ab11FE88);
        address V4_MGR = vm.envOr("V4_POOL_MGR", 0x000000000004444c5dc75cB358380D2e3dE08A90);
        address UNIV = vm.envOr("UNIVERSAL_ROUTER", 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af);
        address V4_POS = vm.envOr("V4_POS_MGR", 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e);
        address DATA_FEED = vm.envOr("DATA_FEED", 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419);

        lm = new ArrowpadLiquidityManager(
            V2_ROUTER, V3_FACTORY, V3_POS, V4_MGR, UNIV, V4_POS, PERMIT2,
            address(this), address(this), 10000, 10000
        );
        arrowpad = new Arrowpad(DATA_FEED, address(lm), address(0xFEE), address(0xD1));
        lm.setAuthorizedCaller(address(arrowpad), true);
        router = IUniswapV2Router02(V2_ROUTER);

        buyer = makeAddr("buyer");
        vm.deal(buyer, 200_000 ether);
        vm.deal(address(this), 100 ether);
    }

    function _launched(address t) internal view returns (bool l) {
        (, , , , , , , l) = arrowpad.tokenPools(t);
    }

    function test_SyncDonationDoesNotBrickGraduation() public {
        address t = arrowpad.createToken{value: 0.001 ether}("Grief", "GRF", 0, 0, 0, 1, block.timestamp);
        address weth = router.WETH();

        // Attacker pre-creates the pair, donates a LARGE amount of WETH (bigger
        // than any possible graduation LP ETH), and sync()s it into reserves.
        address pair = IUniswapV2Factory(router.factory()).createPair(t, weth);
        IWETHMin(weth).deposit{value: 50 ether}();
        IWETHMin(weth).transfer(pair, 50 ether);
        IUniswapV2Pair(pair).sync(); // fold donation into reserves - invisible to balanceOf-only logic

        // Drive to graduation. Before the fix, the graduation-crossing buy reverts
        // (mint underflow), so the token never launches within the loop.
        for (uint256 i = 0; i < 3000 && !_launched(t); i++) {
            vm.prank(buyer);
            arrowpad.swapExactETHForTokens{value: 0.1 ether}(t, 0.1 ether, 0, block.timestamp);
        }

        assertTrue(_launched(t), "BUG: graduation permanently bricked by sync() donation");

        // And it must still open near the target market cap (donation only pushes
        // price up, never below target).
        address realPair = IUniswapV2Factory(router.factory()).getPair(t, weth);
        (uint112 r0, uint112 r1, ) = IUniswapV2Pair(realPair).getReserves();
        (uint256 wethRes, uint256 tokRes) = IUniswapV2Pair(realPair).token0() == weth
            ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 fdv = (arrowpad.getETHPriceByUSD() * TOTAL_SUPPLY * wethRes) / tokRes / 1e18;
        console.log("post-grief V2 FDV USD:", fdv / 1e18);
        // Opens at or above target (never materially below).
        assertGe(fdv, (arrowpad.TARGET_MARKET_CAP_USD() * 97) / 100, "opened below target (LP arb leak)");
    }

    receive() external payable {}
}
