// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {FyuzDeploy} from "../src/FyuzDeploy.sol";
import "forge-std/Test.sol";
import "forge-std/console.sol";
import {Fyuz, IFyuz} from "../src/Fyuz.sol";
import {FyuzLiquidityManager} from "../src/FyuzLiquidityManager.sol";
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

contract FyuzAdvancedTest is Test {
    Fyuz public fyuz;
    FyuzLiquidityManager public liquidityManager;
    IFyuz public iFyuz;

    address public addr1;
    address public addr2;
    address public addr3;

    // address constant PANCAKE_V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    // address constant V3_POS_MGR = 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364;
    // address constant V4_POOL_MGR = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    // address constant UNIVERSAL_ROUTER = 0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB;
    // address constant V4_POS_MGR = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    // address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    // address constant DATA_FEED = 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE;
    // address constant FEE_WALLET = 0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103;
    // address constant DIST_ADDR = 0xF2917a81fF74406fbCf01c507057e101Db8f2F12;

    // DEX/oracle addresses: default Ethereum mainnet, env-overridable (see Fyuz.t.sol).
    address UNISWAP_V2_ROUTER;
    address V3_FACTORY;
    address V3_POS_MGR;
    address V4_POOL_MGR;
    address UNIVERSAL_ROUTER;
    address V4_POS_MGR;
    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Chainlink ETH/USD
    address DATA_FEED;

    // Your same custom addresses (unchanged)
    address constant FEE_WALLET = 0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103;
    address constant DIST_ADDR = 0xF2917a81fF74406fbCf01c507057e101Db8f2F12;

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

        addr1 = makeAddr("addr1");
        addr2 = makeAddr("addr2");
        addr3 = makeAddr("addr3");

        vm.deal(address(this), 100000 ether);
        vm.deal(addr1, 100000 ether);
        vm.deal(addr2, 100000 ether);
        vm.deal(addr3, 100000 ether);

        liquidityManager = FyuzDeploy.deployLiquidityManager(
            UNISWAP_V2_ROUTER,
            V3_FACTORY,
            V3_POS_MGR,
            V4_POOL_MGR,
            UNIVERSAL_ROUTER,
            V4_POS_MGR,
            PERMIT2_ADDR,
            address(this),
            10000,
            10000,
            address(this)
        );

        fyuz = FyuzDeploy.deployFyuz(
            DATA_FEED,
            address(liquidityManager),
            FEE_WALLET,
            DIST_ADDR,
            address(this)
        );
        iFyuz = IFyuz(address(fyuz));

        liquidityManager.setAuthorizedCaller(address(fyuz), true);
        fyuz.setPlatformBuyFeeBps(300);
        fyuz.setPlatformSellFeeBps(300);
        fyuz.setMaxBuyPercent(300);
        fyuz.setMaxSellPercent(300);

        if (block.chainid == 4663) {
            fyuz.setPriceStalenessThreshold(86400);
        }
    }

    // ---- Helper: create token and return address via event ----
    function _create(
        string memory name,
        string memory sym,
        uint8 pt
    ) internal returns (address) {
        vm.recordLogs();
        fyuz.createToken{value: 0.001 ether}(name, sym, 0, 0, 0, pt, block.timestamp);
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

    // ---- Helper: get pool via interface (returns struct) ----
    function _pool(
        address t
    ) internal view returns (IFyuz.PoolInfo memory) {
        return iFyuz.tokenPools(t);
    }

    // ============================================================
    // 1. Fee Validation Tests
    // ============================================================

    function test_FeePercentCannotExceed10() public {
        // Buy fee at boundary (10) should succeed
        fyuz.setPlatformBuyFeeBps(1000);
        assertEq(fyuz.PLATFORM_BUY_FEE_BPS(), 1000);

        // Buy fee above 10 should revert
        vm.expectRevert("Buy fee cannot exceed 10%");
        fyuz.setPlatformBuyFeeBps(1001);

        // Sell fee at boundary (10) should succeed
        fyuz.setPlatformSellFeeBps(1000);
        assertEq(fyuz.PLATFORM_SELL_FEE_BPS(), 1000);

        // Sell fee above 10 should revert
        vm.expectRevert("Sell fee cannot exceed 10%");
        fyuz.setPlatformSellFeeBps(1001);

        // Much larger values should also revert
        vm.expectRevert("Buy fee cannot exceed 10%");
        fyuz.setPlatformBuyFeeBps(5000);

        vm.expectRevert("Sell fee cannot exceed 10%");
        fyuz.setPlatformSellFeeBps(10000);

        // Reset to defaults
        fyuz.setPlatformBuyFeeBps(300);
        fyuz.setPlatformSellFeeBps(300);
    }

    function test_CombinedFeesCannotExceed100() public {
        // Set token owner fee to 10 (max)
        fyuz.setTokenOwnerFeeBps(1000);
        assertEq(fyuz.TOKEN_OWNER_FEE_BPS(), 1000);

        // Combined platform buy + owner must be < 100
        // With owner at 10, setting buy to 10 => 20 < 100, should pass
        fyuz.setPlatformBuyFeeBps(1000);
        assertEq(fyuz.PLATFORM_BUY_FEE_BPS(), 1000);

        // Verify that setTokenOwnerFeeBps also validates combined fees
        // Reset buy fee to 3 first
        fyuz.setPlatformBuyFeeBps(300);

        // Owner fee cannot exceed 10
        vm.expectRevert("Fee cannot exceed 10%");
        fyuz.setTokenOwnerFeeBps(1001);

        // Reset
        fyuz.setTokenOwnerFeeBps(0);
        fyuz.setPlatformBuyFeeBps(300);
    }

    // ============================================================
    // 2. Fuzz Tests
    // ============================================================

    function testFuzz_BuyAmountBounded(uint256 amount) public {
        // Bound the buy amount to a reasonable range
        amount = bound(amount, 0.001 ether, 10 ether);

        address t = _create("FuzzBuy", "FBUY", 1);

        // Ensure the buy amount does not exceed the maxBuy limit
        IFyuz.PoolInfo memory p = _pool(t);
        uint256 maxBuy = (p.virtualEthReserve * fyuz.MAX_BUY_PERCENT()) /
            10000;

        // Skip amounts that exceed the max buy percent or would cause > 45% price impact
        if (amount > maxBuy) return;

        uint256 fee = fyuz.getFirstBuyFee(t);

        vm.prank(addr1);
        fyuz.swapExactETHForTokens{value: amount + fee}(t, amount, 0, block.timestamp);

        uint256 bal = IERC20(t).balanceOf(addr1);
        assertTrue(bal > 0, "Should receive tokens for valid buy");
    }

    function testFuzz_SellAfterBuy(
        uint256 buyAmount,
        uint256 sellPercent
    ) public {
        // Bound inputs: buy between 0.001 and 0.1 ether (keeping within max buy)
        buyAmount = bound(buyAmount, 0.001 ether, 0.07 ether);
        sellPercent = bound(sellPercent, 1, 100);

        address t = _create("FuzzSell", "FSEL", 1);
        uint256 fee = fyuz.getFirstBuyFee(t);

        // Buy tokens
        vm.prank(addr1);
        fyuz.swapExactETHForTokens{value: buyAmount + fee}(t, buyAmount, 0, block.timestamp);

        uint256 tokensBought = IERC20(t).balanceOf(addr1);
        assertTrue(tokensBought > 0, "Should have tokens after buy");

        // Calculate sell amount based on percentage
        uint256 sellAmount = (tokensBought * sellPercent) / 100;
        if (sellAmount == 0) return; // skip 0 sells

        // Check max sell limit
        IFyuz.PoolInfo memory p = _pool(t);
        uint256 maxSell = (p.virtualTokenReserve *
            fyuz.MAX_SELL_PERCENT()) / 10000;
        if (sellAmount > maxSell) return;

        // Record ETH balance before sell
        uint256 ethBefore = addr1.balance;

        // Sell tokens
        vm.startPrank(addr1);
        IERC20(t).approve(address(fyuz), sellAmount);
        fyuz.swapExactTokensForETH(t, sellAmount, 0, block.timestamp);
        vm.stopPrank();

        uint256 ethAfter = addr1.balance;
        uint256 ethReceived = ethAfter - ethBefore;

        // The ETH received from selling should always be less than ETH spent buying
        // (due to fees on both buy and sell + price impact)
        assertTrue(
            ethReceived < buyAmount,
            "ETH received should be less than spent (fees)"
        );
        assertTrue(ethReceived > 0, "Should receive some ETH");
    }

    // ============================================================
    // 3. Price Impact Tests
    // ============================================================

    /// The breaker caps any single buy at MAX_BUY_PERCENT of the pool's VIRTUAL
    /// ETH reserve, so its trigger point moves with the curve calibration. The
    /// old flat `5.5 ether` only tripped it because VIRTUAL_ETH_INITIAL was 2.5
    /// (cap = 2.5 ETH); at the shipping 8.25 the cap is 8.25 ETH and a 5.5 ETH
    /// buy is legitimately allowed — the breaker was never broken, the trigger
    /// was ETH-sized. Derive it from the reserve so it tracks any recalibration,
    /// and pin BOTH sides of the boundary so a genuinely dead breaker still fails
    /// this test.
    function test_PriceImpactCircuitBreaker() public {
        address t = _create("Impact", "IMP", 1);

        fyuz.setMaxBuyPercent(10000); // cap == 100% of virtualEthReserve

        uint256 maxBuy = (_pool(t).virtualEthReserve * 10000) / 10000;

        // One wei over the cap must be rejected.
        vm.prank(addr1);
        vm.expectRevert("Exceeds maximum price impact");
        fyuz.swapExactETHForTokens{value: maxBuy + 1}(t, maxBuy + 1, 0, block.timestamp);

        // ...and exactly at the cap must be allowed: proves the breaker is still
        // reachable and sits exactly where MAX_BUY_PERCENT says, rather than
        // having been pushed out of range entirely.
        uint256 firstBuyFee = fyuz.getFirstBuyFee(t);
        vm.prank(addr1);
        fyuz.swapExactETHForTokens{value: maxBuy + firstBuyFee}(
            t,
            maxBuy,
            0,
            block.timestamp
        );
        assertGt(IERC20(t).balanceOf(addr1), 0, "buy at the cap must succeed");

        fyuz.setMaxBuyPercent(300);
    }

    /// The breaker must also bind at a fractional MAX_BUY_PERCENT, not just 100%.
    function test_PriceImpactCircuitBreaker_scalesWithPercent() public {
        address t = _create("Impact2", "IMP2", 1);

        fyuz.setMaxBuyPercent(300); // 3% of virtualEthReserve
        uint256 cap = (_pool(t).virtualEthReserve * 300) / 10000;

        vm.prank(addr1);
        vm.expectRevert("Exceeds maximum price impact");
        fyuz.swapExactETHForTokens{value: cap + 1}(t, cap + 1, 0, block.timestamp);
    }

    function test_MinimumLiquidityEnforced() public {
        address t = _create("MinLiq", "MLIQ", 1);

        uint256 fee = fyuz.getFirstBuyFee(t);
        vm.prank(addr1);
        fyuz.swapExactETHForTokens{value: 0.00001 ether + fee}(
            t,
            0.00001 ether,
            0,
            block.timestamp
        );

        IFyuz.PoolInfo memory poolBefore = _pool(t);
        if (poolBefore.launched) {
            return;
        }

        assertGt(poolBefore.ethReserve, 0, "Pool should have ETH after buy");

        uint256 tokenBalance = IERC20(t).balanceOf(addr1);

        vm.startPrank(addr1);
        IERC20(t).approve(address(fyuz), tokenBalance / 10);
        fyuz.swapExactTokensForETH(t, tokenBalance / 10, 0, block.timestamp);
        vm.stopPrank();

        IFyuz.PoolInfo memory poolAfter = _pool(t);
        assertGt(poolAfter.ethReserve, 0, "Should retain liquidity");
    }

    // ============================================================
    // 4. Invariant Tests
    // ============================================================

    function test_KValueNeverDecreases() public {
        address t = _create("KTest", "KVAL", 1);

        IFyuz.PoolInfo memory p0 = _pool(t);
        uint256 k0 = p0.virtualEthReserve * p0.virtualTokenReserve;

        uint256 f1 = fyuz.getFirstBuyFee(t);
        vm.prank(addr1);
        fyuz.swapExactETHForTokens{value: 0.0001 ether + f1}(
            t,
            0.0001 ether,
            0,
            block.timestamp
        );
        IFyuz.PoolInfo memory p1 = _pool(t);
        if (p1.launched) return;
        uint256 k1 = p1.virtualEthReserve * p1.virtualTokenReserve;
        assertGe(k1, k0, "K should not decrease after buy 1");

        uint256 f2 = fyuz.getFirstBuyFee(t);
        vm.prank(addr2);
        fyuz.swapExactETHForTokens{value: 0.0001 ether + f2}(
            t,
            0.0001 ether,
            0,
            block.timestamp
        );
        IFyuz.PoolInfo memory p2 = _pool(t);
        if (p2.launched) return;
        uint256 k2 = p2.virtualEthReserve * p2.virtualTokenReserve;
        assertGe(k2, k1, "K should not decrease after buy 2");

        uint256 bal1 = IERC20(t).balanceOf(addr1);
        if (bal1 > 0) {
            vm.startPrank(addr1);
            IERC20(t).approve(address(fyuz), bal1 / 10);
            fyuz.swapExactTokensForETH(t, bal1 / 10, 0, block.timestamp);
            vm.stopPrank();
            IFyuz.PoolInfo memory p3 = _pool(t);
            if (p3.launched) return;
            uint256 k3 = p3.virtualEthReserve * p3.virtualTokenReserve;
            assertGe(k3, k2, "K should not decrease after sell 1");
        }

        uint256 f3 = fyuz.getFirstBuyFee(t);
        vm.prank(addr3);
        fyuz.swapExactETHForTokens{value: 0.0001 ether + f3}(
            t,
            0.0001 ether,
            0,
            block.timestamp
        );
        IFyuz.PoolInfo memory p4 = _pool(t);
        if (p4.launched) return;
        uint256 k4 = p4.virtualEthReserve * p4.virtualTokenReserve;
        assertGe(
            k4,
            p2.virtualEthReserve * p2.virtualTokenReserve,
            "K should not decrease after buy 3"
        );
    }

    function test_ReservesConsistent() public {
        address t = _create("Reserve", "RSVT", 1);

        uint256 feeAddrBefore = FEE_WALLET.balance;
        uint256 distAddrBefore = DIST_ADDR.balance;

        uint256 totalBuyAmount = 0;

        uint256 buyAmt1 = 0.0001 ether;
        uint256 fee1 = fyuz.getFirstBuyFee(t);
        vm.prank(addr1);
        fyuz.swapExactETHForTokens{value: buyAmt1 + fee1}(t, buyAmt1, 0, block.timestamp);
        totalBuyAmount += buyAmt1;

        IFyuz.PoolInfo memory pAfterBuy1 = _pool(t);
        if (pAfterBuy1.launched) return;

        uint256 buyAmt2 = 0.0001 ether;
        uint256 fee2 = fyuz.getFirstBuyFee(t);
        vm.prank(addr2);
        fyuz.swapExactETHForTokens{value: buyAmt2 + fee2}(t, buyAmt2, 0, block.timestamp);
        totalBuyAmount += buyAmt2;

        IFyuz.PoolInfo memory pAfterBuy2 = _pool(t);
        if (pAfterBuy2.launched) return;

        uint256 bal1 = IERC20(t).balanceOf(addr1);
        vm.startPrank(addr1);
        IERC20(t).approve(address(fyuz), bal1 / 10);
        fyuz.swapExactTokensForETH(t, bal1 / 10, 0, block.timestamp);
        vm.stopPrank();

        IFyuz.PoolInfo memory p = _pool(t);

        uint256 feeAddrAfter = FEE_WALLET.balance;
        uint256 distAddrAfter = DIST_ADDR.balance;
        uint256 feesDistributed = (feeAddrAfter - feeAddrBefore) +
            (distAddrAfter - distAddrBefore);

        assertTrue(
            p.ethReserve <= totalBuyAmount,
            "Pool reserve should not exceed total deposited"
        );
        assertTrue(
            p.ethReserve + feesDistributed > 0,
            "ETH should be accounted for"
        );
    }

    // ============================================================
    // 5. Launch Migration Tests
    // ============================================================

    function test_LaunchSendsToCorrectDEX() public {
        // Create a V2 token (poolType=1) and push to launch
        address t = _create("LaunchV2", "LV2", 1);

        bool launched = false;
        for (uint i = 0; i < 500; i++) {
            uint256 fee = fyuz.getFirstBuyFee(t);
            vm.prank(addr2);
            fyuz.swapExactETHForTokens{value: 0.05 ether + fee}(
                t,
                0.05 ether,
                0,
                block.timestamp
            );

            IFyuz.PoolInfo memory p = _pool(t);
            if (p.launched) {
                launched = true;
                console.log("V2 token launched after buy:", i + 1);

                // Verify V2 DEX pair exists
                IUniswapV2Router02 router = IUniswapV2Router02(
                    UNISWAP_V2_ROUTER
                );
                address weth = router.WETH();
                address pair = IUniswapV2Factory(router.factory()).getPair(
                    t,
                    weth
                );
                assertTrue(
                    pair != address(0),
                    "V2 pair should exist after launch"
                );

                // Verify reserves are zeroed out
                assertEq(
                    p.virtualEthReserve,
                    0,
                    "Virtual ETH should be 0 after launch"
                );
                assertEq(
                    p.virtualTokenReserve,
                    0,
                    "Virtual token should be 0 after launch"
                );
                assertEq(
                    p.ethReserve,
                    0,
                    "ETH reserve should be 0 after launch"
                );
                assertEq(
                    p.tokenReserve,
                    0,
                    "Token reserve should be 0 after launch"
                );
                break;
            }
        }
        assertTrue(launched, "Token should have launched");
    }

    function test_PostLaunchSwapReverts() public {
        // Create and launch a token
        address t = _create("PostLaunch", "PLNCH", 1);

        for (uint i = 0; i < 500; i++) {
            uint256 fee = fyuz.getFirstBuyFee(t);
            vm.prank(addr2);
            fyuz.swapExactETHForTokens{value: 0.05 ether + fee}(
                t,
                0.05 ether,
                0,
                block.timestamp
            );

            IFyuz.PoolInfo memory p = _pool(t);
            if (p.launched) break;
        }

        IFyuz.PoolInfo memory pFinal = _pool(t);
        assertTrue(pFinal.launched, "Token should be launched");

        // Attempt to buy after launch should revert.
        // After launch, virtualEthReserve = 0, so maxBuy = 0 and any nonzero buy
        // hits "Exceeds maximum price impact" before reaching the launched check.
        vm.prank(addr1);
        vm.expectRevert("Exceeds maximum price impact");
        fyuz.swapExactETHForTokens{value: 0.01 ether}(t, 0.01 ether, 0, block.timestamp);

        // Attempt to sell after launch should revert.
        // After launch, virtualTokenReserve = 0, so maxSell = 0 and any nonzero sell
        // hits "Sell amount too large" before reaching the launched check.
        uint256 bal = IERC20(t).balanceOf(addr2);
        if (bal > 0) {
            vm.startPrank(addr2);
            IERC20(t).approve(address(fyuz), bal);
            vm.expectRevert("Sell amount too large");
            fyuz.swapExactTokensForETH(t, bal / 2, 0, block.timestamp);
            vm.stopPrank();
        }
    }

    // ============================================================
    // 6. Emergency Function Tests
    // ============================================================

    function test_EmergencyTimelockEnforced() public {
        // Send some ETH to fyuz so there's balance to withdraw
        (bool ok, ) = address(fyuz).call{value: 1 ether}("");
        assertTrue(ok, "ETH transfer to fyuz should succeed");

        // Request emergency withdrawal
        fyuz.requestEmergencyWithdrawETH(0.5 ether);

        // Attempt to execute immediately should revert (timelock not expired)
        vm.expectRevert("Timelock not expired");
        fyuz.executeEmergencyWithdrawETH();

        // Warp 12 hours - still not enough
        vm.warp(block.timestamp + 12 hours);
        vm.expectRevert("Timelock not expired");
        fyuz.executeEmergencyWithdrawETH();

        // Warp past 24 hours total
        vm.warp(block.timestamp + 13 hours);

        uint256 ownerBalBefore = address(this).balance;
        fyuz.executeEmergencyWithdrawETH();
        uint256 ownerBalAfter = address(this).balance;

        assertEq(
            ownerBalAfter - ownerBalBefore,
            0.5 ether,
            "Should receive withdrawn ETH"
        );

        // Second execution should revert (already executed / cleared)
        vm.expectRevert("No pending withdrawal");
        fyuz.executeEmergencyWithdrawETH();
    }

    function test_EmergencyTokenWithdrawOnlyLaunched() public {
        address t = _create("EmgToken", "EMGT", 1);

        uint256 fee = fyuz.getFirstBuyFee(t);
        vm.prank(addr1);
        fyuz.swapExactETHForTokens{value: 0.00001 ether + fee}(
            t,
            0.00001 ether,
            0,
            block.timestamp
        );

        IFyuz.PoolInfo memory p = _pool(t);
        if (p.launched) return;

        uint256 contractBal = IERC20(t).balanceOf(address(fyuz));
        assertTrue(contractBal > 0, "Fyuz should hold tokens");

        vm.expectRevert("Cannot withdraw from active pool");
        fyuz.emergencyWithdrawTokens(t, contractBal);

        Token standalone = new Token("Standalone", "STKN", 1000 ether);
        standalone.transfer(address(fyuz), 100 ether);

        uint256 fyuzStandaloneBal = IERC20(address(standalone)).balanceOf(
            address(fyuz)
        );
        assertEq(fyuzStandaloneBal, 100 ether);

        fyuz.emergencyWithdrawTokens(address(standalone), 100 ether);
        assertEq(
            IERC20(address(standalone)).balanceOf(address(this)),
            900 ether + 100 ether
        );
    }

    function test_EmergencyWithdrawCancelWorks() public {
        (bool ok, ) = address(fyuz).call{value: 1 ether}("");
        assertTrue(ok);

        fyuz.requestEmergencyWithdrawETH(1 ether);

        // Cancel the withdrawal
        fyuz.cancelEmergencyWithdraw();

        // Warp past timelock
        vm.warp(block.timestamp + 25 hours);

        // Execution should fail because it was cancelled
        vm.expectRevert("No pending withdrawal");
        fyuz.executeEmergencyWithdrawETH();
    }

    function test_EmergencyWithdrawOnlyOwner() public {
        (bool ok, ) = address(fyuz).call{value: 1 ether}("");
        assertTrue(ok);

        // Non-owner cannot request
        vm.prank(addr1);
        vm.expectRevert();
        fyuz.requestEmergencyWithdrawETH(0.5 ether);

        // Non-owner cannot execute
        fyuz.requestEmergencyWithdrawETH(0.5 ether);
        vm.warp(block.timestamp + 25 hours);

        vm.prank(addr1);
        vm.expectRevert();
        fyuz.executeEmergencyWithdrawETH();

        // Non-owner cannot cancel
        vm.prank(addr1);
        vm.expectRevert();
        fyuz.cancelEmergencyWithdraw();
    }

    receive() external payable {}
}
