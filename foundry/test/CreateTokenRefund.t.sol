// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Arrowpad} from "../src/Arrowpad.sol";
import {ArrowpadLiquidityManager} from "../src/ArrowpadLiquidityManager.sol";
import {ArrowpadDeploy} from "../src/ArrowpadDeploy.sol";
import {Token} from "../src/Token.sol";

/// createToken must refund against the ETH actually consumed by the curve, not
/// the requested buyAmount. _swapExactETHForTokens caps the effective buy against
/// the real token reserve; ignoring its return value leaves the capped-away ETH
/// stranded in the contract with no path out. buy() already accounts for this
/// (see its usedBuy handling) — createToken must too.
contract CreateTokenRefundTest is Test {
    Arrowpad internal arrowpad;
    ArrowpadLiquidityManager internal liquidityManager;

    address internal constant PERMIT2_ADDR =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant FEE_WALLET =
        0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103;
    address internal constant DIST_ADDR =
        0xF2917a81fF74406fbCf01c507057e101Db8f2F12;

    address internal user;
    uint256 internal fee;

    // This contract is the configured marginRecipient, so it must accept ETH.
    receive() external payable {}

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("FORK_URL", string("https://ethereum-rpc.publicnode.com"))
        );

        liquidityManager = ArrowpadDeploy.deployLiquidityManager(
            vm.envOr("V2_ROUTER", 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D),
            vm.envOr("V3_FACTORY", 0x1F98431c8aD98523631AE4a59f267346ea31F984),
            vm.envOr("V3_POS_MGR", 0xC36442b4a4522E871399CD717aBDD847Ab11FE88),
            vm.envOr("V4_POOL_MGR", 0x000000000004444c5dc75cB358380D2e3dE08A90),
            vm.envOr("UNIVERSAL_ROUTER", 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af),
            vm.envOr("V4_POS_MGR", 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e),
            PERMIT2_ADDR,
            address(this),
            address(this),
            10000,
            10000,
            address(this)
        );
        arrowpad = ArrowpadDeploy.deployArrowpad(
            vm.envOr("DATA_FEED", 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419),
            address(liquidityManager),
            FEE_WALLET,
            DIST_ADDR,
            address(this)
        );
        liquidityManager.setAuthorizedCaller(address(arrowpad), true);
        arrowpad.setMaxBuyPercent(10000);
        // Match the live Robinhood config: that chain's ETH/USD feed has a ~2h
        // heartbeat, so the 1h default reads it as stale and the Chainlink path would
        // look dead — which would quietly make the fallback tests test nothing.
        arrowpad.setPriceStalenessThreshold(86400);

        fee = arrowpad.CREATE_TOKEN_FEE_AMOUNT();
        user = makeAddr("user");
        vm.deal(user, 100_000 ether);
    }

    function _create(uint256 buyAmount) internal returns (address) {
        vm.prank(user);
        return
            arrowpad.createToken{value: buyAmount + fee}(
                "T",
                "T",
                buyAmount,
                0,
                0,
                3, // V4 graduation target (proven to work on this fork)
                block.timestamp + 1
            );
    }

    /// The reserve cap binds well before the whole real reserve is bought, so a
    /// large first buy consumes far less ETH than requested. Everything not
    /// consumed must come back to the buyer.
    function test_createToken_cappedBuy_refundsTheDifference() public {
        uint256 requested = 20 ether;
        uint256 balBefore = user.balance;

        _create(requested);

        uint256 spent = balBefore - user.balance;
        assertLt(spent, requested, "cap bound: buyer must not be charged the full request");
        assertEq(
            address(arrowpad).balance,
            arrowpad.totalCurveEthReserve(),
            "stranded ETH: contract holds more than the curve accounts for"
        );
    }

    /// No buyAmount may leave unaccounted ETH sitting in the contract.
    function testFuzz_createToken_neverStrandsETH(uint256 buyAmount) public {
        buyAmount = bound(buyAmount, 0, 30 ether);
        _create(buyAmount);

        assertEq(
            address(arrowpad).balance,
            arrowpad.totalCurveEthReserve(),
            "contract holds ETH not accounted for in the curve reserve"
        );
    }

    /// Point the feed at a round so old it is always stale.
    function _killOracle() internal {
        vm.mockCall(
            vm.envOr("DATA_FEED", 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419),
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(1), int256(3000e8), uint256(1), uint256(1), uint80(1))
        );
    }

    /// The bonding curve needs no oracle: creation must survive a dead feed rather
    /// than brick on a reporting-only event field.
    function test_createToken_survivesStaleOracle() public {
        _killOracle();
        assertEq(arrowpad.getTokenVirtualMarketCap(address(0)), 0, "feed is dead");

        address t = _create(0.5 ether);
        assertTrue(t != address(0), "creation must not brick on a stale feed");
    }

    /// createTokenDirect genuinely needs the price to set its opening tick, so it
    /// must revert with a reason rather than panic on a divide-by-zero.
    function test_createTokenDirect_staleOracleRevertsCleanly() public {
        _killOracle();
        uint256 v = arrowpad.CREATE_TOKEN_FEE_AMOUNT();
        vm.prank(user);
        vm.expectRevert(bytes("Invalid or stale price feed"));
        arrowpad.createTokenDirect{value: v}("D", "D", 0, block.timestamp + 1);
    }

    // ============ Deploy-time decisions (locked down deliberately) ============

    /// DECISION: the 45% price-impact breaker is deliberately raised to 99.99%, which
    /// effectively disables it for buys — the reserve cap + refund path is what keeps
    /// a large buy safe instead. If someone lowers this back, the trade-off changed
    /// and they should have to say so here.
    function test_decision_maxPriceImpactIs9999() public view {
        assertEq(arrowpad.MAX_PRICE_IMPACT(), 9_999, "breaker deliberately at 99.99%");
    }

    /// With the breaker at 99.99% a buy far past the reserve cap must NOT revert on
    /// price impact — it must be capped and refunded. This is the exact path the old
    /// 4500 breaker used to hide.
    function test_decision_hugeBuyIsCappedNotBlockedByImpact() public {
        uint256 requested = 25 ether;
        uint256 balBefore = user.balance;
        _create(requested); // must not revert on "Exceeds max price impact"
        assertLt(balBefore - user.balance, requested, "capped and refunded, not blocked");
    }

    /// DECISION: creation costs 0.001 ETH. initialize() sets it and the Robinhood
    /// deploy script deliberately does not override it (the old live contract ran 0).
    function test_decision_createFeeIs001() public view {
        assertEq(arrowpad.CREATE_TOKEN_FEE_AMOUNT(), 0.001 ether, "creation fee is 0.001 ETH");
    }

    /// The fee must actually be charged and forwarded to feeAddress, not just declared.
    function test_decision_createFeeIsCollected() public {
        uint256 feeBefore = FEE_WALLET.balance;
        uint256 balBefore = user.balance;

        _create(0); // no buy: the only ETH leaving the user is the fee

        assertEq(FEE_WALLET.balance - feeBefore, fee, "fee forwarded to feeAddress");
        assertEq(balBefore - user.balance, fee, "user charged exactly the fee");
    }

    /// Underpaying the fee must revert, not mint a free token.
    function test_decision_createBelowFeeReverts() public {
        vm.prank(user);
        vm.expectRevert(bytes("Insufficient ETH value"));
        arrowpad.createToken{value: fee - 1}("T", "T", 0, 0, 0, 3, block.timestamp + 1);
    }

    function test_decision_createTokenDirectBelowFeeReverts() public {
        vm.prank(user);
        vm.expectRevert(bytes("Insufficient fee"));
        arrowpad.createTokenDirect{value: fee - 1}("D", "D", 0, block.timestamp + 1);
    }

    /// Direct launch takes the fee and refunds the rest — the creator buys nothing.
    function test_decision_createTokenDirectRefundsAboveFee() public {
        uint256 feeBefore = FEE_WALLET.balance;
        uint256 balBefore = user.balance;

        vm.prank(user);
        arrowpad.createTokenDirect{value: fee + 5 ether}("D", "D", 0, block.timestamp + 1);

        assertEq(FEE_WALLET.balance - feeBefore, fee, "fee forwarded");
        assertEq(balBefore - user.balance, fee, "everything above the fee refunded");
    }

    // ==================== V2 ETH/stable price fallback ====================

    /// Router + a real USD stable paired with WETH on that router's V2 factory.
    /// Defaults to mainnet Uniswap V2 / _stable(); FALLBACK_STABLE overrides it per chain
    /// (Robinhood uses USDG). Both must be genuinely deep pairs — the point is to
    /// prove the fallback against real liquidity, not a mock.
    function _v2Router() internal view returns (address) {
        return vm.envOr("V2_ROUTER", 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
    }

    function _stable() internal view returns (address) {
        return
            vm.envOr("FALLBACK_STABLE", 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    }

    /// Fallback is opt-in: untouched, a dead Chainlink feed still means "no price".
    function test_fallback_disabledByDefault() public {
        _killOracle();
        assertEq(address(arrowpad.fallbackRouterV2()), address(0), "off by default");
        assertEq(
            arrowpad.getTokenVirtualMarketCap(address(0)),
            0,
            "no fallback configured => no price"
        );
    }

    /// With Chainlink dead and the fallback wired to the real V2 _stable()/WETH pair,
    /// the curve keeps pricing instead of stalling.
    function test_fallback_pricesEthWhenChainlinkIsDead() public {
        arrowpad.setEthUsdFallback(_v2Router(), _stable());

        address t = _create(0.5 ether);
        uint256 liveMcap = arrowpad.getTokenVirtualMarketCap(t);
        assertGt(liveMcap, 0, "chainlink path works");

        _killOracle();
        uint256 fallbackMcap = arrowpad.getTokenVirtualMarketCap(t);
        assertGt(fallbackMcap, 0, "fallback must price ETH when chainlink is down");

        // Same asset, same block: the two sources must broadly agree (within 20%).
        // A wild divergence means the decimal normalisation is wrong.
        uint256 hi = liveMcap > fallbackMcap ? liveMcap : fallbackMcap;
        uint256 lo = liveMcap > fallbackMcap ? fallbackMcap : liveMcap;
        assertLt((hi - lo) * 100 / hi, 20, "V2 price disagrees wildly with chainlink");
    }

    /// Chainlink must win while it is healthy — the fallback is a last resort.
    function test_fallback_chainlinkTakesPrecedence() public {
        uint256 before = arrowpad.getETHPriceByUSD();
        arrowpad.setEthUsdFallback(_v2Router(), _stable());
        assertEq(arrowpad.getETHPriceByUSD(), before, "healthy chainlink must win");
    }

    /// A typo must fail at configuration time, not silently read 0 mid-outage.
    /// Real ERC20 (so decimals() resolves) with no WETH pair on the V2 factory.
    function test_fallback_rejectsPairlessStable() public {
        Token orphan = new Token("Orphan", "ORP", 1e18);
        vm.expectRevert(bytes("No V2 pair for stable"));
        arrowpad.setEthUsdFallback(_v2Router(), address(orphan));
    }

    function test_fallback_canBeDisabled() public {
        arrowpad.setEthUsdFallback(_v2Router(), _stable());
        arrowpad.setEthUsdFallback(address(0), address(0));
        _killOracle();
        assertEq(arrowpad.getTokenVirtualMarketCap(address(0)), 0, "cleared");
    }

    function test_fallback_onlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        arrowpad.setEthUsdFallback(_v2Router(), _stable());
    }
}
