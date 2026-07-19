// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/Fyuz.sol";
import "../src/FyuzLiquidityManager.sol";
import {FyuzDeploy} from "../src/FyuzDeploy.sol";
import {IUniswapV2Factory} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IV3PoolSlot0} from "../src/interfaces/IV3PoolSlot0.sol";
import {V3PoolSwapper} from "./ClaimFees.t.sol";

/// Captures the full price curve through graduation for both V2 and V3 launches
/// and prints CSV rows (prefix "GCURVE,") for an off-chain Excel/chart export.
/// Each row: GCURVE,<market>,<phase>,<step>,<bnbIn_wei>,<priceBNB_wei>,<bnbUsd_wei>,<mcapUsd_wei>
///   priceBNB = BNB per token (1e18); bnbUsd = USD per BNB (1e18).
///   phase = curve (bonding curve) | dex (post-graduation pool opening price).
contract GraduationCurveTest is Test {
    address constant V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address constant V2_FACTORY = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
    address constant V3_FACTORY = 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865;
    address constant V3_POSITION_MANAGER = 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364;
    address constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant DATA_FEED = 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE;
    address constant SENTINEL = 0x000000000000000000000000000000000000dEaD;
    uint24 constant POOL_FEE = 100;

    Fyuz fyuz;
    FyuzLiquidityManager lm;
    address deployer = address(this);
    address trader = address(0xBEEF);

    receive() external payable {}

    function setUp() public {
        vm.createSelectFork(vm.envOr("BSC_FORK_URL", string("https://bsc-rpc.publicnode.com")));
        lm = FyuzDeploy.deployLiquidityManager(
            V2_ROUTER, V3_FACTORY, V3_POSITION_MANAGER, SENTINEL, SENTINEL, SENTINEL,
            PERMIT2, deployer, deployer
        );
        fyuz = FyuzDeploy.deployFyuz(DATA_FEED, address(lm), deployer, deployer, deployer);
        lm.setAuthorizedCaller(address(fyuz), true);
        fyuz.setPlatformBuyFeeBps(80);
        fyuz.setPlatformSellFeeBps(80);
        fyuz.setTokenOwnerFeeBps(20);
        fyuz.setPlatformTreasuryShareBps(6250);
        fyuz.setMaxBuyPercent(10000);
        fyuz.setMaxSellPercent(10000);
        fyuz.setPriceStalenessThreshold(3600);
        vm.deal(trader, 20_000 ether);
        vm.deal(deployer, 10 ether);
    }

    function test_captureV2Curve() public {
        _run(1, "v2");
    }

    function test_captureV3Curve() public {
        _run(2, "v3");
    }

    function _run(uint8 poolType, string memory market) internal {
        vm.prank(trader);
        address token = fyuz.createToken{value: 0.001 ether}(
            "Curve", "CRV", 0, 0, 0, poolType, block.timestamp + 1
        );

        uint256 bnbIn;
        uint256 step;
        _row(market, "curve", step, bnbIn, fyuz.getVirtualPrice(token), fyuz.getETHPriceByUSD(), fyuz.getTokenVirtualMarketCap(token));

        while (!_launched(token)) {
            uint256 buyAmt = 0.4 ether;
            uint256 fee = fyuz.getFirstBuyFee(token);
            if (trader.balance <= buyAmt + fee) break;
            vm.prank(trader);
            fyuz.swapExactETHForTokens{value: buyAmt + fee}(token, buyAmt, 0, block.timestamp + 1);
            bnbIn += buyAmt;
            step++;
            if (_launched(token)) break;
            _row(market, "curve", step, bnbIn, fyuz.getVirtualPrice(token), fyuz.getETHPriceByUSD(), fyuz.getTokenVirtualMarketCap(token));
        }
        require(_launched(token), "did not graduate");

        // Opening DEX price (BNB per token), continuous with the curve by design.
        uint256 dexPriceBNB = poolType == 1 ? _v2Price(token) : _v3Price(token);
        _row(market, "dex", step + 1, bnbIn, dexPriceBNB, fyuz.getETHPriceByUSD(), _dexMcap(token, dexPriceBNB));
        _dexTrades(poolType, market, token, step + 1, bnbIn);
    }

    // Post-graduation trade context lives in storage to dodge stack-too-deep.
    V3PoolSwapper internal sw;
    address internal swPool;
    address internal swHolder;
    uint256 internal swStartBal;

    /// Post-graduation DEX activity: buys are BNB amounts, 0 = sell half of the
    /// tokens acquired on the DEX so far. Price captured after each trade.
    function _dexTrades(uint8 poolType, string memory market, address token, uint256 step, uint256 bnbIn) internal {
        uint256[6] memory plan = [uint256(1 ether), 2 ether, 0, 3 ether, 0, 2 ether];
        sw = new V3PoolSwapper();
        if (poolType == 2) {
            swPool = IUniswapV3Factory(V3_FACTORY).getPool(token, WBNB, POOL_FEE);
            vm.deal(address(sw), 20 ether);
            sw.wrap(WBNB, 15 ether);
        }
        swHolder = poolType == 1 ? trader : address(sw);
        swStartBal = IERC20(token).balanceOf(swHolder);

        for (uint256 i = 0; i < plan.length; i++) {
            if (plan[i] > 0) {
                _dexBuy(poolType, token, plan[i]);
                bnbIn += plan[i];
            } else {
                bnbIn += _dexSell(poolType, token);
            }
            step++;
            uint256 p = poolType == 1 ? _v2Price(token) : _v3Price(token);
            _row(market, "dex", step, bnbIn, p, fyuz.getETHPriceByUSD(), _dexMcap(token, p));
        }
    }

    function _dexBuy(uint8 poolType, address token, uint256 amt) internal {
        if (poolType == 1) {
            address[] memory path = new address[](2);
            path[0] = WBNB;
            path[1] = token;
            vm.prank(trader);
            IUniswapV2Router02(V2_ROUTER).swapExactETHForTokensSupportingFeeOnTransferTokens{value: amt}(
                0, path, trader, block.timestamp + 1
            );
        } else {
            sw.swap(swPool, WBNB < token, amt);
        }
    }

    /// Sells half of the tokens acquired on the DEX since graduation.
    function _dexSell(uint8 poolType, address token) internal returns (uint256 received) {
        uint256 amt = (IERC20(token).balanceOf(swHolder) - swStartBal) / 2;
        if (poolType == 1) {
            address[] memory path = new address[](2);
            path[0] = token;
            path[1] = WBNB;
            uint256 before = trader.balance;
            vm.startPrank(trader);
            IERC20(token).approve(V2_ROUTER, amt);
            IUniswapV2Router02(V2_ROUTER).swapExactTokensForETHSupportingFeeOnTransferTokens(
                amt, 0, path, trader, block.timestamp + 1
            );
            vm.stopPrank();
            received = trader.balance - before;
        } else {
            uint256 before = IERC20(WBNB).balanceOf(address(sw));
            sw.swap(swPool, token < WBNB, amt);
            received = IERC20(WBNB).balanceOf(address(sw)) - before;
        }
    }

    /// Full-supply mcap in USD (1e18): price * totalSupply * BNB/USD.
    function _dexMcap(address token, uint256 priceBNB) internal view returns (uint256) {
        return priceBNB * IERC20(token).totalSupply() / 1e18 * fyuz.getETHPriceByUSD() / 1e18;
    }

    function _v2Price(address token) internal view returns (uint256) {
        address pair = IUniswapV2Factory(V2_FACTORY).getPair(token, WBNB);
        (uint112 r0, uint112 r1, ) = IUniswapV2Pair(pair).getReserves();
        address t0 = IUniswapV2Pair(pair).token0();
        (uint256 tokenRes, uint256 wbnbRes) = t0 == token ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        if (tokenRes == 0) return 0;
        return (wbnbRes * 1e18) / tokenRes; // BNB per token
    }

    function _v3Price(address token) internal view returns (uint256) {
        address pool = IUniswapV3Factory(V3_FACTORY).getPool(token, WBNB, POOL_FEE);
        (uint160 sqrtP, , , , , , ) = IV3PoolSlot0(pool).slot0();
        // price of token0 in token1 = (sqrtP/2^96)^2, scaled to 1e18. Compute
        // s = sqrt(price)*1e9 = sqrtP*1e9 >> 96 first (fits in ~2^94), then
        // s^2 = price*1e18 (fits) — no uint256 overflow, no external lib.
        uint256 s = (uint256(sqrtP) * 1e9) >> 96;
        uint256 ratioX = s * s; // token1 per token0, 1e18
        address t0 = IUniswapV2Pair(pool).token0(); // pool exposes token0() too
        if (t0 == token) {
            return ratioX; // token1(=WBNB) per token0(=token) => BNB per token
        } else {
            if (ratioX == 0) return 0;
            return (1e18 * 1e18) / ratioX; // invert
        }
    }

    function _row(
        string memory market,
        string memory phase,
        uint256 step,
        uint256 bnbIn,
        uint256 priceBNB,
        uint256 bnbUsd,
        uint256 mcapUsd
    ) internal view {
        console.log(
            string.concat(
                "GCURVE,", market, ",", phase, ",",
                vm.toString(step), ",",
                vm.toString(bnbIn), ",",
                vm.toString(priceBNB), ",",
                vm.toString(bnbUsd), ",",
                vm.toString(mcapUsd)
            )
        );
    }

    function _launched(address token) internal view returns (bool) {
        (, , , , , , , bool launched) = fyuz.tokenPools(token);
        return launched;
    }
}
