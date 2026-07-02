// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
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
    AggregatorV3Interface
} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

interface IWETHMin {
    function deposit() external payable;
    function transfer(address to, uint256 v) external returns (bool);
}

interface IV3PoolMin {
    function initialize(uint160 sqrtPriceX96) external;
}

/// @notice A token creator that rejects incoming ETH — models the owner-fee
///         honeypot the fee-tolerance fix must neutralize.
contract HostileOwner {
    Arrowpad public ap;
    constructor(Arrowpad _ap) { ap = _ap; }
    function create() external payable returns (address) {
        ap.createToken{value: msg.value}("Hostile", "HOST", 0, 0, 0, 1, block.timestamp);
        return address(0);
    }
    // Reverts on any ETH receipt -> would brick trading without the tolerant send.
    receive() external payable { revert("no eth"); }
}

/// Adversarial tests for the round-2 contract hardening. Runs on any fork; defaults
/// to Ethereum mainnet, overridable via env (same knobs as Arrowpad.t.sol).
contract ArrowpadHardeningTest is Test {
    Arrowpad arrowpad;
    ArrowpadLiquidityManager lm;
    IUniswapV2Router02 router;

    address V2_ROUTER;
    address V3_FACTORY;
    address V3_POS_MGR;
    address V4_POOL_MGR;
    address UNIVERSAL_ROUTER;
    address V4_POS_MGR;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address DATA_FEED;

    address buyer;
    uint256 TARGET;
    uint256 constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;

    function setUp() public {
        vm.createSelectFork(vm.envOr("FORK_URL", string("https://ethereum-rpc.publicnode.com")));
        V2_ROUTER = vm.envOr("V2_ROUTER", 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
        V3_FACTORY = vm.envOr("V3_FACTORY", 0x1F98431c8aD98523631AE4a59f267346ea31F984);
        V3_POS_MGR = vm.envOr("V3_POS_MGR", 0xC36442b4a4522E871399CD717aBDD847Ab11FE88);
        V4_POOL_MGR = vm.envOr("V4_POOL_MGR", 0x000000000004444c5dc75cB358380D2e3dE08A90);
        UNIVERSAL_ROUTER = vm.envOr("UNIVERSAL_ROUTER", 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af);
        V4_POS_MGR = vm.envOr("V4_POS_MGR", 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e);
        DATA_FEED = vm.envOr("DATA_FEED", 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419);

        router = IUniswapV2Router02(V2_ROUTER);
        lm = new ArrowpadLiquidityManager(
            V2_ROUTER, V3_FACTORY, V3_POS_MGR, V4_POOL_MGR, UNIVERSAL_ROUTER,
            V4_POS_MGR, PERMIT2, address(this), address(this), 10000, 10000
        );
        arrowpad = new Arrowpad(DATA_FEED, address(lm), address(0xFEE), address(0xD15));
        lm.setAuthorizedCaller(address(arrowpad), true);
        arrowpad.setPlatformBuyFeeBps(100);
        arrowpad.setPlatformSellFeeBps(100);
        arrowpad.setMaxBuyPercent(10000);
        arrowpad.setMaxSellPercent(10000);
        TARGET = arrowpad.TARGET_MARKET_CAP_USD();

        buyer = makeAddr("buyer");
        vm.deal(buyer, 200_000 ether);
        vm.deal(address(this), 200_000 ether);
    }

    function _create(string memory n, string memory s, uint8 pt) internal returns (address) {
        vm.recordLogs();
        arrowpad.createToken{value: arrowpad.CREATE_TOKEN_FEE_AMOUNT()}(n, s, 0, 0, 0, pt, block.timestamp);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("TokenCreated(address,uint256,uint256,uint32,uint256)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == sig) {
                (address t,,,,) = abi.decode(logs[i].data, (address, uint256, uint256, uint32, uint256));
                return t;
            }
        }
        revert("no TokenCreated");
    }

    function _launched(address t) internal view returns (bool l) {
        (,,,,,,, l) = arrowpad.tokenPools(t);
    }

    function _v2Fdv(address t) internal view returns (uint256) {
        address weth = router.WETH();
        address pair = IUniswapV2Factory(router.factory()).getPair(t, weth);
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        (uint256 e, uint256 tok) = IUniswapV2Pair(pair).token0() == weth
            ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        return (arrowpad.getETHPriceByUSD() * TOTAL_SUPPLY * e) / tok / 1e18;
    }

    function _tokenFromLogs() internal returns (address) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("TokenCreated(address,uint256,uint256,uint32,uint256)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == sig) {
                (address t,,,,) = abi.decode(logs[i].data, (address, uint256, uint256, uint32, uint256));
                return t;
            }
        }
        revert("no TokenCreated");
    }

    // ---- HIGH-2: owner-fee honeypot must NOT brick trading ----
    function test_OwnerFeeHoneypot_DoesNotBrickTrading() public {
        arrowpad.setTokenOwnerFeeBps(300); // 3% creator fee -> pushed to owner on every trade
        HostileOwner ho = new HostileOwner(arrowpad);
        vm.deal(address(ho), 1 ether);
        vm.recordLogs();
        ho.create{value: arrowpad.CREATE_TOKEN_FEE_AMOUNT()}();
        address t = _tokenFromLogs(); // captured across the nested createToken call

        uint256 before = IERC20(t).balanceOf(buyer);
        vm.prank(buyer);
        // Without the tolerant fee send, this reverts (owner rejects the 3% fee).
        arrowpad.swapExactETHForTokens{value: 1 ether}(t, 1 ether, 0, block.timestamp);
        assertGt(IERC20(t).balanceOf(buyer), before, "buy bricked by hostile owner fee");

        // Sell must also work.
        uint256 bal = IERC20(t).balanceOf(buyer);
        vm.startPrank(buyer);
        IERC20(t).approve(address(arrowpad), bal);
        arrowpad.swapExactTokensForETH(t, bal, 0, block.timestamp);
        vm.stopPrank();
    }

    // ---- MEDIUM-2: a WETH donation to the pending V2 pair must NOT skew launch price ----
    function test_V2Donation_DoesNotSkewLaunchPrice() public {
        address t = _create("DonateV2", "DV2", 1);
        address weth = router.WETH();

        // Griefer front-runs: create the empty pair and donate a large WETH amount.
        address pair = IUniswapV2Factory(router.factory()).createPair(t, weth);
        IWETHMin(weth).deposit{value: 0.3 ether}();
        IWETHMin(weth).transfer(pair, 0.3 ether);

        // Graduate.
        for (uint256 i; i < 3000 && !_launched(t); i++) {
            vm.prank(buyer);
            arrowpad.swapExactETHForTokens{value: 0.05 ether}(t, 0.05 ether, 0, block.timestamp);
        }
        assertTrue(_launched(t), "did not graduate");

        uint256 fdv = _v2Fdv(t);
        // Despite the 5 ETH donation, the pool opens at the target (donation absorbed).
        assertApproxEqRel(fdv, TARGET, 0.02e18, "donation skewed the launch price");
    }

    // ---- HIGH-1: sells never revert when the oracle is stale/broken ----
    function test_StaleOracle_DoesNotBrickSell() public {
        address t = _create("OracleSell", "ORS", 1);
        vm.prank(buyer);
        arrowpad.swapExactETHForTokens{value: 1 ether}(t, 1 ether, 0, block.timestamp);
        uint256 bal = IERC20(t).balanceOf(buyer);

        // Make the feed report a very old timestamp -> _rawEthPrice() returns 0,
        // getETHPriceByUSD() reverts, but trades must still work.
        (uint80 rid, int256 price,,, uint80 air) = AggregatorV3Interface(DATA_FEED).latestRoundData();
        vm.mockCall(
            DATA_FEED,
            abi.encodeWithSelector(AggregatorV3Interface.latestRoundData.selector),
            abi.encode(rid, price, uint256(1), uint256(1), air) // updatedAt = 1 (ancient)
        );

        vm.expectRevert(); // strict read reverts when stale...
        arrowpad.getETHPriceByUSD();

        // ...but the sell still succeeds.
        vm.startPrank(buyer);
        IERC20(t).approve(address(arrowpad), bal);
        arrowpad.swapExactTokensForETH(t, bal, 0, block.timestamp);
        vm.stopPrank();
    }

    // ---- HIGH-3: a griefer-initialized V3 pool must NOT brick graduation ----
    function test_V3Griefed_FallsBackToV2() public {
        address t = _create("GriefV3", "GV3", 2); // poolType 2 = Uniswap V3
        address weth = router.WETH();

        // Griefer permissionlessly creates + initializes the destination V3 pool
        // (fee 100) at a hostile ~1:1 price, far outside the target tolerance.
        address pool = IUniswapV3Factory(V3_FACTORY).createPool(t, weth, 100);
        IV3PoolMin(pool).initialize(uint160(2 ** 96));

        // Graduate: the V3 add reverts on the tolerance check, so the contract must
        // fall back to the brick-proof V2 path rather than reverting every buy.
        for (uint256 i; i < 3000 && !_launched(t); i++) {
            vm.prank(buyer);
            arrowpad.swapExactETHForTokens{value: 0.05 ether}(t, 0.05 ether, 0, block.timestamp);
        }
        assertTrue(_launched(t), "griefed V3 bricked graduation");

        (, , , , , , uint8 pt, ) = arrowpad.tokenPools(t);
        assertEq(pt, 1, "did not fall back to V2");
        assertApproxEqRel(_v2Fdv(t), TARGET, 0.02e18, "V2 fallback opened off target");
    }

    receive() external payable {}
}
