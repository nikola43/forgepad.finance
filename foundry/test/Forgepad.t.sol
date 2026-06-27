// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {Forgepad, IForgepad} from "../src/Forgepad.sol";
import {ForgepadLiquidityManager} from "../src/ForgepadLiquidityManager.sol";
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

contract ForgepadTest is Test {
    Forgepad public forgepad;
    ForgepadLiquidityManager public liquidityManager;
    IForgepad public iForgepad;

    address public addr1;
    address public addr2;
    address public addr3;

    // Ethereum Mainnet (Uniswap)
    address constant UNISWAP_V2_ROUTER =
        0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address constant V3_POS_MGR = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
    address constant V4_POOL_MGR = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant UNIVERSAL_ROUTER =
        0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;
    address constant V4_POS_MGR = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address constant PERMIT2_ADDR =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Chainlink ETH/USD on Ethereum
    address constant DATA_FEED = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;

    address constant FEE_WALLET = 0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103;
    address constant DIST_ADDR = 0xF2917a81fF74406fbCf01c507057e101Db8f2F12;

    // Bonding curve constants (mirrored for test assertions)
    uint256 constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;
    uint256 constant VIRTUAL_ETH_INITIAL = 2.5 ether;
    uint256 constant VIRTUAL_TOKEN_INITIAL = 1_073_000_000 * 1e18;
    uint256 constant REAL_TOKEN_INITIAL = 793_100_000 * 1e18;
    uint256 constant TARGET_MCAP_USD = 10_000 * 1e18;

    IUniswapV2Router02 constant router =
        IUniswapV2Router02(UNISWAP_V2_ROUTER);

    function setUp() public {
        vm.createSelectFork("https://ethereum-rpc.publicnode.com");

        addr1 = makeAddr("addr1");
        addr2 = makeAddr("addr2");
        addr3 = makeAddr("addr3");

        vm.deal(address(this), 100_000 ether);
        vm.deal(addr1, 100_000 ether);
        vm.deal(addr2, 100_000 ether);
        vm.deal(addr3, 100_000 ether);

        liquidityManager = new ForgepadLiquidityManager(
            UNISWAP_V2_ROUTER,
            0x1F98431c8aD98523631AE4a59f267346ea31F984, // V3 Factory
            V3_POS_MGR,
            V4_POOL_MGR,
            UNIVERSAL_ROUTER,
            V4_POS_MGR,
            PERMIT2_ADDR,
            address(this),
            address(this),
            10000,
            10000
        );

        forgepad = new Forgepad(
            DATA_FEED,
            address(liquidityManager),
            FEE_WALLET,
            DIST_ADDR
        );
        iForgepad = IForgepad(address(forgepad));

        liquidityManager.setAuthorizedCaller(address(forgepad), true);

        // Set fees to 3% buy / 3% sell, uncapped buy/sell percent
        forgepad.setPlatformBuyFeePercent(3);
        forgepad.setPlatformSellFeePercent(3);
        forgepad.setMaxBuyPercent(10000);
        forgepad.setMaxSellPercent(10000);
    }

    // ================================================================
    //  HELPERS
    // ================================================================

    /// @dev Create a token via Forgepad, extract address from TokenCreated event
    function _create(
        string memory name,
        string memory sym,
        uint8 pt
    ) internal returns (address) {
        vm.recordLogs();
        forgepad.createToken{value: 0.001 ether}(name, sym, 0, 0, 0, pt, block.timestamp);
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
        forgepad.createToken{value: buyAmount + 0.001 ether}(
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
    ) internal view returns (IForgepad.PoolInfo memory) {
        return iForgepad.tokenPools(t);
    }

    /// @dev Log price and mcap for a token
    function _logPriceAndMcap(string memory label, address t) internal view {
        uint256 vPrice = forgepad.getVirtualPrice(t);
        uint256 mcap = forgepad.getTokenVirtualMarketCap(t);
        IForgepad.PoolInfo memory p = _pool(t);
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

        IForgepad.PoolInfo memory p = _pool(t);

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

        // Total supply minted to forgepad
        uint256 supply = IERC20(t).totalSupply();
        assertEq(supply, TOTAL_SUPPLY, "total supply");

        _logPriceAndMcap("After creation (no buy)", t);

        // Token count incremented
        assertEq(forgepad.tokenCount(), 1, "tokenCount");
    }

    function test_01b_CreateTokenWithInitialBuy() public {
        console.log("=== TEST 1b: Create Token (with initial buy) ===");
        uint256 buyAmt = 0.05 ether;
        address t = _createWithBuy("BetaToken", "BETA", 1, buyAmt);

        IForgepad.PoolInfo memory p = _pool(t);
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
        IForgepad.PoolInfo memory p = _pool(t);
        uint256 k = p.virtualEthReserve * p.virtualTokenReserve;
        console.log("Initial K:", k / 1e36);
        assertTrue(k > 0, "K > 0");

        // Virtual price should match ratio
        uint256 vPrice = forgepad.getVirtualPrice(t);
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
        IForgepad.PoolInfo memory p = _pool(t);

        // Use getSwapOutput to test the math
        uint256 inputETH = 0.1 ether;
        (uint256 tokensOut, uint256 impact) = forgepad.getSwapOutput(
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
        (uint256 ethOut, uint256 sellImpact) = forgepad.getSwapOutput(
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

        IForgepad.PoolInfo memory p0 = _pool(t);
        uint256 k0 = p0.virtualEthReserve * p0.virtualTokenReserve;
        console.log("K initial:", k0 / 1e36);

        // Buy 1
        uint256 fee1 = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.01 ether + fee1}(
            t,
            0.01 ether,
            0,
            block.timestamp
        );
        IForgepad.PoolInfo memory p1 = _pool(t);
        uint256 k1 = p1.virtualEthReserve * p1.virtualTokenReserve;
        console.log("K after buy 1:", k1 / 1e36);
        // K should increase (fees add to reserves)
        assertGe(k1, k0, "K non-decreasing after buy");

        // Buy 2
        uint256 fee2 = forgepad.getFirstBuyFee(t);
        vm.prank(addr2);
        forgepad.swapExactETHForTokens{value: 0.05 ether + fee2}(
            t,
            0.05 ether,
            0,
            block.timestamp
        );
        IForgepad.PoolInfo memory p2 = _pool(t);
        uint256 k2 = p2.virtualEthReserve * p2.virtualTokenReserve;
        console.log("K after buy 2:", k2 / 1e36);
        assertGe(k2, k1, "K non-decreasing after buy 2");

        // Sell
        uint256 sellAmt = IERC20(t).balanceOf(addr1) / 2;
        vm.startPrank(addr1);
        IERC20(t).approve(address(forgepad), sellAmt);
        forgepad.swapExactTokensForETH(t, sellAmt, 0, block.timestamp);
        vm.stopPrank();

        IForgepad.PoolInfo memory p3 = _pool(t);
        uint256 k3 = p3.virtualEthReserve * p3.virtualTokenReserve;
        console.log("K after sell:", k3 / 1e36);
        assertGe(k3, k2, "K non-decreasing after sell");
    }

    // ================================================================
    //  3. BUY OPERATIONS
    // ================================================================

    function test_03a_SingleBuy() public {
        console.log("=== TEST 3a: Single buy ===");
        address t = _create("BuyToken", "BUY", 1);
        _logPriceAndMcap("Before buy", t);

        uint256 buyAmt = 0.1 ether;
        uint256 fee = forgepad.getFirstBuyFee(t);
        uint256 feeWalletBefore = FEE_WALLET.balance;
        uint256 distBefore = DIST_ADDR.balance;

        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: buyAmt + fee}(t, buyAmt, 0, block.timestamp);

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

        uint256 prevPrice = forgepad.getVirtualPrice(t);
        console.log("Initial price:", prevPrice);

        for (uint256 i = 0; i < 5; i++) {
            uint256 fee = forgepad.getFirstBuyFee(t);
            vm.prank(addr1);
            forgepad.swapExactETHForTokens{value: 0.05 ether + fee}(
                t,
                0.05 ether,
                0,
                block.timestamp
            );

            uint256 newPrice = forgepad.getVirtualPrice(t);
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
        uint256 fee = forgepad.getFirstBuyFee(t);

        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: buyAmt + fee}(t, buyAmt, 0, block.timestamp);

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
        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.1 ether + fee}(
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
        IERC20(t).approve(address(forgepad), sellAmt);
        forgepad.swapExactTokensForETH(t, sellAmt, 0, block.timestamp);
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

        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.05 ether + fee}(
            t,
            0.05 ether,
            0,
            block.timestamp
        );

        uint256 tokenBal = IERC20(t).balanceOf(addr1);
        uint256 ethBefore = addr1.balance;

        vm.startPrank(addr1);
        IERC20(t).approve(address(forgepad), tokenBal);
        forgepad.swapExactTokensForETH(t, tokenBal, 0, block.timestamp);
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

        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.1 ether + fee}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );

        IForgepad.PoolInfo memory pBefore = _pool(t);
        uint256 tokenBal = IERC20(t).balanceOf(addr1);
        uint256 sellAmt = tokenBal / 10;

        uint256 ethBefore = addr1.balance;
        uint256 feeWalletBefore = FEE_WALLET.balance;
        uint256 distBefore = DIST_ADDR.balance;

        vm.startPrank(addr1);
        IERC20(t).approve(address(forgepad), sellAmt);
        forgepad.swapExactTokensForETH(t, sellAmt, 0, block.timestamp);
        vm.stopPrank();

        uint256 ethReceived = addr1.balance - ethBefore;
        IForgepad.PoolInfo memory pAfter = _pool(t);
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

        uint256 price0 = forgepad.getVirtualPrice(t);
        uint256 mcap0 = forgepad.getTokenVirtualMarketCap(t);
        console.log("INITIAL  price:", price0, " mcap:", mcap0 / 1e18);

        // Buy 0.01 ETH
        uint256 fee1 = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.01 ether + fee1}(
            t,
            0.01 ether,
            0,
            block.timestamp
        );
        uint256 price1 = forgepad.getVirtualPrice(t);
        uint256 mcap1 = forgepad.getTokenVirtualMarketCap(t);
        console.log("AFTER 0.01 ETH  price:", price1, " mcap:", mcap1 / 1e18);
        assertTrue(price1 > price0, "price up after buy");
        assertTrue(mcap1 > mcap0, "mcap up after buy");

        // Buy 0.1 ETH
        uint256 fee2 = forgepad.getFirstBuyFee(t);
        vm.prank(addr2);
        forgepad.swapExactETHForTokens{value: 0.1 ether + fee2}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );
        uint256 price2 = forgepad.getVirtualPrice(t);
        uint256 mcap2 = forgepad.getTokenVirtualMarketCap(t);
        console.log("AFTER 0.1 ETH   price:", price2, " mcap:", mcap2 / 1e18);
        assertTrue(price2 > price1, "price up after 2nd buy");

        // Sell some tokens
        uint256 sellAmt = IERC20(t).balanceOf(addr1);
        if (sellAmt > 0) {
            vm.startPrank(addr1);
            IERC20(t).approve(address(forgepad), sellAmt);
            forgepad.swapExactTokensForETH(t, sellAmt, 0, block.timestamp);
            vm.stopPrank();
        }
        uint256 price3 = forgepad.getVirtualPrice(t);
        uint256 mcap3 = forgepad.getTokenVirtualMarketCap(t);
        console.log("AFTER sell      price:", price3, " mcap:", mcap3 / 1e18);
        assertTrue(price3 < price2, "price down after sell");

        // Buy 0.5 ETH
        uint256 fee3 = forgepad.getFirstBuyFee(t);
        vm.prank(addr3);
        forgepad.swapExactETHForTokens{value: 0.5 ether + fee3}(
            t,
            0.5 ether,
            0,
            block.timestamp
        );
        uint256 price4 = forgepad.getVirtualPrice(t);
        uint256 mcap4 = forgepad.getTokenVirtualMarketCap(t);
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
            IForgepad.PoolInfo memory pCheck = _pool(t);
            if (pCheck.launched) {
                launched = true;
                buyCount = i;
                break;
            }

            uint256 fee = forgepad.getFirstBuyFee(t);
            uint256 buyAmt = 0.5 ether;

            // Log price before graduation-triggering buy
            uint256 mcapBefore = forgepad.getTokenVirtualMarketCap(t);
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
            forgepad.swapExactETHForTokens{value: buyAmt + fee}(t, buyAmt, 0, block.timestamp);
            totalETHSpent += buyAmt;

            IForgepad.PoolInfo memory pAfter = _pool(t);
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
        IForgepad.PoolInfo memory pFinal = _pool(t);
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
            IForgepad.PoolInfo memory p = _pool(t);
            if (p.launched) break;
            uint256 fee = forgepad.getFirstBuyFee(t);
            vm.prank(addr1);
            forgepad.swapExactETHForTokens{value: 0.5 ether + fee}(
                t,
                0.5 ether,
                0,
                block.timestamp
            );
        }

        IForgepad.PoolInfo memory pLaunched = _pool(t);
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

        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.01 ether + fee}(
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

    function test_08b_TransferToForgepadAllowed() public {
        console.log("=== TEST 8b: Transfer to/from Forgepad allowed before launch ===");
        address t = _create("AllowedToken", "ALW", 1);

        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.01 ether + fee}(
            t,
            0.01 ether,
            0,
            block.timestamp
        );

        uint256 bal = IERC20(t).balanceOf(addr1);

        // Sell back to forgepad (this is a transferFrom to owner = forgepad)
        vm.startPrank(addr1);
        IERC20(t).approve(address(forgepad), bal / 4);
        forgepad.swapExactTokensForETH(t, bal / 4, 0, block.timestamp);
        vm.stopPrank();

        console.log(
            "Transfer to Forgepad (sell) succeeded before launch: OK"
        );
    }

    function test_08c_TransferAllowedAfterLaunch() public {
        console.log("=== TEST 8c: Transfer allowed after launch ===");
        address t = _create("LaunchTransfer", "LTF", 1);

        // Graduate
        for (uint i = 0; i < 500; i++) {
            IForgepad.PoolInfo memory p = _pool(t);
            if (p.launched) break;
            uint256 fee = forgepad.getFirstBuyFee(t);
            vm.prank(addr1);
            forgepad.swapExactETHForTokens{value: 0.5 ether + fee}(
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
        uint256 fee = forgepad.getFirstBuyFee(t);
        uint256 feeWalletBefore = FEE_WALLET.balance;
        uint256 distBefore = DIST_ADDR.balance;

        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: buyAmt + fee}(t, buyAmt, 0, block.timestamp);

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
        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.5 ether + fee}(
            t,
            0.5 ether,
            0,
            block.timestamp
        );

        uint256 tokenBal = IERC20(t).balanceOf(addr1);
        uint256 sellAmt = tokenBal / 5;

        IForgepad.PoolInfo memory pBefore = _pool(t);
        uint256 ethBefore = addr1.balance;
        uint256 feeWalletBefore = FEE_WALLET.balance;
        uint256 distBefore = DIST_ADDR.balance;

        vm.startPrank(addr1);
        IERC20(t).approve(address(forgepad), sellAmt);
        forgepad.swapExactTokensForETH(t, sellAmt, 0, block.timestamp);
        vm.stopPrank();

        uint256 ethReceived = addr1.balance - ethBefore;
        IForgepad.PoolInfo memory pAfter = _pool(t);
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
        forgepad.swapExactETHForTokens{value: 0}(t, 0, 0, block.timestamp);
    }

    function test_10b_ZeroSellReverts() public {
        console.log("=== TEST 10b: Zero sell amount reverts ===");
        address t = _create("EdgeZeroSell", "EZS", 1);

        vm.startPrank(addr1);
        IERC20(t).approve(address(forgepad), type(uint256).max);
        vm.expectRevert();
        forgepad.swapExactTokensForETH(t, 0, 0, block.timestamp);
        vm.stopPrank();
    }

    function test_10c_NonExistentPoolReverts() public {
        console.log("=== TEST 10c: Non-existent pool reverts ===");

        vm.prank(addr1);
        vm.expectRevert("Pool does not exist");
        forgepad.swapExactETHForTokens{value: 0.01 ether}(
            address(0xdead),
            0.01 ether,
            0,
            block.timestamp
        );

        vm.prank(addr1);
        vm.expectRevert("Pool does not exist");
        forgepad.swapExactTokensForETH(address(0xdead), 1e18, 0, block.timestamp);
    }

    function test_10d_BuyAfterLaunchReverts() public {
        console.log("=== TEST 10d: Buy on curve after launch reverts ===");
        address t = _create("PostLaunch", "PL", 1);

        // Graduate
        for (uint i = 0; i < 500; i++) {
            IForgepad.PoolInfo memory p = _pool(t);
            if (p.launched) break;
            uint256 fee = forgepad.getFirstBuyFee(t);
            vm.prank(addr1);
            forgepad.swapExactETHForTokens{value: 0.5 ether + fee}(
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
        forgepad.swapExactETHForTokens{value: 0.01 ether}(t, 0.01 ether, 0, block.timestamp);

        console.log("Buy after launch correctly reverts");
    }

    function test_10e_SellAfterLaunchReverts() public {
        console.log("=== TEST 10e: Sell on curve after launch reverts ===");
        address t = _create("PostLaunchSell", "PLS", 1);

        // Buy then graduate
        for (uint i = 0; i < 500; i++) {
            IForgepad.PoolInfo memory p = _pool(t);
            if (p.launched) break;
            uint256 fee = forgepad.getFirstBuyFee(t);
            vm.prank(addr1);
            forgepad.swapExactETHForTokens{value: 0.5 ether + fee}(
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
            IERC20(t).approve(address(forgepad), bal);
            vm.expectRevert("Sell amount too large");
            forgepad.swapExactTokensForETH(t, bal, 0, block.timestamp);
            vm.stopPrank();
        }
        console.log("Sell after launch correctly reverts");
    }

    function test_10f_SlippageProtection() public {
        console.log("=== TEST 10f: Slippage protection ===");
        address t = _create("Slippage", "SLIP", 1);

        // Try to buy with very high minAmountOut
        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        vm.expectRevert("Slippage limit exceeded");
        forgepad.swapExactETHForTokens{value: 0.01 ether + fee}(
            t,
            0.01 ether,
            type(uint256).max,
            block.timestamp
        );

        console.log("Slippage protection works");
    }

    function test_10g_PriceImpactLimit() public {
        console.log("=== TEST 10g: Price impact limit (45%) ===");
        address t = _create("ImpactToken", "IMP", 1);

        // MAX_PRICE_IMPACT = 4500 (45% of virtualTokenReserve).
        // virtualEthReserve = 2.5 ETH, virtualTokenReserve = 1.073e9.
        // MAX_BUY_PERCENT = 10000 (100%), so maxBuy = virtualEthReserve = 2.5 ETH.
        // A buy of 2.4 ETH passes the maxBuy check but after 3% fee,
        // net ~2.328 ETH produces amountOut ~517M tokens = ~48% of
        // virtualTokenReserve, exceeding 45% limit.
        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        vm.expectRevert("Exceeds max price impact");
        forgepad.swapExactETHForTokens{value: 2.4 ether + fee}(
            t,
            2.4 ether,
            0,
            block.timestamp
        );

        console.log("Price impact limit enforced");
    }

    // ================================================================
    //  11. ADMIN FUNCTIONS
    // ================================================================

    function test_11a_OwnerOnlyFunctions() public {
        console.log("=== TEST 11a: Owner-only function access ===");

        // Non-owner cannot call admin functions
        vm.startPrank(addr1);

        vm.expectRevert();
        forgepad.setPlatformBuyFeePercent(5);

        vm.expectRevert();
        forgepad.setPlatformSellFeePercent(5);

        vm.expectRevert();
        forgepad.setFeeAddress(addr1);

        vm.expectRevert();
        forgepad.setDistributorAddress(addr1);

        vm.expectRevert();
        forgepad.setMaxBuyPercent(5000);

        vm.expectRevert();
        forgepad.setMaxSellPercent(5000);

        vm.expectRevert();
        forgepad.setCreateTokenFeeAmount(0.01 ether);

        vm.expectRevert();
        forgepad.setTokenOwnerFeePercent(1);

        vm.expectRevert();
        forgepad.setTokenOwnerLPFee(0.1 ether);

        vm.expectRevert();
        forgepad.setPlatformLPFee(0.1 ether);

        vm.expectRevert();
        forgepad.setFirstBuyFee(100);

        vm.expectRevert();
        forgepad.setLiquidityManager(addr1);

        vm.expectRevert();
        forgepad.pause();

        vm.expectRevert();
        forgepad.unpause();

        vm.expectRevert();
        forgepad.requestEmergencyWithdrawETH(1 ether);

        vm.stopPrank();

        console.log("All admin functions correctly restricted");
    }

    function test_11b_FeeLimits() public {
        console.log("=== TEST 11b: Fee limit validation ===");

        vm.expectRevert("Buy fee cannot exceed 10%");
        forgepad.setPlatformBuyFeePercent(11);

        vm.expectRevert("Sell fee cannot exceed 10%");
        forgepad.setPlatformSellFeePercent(11);

        vm.expectRevert("Fee cannot exceed 10%");
        forgepad.setTokenOwnerFeePercent(11);

        // Valid fee changes should succeed
        forgepad.setPlatformBuyFeePercent(10);
        assertEq(forgepad.PLATFORM_BUY_FEE_PERCENT(), 10, "buy fee set");
        forgepad.setPlatformBuyFeePercent(3); // restore

        forgepad.setPlatformSellFeePercent(10);
        assertEq(forgepad.PLATFORM_SELL_FEE_PERCENT(), 10, "sell fee set");
        forgepad.setPlatformSellFeePercent(3); // restore

        console.log("Fee limits enforced correctly");
    }

    function test_11c_AddressValidation() public {
        console.log("=== TEST 11c: Address validation ===");

        vm.expectRevert("Fee address cannot be zero");
        forgepad.setFeeAddress(address(0));

        vm.expectRevert("Distributor cannot be zero");
        forgepad.setDistributorAddress(address(0));

        vm.expectRevert("Liquidity manager cannot be zero");
        forgepad.setLiquidityManager(address(0));

        // Valid address changes
        forgepad.setFeeAddress(addr3);
        assertEq(forgepad.feeAddress(), addr3, "fee address updated");
        forgepad.setFeeAddress(FEE_WALLET); // restore

        forgepad.setDistributorAddress(addr3);
        assertEq(
            forgepad.distributorAddress(),
            addr3,
            "distributor updated"
        );
        forgepad.setDistributorAddress(DIST_ADDR); // restore

        console.log("Address validation works correctly");
    }

    function test_11d_MaxPercentValidation() public {
        console.log("=== TEST 11d: Max percent validation ===");

        vm.expectRevert("Max buy cannot exceed 100%");
        forgepad.setMaxBuyPercent(10001);

        vm.expectRevert("Max sell cannot exceed 100%");
        forgepad.setMaxSellPercent(10001);

        forgepad.setMaxBuyPercent(5000);
        assertEq(forgepad.MAX_BUY_PERCENT(), 5000, "max buy updated");
        forgepad.setMaxBuyPercent(10000); // restore

        console.log("Max percent validation works");
    }

    function test_11e_PauseUnpause() public {
        console.log("=== TEST 11e: Pause/unpause ===");
        address t = _create("PauseToken", "PAUS", 1);

        forgepad.pause();

        // Create token should revert when paused
        vm.expectRevert();
        forgepad.createToken{value: 0.001 ether}("X", "X", 0, 0, 0, 1, block.timestamp);

        // Buy should revert when paused
        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        vm.expectRevert();
        forgepad.swapExactETHForTokens{value: 0.01 ether + fee}(
            t,
            0.01 ether,
            0,
            block.timestamp
        );

        // Sell should revert when paused
        vm.prank(addr1);
        vm.expectRevert();
        forgepad.swapExactTokensForETH(t, 1e18, 0, block.timestamp);

        forgepad.unpause();

        // Now should work
        fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.01 ether + fee}(
            t,
            0.01 ether,
            0,
            block.timestamp
        );
        assertTrue(IERC20(t).balanceOf(addr1) > 0, "buy works after unpause");

        console.log("Pause/unpause works correctly");
    }

    function test_11f_EmergencyWithdraw() public {
        console.log("=== TEST 11f: Emergency withdraw with timelock ===");
        address t = _create("EmergToken", "EMRG", 1);

        // Buy to put ETH in contract
        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 1 ether + fee}(
            t,
            1 ether,
            0,
            block.timestamp
        );

        uint256 contractBal = address(forgepad).balance;
        assertTrue(contractBal > 0, "contract has ETH");

        uint256 withdrawAmt = contractBal / 2;

        // Request
        forgepad.requestEmergencyWithdrawETH(withdrawAmt);

        // Execute too early
        vm.expectRevert("Timelock not expired");
        forgepad.executeEmergencyWithdrawETH();

        // Warp past timelock (24h)
        vm.warp(block.timestamp + 24 hours + 1);

        uint256 ownerBefore = address(this).balance;
        forgepad.executeEmergencyWithdrawETH();
        uint256 ownerAfter = address(this).balance;

        assertEq(ownerAfter - ownerBefore, withdrawAmt, "withdrew correct amount");
        console.log("Emergency withdraw with timelock works");
    }

    function test_11g_CancelEmergencyWithdraw() public {
        console.log("=== TEST 11g: Cancel emergency withdraw ===");
        address t = _create("CancelToken", "CANC", 1);

        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.5 ether + fee}(
            t,
            0.5 ether,
            0,
            block.timestamp
        );

        forgepad.requestEmergencyWithdrawETH(0.1 ether);
        forgepad.cancelEmergencyWithdraw();

        vm.warp(block.timestamp + 24 hours + 1);
        vm.expectRevert("No pending withdrawal");
        forgepad.executeEmergencyWithdrawETH();

        console.log("Cancel emergency withdraw works");
    }

    function test_11h_EmergencyWithdrawTokens() public {
        console.log("=== TEST 11h: Emergency withdraw tokens ===");
        address t = _create("EWToken", "EWT", 1);

        // Cannot withdraw from active pool
        vm.expectRevert("Cannot withdraw from active pool");
        forgepad.emergencyWithdrawTokens(t, 1e18);

        console.log("Emergency token withdraw correctly blocked for active pool");
    }

    // ================================================================
    //  12. MULTI-USER SCENARIOS
    // ================================================================

    function test_12a_MultipleUsersBuyAndSell() public {
        console.log("=== TEST 12a: Multiple users buy and sell ===");
        address t = _create("MultiUser", "MU", 1);

        // User 1 buys
        uint256 fee1 = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.1 ether + fee1}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );
        uint256 bal1 = IERC20(t).balanceOf(addr1);
        console.log("User1 tokens:", bal1 / 1e18);

        _logPriceAndMcap("After user1 buy", t);

        // User 2 buys
        uint256 fee2 = forgepad.getFirstBuyFee(t);
        vm.prank(addr2);
        forgepad.swapExactETHForTokens{value: 0.2 ether + fee2}(
            t,
            0.2 ether,
            0,
            block.timestamp
        );
        uint256 bal2 = IERC20(t).balanceOf(addr2);
        console.log("User2 tokens:", bal2 / 1e18);

        _logPriceAndMcap("After user2 buy", t);

        // User 3 buys
        uint256 fee3 = forgepad.getFirstBuyFee(t);
        vm.prank(addr3);
        forgepad.swapExactETHForTokens{value: 0.05 ether + fee3}(
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
        IERC20(t).approve(address(forgepad), sell1);
        forgepad.swapExactTokensForETH(t, sell1, 0, block.timestamp);
        vm.stopPrank();
        console.log("User1 sold", sell1 / 1e18, "tokens");

        _logPriceAndMcap("After user1 sell", t);

        // User 2 sells all
        vm.startPrank(addr2);
        IERC20(t).approve(address(forgepad), bal2);
        forgepad.swapExactTokensForETH(t, bal2, 0, block.timestamp);
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
            uint256 fee = forgepad.getFirstBuyFee(t);

            vm.prank(buyer);
            forgepad.swapExactETHForTokens{value: 0.5 ether + fee}(
                t,
                0.5 ether,
                0,
                block.timestamp
            );

            IForgepad.PoolInfo memory p = _pool(t);
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
        uint256 fee1 = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.1 ether + fee1}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );
        uint256 tokens1 = IERC20(t).balanceOf(addr1);
        console.log("Early buyer (0.1 ETH) tokens:", tokens1 / 1e18);

        // Push price up with a large buy
        uint256 fee2 = forgepad.getFirstBuyFee(t);
        vm.prank(addr2);
        forgepad.swapExactETHForTokens{value: 1 ether + fee2}(
            t,
            1 ether,
            0,
            block.timestamp
        );

        // Buyer 3: late (same 0.1 ETH)
        uint256 fee3 = forgepad.getFirstBuyFee(t);
        vm.prank(addr3);
        forgepad.swapExactETHForTokens{value: 0.1 ether + fee3}(
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
        uint256 fee = forgepad.getFirstBuyFee(t);

        _logPriceAndMcap("Before exact token buy", t);

        vm.prank(addr1);
        forgepad.swapETHForExactTokens{value: maxETH + fee}(
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

        uint256 progress0 = forgepad.getBondingCurveProgress(t);
        console.log("Progress at start:", progress0, "bps");
        assertEq(progress0, 0, "0% at start");

        // Buy some
        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.5 ether + fee}(
            t,
            0.5 ether,
            0,
            block.timestamp
        );

        uint256 progress1 = forgepad.getBondingCurveProgress(t);
        console.log("Progress after 0.5 ETH:", progress1, "bps");
        assertTrue(progress1 > 0, "progress > 0");
        assertTrue(progress1 < 10000, "progress < 100%");

        // Buy more
        for (uint i = 0; i < 10; i++) {
            IForgepad.PoolInfo memory p = _pool(t);
            if (p.launched) break;
            uint256 f = forgepad.getFirstBuyFee(t);
            vm.prank(addr2);
            forgepad.swapExactETHForTokens{value: 0.5 ether + f}(
                t,
                0.5 ether,
                0,
                block.timestamp
            );
        }

        IForgepad.PoolInfo memory pFinal = _pool(t);
        if (pFinal.launched) {
            console.log("Token graduated - progress complete");
        } else {
            uint256 progressN = forgepad.getBondingCurveProgress(t);
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
        ) = forgepad.getLaunchProgress(t);

        console.log("Current mcap:", currentMcap / 1e18);
        console.log("Target mcap:", targetMcap / 1e18);
        console.log("Progress %:", progressPct);
        console.log("Can launch:", canLaunch);

        assertEq(targetMcap, TARGET_MCAP_USD, "target matches constant");
        assertFalse(canLaunch, "cannot launch at start");

        // Buy to increase mcap
        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 1 ether + fee}(
            t,
            1 ether,
            0,
            block.timestamp
        );

        (uint256 mcap2, , uint256 prog2, bool can2) = forgepad
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
        ) = forgepad.getPoolDetails(t);

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
        uint256 maxSell = forgepad.getMaxSellableETH(t);
        assertEq(maxSell, 0, "no sellable ETH at start");

        // Buy some
        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.1 ether + fee}(
            t,
            0.1 ether,
            0,
            block.timestamp
        );

        uint256 maxSellAfter = forgepad.getMaxSellableETH(t);
        assertTrue(maxSellAfter > 0, "sellable ETH after buy");
        console.log("Max sellable ETH:", maxSellAfter);

        // getPrice (actual)
        uint256 actPriceAfter = forgepad.getPrice(t);
        assertTrue(actPriceAfter > 0, "actual price > 0 after buy");
        console.log("Actual price after buy:", actPriceAfter);

        // ETH price
        uint256 ethUSD = forgepad.getETHPriceByUSD();
        assertTrue(ethUSD > 0, "ETH price > 0");
        console.log("ETH/USD:", ethUSD / 1e18);
    }

    receive() external payable {}
}
