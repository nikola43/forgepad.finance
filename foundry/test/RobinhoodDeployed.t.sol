// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {Arrowpad, IArrowpad} from "../src/Arrowpad.sol";
import {ArrowpadLiquidityManager} from "../src/ArrowpadLiquidityManager.sol";
import {Token} from "../src/Token.sol";
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
import {
    IUniswapV3Factory
} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {StateLibrary} from "../src/v4-core/libraries/StateLibrary.sol";
import {IPoolManager} from "../src/v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "../src/v4-core/types/PoolKey.sol";
import {PoolIdLibrary} from "../src/v4-core/types/PoolId.sol";
import {Currency} from "../src/v4-core/types/Currency.sol";
import {IHooks} from "../src/v4-core/interfaces/IHooks.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Smoke tests against the LIVE deployed Arrowpad on Robinhood Chain
///         (chainId 4663), run on a fork. Verifies the production deployment is
///         correctly configured and that V2/V3/V4 graduations open at the target
///         market cap with no price gap.
///
///         Skipped unless FORK_URL points at a Robinhood Chain RPC:
///           FORK_URL=<robinhood rpc> \
///           V2_ROUTER=... V3_FACTORY=... (see DeployRobinhood.s.sol) \
///           forge test --match-contract RobinhoodDeployedTest -vv
contract RobinhoodDeployedTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 constant ROBINHOOD_CHAIN_ID = 4663;
    uint256 constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;
    uint24 constant POOL_FEE = 100;

    Arrowpad arrowpad;
    ArrowpadLiquidityManager lm;
    IUniswapV2Router02 router;
    address V3_FACTORY;
    address V4_POOL_MGR;

    address buyer;
    uint256 TARGET_MCAP_USD;
    bool active; // true only on a Robinhood fork

    function setUp() public {
        string memory forkUrl = vm.envOr("FORK_URL", string(""));
        if (bytes(forkUrl).length == 0) return; // no fork configured -> skip all
        vm.createSelectFork(forkUrl);
        if (block.chainid != ROBINHOOD_CHAIN_ID) return; // not Robinhood -> skip all
        active = true;

        // The CURRENT live pair, matching backend-rs/src/config/chains.rs (the app's
        // single source of truth). The earlier 0x871a70 / 0x992C539D deployment was
        // abandoned after the 2026-07-03 security redeploy and has no withdrawableEth()
        // — pointing these tests at it validated a contract nobody uses.
        arrowpad = Arrowpad(
            payable(vm.envOr("DEPLOYED_ARROWPAD", 0x5d2391CF88cd48BB6B9Ec12b38BC8119562F9012))
        );
        lm = ArrowpadLiquidityManager(
            payable(vm.envOr("DEPLOYED_LM", 0x08Dd64DF51945A84124c1228453b43c896cEfAdE))
        );
        router = IUniswapV2Router02(
            vm.envOr("V2_ROUTER", 0x89e5DB8B5aA49aA85AC63f691524311AEB649eba)
        );
        V3_FACTORY = vm.envOr("V3_FACTORY", 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA);
        V4_POOL_MGR = vm.envOr("V4_POOL_MGR", 0x8366a39CC670B4001A1121B8F6A443A643e40951);

        buyer = makeAddr("buyer");
        vm.deal(buyer, 100_000 ether);
        vm.deal(address(this), 100_000 ether);

        TARGET_MCAP_USD = arrowpad.TARGET_MARKET_CAP_USD();
    }

    modifier onlyRobinhood() {
        if (!active) {
            vm.skip(true);
        }
        _;
    }

    // ----------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------

    function _create(string memory name, string memory sym, uint8 pt)
        internal
        returns (address)
    {
        vm.recordLogs();
        arrowpad.createToken{value: arrowpad.CREATE_TOKEN_FEE_AMOUNT()}(
            name, sym, 0, 0, 0, pt, block.timestamp
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 tcSig = keccak256("TokenCreated(address,uint256,uint256,uint32,uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == tcSig) {
                (address tokenAddr, , , , ) =
                    abi.decode(logs[i].data, (address, uint256, uint256, uint32, uint256));
                return tokenAddr;
            }
        }
        revert("TokenCreated not found");
    }

    function _launched(address t) internal view returns (bool l) {
        (, , , , , , , l) = arrowpad.tokenPools(t);
    }

    function _graduate(string memory name, string memory sym, uint8 pt)
        internal
        returns (address t)
    {
        t = _create(name, sym, pt);
        for (uint256 i = 0; i < 2000 && !_launched(t); i++) {
            vm.prank(buyer);
            arrowpad.swapExactETHForTokens{value: 0.05 ether}(t, 0.05 ether, 0, block.timestamp);
        }
        require(_launched(t), "token did not graduate");
        // Curve must be fully cleared after migration.
        (uint256 ethRes, uint256 tokRes, uint256 vEth, uint256 vTok, , , , ) =
            arrowpad.tokenPools(t);
        assertEq(ethRes, 0, "curve ETH cleared");
        assertEq(tokRes, 0, "curve tokens cleared");
        assertEq(vEth, 0, "vETH cleared");
        assertEq(vTok, 0, "vToken cleared");
    }

    function _absGapBps(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 hi = a > b ? a : b;
        uint256 lo = a > b ? b : a;
        return hi == 0 ? 0 : ((hi - lo) * 10_000) / hi;
    }

    function _v2FdvUsd(address t, uint256 ethPriceUSD) internal view returns (uint256) {
        address weth = router.WETH();
        address pair = IUniswapV2Factory(router.factory()).getPair(t, weth);
        require(pair != address(0), "V2 pair missing");
        (uint112 r0, uint112 r1, ) = IUniswapV2Pair(pair).getReserves();
        (uint256 ethRes, uint256 tokRes) = IUniswapV2Pair(pair).token0() == weth
            ? (uint256(r0), uint256(r1))
            : (uint256(r1), uint256(r0));
        return (ethPriceUSD * TOTAL_SUPPLY * ethRes) / tokRes / 1e18;
    }

    function _v3FdvUsd(address t, uint256 ethPriceUSD) internal view returns (uint256) {
        address weth = router.WETH();
        address pool = IUniswapV3Factory(V3_FACTORY).getPool(t, weth, POOL_FEE);
        require(pool != address(0), "V3 pool missing");
        uint256 ethRes = IERC20(weth).balanceOf(pool);
        uint256 tokRes = IERC20(t).balanceOf(pool);
        require(tokRes > 0, "no V3 token liquidity");
        return (ethPriceUSD * TOTAL_SUPPLY * ethRes) / tokRes / 1e18;
    }

    function _v4FdvUsd(address t, uint256 ethPriceUSD) internal view returns (uint256) {
        address weth = router.WETH();
        (address c0, address c1) = t < weth ? (t, weth) : (weth, t);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: POOL_FEE,
            tickSpacing: int24(60),
            hooks: IHooks(address(0))
        });
        (uint160 sp, , , ) = IPoolManager(V4_POOL_MGR).getSlot0(key.toId());
        require(sp > 0, "V4 pool not initialized");
        uint256 Q96 = 0x1000000000000000000000000;
        uint256 priceX = Math.mulDiv(Math.mulDiv(uint256(sp), uint256(sp), Q96), 1e18, Q96);
        uint256 ethPerToken = t < weth ? priceX : (1e36 / priceX);
        return (ethPriceUSD * TOTAL_SUPPLY * ethPerToken) / 1e36;
    }

    // ----------------------------------------------------------------
    // 1. Deployed configuration sanity
    // ----------------------------------------------------------------

    function test_Deployed_Config() public onlyRobinhood {
        console.log("=== DEPLOYED CONFIG (Robinhood, chainId 4663) ===");
        assertEq(address(arrowpad.liquidityManager()), address(lm), "LM wired");
        assertTrue(lm.authorizedCallers(address(arrowpad)), "arrowpad authorized on LM");
        assertEq(arrowpad.PLATFORM_BUY_FEE_BPS(), 100, "buy fee 1%");
        assertEq(arrowpad.PLATFORM_SELL_FEE_BPS(), 100, "sell fee 1%");
        assertEq(arrowpad.MAX_BUY_PERCENT(), 10000, "max buy 100%");
        assertEq(arrowpad.MAX_SELL_PERCENT(), 10000, "max sell 100%");
        assertEq(TARGET_MCAP_USD, 20_000 * 1e18, "target mcap $20k");
        assertFalse(arrowpad.paused(), "not paused");

        // Chainlink feed returns a sane ETH/USD price (1e18-scaled), $100..$100k.
        uint256 ethPrice = arrowpad.getETHPriceByUSD();
        console.log("Chainlink ETH/USD:", ethPrice / 1e18);
        assertGt(ethPrice, 100e18, "ETH price too low - feed broken?");
        assertLt(ethPrice, 100_000e18, "ETH price too high - feed broken?");
    }

    // ----------------------------------------------------------------
    // 2. Full graduation on the LIVE deployment: no price gap, V2/V3/V4
    // ----------------------------------------------------------------

    function test_Deployed_V2Graduation_NoPriceGap() public onlyRobinhood {
        uint256 ethPriceUSD = arrowpad.getETHPriceByUSD();
        address t = _graduate("RHDeployV2", "RD2", 1);

        uint256 fdv = _v2FdvUsd(t, ethPriceUSD);
        console.log("V2 FDV USD:", fdv / 1e18, "gap bps:", _absGapBps(fdv, TARGET_MCAP_USD));
        assertApproxEqRel(fdv, TARGET_MCAP_USD, 0.02e18, "V2 opens off target mcap");

        // LP burned: pair LP tokens sit at the burn address.
        address weth = router.WETH();
        address pair = IUniswapV2Factory(router.factory()).getPair(t, weth);
        assertGt(
            IERC20(pair).balanceOf(0x000000000000000000000000000000000000dEaD),
            0,
            "V2 LP not burned"
        );
    }

    function test_Deployed_V3Graduation_NoPriceGap() public onlyRobinhood {
        uint256 ethPriceUSD = arrowpad.getETHPriceByUSD();
        address t = _graduate("RHDeployV3", "RD3", 2);

        uint256 fdv = _v3FdvUsd(t, ethPriceUSD);
        console.log("V3 FDV USD:", fdv / 1e18, "gap bps:", _absGapBps(fdv, TARGET_MCAP_USD));
        assertApproxEqRel(fdv, TARGET_MCAP_USD, 0.02e18, "V3 opens off target mcap");
    }

    function test_Deployed_V4Graduation_NoPriceGap() public onlyRobinhood {
        uint256 ethPriceUSD = arrowpad.getETHPriceByUSD();
        address t = _graduate("RHDeployV4", "RD4", 3);

        uint256 fdv = _v4FdvUsd(t, ethPriceUSD);
        console.log("V4 FDV USD:", fdv / 1e18, "gap bps:", _absGapBps(fdv, TARGET_MCAP_USD));
        assertApproxEqRel(fdv, TARGET_MCAP_USD, 0.02e18, "V4 opens off target mcap");
    }

    // ----------------------------------------------------------------
    // 3. Post-graduation trading works on the real Robinhood Uniswap V2
    // ----------------------------------------------------------------

    function test_Deployed_V2PostGraduationTrade() public onlyRobinhood {
        address t = _graduate("RHTrade", "RHT", 1);
        address weth = router.WETH();

        // Buy on the real router
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = t;
        uint256 balBefore = IERC20(t).balanceOf(address(this));
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: 0.1 ether}(
            0, path, address(this), block.timestamp
        );
        uint256 got = IERC20(t).balanceOf(address(this)) - balBefore;
        assertGt(got, 0, "post-graduation buy failed");

        // And sell back
        IERC20(t).approve(address(router), got);
        path[0] = t;
        path[1] = weth;
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            got, 0, path, address(this), block.timestamp
        );
    }

    receive() external payable {}
}
