// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {Arrowpad, IArrowpad} from "../src/Arrowpad.sol";
import {ArrowpadLiquidityManager} from "../src/ArrowpadLiquidityManager.sol";
import {ArrowpadDeploy} from "../src/ArrowpadDeploy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {
    IUniswapV2Router02
} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {
    INonfungiblePositionManager
} from "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {IPoolManager} from "../src/v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "../src/v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "../src/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../src/v4-core/types/PoolId.sol";
import {Currency} from "../src/v4-core/types/Currency.sol";
import {IHooks} from "../src/v4-core/interfaces/IHooks.sol";
import {SwapParams} from "../src/v4-core/types/PoolOperation.sol";
import {BalanceDelta} from "../src/v4-core/types/BalanceDelta.sol";
import {StateLibrary} from "../src/v4-core/libraries/StateLibrary.sol";
import {IPositionManager} from "../src/v4-periphery/interfaces/IPositionManager.sol";

/// @dev Minimal V3 swapper that talks to the pool directly and pays inside the
///      callback. Avoids depending on a SwapRouter deployment, which not every chain
///      has (Robinhood does not).
contract V3PoolSwapper {
    uint160 constant MIN_SQRT = 4295128740;
    uint160 constant MAX_SQRT =
        1461446703485210103287273052203988822378723970341;

    function wrap(address weth, uint256 amount) external {
        IWETH(weth).deposit{value: amount}();
    }

    function swap(address pool, bool zeroForOne, uint256 amountIn) external {
        IUniswapV3Pool(pool).swap(
            address(this),
            zeroForOne,
            int256(amountIn),
            zeroForOne ? MIN_SQRT : MAX_SQRT,
            abi.encode(pool)
        );
    }

    /// Pay whatever the pool says we owe.
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        address pool = abi.decode(data, (address));
        require(msg.sender == pool, "only pool");
        if (amount0Delta > 0) {
            IERC20(IUniswapV3Pool(pool).token0()).transfer(
                pool,
                uint256(amount0Delta)
            );
        }
        if (amount1Delta > 0) {
            IERC20(IUniswapV3Pool(pool).token1()).transfer(
                pool,
                uint256(amount1Delta)
            );
        }
    }

    receive() external payable {}
}

/// @dev Minimal V4 swapper: the pool manager only lets you swap inside an unlock
///      callback. Exists purely so the tests can generate REAL V4 trading fees
///      instead of asserting the collect path against a pool nobody ever traded.
contract V4Swapper is IUnlockCallback {
    IPoolManager public immutable pm;
    address public immutable weth;

    constructor(IPoolManager _pm, address _weth) {
        pm = _pm;
        weth = _weth;
    }

    function swap(PoolKey memory key, bool zeroForOne, uint256 amountIn) external {
        pm.unlock(abi.encode(key, zeroForOne, amountIn));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "only pm");
        (PoolKey memory key, bool zeroForOne, uint256 amountIn) = abi.decode(
            data,
            (PoolKey, bool, uint256)
        );

        BalanceDelta delta = pm.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne
                    ? 4295128740
                    : 1461446703485210103287273052203988822378723970341
            }),
            ""
        );

        Currency inC = zeroForOne ? key.currency0 : key.currency1;
        Currency outC = zeroForOne ? key.currency1 : key.currency0;
        int128 inAmt = zeroForOne ? delta.amount0() : delta.amount1();
        int128 outAmt = zeroForOne ? delta.amount1() : delta.amount0();

        // Pay what we owe, then take what we're owed.
        pm.sync(inC);
        IERC20(Currency.unwrap(inC)).transfer(address(pm), uint256(uint128(-inAmt)));
        pm.settle();
        if (outAmt > 0) {
            pm.take(outC, address(this), uint256(uint128(outAmt)));
        }
        return "";
    }
}

contract ClaimFeesTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    Arrowpad public arrowpad;
    ArrowpadLiquidityManager public liquidityManager;

    address UNISWAP_V2_ROUTER;
    address V3_FACTORY;
    address V3_POS_MGR;
    address V4_POOL_MGR;
    address UNIVERSAL_ROUTER;
    address V4_POS_MGR;
    address DATA_FEED;
    address WETH;

    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant FEE_WALLET = 0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103;
    address constant DIST_ADDR = 0xF2917a81fF74406fbCf01c507057e101Db8f2F12;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint24 constant V3_FEE = 100;
    int24 constant TICK_SPACING = 60;

    address creator; // deploys the tokens -> receives the 50% creator share
    address trader;

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
        // Ask the router rather than pinning mainnet WETH — this suite also runs
        // against Robinhood, where WETH lives at a different address.
        WETH = IUniswapV2Router02(UNISWAP_V2_ROUTER).WETH();

        creator = makeAddr("creator");
        trader = makeAddr("trader");
        vm.deal(address(this), 100_000 ether);
        vm.deal(creator, 100_000 ether);
        vm.deal(trader, 100_000 ether);

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
        liquidityManager.setAuthorizedCaller(address(arrowpad), true);
        // Match the live Robinhood config (DeployRobinhood.s.sol): that chain's
        // ETH/USD feed has a ~2h heartbeat, so the 1h default reads it as stale,
        // mcap comes back 0 and nothing ever graduates. Harmless on mainnet, where
        // the feed is fresh at the fork block.
        arrowpad.setPriceStalenessThreshold(86400);
    }

    // ==================== HELPERS ====================

    function _graduate(
        string memory name,
        string memory sym,
        uint8 poolType
    ) internal returns (address t) {
        vm.prank(creator);
        t = arrowpad.createToken{value: 0.01 ether}(
            name,
            sym,
            0,
            0,
            0,
            poolType,
            block.timestamp + 1
        );
        for (uint256 i = 0; i < 1000 && !_pool(t).launched; i++) {
            vm.prank(trader);
            arrowpad.swapExactETHForTokens{value: 0.05 ether}(
                t,
                0.05 ether,
                0,
                block.timestamp
            );
        }
        require(_pool(t).launched, "did not graduate");
    }

    function _pool(address t) internal view returns (IArrowpad.PoolInfo memory) {
        return IArrowpad(address(arrowpad)).tokenPools(t);
    }

    /// @dev Round-trip swaps on the real V3 pool to accrue genuine trading fees.
    /// Swap straight against the V3 pool via its callback instead of going through a
    /// SwapRouter. Robinhood has no SwapRouter deployment, and the router adds nothing
    /// here — we only need real volume to accrue fees.
    function _generateV3Fees(address token) internal {
        address pool = IUniswapV3Factory(V3_FACTORY).getPool(token, WETH, V3_FEE);
        require(pool != address(0), "no V3 pool");

        V3PoolSwapper s = new V3PoolSwapper();
        vm.deal(address(s), 60 ether);
        s.wrap(WETH, 50 ether);

        for (uint256 i = 0; i < 3; i++) {
            s.swap(pool, WETH < token, 1 ether); // WETH -> token
            uint256 bal = IERC20(token).balanceOf(address(s));
            if (bal > 0) s.swap(pool, token < WETH, bal); // token -> WETH
        }
    }

    function _v4Key(address token) internal view returns (PoolKey memory) {
        (address c0, address c1) = token < WETH ? (token, WETH) : (WETH, token);
        return
            PoolKey({
                currency0: Currency.wrap(c0),
                currency1: Currency.wrap(c1),
                fee: V3_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(address(0))
            });
    }

    function _generateV4Fees(address token) internal {
        PoolKey memory key = _v4Key(token);
        V4Swapper swapper = new V4Swapper(IPoolManager(V4_POOL_MGR), WETH);

        vm.deal(address(swapper), 20 ether);
        vm.prank(address(swapper));
        IWETH(WETH).deposit{value: 10 ether}();

        bool wethIsZero = Currency.unwrap(key.currency0) == WETH;
        for (uint256 i = 0; i < 3; i++) {
            swapper.swap(key, wethIsZero, 1 ether); // WETH -> token
            uint256 bal = IERC20(token).balanceOf(address(swapper));
            swapper.swap(key, !wethIsZero, bal); // token -> WETH
        }
    }

    function _v3Liquidity(uint256 id) internal view returns (uint128 liq) {
        (, , , , , , , liq, , , , ) = INonfungiblePositionManager(V3_POS_MGR)
            .positions(id);
    }

    // ==================== V3 ====================

    function test_Claim01_V3FeesSplit5050() public {
        address t = _graduate("FeeV3", "FV3", 2);
        _generateV3Fees(t);

        uint256 creatorEthBefore = creator.balance;
        uint256 platformEthBefore = FEE_WALLET.balance;
        uint256 creatorTokBefore = IERC20(t).balanceOf(creator);
        uint256 platformTokBefore = IERC20(t).balanceOf(FEE_WALLET);

        (uint256 ethFees, uint256 tokenFees) = arrowpad.claimFees(t);

        assertGt(ethFees, 0, "real ETH fees accrued");
        assertGt(tokenFees, 0, "real token fees accrued");

        uint256 creatorEth = creator.balance - creatorEthBefore;
        uint256 platformEth = FEE_WALLET.balance - platformEthBefore;
        uint256 creatorTok = IERC20(t).balanceOf(creator) - creatorTokBefore;
        uint256 platformTok = IERC20(t).balanceOf(FEE_WALLET) - platformTokBefore;

        assertEq(creatorEth + platformEth, ethFees, "all ETH fees paid out");
        assertEq(creatorTok + platformTok, tokenFees, "all token fees paid out");
        assertEq(creatorEth, ethFees / 2, "creator gets 50% of ETH");
        assertEq(platformEth, ethFees - ethFees / 2, "platform gets 50% of ETH");
        assertEq(creatorTok, tokenFees / 2, "creator gets 50% of tokens");
        assertEq(platformTok, tokenFees - tokenFees / 2, "platform gets 50% of tokens");

        console.log("V3 ETH fees claimed  :", ethFees);
        console.log("V3 token fees claimed:", tokenFees);
    }

    /// @dev The whole point of locking instead of burning: claiming must never be
    ///      able to pull principal out of the position.
    function test_Claim02_V3ClaimDoesNotTouchPrincipal() public {
        address t = _graduate("PrinV3", "PV3", 2);
        _generateV3Fees(t);

        uint256 id = liquidityManager.v3PositionOf(t);
        uint128 liqBefore = _v3Liquidity(id);
        assertGt(liqBefore, 0, "position has liquidity");

        arrowpad.claimFees(t);

        assertEq(_v3Liquidity(id), liqBefore, "liquidity unchanged by claim");
        assertEq(
            INonfungiblePositionManager(V3_POS_MGR).ownerOf(id),
            address(liquidityManager),
            "position still locked in manager"
        );
    }

    function test_Claim03_V3SecondClaimYieldsNothingUntilMoreTrading() public {
        address t = _graduate("TwiceV3", "TV3", 2);
        _generateV3Fees(t);

        (uint256 eth1, uint256 tok1) = arrowpad.claimFees(t);
        assertGt(eth1 + tok1, 0, "first claim pays");

        (uint256 eth2, uint256 tok2) = arrowpad.claimFees(t);
        assertEq(eth2, 0, "no ETH fees left immediately after claiming");
        assertEq(tok2, 0, "no token fees left immediately after claiming");

        _generateV3Fees(t);
        (uint256 eth3, uint256 tok3) = arrowpad.claimFees(t);
        assertGt(eth3 + tok3, 0, "new trading accrues new fees");
    }

    // ==================== V4 ====================

    function test_Claim04_V4FeesSplit5050() public {
        address t = _graduate("FeeV4", "FV4", 3);
        _generateV4Fees(t);

        uint256 creatorEthBefore = creator.balance;
        uint256 platformEthBefore = FEE_WALLET.balance;
        uint256 creatorTokBefore = IERC20(t).balanceOf(creator);
        uint256 platformTokBefore = IERC20(t).balanceOf(FEE_WALLET);

        (uint256 ethFees, uint256 tokenFees) = arrowpad.claimFees(t);
        assertGt(ethFees + tokenFees, 0, "real V4 fees accrued and collected");

        uint256 creatorEth = creator.balance - creatorEthBefore;
        uint256 platformEth = FEE_WALLET.balance - platformEthBefore;
        uint256 creatorTok = IERC20(t).balanceOf(creator) - creatorTokBefore;
        uint256 platformTok = IERC20(t).balanceOf(FEE_WALLET) - platformTokBefore;

        assertEq(creatorEth + platformEth, ethFees, "all ETH fees paid out");
        assertEq(creatorTok + platformTok, tokenFees, "all token fees paid out");
        assertEq(creatorEth, ethFees / 2, "creator gets 50% of ETH");
        assertEq(creatorTok, tokenFees / 2, "creator gets 50% of tokens");

        console.log("V4 ETH fees claimed  :", ethFees);
        console.log("V4 token fees claimed:", tokenFees);
    }

    function test_Claim05_V4ClaimDoesNotTouchPrincipal() public {
        address t = _graduate("PrinV4", "PV4", 3);
        _generateV4Fees(t);

        uint256 id = liquidityManager.v4PositionOf(t);
        uint128 liqBefore = IPositionManager(V4_POS_MGR).getPositionLiquidity(id);
        assertGt(liqBefore, 0, "position has liquidity");

        arrowpad.claimFees(t);

        assertEq(
            IPositionManager(V4_POS_MGR).getPositionLiquidity(id),
            liqBefore,
            "liquidity unchanged by claim"
        );
    }

    // ==================== GUARDS ====================

    /// @dev V2 fees accrue into the pool reserves and can only be realised by burning
    ///      LP, which would drag principal out with them. Nothing to claim — say so
    ///      rather than silently paying zero.
    function test_Claim06_V2HasNothingToClaim() public {
        address t = _graduate("FeeV2", "FV2", 1);
        vm.expectRevert("No claimable position");
        arrowpad.claimFees(t);
    }

    function test_Claim07_UnknownTokenReverts() public {
        vm.expectRevert("Unknown token");
        arrowpad.claimFees(makeAddr("nope"));
    }

    function test_Claim08_UnlaunchedTokenReverts() public {
        vm.prank(creator);
        address t = arrowpad.createToken{value: 0.01 ether}(
            "NoGrad",
            "NG",
            0,
            0,
            0,
            3,
            block.timestamp + 1
        );
        vm.expectRevert("Not launched");
        arrowpad.claimFees(t);
    }

    /// @dev collectFees moves real money, so only Arrowpad may drive it — otherwise
    ///      anyone could redirect the split by passing their own addresses.
    function test_Claim09_OnlyAuthorizedCanCollect() public {
        address t = _graduate("AuthV3", "AV3", 2);
        _generateV3Fees(t);

        vm.prank(trader);
        vm.expectRevert("Unauthorized");
        liquidityManager.collectFees(t, trader, trader);
    }

    /// @dev Anyone may TRIGGER a claim: the recipients come from on-chain state, so a
    ///      third party poking it just does the creator a favour. This keeps the UI
    ///      free to claim on a creator's behalf.
    function test_Claim10_AnyoneCanTriggerClaimButPayoutIsFixed() public {
        address t = _graduate("PokeV3", "PV3", 2);
        _generateV3Fees(t);

        uint256 traderEthBefore = trader.balance;
        uint256 creatorEthBefore = creator.balance;

        vm.prank(trader);
        (uint256 ethFees, ) = arrowpad.claimFees(t);

        assertGt(ethFees, 0, "fees were claimed");
        assertEq(trader.balance, traderEthBefore, "caller gets nothing");
        assertEq(
            creator.balance - creatorEthBefore,
            ethFees / 2,
            "creator still gets their half"
        );
    }

    /// @dev The LP lock is only as real as the absence of a withdraw path. If someone
    ///      ever adds one, this catches it.
    function test_Claim11_ManagerExposesNoLiquidityWithdrawal() public {
        string[6] memory forbidden = [
            "decreaseLiquidity(uint256,uint128)",
            "withdrawLP(address)",
            "burnPosition(uint256)",
            "transferPosition(address,uint256)",
            "removeLiquidity(address)",
            "exit(address)"
        ];
        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool ok, ) = address(liquidityManager).call(
                abi.encodeWithSignature(forbidden[i], 0, 0)
            );
            assertFalse(ok, forbidden[i]);
        }
    }

    // ==================== V4 DIRECT (no bonding curve) ====================

    /// Direct launches skip the curve entirely: the whole supply is seeded as
    /// single-sided V4 liquidity at creation. That LP still earns real trading fees,
    /// and they must be claimable and split 50/50 like any other position.
    /// @dev Read the fee BEFORE pranking. A getter call inside the `{value: ...}`
    ///      expression is evaluated first and consumes the prank, so the launch would
    ///      run as this test contract and pool.owner would be wrong.
    function _createDirect(
        string memory name,
        string memory sym
    ) internal returns (address t) {
        uint256 fee = arrowpad.CREATE_TOKEN_FEE_AMOUNT();
        vm.prank(creator);
        t = arrowpad.createTokenDirect{value: fee}(
            name,
            sym,
            0,
            block.timestamp + 1
        );
    }

    function test_Claim12_V4DirectFeesSplit5050() public {
        address t = _createDirect("DirectFee", "DFE");
        _generateV4Fees(t);

        uint256 creatorEthBefore = creator.balance;
        uint256 platformEthBefore = FEE_WALLET.balance;
        uint256 creatorTokBefore = IERC20(t).balanceOf(creator);
        uint256 platformTokBefore = IERC20(t).balanceOf(FEE_WALLET);

        (uint256 ethFees, uint256 tokenFees) = arrowpad.claimFees(t);
        assertGt(ethFees + tokenFees, 0, "direct-launch LP accrued real fees");

        uint256 creatorEth = creator.balance - creatorEthBefore;
        uint256 platformEth = FEE_WALLET.balance - platformEthBefore;
        uint256 creatorTok = IERC20(t).balanceOf(creator) - creatorTokBefore;
        uint256 platformTok = IERC20(t).balanceOf(FEE_WALLET) - platformTokBefore;

        assertEq(creatorEth + platformEth, ethFees, "all ETH fees paid out");
        assertEq(creatorTok + platformTok, tokenFees, "all token fees paid out");
        assertEq(creatorEth, ethFees / 2, "creator gets 50% of ETH");
        assertEq(creatorTok, tokenFees / 2, "creator gets 50% of tokens");

        console.log("V4-direct ETH fees  :", ethFees);
        console.log("V4-direct token fees:", tokenFees);
    }

    /// Claiming a direct launch must never eat into the locked principal.
    function test_Claim13_V4DirectClaimDoesNotTouchPrincipal() public {
        address t = _createDirect("DirectPrin", "DPR");
        _generateV4Fees(t);

        uint256 posBefore = liquidityManager.v4PositionOf(t);
        arrowpad.claimFees(t);

        assertEq(liquidityManager.v4PositionOf(t), posBefore, "LP position still held");
        assertGt(posBefore, 0, "position exists");

        // A second claim with no trading in between yields nothing — proof the first
        // claim took fees only and left the principal alone.
        (uint256 eth2, uint256 tok2) = arrowpad.claimFees(t);
        assertEq(eth2 + tok2, 0, "nothing left to claim without more trading");
    }

    /// End-to-end: every pool type the protocol can produce (V3 + V4 via the curve,
    /// and V4 direct) must trade and pay out claimable fees.
    function test_Claim14_AllPoolTypesTradeAndClaim() public {
        address v3 = _graduate("AllV3", "AV3", 2);
        address v4 = _graduate("AllV4", "AV4", 3);
        address v4d = _createDirect("AllV4D", "AV4D");

        _generateV3Fees(v3);
        _generateV4Fees(v4);
        _generateV4Fees(v4d);

        string[3] memory labels = ["V3      ", "V4      ", "V4direct"];
        address[3] memory toks = [v3, v4, v4d];

        for (uint256 i = 0; i < 3; i++) {
            uint256 cEth = creator.balance;
            uint256 pEth = FEE_WALLET.balance;

            (uint256 ethFees, uint256 tokenFees) = arrowpad.claimFees(toks[i]);
            assertGt(ethFees + tokenFees, 0, "each pool type must accrue fees");

            uint256 paidEth = (creator.balance - cEth) + (FEE_WALLET.balance - pEth);
            assertEq(paidEth, ethFees, "all ETH fees paid out");

            console.log(labels[i], "eth:", ethFees);
            console.log(labels[i], "tok:", tokenFees);
        }
    }

    receive() external payable {}
}
