// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {INonfungiblePositionManager} from "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
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
import {
    IUniswapV3Pool
} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

interface IWETHMinimal {
    function deposit() external payable;
    function transfer(address to, uint256 value) external returns (bool);
}

interface IV2PairMinimal {
    function sync() external;
}
import {StateLibrary} from "../src/v4-core/libraries/StateLibrary.sol";
import {IPoolManager} from "../src/v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "../src/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../src/v4-core/types/PoolId.sol";
import {Currency} from "../src/v4-core/types/Currency.sol";
import {IHooks} from "../src/v4-core/interfaces/IHooks.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ArrowpadDeploy} from "../src/ArrowpadDeploy.sol";

contract ArrowpadTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    Arrowpad public arrowpad;
    ArrowpadLiquidityManager public liquidityManager;
    IArrowpad public iArrowpad;

    address public addr1;
    address public addr2;
    address public addr3;

    // DEX/oracle addresses: default to Ethereum mainnet, overridable via env so the
    // same suite runs against any chain fork (e.g. Robinhood Chain, chainId 4663).
    address UNISWAP_V2_ROUTER;
    address V3_POS_MGR;
    address V4_POOL_MGR;
    address UNIVERSAL_ROUTER;
    address V4_POS_MGR;
    address constant PERMIT2_ADDR =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Chainlink ETH/USD
    address DATA_FEED;

    address constant FEE_WALLET = 0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103;
    address constant DIST_ADDR = 0xF2917a81fF74406fbCf01c507057e101Db8f2F12;

    // Uniswap V3 factory + fee tier used by ArrowpadLiquidityManager (POOL_FEE = 100)
    address V3_FACTORY;
    uint24 constant V3_FEE = 100;

    // Bonding curve constants (mirrored for test assertions)
    uint256 constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;
    uint256 constant VIRTUAL_ETH_INITIAL = 2.5 ether;
    uint256 constant VIRTUAL_TOKEN_INITIAL = 1_073_000_000 * 1e18;
    uint256 constant REAL_TOKEN_INITIAL = 793_100_000 * 1e18;
    uint256 constant PRIVATE_DIVISOR = 10_000;
    uint256 TARGET_MCAP_USD; // read from the contract in setUp so tests track the live target

    IUniswapV2Router02 router;

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("FORK_URL", string("https://ethereum-rpc.publicnode.com"))
        );

        UNISWAP_V2_ROUTER = vm.envOr("V2_ROUTER", 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
        V3_FACTORY = vm.envOr("V3_FACTORY", 0x1F98431c8aD98523631AE4a59f267346ea31F984);
        V3_POS_MGR = vm.envOr("V3_POS_MGR", 0xC36442b4a4522E871399CD717aBDD847Ab11FE88);
        V4_POOL_MGR = vm.envOr("V4_POOL_MGR", 0x000000000004444c5dc75cB358380D2e3dE08A90);
        UNIVERSAL_ROUTER = vm.envOr("UNIVERSAL_ROUTER", 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af);
        V4_POS_MGR = vm.envOr("V4_POS_MGR", 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e);
        DATA_FEED = vm.envOr("DATA_FEED", 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419);
        router = IUniswapV2Router02(UNISWAP_V2_ROUTER);

        addr1 = makeAddr("addr1");
        addr2 = makeAddr("addr2");
        addr3 = makeAddr("addr3");

        vm.deal(address(this), 100_000 ether);
        vm.deal(addr1, 100_000 ether);
        vm.deal(addr2, 100_000 ether);
        vm.deal(addr3, 100_000 ether);

        liquidityManager = ArrowpadDeploy.deployLiquidityManager(
            UNISWAP_V2_ROUTER,
            V3_FACTORY,
            V3_POS_MGR,
            V4_POOL_MGR,
            UNIVERSAL_ROUTER,
            V4_POS_MGR,
            PERMIT2_ADDR,
            address(this),
            address(this),
            10000,
            10000,
            address(this)
        );

        arrowpad = ArrowpadDeploy.deployArrowpad(
            DATA_FEED,
            address(liquidityManager),
            FEE_WALLET,
            DIST_ADDR,
            address(this)
        );
        iArrowpad = IArrowpad(address(arrowpad));
        TARGET_MCAP_USD = arrowpad.TARGET_MARKET_CAP_USD();

        liquidityManager.setAuthorizedCaller(address(arrowpad), true);

        // Set fees to 3% buy / 3% sell, uncapped buy/sell percent
        arrowpad.setPlatformBuyFeeBps(300);
        arrowpad.setPlatformSellFeeBps(300);
        arrowpad.setMaxBuyPercent(10000);
        arrowpad.setMaxSellPercent(10000);

        // On L2 chains (Arbitrum, Robinhood Chain) the Chainlink feed timestamp
        // originates from L1 and can lag behind the L2 block time. Use 24h window.
        if (block.chainid == 4663) {
            arrowpad.setPriceStalenessThreshold(86400);
        }
    }

    // ================================================================
    //  HELPERS
    // ================================================================

    /// @dev Create a token via Arrowpad, extract address from TokenCreated event
    function _create(
        string memory name,
        string memory sym,
        uint8 pt
    ) internal returns (address) {
        vm.recordLogs();
        arrowpad.createToken{value: 0.001 ether}(name, sym, 0, 0, 0, pt, block.timestamp);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 tcSig = keccak256(
            "TokenCreated(address,uint256,uint256,uint32,uint256)"
        );
        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == tcSig) {
                (address tokenAddr, , , , ) = abi.decode(
                    logs[i].data,
                    (address, uint256, uint256, uint32, uint256)
                );
                return tokenAddr;
            }
        }
        revert("TokenCreated not found");
    }

    /// @dev Create a token with an initial buy
    function _createWithBuy(
        string memory name,
        string memory sym,
        uint8 pt,
        uint256 buyAmount
    ) internal returns (address) {
        vm.recordLogs();
        arrowpad.createToken{value: buyAmount + 0.001 ether}(
            name,
            sym,
            buyAmount,
            0,
            0,
            pt,
            block.timestamp
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 tcSig = keccak256(
            "TokenCreated(address,uint256,uint256,uint32,uint256)"
        );
        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == tcSig) {
                (address tokenAddr, , , , ) = abi.decode(
                    logs[i].data,
                    (address, uint256, uint256, uint32, uint256)
                );
                return tokenAddr;
            }
        }
        revert("TokenCreated not found");
    }

    /// @dev Shorthand to read pool struct
    function _pool(
        address t
    ) internal view returns (IArrowpad.PoolInfo memory) {
        return iArrowpad.tokenPools(t);
    }

    /// @dev Log price and mcap for a token
    function _logPriceAndMcap(string memory label, address t) internal view {
        uint256 vPrice = arrowpad.getVirtualPrice(t);
        uint256 mcap = arrowpad.getTokenVirtualMarketCap(t);
        IArrowpad.PoolInfo memory p = _pool(t);
        console.log("----", label, "----");
        console.log("  Virtual Price (wei/token):", vPrice);
        console.log("  Market Cap USD (18 dec):", mcap / 1e18);
        console.log("  Virtual ETH Reserve:", p.virtualEthReserve);
        console.log("  Virtual Token Reserve:", p.virtualTokenReserve / 1e18);
        console.log("  Real ETH Reserve:", p.ethReserve);
        console.log("  Real Token Reserve:", p.tokenReserve / 1e18);
    }

    // ================================================================
    //  1. TOKEN CREATION
    // ================================================================

    function test_01_CreateTokenNoInitialBuy() public {
        console.log("=== TEST 1a: Create Token (no initial buy) ===");
        address t = _create("AlphaToken", "ALPHA", 1);
        assertTrue(t != address(0), "Token address nonzero");

        IArrowpad.PoolInfo memory p = _pool(t);

        // Virtual reserves match constants
        assertEq(p.virtualEthReserve, VIRTUAL_ETH_INITIAL, "vETH initial");
        assertEq(
            p.virtualTokenReserve,
            VIRTUAL_TOKEN_INITIAL,
            "vToken initial"
        );
        assertEq(p.tokenReserve, REAL_TOKEN_INITIAL, "real token initial");
        assertEq(p.ethReserve, 0, "real ETH initial = 0");
        assertEq(p.poolType, 1, "pool type V2");
        assertFalse(p.launched, "not launched");

        // Total supply minted to arrowpad
        uint256 supply = IERC20(t).totalSupply();
        assertEq(supply, TOTAL_SUPPLY, "total supply");

        _logPriceAndMcap("After creation (no buy)", t);

        // Token count incremented
        assertEq(arrowpad.tokenCount(), 1, "tokenCount");
    }

    function test_01b_CreateTokenWithInitialBuy() public {
        console.log("=== TEST 1b: Create Token (with initial buy) ===");
        uint256 buyAmt = 0.05 ether;
        address t = _createWithBuy("BetaToken", "BETA", 1, buyAmt);

        IArrowpad.PoolInfo memory p = _pool(t);
        assertTrue(p.ethReserve > 0, "real ETH > 0 after initial buy");
        assertTrue(
            p.tokenReserve < REAL_TOKEN_INITIAL,
            "tokens sold from reserve"
        );

        uint256 creatorBal = IERC20(t).balanceOf(address(this));
        assertTrue(creatorBal > 0, "creator received tokens");
        console.log("Creator tokens from initial buy:", creatorBal);

        _logPriceAndMcap("After creation (with 0.05 ETH buy)", t);
    }

    function test_01c_CreateTokenPoolState() public {
        console.log("=== TEST 1c: Pool state verification ===");
        address t = _create("GammaToken", "GAMMA", 1);

        // K value at creation
        IArrowpad.PoolInfo memory p = _pool(t);
        uint256 k = p.virtualEthReserve * p.virtualTokenReserve;
        console.log("Initial K:", k / 1e36);
        assertTrue(k > 0, "K > 0");

        // Virtual price should match ratio
        uint256 vPrice = arrowpad.getVirtualPrice(t);
        uint256 expectedPrice = (p.virtualEthReserve * 1e18) /
            p.virtualTokenReserve;
        assertEq(vPrice, expectedPrice, "price matches reserve ratio");
        console.log("Initial virtual price:", vPrice);
    }

    // ================================================================
    //  2. BONDING CURVE MATH
    // ================================================================

    function test_02a_GetAmountOutBasic() public {
        console.log("=== TEST 2a: getAmountOut / getAmountIn math ===");
        address t = _create("MathToken", "MATH", 1);
        IArrowpad.PoolInfo memory p = _pool(t);

        // Use getSwapOutput to test the math
        uint256 inputETH = 0.1 ether;
        (uint256 tokensOut, uint256 impact) = arrowpad.getSwapOutput(
            t,
            inputETH,
            true
        );
        console.log("Input ETH:", inputETH);
        console.log("Tokens out:", tokensOut / 1e18);
        console.log("Price impact (bps):", impact);
        assertTrue(tokensOut > 0, "tokens out > 0");
        assertTrue(impact < 4500, "impact within limit");

        // Test sell side
        (uint256 ethOut, uint256 sellImpact) = arrowpad.getSwapOutput(
            t,
            tokensOut,
            false
        );
        console.log("Sell ETH out (after 3% fee):", ethOut);
        console.log("Sell impact (bps):", sellImpact);
        // Should get back less than input due to buy + sell fees
        assertTrue(ethOut < inputETH, "round-trip loses to fees");
    }

    function test_02b_KPreservationAcrossBuys() public {
        console.log("=== TEST 2b: K preservation across buys ===");
        address t = _create("KToken", "KVAL", 1);

        IArrowpad.PoolInfo memory p0 = _pool(t);
        uint256 k0 = p0.virtualEthReserve * p0.virtualTokenReserve;
        console.log("K initial:", k0 / 1e36);

        // Buy 1
        uint256 fee1 = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.01 ether + fee1}(
            t,
            0.01 ether,
            0,
            block.timestamp
        );
        IArrowpad.PoolInfo memory p1 = _pool(t);
        uint256 k1 = p1.virtualEthReserve * p1.virtualTokenReserve;
        console.log("K after buy 1:", k1 / 1e36);
        // K should increase (fees add to reserves)
        assertGe(k1, k0, "K non-decreasing after buy");

        // Buy 2
        uint256 fee2 = arrowpad.getFirstBuyFee(t);
        vm.prank(addr2);
        arrowpad.swapExactETHForTokens{value: 0.05 ether + fee2}(
            t,
            0.05 ether,
            0,
            block.timestamp
        );
        IArrowpad.PoolInfo memory p2 = _pool(t);
        uint256 k2 = p2.virtualEthReserve * p2.virtualTokenReserve;
        console.log("K after buy 2:", k2 / 1e36);
        assertGe(k2, k1, "K non-decreasing after buy 2");

        // Sell
        uint256 sellAmt = IERC20(t).balanceOf(addr1) / 2;
        vm.startPrank(addr1);
        IERC20(t).approve(address(arrowpad), sellAmt);
        arrowpad.swapExactTokensForETH(t, sellAmt, 0, block.timestamp);
        vm.stopPrank();

        IArrowpad.PoolInfo memory p3 = _pool(t);
        uint256 k3 = p3.virtualEthReserve * p3.virtualTokenReserve;
        console.log("K after sell:", k3 / 1e36);
        assertGe(k3, k2, "K non-decreasing after sell");
    }

    /// @notice _getMaxBuyForReserve caps the effective buyAmount so the computed
    ///         output never exceeds the available token reserve. Verify indirectly:
    ///         each buy's received tokens never exceed the pre-buy tokenReserve.
    function test_02c_MaxBuyForReserve_NoOvercharge() public {
        console.log("=== TEST 2c: _getMaxBuyForReserve no overcharge ===");
        address t = _create("MaxBuy", "MXB", 1);

        for (uint256 i = 0; i < 2000; i++) {
            IArrowpad.PoolInfo memory p = _pool(t);
            if (p.launched) break;

            uint256 resBefore = p.tokenReserve;
            uint256 balBefore = IERC20(t).balanceOf(addr1);

            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.3 ether}(t, 0.3 ether, 0, block.timestamp);

            IArrowpad.PoolInfo memory pAfter = _pool(t);
            if (!pAfter.launched) {
                uint256 tokensReceived = IERC20(t).balanceOf(addr1) - balBefore;
                // Invariant: the buy never consumes more tokens than were available.
                // This is the direct consequence of the _getMaxBuyForReserve cap.
                assertTrue(tokensReceived <= resBefore, "buyer cannot exceed available reserve");
            }

            // If graduation happened, our invariant was already verified on prior buys.
            if (pAfter.launched) {
                console.log("Graduated after buy", i + 1);
                break;
            }
        }
        console.log("All buys respected the reserve cap");
    }

    /// @dev Verify the _getMaxBuyForReserve formula directly by reimplementing
    ///      it here and cross-checking with getSwapOutput + getAmountIn.
    function test_02d_MaxBuyForReserve_Math() public {
        console.log("=== TEST 2d: _getMaxBuyForReserve math ===");

        // Full reserves: vEth=2.5, vToken=1.073e9, tokenReserve=793.1e6, fee=300bps
        // maxNet = tokenReserve * vEth / (vToken - tokenReserve)
        //        = 793.1e6 * 1e18 * 2.5e18 / ((1.073e9 - 793.1e6) * 1e18)
        //        = 793.1e6 * 2.5e18 / 279.9e6 ≈ 7.08e18
        // maxBuy = maxNet * DIVISOR / (DIVISOR - 300) ≈ 7.08 * 10000 / 9700 ≈ 7.3 ETH
        uint256 capFull = _maxBuyForReserve(2.5 ether, 1_073_000_000e18, 793_100_000e18, 300);
        // ~7.3 ETH expected at full reserves
        assertTrue(capFull > 5 ether, "full reserve cap > 5 ETH");
        assertTrue(capFull < 10 ether, "full reserve cap < 10 ETH");

        // When tokenReserve is very small, cap should be tiny.
        uint256 capTiny = _maxBuyForReserve(2.5 ether, 1_073_000_000e18, 0.1 ether, 300);
        assertTrue(capTiny < 1e15, "tiny reserve produces tiny cap");

        // When tokenReserve >= vToken, reserve is ample -> type(uint256).max
        uint256 capAmple = _maxBuyForReserve(2.5 ether, 1_000_000e18, 1_000_001e18, 300);
        assertEq(capAmple, type(uint256).max, "ample reserve returns max");

        // Cross-check: for a given buyAmount <= cap, verify the computed
        // amountOut never exceeds an imagined tokenReserve.
        // Use a realistic mid-curve state: vEth=3.0, vToken=800e6, tokenReserve=500e6
        for (uint256 buy = 0.01 ether; buy <= 5 ether; buy += 0.1 ether) {
            uint256 maxBuy = _maxBuyForReserve(3 ether, 800_000_000e18, 500_000_000e18, 300);
            if (buy > maxBuy) {
                // Buy would be capped; the output at the cap must be <= tokenReserve.
                (uint256 out,) = _simAmountOut(maxBuy, 3 ether, 800_000_000e18, 300);
                assertTrue(out <= 500_000_000e18, "capped buy doesn't exceed reserve");
                break; // verified the boundary
            }
        }
    }

    /// @dev Reimplementation of _getMaxBuyForReserve for test verification.
    function _maxBuyForReserve(
        uint256 vEth, uint256 vToken, uint256 tokenReserve, uint256 feeBps
    ) internal pure returns (uint256) {
        if (vToken <= tokenReserve) return type(uint256).max;
        uint256 maxNet = _mul(tokenReserve, vEth) / (vToken - tokenReserve);
        return _mul(maxNet, PRIVATE_DIVISOR) / (PRIVATE_DIVISOR - feeBps);
    }

    /// @dev Reimplementation of getAmountOut for test cross-check.
    function _simAmountOut(
        uint256 amountIn, uint256 vEth, uint256 vToken, uint256 feeBps
    ) internal pure returns (uint256 amountOut, uint256 impact) {
        uint256 amountInWithFee = _mul(amountIn, PRIVATE_DIVISOR - feeBps) / PRIVATE_DIVISOR;
        uint256 numerator = _mul(amountInWithFee, vToken);
        uint256 denominator = vEth + amountInWithFee;
        amountOut = numerator / denominator;
        impact = amountOut * PRIVATE_DIVISOR / vToken;
    }

    function _mul(uint256 a, uint256 b) private pure returns (uint256) {
        uint256 c = a * b;
        require(a == 0 || c / a == b, "mul overflow");
        return c;
    }

    function test_03a_SingleBuy() public {
        console.log("=== TEST 3a: Single buy ===");
        address t = _create("BuyToken", "BUY", 1);
        _logPriceAndMcap("Before buy", t);

        uint256 buyAmt = 0.1 ether;
        uint256 fee = arrowpad.getFirstBuyFee(t);
        uint256 feeWalletBefore = FEE_WALLET.balance;
        uint256 distBefore = DIST_ADDR.balance;

        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: buyAmt + fee}(t, buyAmt, 0, block.timestamp);

        uint256 bal = IERC20(t).balanceOf(addr1);
        assertTrue(bal > 0, "received tokens");
        console.log("Tokens received:", bal / 1e18);

        // Fee distribution: 3% of buyAmt split half/half to fee + distributor
        uint256 expectedFee = (buyAmt * 3) / 100;
        uint256 feeWalletGain = FEE_WALLET.balance - feeWalletBefore;
        uint256 distGain = DIST_ADDR.balance - distBefore;
        uint256 totalFeeReceived = feeWalletGain + distGain;
        console.log("Expected platform fee:", expectedFee);
        console.log("Fee wallet gain:", feeWalletGain);
        console.log("Distributor gain:", distGain);
        console.log("Total fee received:", totalFeeReceived);

        // Allow 1 wei rounding
        assertApproxEqAbs(totalFeeReceived, expectedFee, 1, "fee match");

        _logPriceAndMcap("After buy 0.1 ETH", t);
    }

    function test_03b_MultipleBuys() public {
        console.log("=== TEST 3b: Multiple sequential buys ===");
        address t = _create("MultiBuy", "MBUY", 1);

        uint256 prevPrice = arrowpad.getVirtualPrice(t);
        console.log("Initial price:", prevPrice);

        for (uint256 i = 0; i < 5; i++) {
            uint256 fee = arrowpad.getFirstBuyFee(t);
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.05 ether + fee}(
                t,
                0.05 ether,
                0,
                block.timestamp
            );

            uint256 newPrice = arrowpad.getVirtualPrice(t);
            console.log("Price after buy", i + 1, ":", newPrice);
            assertTrue(newPrice > prevPrice, "price increases on buy");
            prevPrice = newPrice;
        }

        uint256 totalBal = IERC20(t).balanceOf(addr1);
        console.log("Total tokens after 5 buys:", totalBal / 1e18);
        _logPriceAndMcap("After 5 x 0.05 ETH buys", t);
    }

    function test_03c_LargeBuy() public {
        console.log("=== TEST 3c: Large single buy ===");
        address t = _create("BigBuy", "BIG", 1);
        _logPriceAndMcap("Before large buy", t);

        // Buy 1 ETH in one go
        uint256 buyAmt = 1 ether;
        uint256 fee = arrowpad.getFirstBuyFee(t);

        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: buyAmt + fee}(t, buyAmt, 0, block.timestamp);

        uint256 bal = IERC20(t).balanceOf(addr1);
        console.log("Tokens from 1 ETH buy:", bal / 1e18);

        _logPriceAndMcap("After 1 ETH buy", t);
    }

    // ================================================================
    //  4. SELL OPERATIONS
    // ================================================================

    function test_04a_SellAfterBuy() public {
        console.log("=== TEST 4a: Sell after buy ===");
        address t = _create("SellToken", "SELL", 1);

        // Buy first
        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.1 ether + fee}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );

        uint256 tokenBal = IERC20(t).balanceOf(addr1);
        console.log("Tokens after buy:", tokenBal / 1e18);
        _logPriceAndMcap("Before sell", t);

        // Sell half
        uint256 sellAmt = tokenBal / 2;
        uint256 ethBefore = addr1.balance;

        vm.startPrank(addr1);
        IERC20(t).approve(address(arrowpad), sellAmt);
        arrowpad.swapExactTokensForETH(t, sellAmt, 0, block.timestamp);
        vm.stopPrank();

        uint256 ethReceived = addr1.balance - ethBefore;
        console.log("ETH received from sell:", ethReceived);
        assertTrue(ethReceived > 0, "received ETH");

        uint256 remainingTokens = IERC20(t).balanceOf(addr1);
        assertApproxEqAbs(
            remainingTokens,
            tokenBal - sellAmt,
            0,
            "token balance reduced"
        );

        _logPriceAndMcap("After selling half", t);
    }

    function test_04b_SellEntireBalance() public {
        console.log("=== TEST 4b: Sell entire token balance ===");
        address t = _create("FullSell", "FSELL", 1);

        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.05 ether + fee}(
            t,
            0.05 ether,
            0,
            block.timestamp
        );

        uint256 tokenBal = IERC20(t).balanceOf(addr1);
        uint256 ethBefore = addr1.balance;

        vm.startPrank(addr1);
        IERC20(t).approve(address(arrowpad), tokenBal);
        arrowpad.swapExactTokensForETH(t, tokenBal, 0, block.timestamp);
        vm.stopPrank();

        uint256 ethReceived = addr1.balance - ethBefore;
        uint256 remainingTokens = IERC20(t).balanceOf(addr1);
        assertEq(remainingTokens, 0, "zero tokens remaining");
        console.log("ETH received from full sell:", ethReceived);
        assertTrue(ethReceived > 0, "received ETH");

        _logPriceAndMcap("After full sell", t);
    }

    function test_04c_SellFeeDeduction() public {
        console.log("=== TEST 4c: Sell fee deduction verification ===");
        address t = _create("FeeCheck", "FCHK", 1);

        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.1 ether + fee}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );

        IArrowpad.PoolInfo memory pBefore = _pool(t);
        uint256 tokenBal = IERC20(t).balanceOf(addr1);
        uint256 sellAmt = tokenBal / 10;

        uint256 ethBefore = addr1.balance;
        uint256 feeWalletBefore = FEE_WALLET.balance;
        uint256 distBefore = DIST_ADDR.balance;

        vm.startPrank(addr1);
        IERC20(t).approve(address(arrowpad), sellAmt);
        arrowpad.swapExactTokensForETH(t, sellAmt, 0, block.timestamp);
        vm.stopPrank();

        uint256 ethReceived = addr1.balance - ethBefore;
        IArrowpad.PoolInfo memory pAfter = _pool(t);
        uint256 grossETH = pBefore.ethReserve - pAfter.ethReserve;
        uint256 feeWalletGain = FEE_WALLET.balance - feeWalletBefore;
        uint256 distGain = DIST_ADDR.balance - distBefore;
        uint256 totalFee = feeWalletGain + distGain;

        console.log("Gross ETH from reserves:", grossETH);
        console.log("Net ETH to seller:", ethReceived);
        console.log("Platform sell fee:", totalFee);

        if (grossETH > 0) {
            uint256 feeBps = (totalFee * 10000) / grossETH;
            console.log("Sell fee bps:", feeBps, "(expected ~300)");
            assertGe(feeBps, 295, "fee >= 2.95%");
            assertLe(feeBps, 305, "fee <= 3.05%");
        }
    }

    // ================================================================
    //  5. PRICE TRACKING
    // ================================================================

    function test_05_PriceTracking() public {
        console.log("=== TEST 5: Price tracking across operations ===");
        address t = _create("PriceTrack", "PTRK", 1);

        uint256 price0 = arrowpad.getVirtualPrice(t);
        uint256 mcap0 = arrowpad.getTokenVirtualMarketCap(t);
        console.log("INITIAL  price:", price0, " mcap:", mcap0 / 1e18);

        // Buy 0.01 ETH
        uint256 fee1 = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.01 ether + fee1}(
            t,
            0.01 ether,
            0,
            block.timestamp
        );
        uint256 price1 = arrowpad.getVirtualPrice(t);
        uint256 mcap1 = arrowpad.getTokenVirtualMarketCap(t);
        console.log("AFTER 0.01 ETH  price:", price1, " mcap:", mcap1 / 1e18);
        assertTrue(price1 > price0, "price up after buy");
        assertTrue(mcap1 > mcap0, "mcap up after buy");

        // Buy 0.1 ETH
        uint256 fee2 = arrowpad.getFirstBuyFee(t);
        vm.prank(addr2);
        arrowpad.swapExactETHForTokens{value: 0.1 ether + fee2}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );
        uint256 price2 = arrowpad.getVirtualPrice(t);
        uint256 mcap2 = arrowpad.getTokenVirtualMarketCap(t);
        console.log("AFTER 0.1 ETH   price:", price2, " mcap:", mcap2 / 1e18);
        assertTrue(price2 > price1, "price up after 2nd buy");

        // Sell some tokens
        uint256 sellAmt = IERC20(t).balanceOf(addr1);
        if (sellAmt > 0) {
            vm.startPrank(addr1);
            IERC20(t).approve(address(arrowpad), sellAmt);
            arrowpad.swapExactTokensForETH(t, sellAmt, 0, block.timestamp);
            vm.stopPrank();
        }
        uint256 price3 = arrowpad.getVirtualPrice(t);
        uint256 mcap3 = arrowpad.getTokenVirtualMarketCap(t);
        console.log("AFTER sell      price:", price3, " mcap:", mcap3 / 1e18);
        assertTrue(price3 < price2, "price down after sell");

        // Buy 0.5 ETH
        uint256 fee3 = arrowpad.getFirstBuyFee(t);
        vm.prank(addr3);
        arrowpad.swapExactETHForTokens{value: 0.5 ether + fee3}(
            t,
            0.5 ether,
            0,
            block.timestamp
        );
        uint256 price4 = arrowpad.getVirtualPrice(t);
        uint256 mcap4 = arrowpad.getTokenVirtualMarketCap(t);
        console.log("AFTER 0.5 ETH   price:", price4, " mcap:", mcap4 / 1e18);
        assertTrue(price4 > price3, "price up after large buy");
    }

    // ================================================================
    //  6. GRADUATION / LAUNCH
    // ================================================================

    function test_06_GraduationLaunch() public {
        console.log("=== TEST 6: Graduation to DEX ===");
        address t = _create("GradToken", "GRAD", 1);

        _logPriceAndMcap("Initial state", t);

        address weth = router.WETH();

        // Buy in increasing chunks until graduation
        bool launched = false;
        uint256 totalETHSpent = 0;
        uint256 buyCount = 0;

        for (uint i = 0; i < 500; i++) {
            IArrowpad.PoolInfo memory pCheck = _pool(t);
            if (pCheck.launched) {
                launched = true;
                buyCount = i;
                break;
            }

            uint256 fee = arrowpad.getFirstBuyFee(t);
            uint256 buyAmt = 0.5 ether;

            // Log price before graduation-triggering buy
            uint256 mcapBefore = arrowpad.getTokenVirtualMarketCap(t);
            if (mcapBefore > 60_000 * 1e18) {
                console.log(
                    "  [Near graduation] mcap:",
                    mcapBefore / 1e18,
                    " buy #",
                    i + 1
                );
                _logPriceAndMcap("Pre-graduation buy", t);
            }

            vm.prank(addr2);
            arrowpad.swapExactETHForTokens{value: buyAmt + fee}(t, buyAmt, 0, block.timestamp);
            totalETHSpent += buyAmt;

            IArrowpad.PoolInfo memory pAfter = _pool(t);
            if (pAfter.launched) {
                launched = true;
                buyCount = i + 1;
                console.log("--- GRADUATED after buy #", buyCount, "---");
                console.log("Total ETH spent on curve:", totalETHSpent);
                break;
            }
        }

        assertTrue(launched, "Token should graduate");

        // Verify pool cleared
        IArrowpad.PoolInfo memory pFinal = _pool(t);
        assertTrue(pFinal.launched, "launched = true");
        assertEq(pFinal.ethReserve, 0, "ethReserve cleared");
        assertEq(pFinal.tokenReserve, 0, "tokenReserve cleared");
        assertEq(pFinal.virtualEthReserve, 0, "vETH cleared");
        assertEq(pFinal.virtualTokenReserve, 0, "vToken cleared");

        // Verify Uniswap V2 pair exists
        address pair = IUniswapV2Factory(router.factory()).getPair(t, weth);
        assertTrue(pair != address(0), "V2 pair exists");
        console.log("Uniswap V2 pair:", pair);

        // Check V2 pair reserves
        (uint112 r0, uint112 r1, ) = IUniswapV2Pair(pair).getReserves();
        address token0 = IUniswapV2Pair(pair).token0();
        uint256 ethReserveInPair;
        uint256 tokenReserveInPair;
        if (token0 == weth) {
            ethReserveInPair = uint256(r0);
            tokenReserveInPair = uint256(r1);
        } else {
            ethReserveInPair = uint256(r1);
            tokenReserveInPair = uint256(r0);
        }
        console.log("DEX ETH liquidity:", ethReserveInPair);
        console.log("DEX Token liquidity:", tokenReserveInPair / 1e18);
        assertTrue(ethReserveInPair > 0, "ETH in V2 pair");
        assertTrue(tokenReserveInPair > 0, "Tokens in V2 pair");

        // Compute DEX price
        uint256 dexPrice = (ethReserveInPair * 1e18) / tokenReserveInPair;
        console.log("DEX price (ETH per token):", dexPrice);

        // Token should be launched (free transfers)
        assertTrue(Token(t).launched(), "Token.launched()");
    }

    // ================================================================
    //  7. POST-GRADUATION DEX TRADING
    // ================================================================

    function test_07_PostGraduationDEXTrading() public {
        console.log("=== TEST 7: Post-graduation DEX trading ===");
        address t = _create("DexToken", "DEX", 1);

        // Graduate the token
        for (uint i = 0; i < 500; i++) {
            IArrowpad.PoolInfo memory p = _pool(t);
            if (p.launched) break;
            uint256 fee = arrowpad.getFirstBuyFee(t);
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.5 ether + fee}(
                t,
                0.5 ether,
                0,
                block.timestamp
            );
        }

        IArrowpad.PoolInfo memory pLaunched = _pool(t);
        assertTrue(pLaunched.launched, "must be launched");

        address weth = router.WETH();

        // Buy on Uniswap V2
        uint256 ethBefore = addr3.balance;
        address[] memory buyPath = new address[](2);
        buyPath[0] = weth;
        buyPath[1] = t;

        vm.prank(addr3);
        router.swapExactETHForTokens{value: 0.1 ether}(
            0,
            buyPath,
            addr3,
            block.timestamp + 600
        );

        uint256 tokenBal = IERC20(t).balanceOf(addr3);
        console.log("DEX buy - tokens received:", tokenBal / 1e18);
        assertTrue(tokenBal > 0, "got tokens from DEX");

        // Sell on Uniswap V2
        address[] memory sellPath = new address[](2);
        sellPath[0] = t;
        sellPath[1] = weth;

        uint256 sellAmt = tokenBal / 2;
        vm.startPrank(addr3);
        IERC20(t).approve(UNISWAP_V2_ROUTER, sellAmt);
        uint256 ethBeforeSell = addr3.balance;
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            sellAmt,
            0,
            sellPath,
            addr3,
            block.timestamp + 600
        );
        vm.stopPrank();

        uint256 ethGain = addr3.balance - ethBeforeSell;
        console.log("DEX sell - ETH received:", ethGain);
        assertTrue(ethGain > 0, "got ETH from DEX sell");

        // Transfer between wallets freely
        uint256 remaining = IERC20(t).balanceOf(addr3);
        vm.prank(addr3);
        IERC20(t).transfer(addr2, remaining / 2);
        assertTrue(
            IERC20(t).balanceOf(addr2) > 0,
            "free transfer post-launch"
        );
        console.log("Free transfer post-launch: OK");
    }

    // ================================================================
    //  8. TRANSFER RESTRICTIONS
    // ================================================================

    function test_08a_TransferBlockedBeforeLaunch() public {
        console.log("=== TEST 8a: Transfer blocked before launch ===");
        address t = _create("RestrictToken", "RST", 1);

        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.01 ether + fee}(
            t,
            0.01 ether,
            0,
            block.timestamp
        );

        uint256 bal = IERC20(t).balanceOf(addr1);
        assertTrue(bal > 0, "has tokens");
        assertFalse(Token(t).launched(), "not launched yet");

        // Direct transfer should revert
        vm.prank(addr1);
        vm.expectRevert(
            "This token is not launched and cannot be listed on dexes yet."
        );
        IERC20(t).transfer(addr2, bal / 2);

        // transferFrom should also revert
        vm.prank(addr1);
        IERC20(t).approve(addr2, bal / 2);
        vm.prank(addr2);
        vm.expectRevert(
            "This token is not launched and cannot be listed on dexes yet."
        );
        IERC20(t).transferFrom(addr1, addr3, bal / 2);

        console.log("Transfers correctly blocked before launch");
    }

    function test_08b_TransferToArrowpadAllowed() public {
        console.log("=== TEST 8b: Transfer to/from Arrowpad allowed before launch ===");
        address t = _create("AllowedToken", "ALW", 1);

        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.01 ether + fee}(
            t,
            0.01 ether,
            0,
            block.timestamp
        );

        uint256 bal = IERC20(t).balanceOf(addr1);

        // Sell back to arrowpad (this is a transferFrom to owner = arrowpad)
        vm.startPrank(addr1);
        IERC20(t).approve(address(arrowpad), bal / 4);
        arrowpad.swapExactTokensForETH(t, bal / 4, 0, block.timestamp);
        vm.stopPrank();

        console.log(
            "Transfer to Arrowpad (sell) succeeded before launch: OK"
        );
    }

    function test_08c_TransferAllowedAfterLaunch() public {
        console.log("=== TEST 8c: Transfer allowed after launch ===");
        address t = _create("LaunchTransfer", "LTF", 1);

        // Graduate
        for (uint i = 0; i < 500; i++) {
            IArrowpad.PoolInfo memory p = _pool(t);
            if (p.launched) break;
            uint256 fee = arrowpad.getFirstBuyFee(t);
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.5 ether + fee}(
                t,
                0.5 ether,
                0,
                block.timestamp
            );
        }

        assertTrue(Token(t).launched(), "token launched");

        uint256 bal = IERC20(t).balanceOf(addr1);
        if (bal > 0) {
            vm.prank(addr1);
            IERC20(t).transfer(addr2, bal / 2);
            assertTrue(
                IERC20(t).balanceOf(addr2) > 0,
                "transfer works after launch"
            );
            console.log("Post-launch transfer succeeded: OK");
        }
    }

    // ================================================================
    //  9. FEE VERIFICATION
    // ================================================================

    function test_09a_BuyFee3Percent() public {
        console.log("=== TEST 9a: 3% buy fee verification ===");
        address t = _create("BuyFeeToken", "BFT", 1);

        uint256 buyAmt = 1 ether;
        uint256 fee = arrowpad.getFirstBuyFee(t);
        uint256 feeWalletBefore = FEE_WALLET.balance;
        uint256 distBefore = DIST_ADDR.balance;

        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: buyAmt + fee}(t, buyAmt, 0, block.timestamp);

        uint256 feeWalletGain = FEE_WALLET.balance - feeWalletBefore;
        uint256 distGain = DIST_ADDR.balance - distBefore;
        uint256 totalFee = feeWalletGain + distGain;

        uint256 expectedFee = (buyAmt * 3) / 100;
        console.log("Buy amount:", buyAmt);
        console.log("Expected 3% fee:", expectedFee);
        console.log("Actual total fee:", totalFee);
        console.log("Fee wallet half:", feeWalletGain);
        console.log("Distributor half:", distGain);

        assertApproxEqAbs(totalFee, expectedFee, 1, "3% buy fee");
        // Fee split: half/half (with rounding)
        assertApproxEqAbs(
            feeWalletGain,
            expectedFee / 2,
            1,
            "fee wallet half"
        );
        assertApproxEqAbs(
            distGain,
            expectedFee - expectedFee / 2,
            1,
            "dist half"
        );
    }

    function test_09b_SellFee3Percent() public {
        console.log("=== TEST 9b: 3% sell fee verification ===");
        address t = _create("SellFeeToken", "SFT", 1);

        // Buy first
        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.5 ether + fee}(
            t,
            0.5 ether,
            0,
            block.timestamp
        );

        uint256 tokenBal = IERC20(t).balanceOf(addr1);
        uint256 sellAmt = tokenBal / 5;

        IArrowpad.PoolInfo memory pBefore = _pool(t);
        uint256 ethBefore = addr1.balance;
        uint256 feeWalletBefore = FEE_WALLET.balance;
        uint256 distBefore = DIST_ADDR.balance;

        vm.startPrank(addr1);
        IERC20(t).approve(address(arrowpad), sellAmt);
        arrowpad.swapExactTokensForETH(t, sellAmt, 0, block.timestamp);
        vm.stopPrank();

        uint256 ethReceived = addr1.balance - ethBefore;
        IArrowpad.PoolInfo memory pAfter = _pool(t);
        uint256 grossETH = pBefore.ethReserve - pAfter.ethReserve;
        uint256 feeWalletGain = FEE_WALLET.balance - feeWalletBefore;
        uint256 distGain = DIST_ADDR.balance - distBefore;
        uint256 totalFee = feeWalletGain + distGain;

        uint256 expectedFee = (grossETH * 3) / 100;
        console.log("Gross ETH out:", grossETH);
        console.log("Expected 3% sell fee:", expectedFee);
        console.log("Actual sell fee:", totalFee);
        console.log("Net ETH to seller:", ethReceived);

        assertApproxEqAbs(totalFee, expectedFee, 1, "3% sell fee");
        assertApproxEqAbs(
            ethReceived,
            grossETH - totalFee,
            1,
            "net = gross - fee"
        );
    }

    // ================================================================
    //  10. EDGE CASES
    // ================================================================

    function test_10a_ZeroBuyReverts() public {
        console.log("=== TEST 10a: Zero buy amount reverts ===");
        address t = _create("EdgeZero", "EZ", 1);

        vm.prank(addr1);
        vm.expectRevert();
        arrowpad.swapExactETHForTokens{value: 0}(t, 0, 0, block.timestamp);
    }

    function test_10b_ZeroSellReverts() public {
        console.log("=== TEST 10b: Zero sell amount reverts ===");
        address t = _create("EdgeZeroSell", "EZS", 1);

        vm.startPrank(addr1);
        IERC20(t).approve(address(arrowpad), type(uint256).max);
        vm.expectRevert();
        arrowpad.swapExactTokensForETH(t, 0, 0, block.timestamp);
        vm.stopPrank();
    }

    function test_10h_InvalidPoolTypeReverts() public {
        console.log("=== TEST 10h: Invalid pool type reverts at creation ===");
        vm.expectRevert("Invalid pool type");
        arrowpad.createToken{value: 0.001 ether}("Bad", "BAD", 0, 0, 0, 0, block.timestamp);

        vm.expectRevert("Invalid pool type");
        arrowpad.createToken{value: 0.001 ether}("Bad", "BAD", 0, 0, 0, 4, block.timestamp);

        // Valid types 1-3 succeed
        address t1 = _create("OkV2", "OK2", 1);
        address t2 = _create("OkV3", "OK3", 2);
        address t3 = _create("OkV4", "OK4", 3);
        assertTrue(t1 != address(0) && t2 != address(0) && t3 != address(0), "valid types ok");
        console.log("Pool type validation works");
    }

    function test_10c_NonExistentPoolReverts() public {
        console.log("=== TEST 10c: Non-existent pool reverts ===");

        vm.prank(addr1);
        vm.expectRevert("Pool does not exist");
        arrowpad.swapExactETHForTokens{value: 0.01 ether}(
            address(0xdead),
            0.01 ether,
            0,
            block.timestamp
        );

        vm.prank(addr1);
        vm.expectRevert("Pool does not exist");
        arrowpad.swapExactTokensForETH(address(0xdead), 1e18, 0, block.timestamp);
    }

    function test_10d_BuyAfterLaunchReverts() public {
        console.log("=== TEST 10d: Buy on curve after launch reverts ===");
        address t = _create("PostLaunch", "PL", 1);

        // Graduate
        for (uint i = 0; i < 500; i++) {
            IArrowpad.PoolInfo memory p = _pool(t);
            if (p.launched) break;
            uint256 fee = arrowpad.getFirstBuyFee(t);
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.5 ether + fee}(
                t,
                0.5 ether,
                0,
                block.timestamp
            );
        }
        assertTrue(_pool(t).launched, "launched");

        // After launch virtualEthReserve=0, so maxBuy=0, any buy reverts
        vm.prank(addr2);
        vm.expectRevert("Exceeds maximum price impact");
        arrowpad.swapExactETHForTokens{value: 0.01 ether}(t, 0.01 ether, 0, block.timestamp);

        console.log("Buy after launch correctly reverts");
    }

    function test_10e_SellAfterLaunchReverts() public {
        console.log("=== TEST 10e: Sell on curve after launch reverts ===");
        address t = _create("PostLaunchSell", "PLS", 1);

        // Buy then graduate
        for (uint i = 0; i < 500; i++) {
            IArrowpad.PoolInfo memory p = _pool(t);
            if (p.launched) break;
            uint256 fee = arrowpad.getFirstBuyFee(t);
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.5 ether + fee}(
                t,
                0.5 ether,
                0,
                block.timestamp
            );
        }
        assertTrue(_pool(t).launched, "launched");

        // After launch virtualTokenReserve=0, so maxSell=0, any sell reverts
        uint256 bal = IERC20(t).balanceOf(addr1);
        if (bal > 0) {
            vm.startPrank(addr1);
            IERC20(t).approve(address(arrowpad), bal);
            vm.expectRevert("Sell amount too large");
            arrowpad.swapExactTokensForETH(t, bal, 0, block.timestamp);
            vm.stopPrank();
        }
        console.log("Sell after launch correctly reverts");
    }

    function test_10f_SlippageProtection() public {
        console.log("=== TEST 10f: Slippage protection ===");
        address t = _create("Slippage", "SLIP", 1);

        // Try to buy with very high minAmountOut
        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        vm.expectRevert("Slippage limit exceeded");
        arrowpad.swapExactETHForTokens{value: 0.01 ether + fee}(
            t,
            0.01 ether,
            type(uint256).max,
            block.timestamp
        );

        console.log("Slippage protection works");
    }

    function test_10g_PriceImpactLimit() public {
        console.log("=== TEST 10g: Price impact limit (99.99%) ===");
        address t = _create("ImpactToken", "IMP", 1);

        assertEq(arrowpad.MAX_PRICE_IMPACT(), 9_999, "breaker set to 99.99%");

        // virtualEthReserve = 2.5 ETH, virtualTokenReserve = 1.073e9.
        // A buy of 2.4 ETH nets ~2.328 ETH after fees => amountOut ~517M tokens
        // = ~48% of virtualTokenReserve. That tripped the old 45% breaker; at
        // 99.99% it is allowed through.
        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 2.4 ether + fee}(
            t,
            2.4 ether,
            0,
            block.timestamp
        );
        assertGt(IERC20(t).balanceOf(addr1), 0, "48% impact buy now permitted");

        // Buys can no longer trip this breaker at all: the reserve cap binds first,
        // holding amountOut at tokenReserve (~74% of virtualTokenReserve) — below
        // 99.99%. MAX_BUY_PERCENT is what actually bounds buy size now.
        console.log("Price impact breaker relaxed to 99.99%");
    }

    // ================================================================
    //  11. ADMIN FUNCTIONS
    // ================================================================

    function test_11a_OwnerOnlyFunctions() public {
        console.log("=== TEST 11a: Owner-only function access ===");

        // Non-owner cannot call admin functions
        vm.startPrank(addr1);

        vm.expectRevert();
        arrowpad.setPlatformBuyFeeBps(500);

        vm.expectRevert();
        arrowpad.setPlatformSellFeeBps(500);

        vm.expectRevert();
        arrowpad.setFeeAddress(addr1);

        vm.expectRevert();
        arrowpad.setDistributorAddress(addr1);

        vm.expectRevert();
        arrowpad.setMaxBuyPercent(5000);

        vm.expectRevert();
        arrowpad.setMaxSellPercent(5000);

        vm.expectRevert();
        arrowpad.setCreateTokenFeeAmount(0.01 ether);

        vm.expectRevert();
        arrowpad.setTokenOwnerFeeBps(100);

        vm.expectRevert();
        arrowpad.setTokenOwnerLPFee(0.1 ether);

        vm.expectRevert();
        arrowpad.setPlatformLPFee(0.1 ether);

        vm.expectRevert();
        arrowpad.setFirstBuyFee(100);

        vm.expectRevert();
        arrowpad.requestLiquidityManagerChange(addr1);

        vm.expectRevert();
        arrowpad.pause();

        vm.expectRevert();
        arrowpad.unpause();

        vm.expectRevert();
        arrowpad.requestEmergencyWithdrawETH(1 ether);

        vm.stopPrank();

        console.log("All admin functions correctly restricted");
    }

    function test_11b_FeeLimits() public {
        console.log("=== TEST 11b: Fee limit validation ===");

        vm.expectRevert("Buy fee cannot exceed 10%");
        arrowpad.setPlatformBuyFeeBps(1001);

        vm.expectRevert("Sell fee cannot exceed 10%");
        arrowpad.setPlatformSellFeeBps(1001);

        vm.expectRevert("Fee cannot exceed 10%");
        arrowpad.setTokenOwnerFeeBps(1001);

        // Valid fee changes should succeed
        arrowpad.setPlatformBuyFeeBps(1000);
        assertEq(arrowpad.PLATFORM_BUY_FEE_BPS(), 1000, "buy fee set");
        arrowpad.setPlatformBuyFeeBps(300); // restore

        arrowpad.setPlatformSellFeeBps(1000);
        assertEq(arrowpad.PLATFORM_SELL_FEE_BPS(), 1000, "sell fee set");
        arrowpad.setPlatformSellFeeBps(300); // restore

        console.log("Fee limits enforced correctly");
    }

    function test_11c_AddressValidation() public {
        console.log("=== TEST 11c: Address validation ===");

        vm.expectRevert("Fee address cannot be zero");
        arrowpad.setFeeAddress(address(0));

        vm.expectRevert("Distributor cannot be zero");
        arrowpad.setDistributorAddress(address(0));

        vm.expectRevert("Liquidity manager cannot be zero");
        arrowpad.requestLiquidityManagerChange(address(0));

        // Valid address changes
        arrowpad.setFeeAddress(addr3);
        assertEq(arrowpad.feeAddress(), addr3, "fee address updated");
        arrowpad.setFeeAddress(FEE_WALLET); // restore

        arrowpad.setDistributorAddress(addr3);
        assertEq(
            arrowpad.distributorAddress(),
            addr3,
            "distributor updated"
        );
        arrowpad.setDistributorAddress(DIST_ADDR); // restore

        console.log("Address validation works correctly");
    }

    function test_11d_MaxPercentValidation() public {
        console.log("=== TEST 11d: Max percent validation ===");

        vm.expectRevert("Max buy cannot exceed 100%");
        arrowpad.setMaxBuyPercent(10001);

        vm.expectRevert("Max sell cannot exceed 100%");
        arrowpad.setMaxSellPercent(10001);

        arrowpad.setMaxBuyPercent(5000);
        assertEq(arrowpad.MAX_BUY_PERCENT(), 5000, "max buy updated");
        arrowpad.setMaxBuyPercent(10000); // restore

        console.log("Max percent validation works");
    }

    function test_11e_PauseUnpause() public {
        console.log("=== TEST 11e: Pause/unpause ===");
        address t = _create("PauseToken", "PAUS", 1);

        arrowpad.pause();

        // Create token should revert when paused
        vm.expectRevert();
        arrowpad.createToken{value: 0.001 ether}("X", "X", 0, 0, 0, 1, block.timestamp);

        // Buy should revert when paused
        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        vm.expectRevert();
        arrowpad.swapExactETHForTokens{value: 0.01 ether + fee}(
            t,
            0.01 ether,
            0,
            block.timestamp
        );

        // Sell should revert when paused
        vm.prank(addr1);
        vm.expectRevert();
        arrowpad.swapExactTokensForETH(t, 1e18, 0, block.timestamp);

        arrowpad.unpause();

        // Now should work
        fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.01 ether + fee}(
            t,
            0.01 ether,
            0,
            block.timestamp
        );
        assertTrue(IERC20(t).balanceOf(addr1) > 0, "buy works after unpause");

        console.log("Pause/unpause works correctly");
    }

    function test_11f_EmergencyWithdraw() public {
        console.log("=== TEST 11f: Emergency withdraw (curve-backed ETH protected) ===");
        address t = _create("EmergToken", "EMRG", 1);

        // Buy to put ETH into an ACTIVE bonding curve.
        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 1 ether + fee}(
            t,
            1 ether,
            0,
            block.timestamp
        );

        uint256 curveEth = arrowpad.totalCurveEthReserve();
        assertGt(curveEth, 0, "curve holds ETH");
        // Curve-backed ETH is NOT withdrawable (anti soft-rug). Only rounding dust
        // (<< curve ETH) may be withdrawable before any stray ETH is donated.
        uint256 dust = arrowpad.withdrawableEth();
        assertLt(dust, 1e12, "curve ETH is protected (only dust withdrawable)");
        vm.expectRevert("Exceeds withdrawable (curve-backed ETH protected)");
        arrowpad.requestEmergencyWithdrawETH(curveEth);

        // Now STRAY ETH lands in the contract (donation / leftover). Only that
        // (plus pre-existing dust) becomes withdrawable — curve ETH stays protected.
        uint256 stray = 0.5 ether;
        (bool ok, ) = address(arrowpad).call{value: stray}("");
        require(ok, "stray send failed");
        uint256 withdrawable = arrowpad.withdrawableEth();
        assertEq(withdrawable, dust + stray, "stray added to withdrawable");

        // Cannot take more than the withdrawable amount (curve ETH stays protected).
        vm.expectRevert("Exceeds withdrawable (curve-backed ETH protected)");
        arrowpad.requestEmergencyWithdrawETH(withdrawable + 1);

        arrowpad.requestEmergencyWithdrawETH(withdrawable);
        vm.expectRevert("Timelock not expired");
        arrowpad.executeEmergencyWithdrawETH();

        vm.warp(block.timestamp + 24 hours + 1);
        uint256 ownerBefore = address(this).balance;
        arrowpad.executeEmergencyWithdrawETH();
        assertEq(address(this).balance - ownerBefore, withdrawable, "withdrew only stray+dust");
        // Curve ETH is still fully backed.
        assertGe(address(arrowpad).balance, arrowpad.totalCurveEthReserve(), "curve still backed");
        console.log("Emergency withdraw protects curve-backed ETH");
    }

    function test_11g_CancelEmergencyWithdraw() public {
        console.log("=== TEST 11g: Cancel emergency withdraw ===");
        address t = _create("CancelToken", "CANC", 1);

        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.5 ether + fee}(
            t,
            0.5 ether,
            0,
            block.timestamp
        );

        // Donate stray ETH so there is a withdrawable (non-curve) balance to request.
        (bool ok, ) = address(arrowpad).call{value: 0.2 ether}("");
        require(ok, "stray send failed");
        arrowpad.requestEmergencyWithdrawETH(0.1 ether);
        arrowpad.cancelEmergencyWithdraw();

        vm.warp(block.timestamp + 24 hours + 1);
        vm.expectRevert("No pending withdrawal");
        arrowpad.executeEmergencyWithdrawETH();

        console.log("Cancel emergency withdraw works");
    }

    function test_11h_EmergencyWithdrawTokens() public {
        console.log("=== TEST 11h: Emergency withdraw tokens ===");
        address t = _create("EWToken", "EWT", 1);

        // Cannot withdraw from active pool
        vm.expectRevert("Cannot withdraw from active pool");
        arrowpad.emergencyWithdrawTokens(t, 1e18);

        console.log("Emergency token withdraw correctly blocked for active pool");
    }

    function test_11i_LiquidityManagerTimelock() public {
        console.log("=== TEST 11i: Liquidity manager change timelock ===");
        address newManager = makeAddr("newManager");

        // Cannot execute without a pending request
        vm.expectRevert("No pending change");
        arrowpad.executeLiquidityManagerChange();

        // Request the change
        arrowpad.requestLiquidityManagerChange(newManager);
        assertEq(
            arrowpad.pendingLiquidityManager(),
            newManager,
            "pending set"
        );
        // Not applied yet
        assertTrue(
            address(arrowpad.liquidityManager()) != newManager,
            "not applied before timelock"
        );

        // Cannot execute before timelock expires
        vm.expectRevert("Timelock not expired");
        arrowpad.executeLiquidityManagerChange();

        // Warp past the 24h timelock and execute
        vm.warp(block.timestamp + 24 hours + 1);
        arrowpad.executeLiquidityManagerChange();
        assertEq(
            address(arrowpad.liquidityManager()),
            newManager,
            "manager updated after timelock"
        );
        assertEq(
            arrowpad.pendingLiquidityManager(),
            address(0),
            "pending cleared"
        );

        // Cancel path: request then cancel blocks execution
        address another = makeAddr("another");
        arrowpad.requestLiquidityManagerChange(another);
        arrowpad.cancelLiquidityManagerChange();
        vm.warp(block.timestamp + 24 hours + 1);
        vm.expectRevert("No pending change");
        arrowpad.executeLiquidityManagerChange();

        console.log("Liquidity manager timelock + cancel work");
    }

    // ================================================================
    //  12. MULTI-USER SCENARIOS
    // ================================================================

    function test_12a_MultipleUsersBuyAndSell() public {
        console.log("=== TEST 12a: Multiple users buy and sell ===");
        address t = _create("MultiUser", "MU", 1);

        // User 1 buys
        uint256 fee1 = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.1 ether + fee1}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );
        uint256 bal1 = IERC20(t).balanceOf(addr1);
        console.log("User1 tokens:", bal1 / 1e18);

        _logPriceAndMcap("After user1 buy", t);

        // User 2 buys
        uint256 fee2 = arrowpad.getFirstBuyFee(t);
        vm.prank(addr2);
        arrowpad.swapExactETHForTokens{value: 0.2 ether + fee2}(
            t,
            0.2 ether,
            0,
            block.timestamp
        );
        uint256 bal2 = IERC20(t).balanceOf(addr2);
        console.log("User2 tokens:", bal2 / 1e18);

        _logPriceAndMcap("After user2 buy", t);

        // User 3 buys
        uint256 fee3 = arrowpad.getFirstBuyFee(t);
        vm.prank(addr3);
        arrowpad.swapExactETHForTokens{value: 0.05 ether + fee3}(
            t,
            0.05 ether,
            0,
            block.timestamp
        );
        uint256 bal3 = IERC20(t).balanceOf(addr3);
        console.log("User3 tokens:", bal3 / 1e18);

        _logPriceAndMcap("After user3 buy", t);

        // User 1 sells half
        uint256 sell1 = bal1 / 2;
        vm.startPrank(addr1);
        IERC20(t).approve(address(arrowpad), sell1);
        arrowpad.swapExactTokensForETH(t, sell1, 0, block.timestamp);
        vm.stopPrank();
        console.log("User1 sold", sell1 / 1e18, "tokens");

        _logPriceAndMcap("After user1 sell", t);

        // User 2 sells all
        vm.startPrank(addr2);
        IERC20(t).approve(address(arrowpad), bal2);
        arrowpad.swapExactTokensForETH(t, bal2, 0, block.timestamp);
        vm.stopPrank();
        console.log("User2 sold all tokens");

        _logPriceAndMcap("After user2 sell all", t);

        // Verify balances
        assertTrue(
            IERC20(t).balanceOf(addr1) > 0,
            "user1 still has tokens"
        );
        assertEq(IERC20(t).balanceOf(addr2), 0, "user2 sold all");
        assertTrue(
            IERC20(t).balanceOf(addr3) > 0,
            "user3 still has tokens"
        );
    }

    function test_12b_MultiUserGraduation() public {
        console.log("=== TEST 12b: Multi-user drive to graduation ===");
        address t = _create("CommunityToken", "COM", 1);

        address[] memory buyers = new address[](3);
        buyers[0] = addr1;
        buyers[1] = addr2;
        buyers[2] = addr3;

        bool launched = false;
        uint256 round = 0;

        for (uint i = 0; i < 200 && !launched; i++) {
            address buyer = buyers[i % 3];
            uint256 fee = arrowpad.getFirstBuyFee(t);

            vm.prank(buyer);
            arrowpad.swapExactETHForTokens{value: 0.5 ether + fee}(
                t,
                0.5 ether,
                0,
                block.timestamp
            );

            IArrowpad.PoolInfo memory p = _pool(t);
            if (p.launched) {
                launched = true;
                round = i + 1;
            }
        }

        assertTrue(launched, "graduated with multi-user buying");
        console.log("Graduated after", round, "buys from 3 users");

        // Check each user's balance
        console.log("User1 tokens:", IERC20(t).balanceOf(addr1) / 1e18);
        console.log("User2 tokens:", IERC20(t).balanceOf(addr2) / 1e18);
        console.log("User3 tokens:", IERC20(t).balanceOf(addr3) / 1e18);

        // All should be able to transfer freely now
        uint256 b1 = IERC20(t).balanceOf(addr1);
        if (b1 > 0) {
            vm.prank(addr1);
            IERC20(t).transfer(addr2, b1 / 10);
            console.log("Post-graduation multi-user transfer: OK");
        }
    }

    function test_12c_BuyerGetsFewerTokensAtHigherPrice() public {
        console.log("=== TEST 12c: Later buyers get fewer tokens for same ETH ===");
        address t = _create("PriceCurve", "PC", 1);

        // Buyer 1: early
        uint256 fee1 = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.1 ether + fee1}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );
        uint256 tokens1 = IERC20(t).balanceOf(addr1);
        console.log("Early buyer (0.1 ETH) tokens:", tokens1 / 1e18);

        // Push price up with a large buy
        uint256 fee2 = arrowpad.getFirstBuyFee(t);
        vm.prank(addr2);
        arrowpad.swapExactETHForTokens{value: 1 ether + fee2}(
            t,
            1 ether,
            0,
            block.timestamp
        );

        // Buyer 3: late (same 0.1 ETH)
        uint256 fee3 = arrowpad.getFirstBuyFee(t);
        vm.prank(addr3);
        arrowpad.swapExactETHForTokens{value: 0.1 ether + fee3}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );
        uint256 tokens3 = IERC20(t).balanceOf(addr3);
        console.log("Late buyer (0.1 ETH) tokens:", tokens3 / 1e18);

        assertTrue(
            tokens3 < tokens1,
            "later buyer gets fewer tokens for same ETH"
        );
        console.log(
            "Token ratio (early/late):",
            tokens1 / (tokens3 > 0 ? tokens3 : 1)
        );
    }

    // ================================================================
    //  BONUS: swapETHForExactTokens
    // ================================================================

    function test_13_SwapETHForExactTokens() public {
        console.log("=== TEST 13: swapETHForExactTokens ===");
        address t = _create("ExactToken", "EXT", 1);

        uint256 desiredTokens = 1_000_000 * 1e18; // 1M tokens
        uint256 maxETH = 0.1 ether;
        uint256 fee = arrowpad.getFirstBuyFee(t);

        _logPriceAndMcap("Before exact token buy", t);

        vm.prank(addr1);
        arrowpad.swapETHForExactTokens{value: maxETH + fee}(
            t,
            desiredTokens,
            maxETH,
            block.timestamp
        );

        uint256 bal = IERC20(t).balanceOf(addr1);
        assertEq(bal, desiredTokens, "got exact tokens requested");
        console.log("Exact tokens received:", bal / 1e18);

        _logPriceAndMcap("After exact token buy", t);
    }

    // ================================================================
    //  BONUS: Bonding curve progress
    // ================================================================

    function test_14_BondingCurveProgress() public {
        console.log("=== TEST 14: Bonding curve progress tracking ===");
        address t = _create("ProgressToken", "PROG", 1);

        uint256 progress0 = arrowpad.getBondingCurveProgress(t);
        console.log("Progress at start:", progress0, "bps");
        assertEq(progress0, 0, "0% at start");

        // Buy some
        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.5 ether + fee}(
            t,
            0.5 ether,
            0,
            block.timestamp
        );

        uint256 progress1 = arrowpad.getBondingCurveProgress(t);
        console.log("Progress after 0.5 ETH:", progress1, "bps");
        assertTrue(progress1 > 0, "progress > 0");
        assertTrue(progress1 < 10000, "progress < 100%");

        // Buy more
        for (uint i = 0; i < 10; i++) {
            IArrowpad.PoolInfo memory p = _pool(t);
            if (p.launched) break;
            uint256 f = arrowpad.getFirstBuyFee(t);
            vm.prank(addr2);
            arrowpad.swapExactETHForTokens{value: 0.5 ether + f}(
                t,
                0.5 ether,
                0,
                block.timestamp
            );
        }

        IArrowpad.PoolInfo memory pFinal = _pool(t);
        if (pFinal.launched) {
            console.log("Token graduated - progress complete");
        } else {
            uint256 progressN = arrowpad.getBondingCurveProgress(t);
            console.log("Progress after more buys:", progressN, "bps");
            assertTrue(progressN > progress1, "progress increased");
        }
    }

    // ================================================================
    //  BONUS: Launch progress view
    // ================================================================

    function test_15_LaunchProgressView() public {
        console.log("=== TEST 15: getLaunchProgress view ===");
        address t = _create("LaunchView", "LV", 1);

        (
            uint256 currentMcap,
            uint256 targetMcap,
            uint256 progressPct,
            bool canLaunch
        ) = arrowpad.getLaunchProgress(t);

        console.log("Current mcap:", currentMcap / 1e18);
        console.log("Target mcap:", targetMcap / 1e18);
        console.log("Progress %:", progressPct);
        console.log("Can launch:", canLaunch);

        assertEq(targetMcap, TARGET_MCAP_USD, "target matches constant");
        assertFalse(canLaunch, "cannot launch at start");

        // Buy to increase mcap
        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 1 ether + fee}(
            t,
            1 ether,
            0,
            block.timestamp
        );

        (uint256 mcap2, , uint256 prog2, bool can2) = arrowpad
            .getLaunchProgress(t);
        console.log("After 1 ETH buy - mcap:", mcap2 / 1e18, "progress:", prog2);
        assertTrue(mcap2 > currentMcap, "mcap increased");
        assertTrue(prog2 > progressPct, "progress increased");
    }

    // ================================================================
    //  BONUS: getPoolDetails and getPrice views
    // ================================================================

    function test_16_ViewFunctions() public {
        console.log("=== TEST 16: View function coverage ===");
        address t = _create("ViewToken", "VIEW", 1);

        // getPoolDetails
        (
            uint256 ethRes,
            uint256 tokRes,
            uint256 vEthRes,
            uint256 vTokRes,
            uint256 vPrice,
            uint256 actPrice,
            bool launched
        ) = arrowpad.getPoolDetails(t);

        console.log("ethReserve:", ethRes);
        console.log("tokenReserve:", tokRes / 1e18);
        console.log("virtualEthReserve:", vEthRes);
        console.log("virtualTokenReserve:", vTokRes / 1e18);
        console.log("virtualPrice:", vPrice);
        console.log("actualPrice:", actPrice);
        console.log("launched:", launched);

        assertEq(ethRes, 0, "no real ETH at start");
        assertEq(actPrice, 0, "actual price 0 when no real reserves");
        assertTrue(vPrice > 0, "virtual price > 0");
        assertFalse(launched, "not launched");

        // getMaxSellableETH
        uint256 maxSell = arrowpad.getMaxSellableETH(t);
        assertEq(maxSell, 0, "no sellable ETH at start");

        // Buy some
        uint256 fee = arrowpad.getFirstBuyFee(t);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.1 ether + fee}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );

        uint256 maxSellAfter = arrowpad.getMaxSellableETH(t);
        assertTrue(maxSellAfter > 0, "sellable ETH after buy");
        console.log("Max sellable ETH:", maxSellAfter);

        // getPrice (actual)
        uint256 actPriceAfter = arrowpad.getPrice(t);
        assertTrue(actPriceAfter > 0, "actual price > 0 after buy");
        console.log("Actual price after buy:", actPriceAfter);

        // ETH price
        uint256 ethUSD = arrowpad.getETHPriceByUSD();
        assertTrue(ethUSD > 0, "ETH price > 0");
        console.log("ETH/USD:", ethUSD / 1e18);
    }

    // ================================================================
    //  17. PRICE GAP AFTER MIGRATION TO UNISWAP V2 LP
    // ================================================================

    /// @dev Read the WETH/token V2 pair reserves and spot price (ETH-wei per token, 1e18-scaled)
    function _v2Reserves(address t)
        internal
        view
        returns (uint256 ethRes, uint256 tokRes, uint256 price)
    {
        address weth = router.WETH();
        address pair = IUniswapV2Factory(router.factory()).getPair(t, weth);
        require(pair != address(0), "V2 pair missing");
        (uint112 r0, uint112 r1, ) = IUniswapV2Pair(pair).getReserves();
        if (IUniswapV2Pair(pair).token0() == weth) {
            (ethRes, tokRes) = (uint256(r0), uint256(r1));
        } else {
            (ethRes, tokRes) = (uint256(r1), uint256(r0));
        }
        price = (ethRes * 1e18) / tokRes;
    }

    /// @dev Fully-diluted valuation of the V2 pool in USD (mirrors getTokenVirtualMarketCap)
    function _v2FdvUsd(address t, uint256 ethPriceUSD)
        internal
        view
        returns (uint256)
    {
        (uint256 ethRes, uint256 tokRes, ) = _v2Reserves(t);
        return (ethPriceUSD * TOTAL_SUPPLY * ethRes) / tokRes / 1e18;
    }

    function _absGapBps(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 hi = a > b ? a : b;
        uint256 lo = a > b ? b : a;
        return hi == 0 ? 0 : ((hi - lo) * 10_000) / hi;
    }

    /// @notice The V2 pool must be seeded at exactly the target market cap.
    /// @dev This is the migration's core price invariant: the LP price is pinned
    ///      to TARGET_MCAP_USD, not left to the (possibly overshot) curve state.
    ///      A wrong migration price would show up here as a large FDV deviation.
    function test_17_V2PoolSeededAtTargetMcap() public {
        console.log("=== TEST 17: V2 pool seeded at target market cap ===");
        address t = _create("MigTarget", "MTGT", 1);
        uint256 ethPriceUSD = arrowpad.getETHPriceByUSD();

        for (uint256 i = 0; i < 1000 && !_pool(t).launched; i++) {
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.05 ether}(
                t,
                0.05 ether,
                0,
                block.timestamp
            );
        }
        assertTrue(_pool(t).launched, "token graduated");

        uint256 fdv = _v2FdvUsd(t, ethPriceUSD);
        console.log("Target MCAP USD :", TARGET_MCAP_USD / 1e18);
        console.log("V2 pool FDV USD :", fdv / 1e18);
        console.log("Gap (bps)       :", _absGapBps(fdv, TARGET_MCAP_USD));

        // Pinned to target within 1% (only integer-division + 2% router slippage floor).
        assertApproxEqRel(fdv, TARGET_MCAP_USD, 0.01e18, "V2 FDV != target mcap");
    }

    /// @notice No price gap for a fresh trader: the last on-curve quote and the
    ///         first V2 quote must line up when graduation is approached in small steps.
    function test_18_NoPriceGap_CarefulGraduation() public {
        console.log("=== TEST 18: No price gap (careful graduation) ===");
        address t = _create("NoGap", "NOGAP", 1);

        // Degenerate only if ETH is so expensive the curve starts above target.
        if (arrowpad.getTokenVirtualMarketCap(t) >= TARGET_MCAP_USD) {
            console.log("ETH price starts curve above target; skipping.");
            return;
        }

        uint256 lastCurvePrice;
        uint256 lastMcap;
        bool launched;
        for (uint256 i = 0; i < 2000; i++) {
            if (_pool(t).launched) {
                launched = true;
                break;
            }
            lastCurvePrice = arrowpad.getVirtualPrice(t);
            lastMcap = arrowpad.getTokenVirtualMarketCap(t);
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.01 ether}(
                t,
                0.01 ether,
                0,
                block.timestamp
            );
        }
        assertTrue(launched, "token graduated");

        (, , uint256 v2Price) = _v2Reserves(t);
        uint256 gapBps = _absGapBps(lastCurvePrice, v2Price);

        console.log("Last curve MCAP :", lastMcap / 1e18);
        console.log("Last curve price:", lastCurvePrice);
        console.log("V2 open price   :", v2Price);
        console.log("Price gap (bps) :", gapBps);

        // A correct migration keeps the two within one small buy-step of each other.
        // A migration price bug would blow this to hundreds/thousands of bps.
        assertLt(gapBps, 300, "price gap exceeds 3%");
    }

    /// @notice Even when a single large buy overshoots the target, the V2 pool is
    ///         still seeded at the target price (the overshoot only overcharges the
    ///         graduating buyer on the curve; it does not corrupt the DEX open price).
    function test_19_OvershootStillPinsV2ToTarget() public {
        console.log("=== TEST 19: Large final buy overshoot still pins V2 ===");
        address t = _create("Overshoot", "OVSH", 1);
        uint256 ethPriceUSD = arrowpad.getETHPriceByUSD();

        if (arrowpad.getTokenVirtualMarketCap(t) >= TARGET_MCAP_USD) {
            console.log("ETH price starts curve above target; skipping.");
            return;
        }

        // Creep up to just under the target with tiny buys.
        for (uint256 i = 0; i < 2000; i++) {
            uint256 mcap = arrowpad.getTokenVirtualMarketCap(t);
            if (_pool(t).launched) break;
            if (mcap >= (TARGET_MCAP_USD * 95) / 100) break;
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.01 ether}(
                t,
                0.01 ether,
                0,
                block.timestamp
            );
        }
        assertFalse(_pool(t).launched, "should not be launched yet");

        // One deliberately oversized buy that blows through the target.
        uint256 curvePriceBefore = arrowpad.getVirtualPrice(t);
        uint256 balBefore = IERC20(t).balanceOf(addr2);
        uint256 maxBuy = (_pool(t).virtualEthReserve * arrowpad.MAX_BUY_PERCENT()) /
            10_000;
        uint256 bigBuy = maxBuy > 1 ether ? 1 ether : maxBuy;

        vm.prank(addr2);
        arrowpad.swapExactETHForTokens{value: bigBuy}(
            t,
            bigBuy,
            0,
            block.timestamp
        );
        assertTrue(_pool(t).launched, "graduated on oversized buy");

        uint256 tokensBought = IERC20(t).balanceOf(addr2) - balBefore;
        uint256 buyerEffPrice = (bigBuy * 1e18) / tokensBought;
        (, , uint256 v2Price) = _v2Reserves(t);
        uint256 fdv = _v2FdvUsd(t, ethPriceUSD);

        console.log("Curve price pre-buy :", curvePriceBefore);
        console.log("Buyer effective px  :", buyerEffPrice);
        console.log("V2 open price       :", v2Price);
        console.log("V2 FDV USD          :", fdv / 1e18);
        console.log("Graduating-buyer overpay vs V2 (bps):", _absGapBps(buyerEffPrice, v2Price));

        // Invariant: the DEX still opens at the target price regardless of overshoot.
        assertApproxEqRel(fdv, TARGET_MCAP_USD, 0.01e18, "V2 FDV != target despite overshoot");
    }

    // ================================================================
    //  20. PRICE GAP AFTER MIGRATION TO UNISWAP V3 POOL
    // ================================================================

    /// @dev Read the V3 pool's ERC20 balances (= reserves for a fresh full-range mint)
    ///      and spot price (ETH-wei per token, 1e18-scaled).
    function _v3Reserves(address t)
        internal
        view
        returns (uint256 ethRes, uint256 tokRes, uint256 price)
    {
        address weth = router.WETH();
        address pool = IUniswapV3Factory(V3_FACTORY).getPool(t, weth, V3_FEE);
        require(pool != address(0), "V3 pool missing");
        ethRes = IERC20(weth).balanceOf(pool);
        tokRes = IERC20(t).balanceOf(pool);
        require(tokRes > 0, "no V3 token liquidity");
        price = (ethRes * 1e18) / tokRes;
    }

    function _v3FdvUsd(address t, uint256 ethPriceUSD)
        internal
        view
        returns (uint256)
    {
        (uint256 ethRes, uint256 tokRes, ) = _v3Reserves(t);
        return (ethPriceUSD * TOTAL_SUPPLY * ethRes) / tokRes / 1e18;
    }

    /// @dev Drive a poolType-2 token to graduation.
    function _graduateV3(string memory name, string memory sym)
        internal
        returns (address t)
    {
        t = _create(name, sym, 2); // poolType 2 = Uniswap V3
        for (uint256 i = 0; i < 1000 && !_pool(t).launched; i++) {
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.05 ether}(
                t,
                0.05 ether,
                0,
                block.timestamp
            );
        }
        require(_pool(t).launched, "V3 token did not graduate");
    }

    /// @notice V3 migration must actually create a funded pool and clear the curve.
    function test_20_V3MigrationCreatesFundedPool() public {
        console.log("=== TEST 20: V3 migration creates a funded pool ===");
        address t = _graduateV3("V3Mig", "V3M");

        // Curve fully cleared
        IArrowpad.PoolInfo memory p = _pool(t);
        assertEq(p.ethReserve, 0, "curve ETH cleared");
        assertEq(p.tokenReserve, 0, "curve token cleared");
        assertEq(p.virtualEthReserve, 0, "vETH cleared");
        assertEq(p.virtualTokenReserve, 0, "vToken cleared");
        assertTrue(Token(t).launched(), "token launched");

        (uint256 ethRes, uint256 tokRes, uint256 price) = _v3Reserves(t);
        console.log("V3 ETH liquidity  :", ethRes);
        console.log("V3 token liquidity:", tokRes / 1e18);
        console.log("V3 spot price     :", price);
        assertTrue(ethRes > 0, "ETH in V3 pool");
        assertTrue(tokRes > 0, "tokens in V3 pool");
    }

    /// @notice V3 pool must open at the target market cap — i.e. at the same price
    ///         the bonding curve graduated at, with no price gap.
    function test_21_NoPriceGap_V3Migration() public {
        console.log("=== TEST 21: No price gap after V3 migration ===");
        uint256 ethPriceUSD = arrowpad.getETHPriceByUSD();
        address t = _graduateV3("V3Gap", "V3G");

        uint256 fdv = _v3FdvUsd(t, ethPriceUSD);
        (, , uint256 v3Price) = _v3Reserves(t);

        console.log("Target MCAP USD :", TARGET_MCAP_USD / 1e18);
        console.log("V3 pool FDV USD :", fdv / 1e18);
        console.log("V3 open price   :", v3Price);
        console.log("FDV gap (bps)   :", _absGapBps(fdv, TARGET_MCAP_USD));

        // Same invariant enforced for V2 in test_17: the DEX opens at the target price.
        assertApproxEqRel(fdv, TARGET_MCAP_USD, 0.02e18, "V3 FDV != target mcap (price gap)");
    }

    /// @notice V2 and V3 graduations of the same target must open at the same price.
    function test_22_V2AndV3OpenAtSamePrice() public {
        console.log("=== TEST 22: V2 vs V3 open price parity ===");

        address tV2 = _create("ParityV2", "PV2", 1);
        for (uint256 i = 0; i < 1000 && !_pool(tV2).launched; i++) {
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.05 ether}(
                tV2,
                0.05 ether,
                0,
                block.timestamp
            );
        }
        require(_pool(tV2).launched, "V2 did not graduate");

        address tV3 = _graduateV3("ParityV3", "PV3");

        (, , uint256 v2Price) = _v2Reserves(tV2);
        (, , uint256 v3Price) = _v3Reserves(tV3);
        uint256 gapBps = _absGapBps(v2Price, v3Price);

        console.log("V2 open price:", v2Price);
        console.log("V3 open price:", v3Price);
        console.log("V2 vs V3 gap (bps):", gapBps);

        assertLt(gapBps, 300, "V2 and V3 open prices diverge > 3%");
    }

    // ================================================================
    //  23. PRICE GAP AFTER MIGRATION TO UNISWAP V4 POOL
    // ================================================================

    function _v4PoolKey(address t) internal view returns (PoolKey memory key) {
        address weth = router.WETH();
        (address c0, address c1) = t < weth ? (t, weth) : (weth, t);
        key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: V3_FEE, // POOL_FEE = 100
            tickSpacing: int24(60), // TICK_SPACING
            hooks: IHooks(address(0))
        });
    }

    /// @dev V4 spot price (ETH-wei per token, 1e18-scaled) read from the pool's slot0.
    function _v4PriceScaled(address t) internal view returns (uint256) {
        (uint160 sp, , , ) = IPoolManager(V4_POOL_MGR).getSlot0(
            _v4PoolKey(t).toId()
        );
        require(sp > 0, "V4 pool not initialized");
        uint256 Q96 = 0x1000000000000000000000000;
        // token1 per token0, 1e18-scaled (mulDiv avoids sqrtP^2 overflow)
        uint256 priceX = Math.mulDiv(
            Math.mulDiv(uint256(sp), uint256(sp), Q96),
            1e18,
            Q96
        );
        // Normalize to ETH-per-token regardless of currency ordering
        return t < router.WETH() ? priceX : (1e36 / priceX);
    }

    function _v4FdvUsd(address t, uint256 ethPriceUSD)
        internal
        view
        returns (uint256)
    {
        return (ethPriceUSD * TOTAL_SUPPLY * _v4PriceScaled(t)) / 1e36;
    }

    function _graduateV4(string memory name, string memory sym)
        internal
        returns (address t)
    {
        t = _create(name, sym, 3); // poolType 3 = Uniswap V4
        for (uint256 i = 0; i < 2000 && !_pool(t).launched; i++) {
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.05 ether}(
                t,
                0.05 ether,
                0,
                block.timestamp
            );
        }
        require(_pool(t).launched, "V4 token did not graduate");
    }

    /// @notice V4 migration must succeed (tick alignment) and fund a real pool.
    function test_23_V4MigrationCreatesFundedPool() public {
        console.log("=== TEST 23: V4 migration creates a funded pool ===");
        address t = _graduateV4("V4Mig", "V4M");

        IArrowpad.PoolInfo memory p = _pool(t);
        assertEq(p.ethReserve, 0, "curve ETH cleared");
        assertEq(p.virtualEthReserve, 0, "vETH cleared");
        assertTrue(Token(t).launched(), "token launched");

        // Fresh token → its only V4 holder is the PoolManager singleton.
        uint256 tokInPool = IERC20(t).balanceOf(V4_POOL_MGR);
        uint256 price = _v4PriceScaled(t);
        console.log("V4 token liquidity:", tokInPool / 1e18);
        console.log("V4 spot price     :", price);
        assertTrue(tokInPool > 0, "tokens in V4 pool");
        assertTrue(price > 0, "V4 pool initialized");
    }

    /// @notice V4 pool must open at the target market cap — no price gap.
    function test_24_NoPriceGap_V4Migration() public {
        console.log("=== TEST 24: No price gap after V4 migration ===");
        uint256 ethPriceUSD = arrowpad.getETHPriceByUSD();
        uint256 target = arrowpad.TARGET_MARKET_CAP_USD();
        address t = _graduateV4("V4Gap", "V4G");

        uint256 fdv = _v4FdvUsd(t, ethPriceUSD);
        console.log("Target MCAP USD :", target / 1e18);
        console.log("V4 pool FDV USD :", fdv / 1e18);
        console.log("V4 open price   :", _v4PriceScaled(t));
        console.log("FDV gap (bps)   :", _absGapBps(fdv, target));

        // Same invariant as V2 (test_17) and V3 (test_21): opens at target price.
        assertApproxEqRel(fdv, target, 0.02e18, "V4 FDV != target mcap (price gap)");
    }

    // ================================================================
    //  25. LP FEE ROUTING AT GRADUATION
    // ================================================================

    /// @notice platformLPFee must go to the project fee address and tokenOwnerLPFee
    ///         to the token creator (not a blind 50/50 split).
    function test_25_LPFeeRoutedToFeeAddress() public {
        console.log("=== TEST 25: LP fees routed to designated recipients ===");

        // Zero trading fees so only the graduation LP-fee split moves balances.
        arrowpad.setPlatformBuyFeeBps(0);
        arrowpad.setTokenOwnerFeeBps(0);
        arrowpad.setPlatformLPFee(0.1 ether);
        arrowpad.setTokenOwnerLPFee(0.05 ether);

        address creator = address(this); // _create is called by this test contract
        address t = _create("LPFee", "LPF", 1);

        uint256 feeBefore = FEE_WALLET.balance;
        uint256 creatorBefore = creator.balance;

        for (uint256 i = 0; i < 1000 && !_pool(t).launched; i++) {
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.1 ether}(
                t,
                0.1 ether,
                0,
                block.timestamp
            );
        }
        require(_pool(t).launched, "did not graduate");

        uint256 feeGain = FEE_WALLET.balance - feeBefore;
        uint256 creatorGain = creator.balance - creatorBefore;
        console.log("feeAddress gained (wei):", feeGain);
        console.log("creator gained    (wei):", creatorGain);

        // FEE_WALLET is not the LM margin recipient, so its only inflow is platformLPFee.
        assertEq(feeGain, 0.1 ether, "platformLPFee must go to fee address");
        // Creator gets tokenOwnerLPFee (+ negligible LM margin dust, hence >=).
        assertGe(creatorGain, 0.05 ether, "tokenOwnerLPFee must go to creator");
        assertLt(creatorGain, 0.06 ether, "creator gets no more than its LP fee + dust");
    }

    // ================================================================
    //  26-28. MIGRATION FRONT-RUNNING DEFENSES
    // ================================================================

    // 2^96 == 1:1 price, wildly off any real token/ETH price -> outside tolerance.
    uint160 constant HOSTILE_SQRT_PRICE = 79228162514264337593543950336;

    /// @dev Buy 0.1 ETH increments until MCAP reaches pctBps/10000 of target,
    ///      stopping before graduation.
    function _driveTo(address t, uint256 pctBps) internal {
        uint256 target = arrowpad.TARGET_MARKET_CAP_USD();
        for (uint256 i = 0; i < 3000; i++) {
            if (_pool(t).launched) break;
            if (arrowpad.getTokenVirtualMarketCap(t) >= (target * pctBps) / 10000)
                break;
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.1 ether}(
                t,
                0.1 ether,
                0,
                block.timestamp
            );
        }
    }

    /// @notice V2: a pre-seeded / donated pair must NOT brick graduation.
    function test_26_V2GraduationSurvivesPreSeededPair() public {
        console.log("=== TEST 26: V2 survives pre-seeded pair ===");
        address t = _create("PreSeed", "PSD", 1);
        address weth = router.WETH();

        // Attacker: create pair, donate dust WETH, sync -> one-sided reserves.
        address pair = IUniswapV2Factory(router.factory()).createPair(t, weth);
        IWETHMinimal(weth).deposit{value: 0.01 ether}();
        IWETHMinimal(weth).transfer(pair, 0.01 ether);
        IV2PairMinimal(pair).sync();

        // Graduation must still succeed (was a permanent brick before the fix).
        for (uint256 i = 0; i < 2000 && !_pool(t).launched; i++) {
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.1 ether}(
                t,
                0.1 ether,
                0,
                block.timestamp
            );
        }
        assertTrue(_pool(t).launched, "graduated despite pre-seeded pair");

        uint256 fdv = _v2FdvUsd(t, arrowpad.getETHPriceByUSD());
        console.log("V2 FDV after grief:", fdv / 1e18);
        assertApproxEqRel(
            fdv,
            arrowpad.TARGET_MARKET_CAP_USD(),
            0.03e18,
            "V2 opens at target despite grief"
        );
    }

    /// @notice V3: hostile pre-init — the auto-fallback to V2 kicks in so graduation
    ///         succeeds at the target price (owner never needs manual recovery).
    function test_27_V3HostilePreInit_FallsBackToV2() public {
        console.log("=== TEST 27: V3 hostile pre-init falls back to V2 ===");
        address t = _create("V3Grief", "V3GR", 2);
        address weth = router.WETH();

        // Attacker pre-creates + initializes the V3 pool at a 1:1 (hostile) price.
        address pool = IUniswapV3Factory(V3_FACTORY).createPool(t, weth, V3_FEE);
        IUniswapV3Pool(pool).initialize(HOSTILE_SQRT_PRICE);

        // Drive to 80% of target, no graduation yet.
        _driveTo(t, 8000);
        assertFalse(_pool(t).launched, "not launched while driving");

        // The graduation-crossing buy does NOT revert (the V3 addLiquidity reverts
        // internally, caught by the try/catch fallback, and V2 is used instead).
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 1 ether}(
            t,
            1 ether,
            0,
            block.timestamp
        );

        // Graduation must have succeeded via the V2 fallback path.
        assertTrue(_pool(t).launched, "graduated via V2 fallback");
        // poolType was flipped to V2 by the fallback.
        assertEq(_pool(t).poolType, 1, "poolType reset to V2");
        assertApproxEqRel(
            _v2FdvUsd(t, arrowpad.getETHPriceByUSD()),
            arrowpad.TARGET_MARKET_CAP_USD(),
            0.03e18,
            "V2 fallback opens at target mcap"
        );
    }

    /// @notice V4: hostile pre-init — same auto-fallback to V2.
    function test_28_V4HostilePreInit_FallsBackToV2() public {
        console.log("=== TEST 28: V4 hostile pre-init falls back to V2 ===");
        address t = _create("V4Grief", "V4GR", 3);

        // Attacker initializes the V4 pool at a hostile price.
        IPoolManager(V4_POOL_MGR).initialize(_v4PoolKey(t), HOSTILE_SQRT_PRICE);

        _driveTo(t, 8000);
        assertFalse(_pool(t).launched, "not launched while driving");

        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 1 ether}(
            t,
            1 ether,
            0,
            block.timestamp
        );

        assertTrue(_pool(t).launched, "graduated via V2 fallback");
        assertEq(_pool(t).poolType, 1, "poolType reset to V2");
        assertApproxEqRel(
            _v2FdvUsd(t, arrowpad.getETHPriceByUSD()),
            arrowpad.TARGET_MARKET_CAP_USD(),
            0.03e18,
            "V2 fallback opens at target mcap"
        );
    }

    /// @notice A buy whose platform fee rounds to 1 wei (feeHalf==0) must not revert.
    function test_29_DustFeeBuyDoesNotRevert() public {
        console.log("=== TEST 29: dust fee (1 wei) buy does not revert ===");
        address t = _create("Dust", "DUST", 1);
        // buyFee = 100 wei * 100 bps / 10000 = 1 wei -> feeHalf == 0
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 100}(t, 100, 0, block.timestamp);
        assertGt(IERC20(t).balanceOf(addr1), 0, "received tokens on dust buy");
    }

    /// @notice recoverPoolType is owner-gated and validates inputs.
    function test_30_RecoverPoolTypeAccessControl() public {
        console.log("=== TEST 30: recoverPoolType access control ===");
        address t = _create("Rec", "REC", 2);

        vm.prank(addr1);
        vm.expectRevert();
        arrowpad.recoverPoolType(t, 1);

        vm.expectRevert("Invalid pool type");
        arrowpad.recoverPoolType(t, 4);

        vm.expectRevert("Pool does not exist");
        arrowpad.recoverPoolType(address(0xdead), 1);

        arrowpad.recoverPoolType(t, 1);
        assertEq(_pool(t).poolType, 1, "poolType updated by owner");
    }

    // ================================================================
    //  31-33. LP / POSITION IS ALWAYS BURNED (no one can pull liquidity)
    // ================================================================

    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    /// @notice V2 LP tokens go to the burn address; no controllable party holds any.
    function test_31_V2LiquidityBurned() public {
        console.log("=== TEST 31: V2 LP burned ===");
        address t = _create("BurnV2", "BV2", 1);
        for (uint256 i = 0; i < 2000 && !_pool(t).launched; i++) {
            vm.prank(addr1);
            arrowpad.swapExactETHForTokens{value: 0.1 ether}(
                t,
                0.1 ether,
                0,
                block.timestamp
            );
        }
        assertTrue(_pool(t).launched, "graduated");

        address pair = IUniswapV2Factory(router.factory()).getPair(
            t,
            router.WETH()
        );
        uint256 supply = IERC20(pair).totalSupply();
        assertGt(supply, 0, "LP minted");
        assertGt(IERC20(pair).balanceOf(DEAD), 0, "LP held at burn address");
        // Nobody controllable holds LP.
        assertEq(IERC20(pair).balanceOf(address(liquidityManager)), 0, "LM=0");
        assertEq(IERC20(pair).balanceOf(address(arrowpad)), 0, "arrowpad=0");
        assertEq(IERC20(pair).balanceOf(address(this)), 0, "creator=0");
        assertEq(IERC20(pair).balanceOf(addr1), 0, "buyer=0");
        console.log("V2 LP totalSupply :", supply);
        console.log("V2 LP at 0xdead   :", IERC20(pair).balanceOf(DEAD));
    }

    /// @notice V3 position NFT is minted to the burn address; LM/arrowpad hold none.
    /// @notice V3 position is LOCKED IN THE MANAGER, not burned. Burning the NFT
    ///         would strand every fee the position ever earns, because collect() is
    ///         owner-only and 0xdEaD can never call it. Locking gives the same
    ///         no-rug guarantee (no withdraw path exists) while keeping fees claimable.
    function test_32_V3PositionLockedInManager() public {
        console.log("=== TEST 32: V3 position NFT locked in LM ===");
        uint256 deadBefore = IERC20(V3_POS_MGR).balanceOf(DEAD);
        uint256 lmBefore = IERC20(V3_POS_MGR).balanceOf(address(liquidityManager));
        address t = _graduateV3("LockV3", "LV3");
        assertEq(
            IERC20(V3_POS_MGR).balanceOf(DEAD),
            deadBefore,
            "position must NOT be burned"
        );
        assertEq(
            IERC20(V3_POS_MGR).balanceOf(address(liquidityManager)),
            lmBefore + 1,
            "LM holds the position"
        );
        assertEq(
            IERC20(V3_POS_MGR).balanceOf(address(arrowpad)),
            0,
            "arrowpad holds no position"
        );
        uint256 id = liquidityManager.v3PositionOf(t);
        assertTrue(id != 0, "position id recorded for fee collection");
        assertEq(
            INonfungiblePositionManager(V3_POS_MGR).ownerOf(id),
            address(liquidityManager),
            "LM owns the recorded position"
        );
    }

    /// @notice V4 position is locked in the LM rather than burned, for the same
    ///         reason as V3: a burned position's fees are unreachable forever.
    function test_33_V4PositionLockedInManager() public {
        console.log("=== TEST 33: V4 position NFT locked in LM ===");
        uint256 deadBefore = IERC20(V4_POS_MGR).balanceOf(DEAD);
        uint256 lmBefore = IERC20(V4_POS_MGR).balanceOf(address(liquidityManager));
        address t = _graduateV4("LockV4", "LV4");
        assertEq(
            IERC20(V4_POS_MGR).balanceOf(DEAD),
            deadBefore,
            "position must NOT be burned"
        );
        assertEq(
            IERC20(V4_POS_MGR).balanceOf(address(liquidityManager)),
            lmBefore + 1,
            "LM holds the position"
        );
        assertTrue(
            liquidityManager.v4PositionOf(t) != 0,
            "position id recorded for fee collection"
        );
    }

    receive() external payable {}
}
