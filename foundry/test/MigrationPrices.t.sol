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
import {
    IUniswapV2Factory
} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {
    IUniswapV2Pair
} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

/// Walks a token across its whole life — bonding curve, the graduating trade, and
/// post-migration DEX trading — recording price at every step so the migration seam
/// can be inspected rather than assumed.
///
/// Emits CSV rows prefixed with "ROW," so the harness can scrape them out of the
/// forge log without needing fs_permissions.
contract MigrationPricesTest is Test {
    Arrowpad internal arrowpad;
    ArrowpadLiquidityManager internal lm;

    address internal constant PERMIT2 =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal V2_ROUTER;
    address internal weth;
    address internal user;

    uint256 internal t0;

    receive() external payable {}

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("FORK_URL", string("https://ethereum-rpc.publicnode.com"))
        );
        V2_ROUTER = vm.envOr(
            "V2_ROUTER",
            0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
        );

        lm = ArrowpadDeploy.deployLiquidityManager(
            V2_ROUTER,
            vm.envOr("V3_FACTORY", 0x1F98431c8aD98523631AE4a59f267346ea31F984),
            vm.envOr("V3_POS_MGR", 0xC36442b4a4522E871399CD717aBDD847Ab11FE88),
            vm.envOr("V4_POOL_MGR", 0x000000000004444c5dc75cB358380D2e3dE08A90),
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
        arrowpad.setMaxBuyPercent(10000);
        // The fork's feed has a fixed updatedAt; warping simulated time would make it
        // read stale and revert. Widen the window so the walk measures curve price,
        // not the fork's frozen clock. ETH/USD stays constant across the run, which
        // is what we want: it isolates the curve's own price movement.
        arrowpad.setPriceStalenessThreshold(3650 days);

        weth = IUniswapV2Router02(V2_ROUTER).WETH();
        user = makeAddr("trader");
        vm.deal(user, 100_000 ether);
        t0 = block.timestamp;
    }

    /// ETH price (18dp) from the same oracle the contract uses.
    function _ethUsd() internal view returns (uint256) {
        return arrowpad.getETHPriceByUSD();
    }

    /// Spot price of the graduated V2 pool, in wei of ETH per whole token (18dp).
    function _poolPrice(address token) internal view returns (uint256) {
        address pair = IUniswapV2Factory(IUniswapV2Router02(V2_ROUTER).factory())
            .getPair(token, weth);
        if (pair == address(0)) return 0;
        (uint112 r0, uint112 r1, ) = IUniswapV2Pair(pair).getReserves();
        (uint256 wethR, uint256 tokR) = IUniswapV2Pair(pair).token0() == weth
            ? (uint256(r0), uint256(r1))
            : (uint256(r1), uint256(r0));
        if (tokR == 0) return 0;
        return (wethR * 1e18) / tokR;
    }

    function _row(
        string memory phase,
        uint256 idx,
        uint256 ethIn,
        uint256 priceEth,
        uint256 mcapUsd,
        uint256 progressBps
    ) internal view {
        // priceUsd (18dp) = priceEth * ethUsd / 1e18
        uint256 priceUsd = (priceEth * _ethUsd()) / 1e18;
        console.log(
            string.concat(
                "ROW,",
                phase,
                ",",
                vm.toString(idx),
                ",",
                vm.toString((block.timestamp - t0) / 60), // minutes elapsed
                ",",
                vm.toString(ethIn),
                ",",
                vm.toString(priceEth),
                ",",
                vm.toString(priceUsd),
                ",",
                vm.toString(mcapUsd),
                ",",
                vm.toString(progressBps)
            )
        );
    }

    function test_migrationPriceCurve() public {
        console.log("ROW,phase,index,minutes,ethIn,priceEthWei,priceUsdWei,mcapUsd,progressBps");

        address t = arrowpad.createToken{
            value: 0.05 ether + arrowpad.CREATE_TOKEN_FEE_AMOUNT()
        }("Curve", "CRV", 0.05 ether, 0, 0, 1, block.timestamp + 1);

        _row(
            "curve",
            0,
            0.05 ether,
            arrowpad.getVirtualPrice(t),
            arrowpad.getTokenVirtualMarketCap(t),
            arrowpad.getBondingCurveProgress(t)
        );

        uint256 step = 0.15 ether;
        uint256 lastCurvePrice;
        uint256 graduatedAt;

        for (uint256 i = 1; i <= 40; i++) {
            (, , , , , , bool launched) = arrowpad.getPoolDetails(t);
            if (launched) {
                graduatedAt = i;
                break;
            }

            lastCurvePrice = arrowpad.getVirtualPrice(t);

            vm.warp(block.timestamp + 5 minutes);
            vm.roll(block.number + 25);

            uint256 fee = arrowpad.getFirstBuyFee(t);
            vm.prank(user);
            arrowpad.swapExactETHForTokens{value: step + fee}(
                t,
                step,
                0,
                block.timestamp + 1
            );

            (, , , , , , bool nowLaunched) = arrowpad.getPoolDetails(t);
            if (nowLaunched) {
                graduatedAt = i;
                // The graduating trade zeroes the curve, so price now lives in the pool.
                _row("migration", i, step, _poolPrice(t), 0, 10000);
                break;
            }

            _row(
                "curve",
                i,
                step,
                arrowpad.getVirtualPrice(t),
                arrowpad.getTokenVirtualMarketCap(t),
                arrowpad.getBondingCurveProgress(t)
            );
        }

        assertGt(graduatedAt, 0, "token must graduate within the walk");

        uint256 poolOpen = _poolPrice(t);
        assertGt(poolOpen, 0, "V2 pool must exist after migration");

        console.log("LAST_CURVE_PRICE_WEI", lastCurvePrice);
        console.log("POOL_OPEN_PRICE_WEI", poolOpen);
        console.log("ETH_USD_WEI", _ethUsd());

        // ---- post-migration DEX trading ----
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = t;

        for (uint256 j = 1; j <= 12; j++) {
            vm.warp(block.timestamp + 5 minutes);
            vm.roll(block.number + 25);

            vm.prank(user);
            IUniswapV2Router02(V2_ROUTER).swapExactETHForTokensSupportingFeeOnTransferTokens{
                value: 0.15 ether
            }(0, path, user, block.timestamp + 1);

            _row("pool", graduatedAt + j, 0.15 ether, _poolPrice(t), 0, 10000);
        }
    }
}
