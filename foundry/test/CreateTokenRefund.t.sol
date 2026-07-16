// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Fyuz} from "../src/Fyuz.sol";
import {FyuzLiquidityManager} from "../src/FyuzLiquidityManager.sol";
import {FyuzDeploy} from "../src/FyuzDeploy.sol";
import {Token} from "../src/Token.sol";

/// createToken must refund against the ETH actually consumed by the curve, not
/// the requested buyAmount. _swapExactETHForTokens caps the effective buy against
/// the real token reserve; ignoring its return value leaves the capped-away ETH
/// stranded in the contract with no path out. buy() already accounts for this
/// (see its usedBuy handling) — createToken must too.
contract CreateTokenRefundTest is Test {
    Fyuz internal fyuz;
    FyuzLiquidityManager internal liquidityManager;

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

        liquidityManager = FyuzDeploy.deployLiquidityManager(
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
        fyuz = FyuzDeploy.deployFyuz(
            vm.envOr("DATA_FEED", 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419),
            address(liquidityManager),
            FEE_WALLET,
            DIST_ADDR,
            address(this)
        );
        liquidityManager.setAuthorizedCaller(address(fyuz), true);
        fyuz.setMaxBuyPercent(10000);
        // Match the live Robinhood config: that chain's ETH/USD feed has a ~2h
        // heartbeat, so the 1h default reads it as stale and the Chainlink path would
        // look dead — which would quietly make the fallback tests test nothing.
        fyuz.setPriceStalenessThreshold(86400);

        fee = fyuz.CREATE_TOKEN_FEE_AMOUNT();
        user = makeAddr("user");
        // makeAddr derives from a PUBLICLY KNOWN key (keccak("user")), so on a
        // mainnet fork the address is real, funded-then-drained, and carries live
        // state. On BSC it holds an EIP-7702 delegation designator
        // (0xef0100...) pointing at a sweeper contract: every wei sent to it is
        // instantly forwarded to the attacker. That silently ate this suite's
        // refunds and made a CORRECT refund read as "buyer charged the full
        // request". Clear the delegation so `user` is a plain EOA whose balance
        // actually moves.
        vm.etch(user, "");
        vm.deal(user, 100_000 ether);
    }

    /// Largest gross buyAmount a FRESH curve will accept before the real-token
    /// reserve cap bites, derived from the contract's own constants so it tracks
    /// any recalibration of the curve instead of rotting into a magic number.
    /// Mirrors Fyuz._getMaxBuyForReserve on the initial pool state.
    function _maxEffectiveBuy() internal view returns (uint256) {
        uint256 vEth = fyuz.VIRTUAL_ETH_INITIAL();
        uint256 vTok = fyuz.VIRTUAL_TOKEN_INITIAL();
        uint256 real = fyuz.REAL_TOKEN_INITIAL();
        uint256 feeBps = fyuz.PLATFORM_BUY_FEE_BPS() + fyuz.TOKEN_OWNER_FEE_BPS();
        uint256 maxNet = (real * vEth) / (vTok - real);
        return (maxNet * 10_000) / (10_000 - feeBps);
    }

    function _create(uint256 buyAmount) internal returns (address) {
        vm.prank(user);
        return
            fyuz.createToken{value: buyAmount + fee}(
                "T",
                "T",
                buyAmount,
                0,
                0,
                2, // V3. Was 3 (V4) — now gated off. These tests are about curve
                   // ETH accounting/refunds, so the DEX target is incidental.
                block.timestamp + 1
            );
    }

    /// A first buy larger than the whole real token reserve can absorb consumes
    /// only what the reserve cap allows. Everything not consumed must come back
    /// to the buyer.
    /// @dev The request is derived from the live curve constants rather than
    ///      hardcoded: the old flat `20 ether` was sized for VIRTUAL_ETH_INITIAL
    ///      = 2.5, where 20 ETH overshot the cap. At the shipping vETH of 8.25 the
    ///      curve is deeper and the cap does not bite until ~23.6 ETH, so 20 ETH
    ///      was consumed in full and nothing was refunded — the test was asserting
    ///      against a curve that no longer exists.
    function test_createToken_cappedBuy_refundsTheDifference() public {
        uint256 maxBuy = _maxEffectiveBuy();
        uint256 requested = maxBuy + 10 ether; // comfortably past the cap
        uint256 balBefore = user.balance;

        _create(requested);

        uint256 spent = balBefore - user.balance;
        assertLt(spent, requested, "cap bound: buyer must not be charged the full request");
        // The buyer pays the capped buy plus the flat creation fee, nothing more.
        assertApproxEqAbs(
            spent,
            maxBuy + fee,
            1e12,
            "buyer charged more than the capped buy + creation fee"
        );
        assertEq(
            address(fyuz).balance,
            fyuz.totalCurveEthReserve(),
            "stranded ETH: contract holds more than the curve accounts for"
        );
    }

    /// No buyAmount may leave unaccounted ETH sitting in the contract.
    function testFuzz_createToken_neverStrandsETH(uint256 buyAmount) public {
        buyAmount = bound(buyAmount, 0, 30 ether);
        _create(buyAmount);

        assertEq(
            address(fyuz).balance,
            fyuz.totalCurveEthReserve(),
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
        assertEq(fyuz.getTokenVirtualMarketCap(address(0)), 0, "feed is dead");

        address t = _create(0.5 ether);
        assertTrue(t != address(0), "creation must not brick on a stale feed");
    }

    /// createTokenDirect (the V4-only, bonding-curve-less launch) was removed from
    /// the ABI when V4 was gated off. Prove the entry point is genuinely gone
    /// rather than merely unused: a raw call carrying its historical selector must
    /// find no function to dispatch to. Fyuz has a `receive()` but no `fallback()`,
    /// so an unknown selector reverts.
    function test_createTokenDirect_removedFromAbi() public {
        bytes4 oldSelector = bytes4(
            keccak256("createTokenDirect(string,string,uint32,uint256)")
        );
        vm.prank(user);
        (bool ok, ) = address(fyuz).call{value: fee}(
            abi.encodeWithSelector(
                oldSelector,
                "D",
                "D",
                uint32(0),
                block.timestamp + 1
            )
        );
        assertFalse(ok, "createTokenDirect must no longer exist on Fyuz");
    }

    /// V4 is gated off: poolType 3 must be rejected at creation.
    function test_createToken_v4PoolTypeRejected() public {
        vm.prank(user);
        vm.expectRevert(bytes("Only V2 or V3 pool type"));
        fyuz.createToken{value: fee}("T", "T", 0, 0, 0, 3, block.timestamp + 1);
    }

    // ============ Deploy-time decisions (locked down deliberately) ============

    /// DECISION: the 45% price-impact breaker is deliberately raised to 99.99%, which
    /// effectively disables it for buys — the reserve cap + refund path is what keeps
    /// a large buy safe instead. If someone lowers this back, the trade-off changed
    /// and they should have to say so here.
    function test_decision_maxPriceImpactIs9999() public view {
        assertEq(fyuz.MAX_PRICE_IMPACT(), 9_999, "breaker deliberately at 99.99%");
    }

    /// With the breaker at 99.99% a buy far past the reserve cap must NOT revert on
    /// price impact — it must be capped and refunded. This is the exact path the old
    /// 4500 breaker used to hide.
    function test_decision_hugeBuyIsCappedNotBlockedByImpact() public {
        // Derived, not hardcoded: must be past the reserve cap on any curve
        // calibration, otherwise this silently stops exercising the cap path.
        uint256 requested = _maxEffectiveBuy() * 2;
        uint256 balBefore = user.balance;
        _create(requested); // must not revert on "Exceeds max price impact"
        assertLt(balBefore - user.balance, requested, "capped and refunded, not blocked");
    }

    /// DECISION: creation costs 0.001 ETH. initialize() sets it and the Robinhood
    /// deploy script deliberately does not override it (the old live contract ran 0).
    function test_decision_createFeeIs001() public view {
        assertEq(fyuz.CREATE_TOKEN_FEE_AMOUNT(), 0.001 ether, "creation fee is 0.001 ETH");
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
    /// @dev poolType is 1 (V2) here: it used to be 3, but V4 is now rejected up
    ///      front, which would mask the fee check this test exists to prove.
    function test_decision_createBelowFeeReverts() public {
        vm.prank(user);
        vm.expectRevert(bytes("Insufficient ETH value"));
        fyuz.createToken{value: fee - 1}("T", "T", 0, 0, 0, 1, block.timestamp + 1);
    }

    // The two createTokenDirect fee/refund decision tests were removed with the
    // function itself (V4 gated off). test_createTokenDirect_removedFromAbi above
    // now pins the replacement decision: the entry point must stay gone.
    // Fee-taking and refunding on the surviving path are covered by
    // test_decision_createChargesExactlyTheFee and the refund tests above.

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
        assertEq(address(fyuz.fallbackRouterV2()), address(0), "off by default");
        assertEq(
            fyuz.getTokenVirtualMarketCap(address(0)),
            0,
            "no fallback configured => no price"
        );
    }

    /// With Chainlink dead and the fallback wired to the real V2 _stable()/WETH pair,
    /// the curve keeps pricing instead of stalling.
    function test_fallback_pricesEthWhenChainlinkIsDead() public {
        fyuz.setEthUsdFallback(_v2Router(), _stable());

        address t = _create(0.5 ether);
        uint256 liveMcap = fyuz.getTokenVirtualMarketCap(t);
        assertGt(liveMcap, 0, "chainlink path works");

        _killOracle();
        uint256 fallbackMcap = fyuz.getTokenVirtualMarketCap(t);
        assertGt(fallbackMcap, 0, "fallback must price ETH when chainlink is down");

        // Same asset, same block: the two sources must broadly agree (within 20%).
        // A wild divergence means the decimal normalisation is wrong.
        uint256 hi = liveMcap > fallbackMcap ? liveMcap : fallbackMcap;
        uint256 lo = liveMcap > fallbackMcap ? fallbackMcap : liveMcap;
        assertLt((hi - lo) * 100 / hi, 20, "V2 price disagrees wildly with chainlink");
    }

    /// Chainlink must win while it is healthy — the fallback is a last resort.
    function test_fallback_chainlinkTakesPrecedence() public {
        uint256 before = fyuz.getETHPriceByUSD();
        fyuz.setEthUsdFallback(_v2Router(), _stable());
        assertEq(fyuz.getETHPriceByUSD(), before, "healthy chainlink must win");
    }

    /// A typo must fail at configuration time, not silently read 0 mid-outage.
    /// Real ERC20 (so decimals() resolves) with no WETH pair on the V2 factory.
    function test_fallback_rejectsPairlessStable() public {
        Token orphan = new Token("Orphan", "ORP", 1e18);
        vm.expectRevert(bytes("No V2 pair for stable"));
        fyuz.setEthUsdFallback(_v2Router(), address(orphan));
    }

    function test_fallback_canBeDisabled() public {
        fyuz.setEthUsdFallback(_v2Router(), _stable());
        fyuz.setEthUsdFallback(address(0), address(0));
        _killOracle();
        assertEq(fyuz.getTokenVirtualMarketCap(address(0)), 0, "cleared");
    }

    function test_fallback_onlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        fyuz.setEthUsdFallback(_v2Router(), _stable());
    }
}
