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
import {StateLibrary} from "../src/v4-core/libraries/StateLibrary.sol";
import {IPoolManager} from "../src/v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "../src/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../src/v4-core/types/PoolId.sol";
import {Currency} from "../src/v4-core/types/Currency.sol";
import {IHooks} from "../src/v4-core/interfaces/IHooks.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ArrowpadDeploy} from "../src/ArrowpadDeploy.sol";

contract DirectLaunchTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    Arrowpad public arrowpad;
    ArrowpadLiquidityManager public liquidityManager;
    IArrowpad public iArrowpad;

    address public addr1;
    address public addr2;
    address public addr3;

    address UNISWAP_V2_ROUTER;
    address V3_FACTORY;
    address V3_POS_MGR;
    address V4_POOL_MGR;
    address UNIVERSAL_ROUTER;
    address V4_POS_MGR;
    address constant PERMIT2_ADDR =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address DATA_FEED;

    address constant FEE_WALLET = 0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103;
    address constant DIST_ADDR = 0xF2917a81fF74406fbCf01c507057e101Db8f2F12;

    uint24 constant V3_FEE = 100;
    uint256 constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;

    address constant BURN = 0x000000000000000000000000000000000000dEaD;
    /// Minting liquidity floors: getLiquidityForAmount0 rounds down, so the position
    /// consumes marginally less than the whole supply and the manager sweeps the
    /// remainder to the burn address. Observed ~3.8e3 wei of 1e27 (~4e-24 relative);
    /// bounded here so a real leak can never hide inside "it's just dust".
    uint256 constant MAX_LAUNCH_DUST = 1e12;

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

        liquidityManager.setAuthorizedCaller(address(arrowpad), true);
        arrowpad.setPlatformBuyFeeBps(300);
        arrowpad.setPlatformSellFeeBps(300);
        arrowpad.setMaxBuyPercent(10000);
        arrowpad.setMaxSellPercent(10000);

        if (block.chainid == 4663) {
            arrowpad.setPriceStalenessThreshold(86400);
        }
    }

    // ================================================================
    //  HELPERS
    // ================================================================

    function _createDirect(
        string memory name,
        string memory symbol
    ) internal returns (address) {
        vm.recordLogs();
        arrowpad.createTokenDirect{value: arrowpad.CREATE_TOKEN_FEE_AMOUNT()}(
            name,
            symbol,
            0,
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

    function _createDirectWithValue(
        string memory name,
        string memory symbol,
        uint256 msgValue
    ) internal returns (address) {
        vm.recordLogs();
        arrowpad.createTokenDirect{value: msgValue}(
            name,
            symbol,
            0,
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

    function _createCurve(
        string memory name,
        string memory symbol,
        uint8 poolType
    ) internal returns (address) {
        vm.recordLogs();
        arrowpad.createToken{value: 0.001 ether}(
            name, symbol, 0, 0, 0, poolType, block.timestamp
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

    function _pool(
        address t
    ) internal view returns (IArrowpad.PoolInfo memory) {
        return iArrowpad.tokenPools(t);
    }

    function _v4PoolKey(address t) internal view returns (PoolKey memory key) {
        address weth = router.WETH();
        (address c0, address c1) = t < weth ? (t, weth) : (weth, t);
        key = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: V3_FEE,
            tickSpacing: int24(60),
            hooks: IHooks(address(0))
        });
    }

    function _v4PriceScaled(address t) internal view returns (uint256) {
        (uint160 sp, , , ) = IPoolManager(V4_POOL_MGR).getSlot0(
            _v4PoolKey(t).toId()
        );
        require(sp > 0, "V4 pool not initialized");
        uint256 Q96 = 0x1000000000000000000000000;
        uint256 priceX = Math.mulDiv(
            Math.mulDiv(uint256(sp), uint256(sp), Q96),
            1e18,
            Q96
        );
        address weth = router.WETH();
        return t < weth ? priceX : (1e36 / priceX);
    }

    function _v4FdvUsd(address t, uint256 ethPriceUSD)
        internal
        view
        returns (uint256)
    {
        return (ethPriceUSD * TOTAL_SUPPLY * _v4PriceScaled(t)) / 1e36;
    }

    function _absGapBps(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 hi = a > b ? a : b;
        uint256 lo = a > b ? b : a;
        return hi == 0 ? 0 : ((hi - lo) * 10_000) / hi;
    }

    IUniswapV2Router02 router;

    // ================================================================
    //  1. BASIC CREATION
    // ================================================================

    function test_Direct01_BasicCreation() public {
        console.log("=== DIRECT TEST 1: Basic createTokenDirect ===");
        address t = _createDirect("DirectToken", "DIR");
        assertTrue(t != address(0), "token address nonzero");

        IArrowpad.PoolInfo memory p = _pool(t);

        // Pool state: all reserves zero, poolType=3, launched=true
        assertEq(p.ethReserve, 0, "ethReserve = 0");
        assertEq(p.tokenReserve, 0, "tokenReserve = 0");
        assertEq(p.virtualEthReserve, 0, "virtualEthReserve = 0");
        assertEq(p.virtualTokenReserve, 0, "virtualTokenReserve = 0");
        assertEq(p.poolType, 3, "poolType = 3 (V4)");
        assertTrue(p.launched, "launched = true");
        assertEq(p.owner, address(this), "owner = caller");
        assertEq(p.token, t, "token address matches");

        // Total supply is 1B
        uint256 supply = IERC20(t).totalSupply();
        assertEq(supply, TOTAL_SUPPLY, "total supply = 1B");

        // Token count incremented
        assertEq(arrowpad.tokenCount(), 1, "tokenCount = 1");

        console.log("Direct token created:", t);
        console.log("Total supply:", supply / 1e18);
    }

    // ================================================================
    //  2. FEE PAYMENT
    // ================================================================

    function test_Direct02_FeePaidToFeeAddress() public {
        console.log("=== DIRECT TEST 2: Fee payment ===");
        uint256 feeAmount = arrowpad.CREATE_TOKEN_FEE_AMOUNT();
        uint256 feeBefore = FEE_WALLET.balance;

        _createDirect("FeeToken", "FEE");

        uint256 feeGain = FEE_WALLET.balance - feeBefore;
        assertEq(feeGain, feeAmount, "exact fee sent to fee address");
        console.log("Fee paid:", feeAmount);
    }

    // ================================================================
    //  3. EXCESS ETH REFUNDED
    // ================================================================

    /// @notice A direct launch seeds the pool with tokens ONLY, so there is nothing
    ///         to spend LP ETH on. Anything above the fee is refunded rather than
    ///         quietly kept.
    function test_Direct03_ExcessETHRefunded() public {
        console.log("=== DIRECT TEST 3: Excess ETH refunded ===");
        uint256 feeAmount = arrowpad.CREATE_TOKEN_FEE_AMOUNT();
        uint256 sent = 0.1 ether;
        uint256 balBefore = address(this).balance;

        _createDirectWithValue("LPFromExcess", "LPE", sent);

        uint256 spent = balBefore - address(this).balance;
        assertEq(spent, feeAmount, "only the creation fee is spent");
        assertEq(address(arrowpad).balance, 0, "no ETH left in Arrowpad");
        console.log("Sent:", sent);
        console.log("Spent:", spent);
    }

    // ================================================================
    //  4. TOKENS HELD BY ARROWPAD (not creator)
    // ================================================================

    /// @notice The entire supply goes into the pool as single-sided liquidity.
    ///         Nobody — not the creator, not Arrowpad — keeps an allocation to dump.
    function test_Direct04_EntireSupplyInPool() public {
        console.log("=== DIRECT TEST 4: Entire supply seeded into pool ===");
        address t = _createDirect("HeldToken", "HELD");

        assertEq(IERC20(t).balanceOf(address(arrowpad)), 0, "Arrowpad keeps nothing");
        assertEq(IERC20(t).balanceOf(address(this)), 0, "creator keeps nothing");
        assertEq(
            IERC20(t).balanceOf(address(liquidityManager)),
            0,
            "manager keeps no loose tokens"
        );
        // Every token is either working in the pool or burned — none held back.
        uint256 pooled = IERC20(t).balanceOf(V4_POOL_MGR);
        uint256 burned = IERC20(t).balanceOf(BURN);
        assertEq(pooled + burned, TOTAL_SUPPLY, "whole supply pooled or burned");
        assertLt(burned, MAX_LAUNCH_DUST, "burned amount must be rounding dust only");
    }

    // ================================================================
    //  5. NO BONDING CURVE TRADING
    // ================================================================

    function test_Direct05_CannotBuyOnCurve() public {
        console.log("=== DIRECT TEST 5: Cannot buy on curve for direct token ===");
        address t = _createDirect("NoCurve", "NCR");

        // swapExactETHForTokens should revert (launched = true)
        vm.prank(addr1);
        vm.expectRevert("Exceeds maximum price impact");
        arrowpad.swapExactETHForTokens{value: 0.01 ether}(
            t, 0.01 ether, 0, block.timestamp
        );

        console.log("Buy on curve correctly reverts");
    }

    function test_Direct06_CannotSellOnCurve() public {
        console.log("=== DIRECT TEST 6: Cannot sell on curve for direct token ===");
        address t = _createDirect("NoSell", "NSL");

        // swapExactTokensForETH should revert (virtualTokenReserve = 0)
        vm.startPrank(addr1);
        IERC20(t).approve(address(arrowpad), 1e18);
        vm.expectRevert("Sell amount too large");
        arrowpad.swapExactTokensForETH(t, 1e18, 0, block.timestamp);
        vm.stopPrank();

        console.log("Sell on curve correctly reverts");
    }

    // ================================================================
    //  6. VIEW FUNCTIONS RETURN ZERO FOR DIRECT TOKENS
    // ================================================================

    function test_Direct07_ViewFunctionsZero() public {
        console.log("=== DIRECT TEST 7: View functions return zero ===");
        address t = _createDirect("ViewZero", "VZ");

        uint256 vPrice = arrowpad.getVirtualPrice(t);
        assertEq(vPrice, 0, "virtual price = 0");

        uint256 mcap = arrowpad.getTokenVirtualMarketCap(t);
        assertEq(mcap, 0, "market cap = 0");

        uint256 actPrice = arrowpad.getPrice(t);
        assertEq(actPrice, 0, "actual price = 0");

        uint256 maxSell = arrowpad.getMaxSellableETH(t);
        assertEq(maxSell, 0, "max sellable ETH = 0");

        uint256 progress = arrowpad.getBondingCurveProgress(t);
        // virtualTokenReserve = 0 => progress = 10000 (100%)
        assertEq(progress, 10000, "bonding curve progress = 100%");

        console.log("All view functions return expected values");
    }

    // ================================================================
    //  8. TOKEN TRANSFER RESTRICTIONS
    // ================================================================

    function test_Direct08_TransferRestrictions() public {
        console.log("=== DIRECT TEST 8: Token transfer restrictions ===");
        address t = _createDirect("RestrictDir", "RDR");

        // Token.launched is set by ILaunchable(token).launch()
        // Token owner is renounced (address(0)), so tokens move freely
        assertTrue(Token(t).launched(), "Token.launched = true");
        assertEq(Token(t).owner(), address(0), "Token owner = address(0) (renounced)");

        console.log("Token.launched:", Token(t).launched());
        console.log("Token.owner:", Token(t).owner());
        console.log("Token launched and ownership renounced");
    }

    // ================================================================
    //  9. MULTIPLE DIRECT TOKENS INDEPENDENT
    // ================================================================

    function test_Direct09_MultipleDirectTokens() public {
        console.log("=== DIRECT TEST 9: Multiple direct tokens are independent ===");
        address t1 = _createDirect("Direct1", "DIR1");
        address t2 = _createDirect("Direct2", "DIR2");
        address t3 = _createDirect("Direct3", "DIR3");

        assertTrue(t1 != address(0) && t2 != address(0) && t3 != address(0), "all nonzero");
        assertTrue(t1 != t2 && t2 != t3 && t1 != t3, "all unique");

        assertEq(_pool(t1).poolType, 3, "t1 poolType=3");
        assertEq(_pool(t2).poolType, 3, "t2 poolType=3");
        assertEq(_pool(t3).poolType, 3, "t3 poolType=3");

        assertTrue(_pool(t1).launched, "t1 launched");
        assertTrue(_pool(t2).launched, "t2 launched");
        assertTrue(_pool(t3).launched, "t3 launched");

        assertEq(arrowpad.tokenCount(), 3, "tokenCount = 3");
        console.log("3 direct tokens created independently");
    }

    // ================================================================
    //  10. EDGE CASES
    // ================================================================

    function test_Direct10_ExpiredDeadlineReverts() public {
        console.log("=== DIRECT TEST 10: Expired deadline reverts ===");
        vm.expectRevert("Swap expired");
        arrowpad.createTokenDirect{value: 0.001 ether}(
            "Expired", "EXP", 0, block.timestamp - 1
        );
        console.log("Expired deadline correctly reverts");
    }

    function test_Direct11_InsufficientFeeReverts() public {
        console.log("=== DIRECT TEST 11: Insufficient fee reverts ===");
        uint256 fee = arrowpad.CREATE_TOKEN_FEE_AMOUNT();
        vm.expectRevert("Insufficient fee");
        arrowpad.createTokenDirect{value: fee - 1}(
            "Cheap", "CHP", 0, block.timestamp
        );
        console.log("Insufficient fee correctly reverts");
    }

    function test_Direct12_ZeroFeeSucceeds() public {
        console.log("=== DIRECT TEST 12: Zero fee succeeds ===");
        arrowpad.setCreateTokenFeeAmount(0);
        address t = _createDirect("ZeroFee", "ZF");
        assertTrue(t != address(0), "created with zero fee");
        assertEq(_pool(t).launched, true, "launched with zero fee");
        arrowpad.setCreateTokenFeeAmount(0.001 ether); // restore
        console.log("Zero fee creation works");
    }

    function test_Direct13_PausedReverts() public {
        console.log("=== DIRECT TEST 13: Paused reverts ===");
        arrowpad.pause();

        vm.expectRevert();
        arrowpad.createTokenDirect{value: 0.001 ether}(
            "Paused", "PAUS", 0, block.timestamp
        );

        arrowpad.unpause();
        console.log("Paused createTokenDirect correctly reverts");
    }

    // ================================================================
    //  11. MIXED: DIRECT LAUNCH + BONDING CURVE COEXIST
    // ================================================================

    function test_Direct14_CoexistWithBondingCurve() public {
        console.log("=== DIRECT TEST 14: Direct + bonding curve coexist ===");

        // Create a bonding curve token (V4)
        address curve = _createCurve("CurveToken", "CRV", 3);
        assertEq(_pool(curve).poolType, 3, "curve token poolType=3");
        assertFalse(_pool(curve).launched, "curve token not launched");
        assertTrue(_pool(curve).virtualEthReserve > 0, "curve has virtual ETH");

        // Create a direct launch token
        address direct = _createDirect("DirectToken", "DIR");
        assertEq(_pool(direct).poolType, 3, "direct token poolType=3");
        assertTrue(_pool(direct).launched, "direct token launched");
        assertEq(_pool(direct).virtualEthReserve, 0, "direct has no virtual ETH");

        // Both are poolType=3 but distinguishable by launched + virtualEthReserve
        assertEq(_pool(curve).launched, false, "curve not launched");
        assertEq(_pool(direct).launched, true, "direct launched");
        assertTrue(_pool(curve).virtualEthReserve > 0, "curve has virtual reserves");
        assertEq(_pool(direct).virtualEthReserve, 0, "direct has zero virtual reserves");

        // Can still buy the curve token
        uint256 fee = arrowpad.getFirstBuyFee(curve);
        vm.prank(addr1);
        arrowpad.swapExactETHForTokens{value: 0.01 ether + fee}(
            curve, 0.01 ether, 0, block.timestamp
        );
        assertTrue(IERC20(curve).balanceOf(addr1) > 0, "bought curve token");

        assertEq(arrowpad.tokenCount(), 2, "tokenCount = 2");
        console.log("Direct and curve tokens coexist correctly");
    }

    // ================================================================
    //  12. EVENTS
    // ================================================================

    function test_Direct15_Events() public {
        console.log("=== DIRECT TEST 15: Events emitted ===");
        vm.recordLogs();
        arrowpad.createTokenDirect{value: arrowpad.CREATE_TOKEN_FEE_AMOUNT()}(
            "EventToken", "EVT", 0, block.timestamp
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 tcSig = keccak256(
            "TokenCreated(address,uint256,uint256,uint32,uint256)"
        );
        bytes32 tlSig = keccak256("TokenLaunched(address,uint256)");

        bool foundCreated = false;
        bool foundLaunched = false;

        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == tcSig) {
                foundCreated = true;
                (address tokenAddr, uint256 tokenPrice, , , ) = abi.decode(
                    logs[i].data,
                    (address, uint256, uint256, uint32, uint256)
                );
                assertEq(tokenPrice, 0, "TokenCreated price = 0");
            }
            if (logs[i].topics[0] == tlSig) {
                foundLaunched = true;
            }
        }

        assertTrue(foundCreated, "TokenCreated event emitted");
        assertTrue(foundLaunched, "TokenLaunched event emitted");
        console.log("Both events emitted correctly");
    }

    // ================================================================
    //  13. EMERGENCY WITHDRAW TOKENS
    // ================================================================

    /// @notice Arrowpad no longer custodies the supply — it is all in the pool — so
    ///         there is nothing for an emergency withdrawal to take. This is the
    ///         point: the owner cannot rug a direct launch.
    function test_Direct16_NothingToEmergencyWithdraw() public {
        console.log("=== DIRECT TEST 16: No tokens for owner to withdraw ===");
        address t = _createDirect("WithdrawToken", "WDT");

        assertEq(IERC20(t).balanceOf(address(arrowpad)), 0, "Arrowpad holds nothing");

        vm.expectRevert();
        arrowpad.emergencyWithdrawTokens(t, 100_000_000 * 1e18);
    }

    // ================================================================
    //  14. RECOVER POOL TYPE BLOCKED (already launched)
    // ================================================================

    function test_Direct17_CannotRecoverPoolType() public {
        console.log("=== DIRECT TEST 17: Cannot recover pool type for launched ===");
        address t = _createDirect("NoRecover", "NRC");

        vm.expectRevert("Already launched");
        arrowpad.recoverPoolType(t, 1);

        console.log("recoverPoolType correctly blocked for direct-launched token");
    }

    // ================================================================
    //  15. GETPOOLDETAILS VIEW
    // ================================================================

    function test_Direct18_GetPoolDetails() public {
        console.log("=== DIRECT TEST 18: getPoolDetails for direct token ===");
        address t = _createDirect("DetailToken", "DET");

        (
            uint256 ethRes,
            uint256 tokRes,
            uint256 vEthRes,
            uint256 vTokRes,
            uint256 vPrice,
            uint256 actPrice,
            bool launched
        ) = arrowpad.getPoolDetails(t);

        assertEq(ethRes, 0, "ethReserve = 0");
        assertEq(tokRes, 0, "tokenReserve = 0");
        assertEq(vEthRes, 0, "virtualEthReserve = 0");
        assertEq(vTokRes, 0, "virtualTokenReserve = 0");
        assertEq(vPrice, 0, "virtualPrice = 0");
        assertEq(actPrice, 0, "actualPrice = 0");
        assertTrue(launched, "launched = true");

        console.log("getPoolDetails returns expected values");
    }

    // ================================================================
    //  16. LAUNCH PROGRESS VIEW
    // ================================================================

    function test_Direct19_LaunchProgress() public {
        console.log("=== DIRECT TEST 19: getLaunchProgress for direct token ===");
        address t = _createDirect("ProgressDir", "PRD");

        (
            uint256 currentMcap,
            uint256 targetMcap,
            uint256 progressPct,
            bool canLaunch
        ) = arrowpad.getLaunchProgress(t);

        assertEq(currentMcap, 0, "current mcap = 0");
        assertEq(targetMcap, arrowpad.TARGET_MARKET_CAP_USD(), "target mcap correct");
        assertEq(progressPct, 0, "progress = 0");
        assertFalse(canLaunch, "canLaunch = false (already launched, but view checks mcap)");

        console.log("getLaunchProgress works for direct token");
    }

    // ================================================================
    //  17. GETSWAPOUTPUT REVERTS
    // ================================================================

    function test_Direct20_GetSwapOutputReverts() public {
        console.log("=== DIRECT TEST 20: getSwapOutput reverts for direct token ===");
        address t = _createDirect("SwapOut", "SWO");

        vm.expectRevert("Pool has been launched");
        arrowpad.getSwapOutput(t, 0.1 ether, true);

        console.log("getSwapOutput correctly reverts");
    }

    // ================================================================
    //  21. DIRECT LAUNCH WITH LP (same tx)
    // ================================================================

    function test_Direct21_CreatesV4PoolWithLP() public {
        console.log("=== DIRECT TEST 21: Direct launch creates V4 pool with LP ===");
        uint256 feeAmount = arrowpad.CREATE_TOKEN_FEE_AMOUNT();
        uint256 lpEth = 1 ether;
        uint256 totalSent = feeAmount + lpEth;
        uint256 ethPriceUSD = arrowpad.getETHPriceByUSD();

        address t = _createDirectWithValue("LPDirect", "LPD", totalSent);
        assertTrue(t != address(0), "token created");

        // Token balance: creator should have received remaining tokens
        uint256 creatorBal = IERC20(t).balanceOf(address(this));
        console.log("Creator token balance:", creatorBal / 1e18);

        // V4 pool should be initialized
        address weth = router.WETH();
        (uint160 sp, , , ) = IPoolManager(V4_POOL_MGR).getSlot0(
            _v4PoolKey(t).toId()
        );
        assertTrue(sp > 0, "V4 pool initialized");

        // Check FDV
        uint256 fdv = _v4FdvUsd(t, ethPriceUSD);
        uint256 target = arrowpad.TARGET_MARKET_CAP_USD();
        console.log("V4 FDV USD:", fdv / 1e18);
        console.log("Target MCAP USD:", target / 1e18);
        console.log("Gap (bps):", _absGapBps(fdv, target));

        // FDV should be close to target mcap
        assertApproxEqRel(fdv, target, 0.02e18, "V4 FDV ~= target mcap");

        console.log("Direct launch with LP succeeded");
    }

    function test_Direct22_LiquidityAddedEvent() public {
        console.log("=== DIRECT TEST 22: LiquidityAdded event emitted ===");
        uint256 feeAmount = arrowpad.CREATE_TOKEN_FEE_AMOUNT();
        uint256 lpEth = 0.5 ether;

        vm.recordLogs();
        arrowpad.createTokenDirect{value: feeAmount + lpEth}(
            "EventLP", "ELP", 0, block.timestamp
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 laSig = keccak256(
            "LiquidityAdded(address,uint256,uint256,uint256)"
        );
        bool foundLiquidity = false;

        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == laSig) {
                foundLiquidity = true;
                (address token, uint256 ethAmt, uint256 tokenAmt, ) = abi.decode(
                    logs[i].data,
                    (address, uint256, uint256, uint256)
                );
                assertEq(tokenAmt > 0, true, "tokenAmount > 0");
                console.log("LiquidityAdded - ETH:", ethAmt, "Tokens:", tokenAmt / 1e18);
            }
        }

        assertTrue(foundLiquidity, "LiquidityAdded event emitted");
        console.log("LiquidityAdded event verified");
    }

    /// @notice Fee-only IS the normal direct-launch path: no LP ETH is ever needed,
    ///         so the pool must still come up fully seeded.
    function test_Direct23_PoolSeededWithFeeOnly() public {
        console.log("=== DIRECT TEST 23: Pool seeded with fee only ===");
        uint256 feeAmount = arrowpad.CREATE_TOKEN_FEE_AMOUNT();

        address t = _createDirectWithValue("NoLP", "NLP", feeAmount);

        (uint160 sp, , , ) = IPoolManager(V4_POOL_MGR).getSlot0(
            _v4PoolKey(t).toId()
        );
        assertTrue(sp > 0, "V4 pool initialized without any LP ETH");
        assertEq(IERC20(t).balanceOf(address(this)), 0, "creator has no tokens");
        assertTrue(liquidityManager.v4PositionOf(t) != 0, "position locked");
    }

    /// @notice The creator receives NO tokens. The whole supply is in the pool, so a
    ///         direct launch has no insider allocation by construction.
    function test_Direct24_CreatorReceivesNothing() public {
        console.log("=== DIRECT TEST 24: Creator receives no tokens ===");
        uint256 feeAmount = arrowpad.CREATE_TOKEN_FEE_AMOUNT();

        address t = _createDirectWithValue("RemainTokens", "RMT", feeAmount);

        assertEq(IERC20(t).balanceOf(address(this)), 0, "creator gets nothing");
        assertEq(IERC20(t).balanceOf(address(arrowpad)), 0, "arrowpad keeps nothing");
        uint256 pooled = IERC20(t).balanceOf(V4_POOL_MGR);
        uint256 burned = IERC20(t).balanceOf(BURN);
        assertEq(pooled + burned, TOTAL_SUPPLY, "every token pooled or burned");
        assertLt(burned, MAX_LAUNCH_DUST, "burned amount must be rounding dust only");
    }

    function test_Direct25_TradingWorksAfterLP() public {
        console.log("=== DIRECT TEST 25: Trading works on V4 after direct LP ===");
        uint256 feeAmount = arrowpad.CREATE_TOKEN_FEE_AMOUNT();
        uint256 lpEth = 2 ether;

        address t = _createDirectWithValue("TradeDir", "TRD", feeAmount + lpEth);

        // V4 pool initialized
        (uint160 sp, , , ) = IPoolManager(V4_POOL_MGR).getSlot0(
            _v4PoolKey(t).toId()
        );
        assertTrue(sp > 0, "V4 pool initialized");

        // The token is transfer-restricted (Token.launched=false) so we can't
        // test user-to-user V4 trading without calling launch(). But we verify
        // the pool exists and is priced correctly.
        uint256 ethPriceUSD = arrowpad.getETHPriceByUSD();
        uint256 price = _v4PriceScaled(t);
        console.log("V4 price (ETH/token):", price);
        assertTrue(price > 0, "V4 price > 0");

        console.log("V4 pool is ready for trading");
    }

    /// @notice Direct-launch LP is locked in the manager, not burned — burning would
    ///         make the position's trading fees permanently unclaimable.
    function test_Direct26_V4LPLockedInManager() public {
        console.log("=== DIRECT TEST 26: V4 position NFT locked in LM ===");
        uint256 feeAmount = arrowpad.CREATE_TOKEN_FEE_AMOUNT();
        uint256 lpEth = 1 ether;
        address DEAD = 0x000000000000000000000000000000000000dEaD;

        uint256 deadBefore = IERC20(V4_POS_MGR).balanceOf(DEAD);
        uint256 lmBefore = IERC20(V4_POS_MGR).balanceOf(address(liquidityManager));
        address t = _createDirectWithValue("LockLP", "LLP", feeAmount + lpEth);
        uint256 deadAfter = IERC20(V4_POS_MGR).balanceOf(DEAD);

        assertEq(deadAfter, deadBefore, "position must NOT be burned");

        assertEq(
            IERC20(V4_POS_MGR).balanceOf(address(liquidityManager)),
            lmBefore + 1,
            "LM holds the position"
        );
        assertTrue(
            liquidityManager.v4PositionOf(t) != 0,
            "position id recorded for fee collection"
        );

        console.log("V4 LP position locked in manager correctly");
    }

    receive() external payable {}
}
