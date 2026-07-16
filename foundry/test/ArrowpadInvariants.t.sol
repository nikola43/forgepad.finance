// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Arrowpad, IArrowpad} from "../src/Arrowpad.sol";
import {ArrowpadLiquidityManager} from "../src/ArrowpadLiquidityManager.sol";
import {ArrowpadDeploy} from "../src/ArrowpadDeploy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Drives Arrowpad with random create/buy/sell sequences from several actors.
/// Every call is wrapped in try/catch: a revert is a legitimate outcome (slippage,
/// launched pool, deadline) and must not abort the run — we care about the state the
/// contract is left in, not whether any single call succeeds.
contract ArrowpadHandler is Test {
    Arrowpad public arrowpad;
    address[] public tokens;
    address[] public actors;

    uint256 public creates;
    uint256 public buys;
    uint256 public sells;

    receive() external payable {}

    constructor(Arrowpad _a) {
        arrowpad = _a;
        for (uint256 i = 0; i < 4; i++) {
            address a = address(uint160(uint256(keccak256(abi.encode("actor", i)))));
            vm.deal(a, 10_000 ether);
            actors.push(a);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function createToken(uint256 seed, uint256 buyAmount) public {
        if (tokens.length >= 6) return;
        buyAmount = bound(buyAmount, 0, 30 ether);
        address a = _actor(seed);
        uint256 fee = arrowpad.CREATE_TOKEN_FEE_AMOUNT();

        vm.prank(a);
        try
            arrowpad.createToken{value: buyAmount + fee}(
                "Fz",
                "FZ",
                buyAmount,
                0,
                0,
                1,
                block.timestamp + 1
            )
        returns (address t) {
            tokens.push(t);
            creates++;
        } catch {}
    }

    function buy(uint256 seed, uint256 amount) public {
        if (tokens.length == 0) return;
        address t = tokens[seed % tokens.length];
        amount = bound(amount, 1, 5 ether);
        address a = _actor(seed >> 8);

        vm.prank(a);
        try
            arrowpad.swapExactETHForTokens{value: amount}(
                t,
                amount,
                0,
                block.timestamp + 1
            )
        {
            buys++;
        } catch {}
    }

    function sell(uint256 seed, uint256 pct) public {
        if (tokens.length == 0) return;
        address a = _actor(seed >> 8);

        // Pick a token this actor actually HOLDS. Indexing by seed alone lands on a
        // token they never bought (the index space shifts as tokens.length grows), so
        // every sell would bail at bal==0 and the sell path would go untested while
        // the run still reported ~1k calls.
        address t;
        uint256 bal;
        for (uint256 i = 0; i < tokens.length; i++) {
            address cand = tokens[(seed + i) % tokens.length];
            uint256 b = IERC20(cand).balanceOf(a);
            if (b > 0) {
                t = cand;
                bal = b;
                break;
            }
        }
        if (t == address(0)) return;

        uint256 amt = (bal * bound(pct, 1, 100)) / 100;
        if (amt == 0) return;

        vm.startPrank(a);
        IERC20(t).approve(address(arrowpad), amt);
        try arrowpad.swapExactTokensForETH(t, amt, 0, block.timestamp + 1) {
            sells++;
        } catch {}
        vm.stopPrank();
    }

    /// Anyone can shove ETH at the contract via receive(). That must never be counted
    /// as curve reserve — it should show up as withdrawable surplus instead.
    function donate(uint256 amount) public {
        amount = bound(amount, 1, 1 ether);
        vm.deal(address(this), amount);
        (bool ok, ) = payable(address(arrowpad)).call{value: amount}("");
        ok;
    }
}

/// Stateful invariants over the ETH accounting.
///
/// This matters more since MAX_PRICE_IMPACT was raised to 99.99%: the price-impact
/// breaker no longer bounds buys, so the reserve cap + refund path is the only thing
/// keeping a large buy from stranding ETH. These invariants hold that line across
/// random trade sequences rather than hand-picked cases.
contract ArrowpadInvariants is Test {
    Arrowpad internal arrowpad;
    ArrowpadLiquidityManager internal lm;
    ArrowpadHandler internal handler;

    address internal constant PERMIT2 =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;

    receive() external payable {}

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("FORK_URL", string("https://ethereum-rpc.publicnode.com"))
        );

        lm = ArrowpadDeploy.deployLiquidityManager(
            vm.envOr("V2_ROUTER", 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D),
            vm.envOr("V3_FACTORY", 0x1F98431c8aD98523631AE4a59f267346ea31F984),
            vm.envOr("V3_POS_MGR", 0xC36442b4a4522E871399CD717aBDD847Ab11FE88),
            vm.envOr("V4_POOL_MGR", 0x000000000004444c5dc75cB358380D2e3dE08A90),
            vm.envOr("UNIVERSAL_ROUTER", 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af),
            vm.envOr("V4_POS_MGR", 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e),
            PERMIT2,
            address(this),
            address(this),
            10000,
            10000,
            address(this)
        );
        arrowpad = ArrowpadDeploy.deployArrowpad(
            vm.envOr("DATA_FEED", 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419),
            address(lm),
            address(this),
            address(this),
            address(this)
        );
        lm.setAuthorizedCaller(address(arrowpad), true);
        arrowpad.setMaxBuyPercent(10000);
        arrowpad.setPriceStalenessThreshold(86400);

        handler = new ArrowpadHandler(arrowpad);
        targetContract(address(handler));

        // Pin the senders. Left to its own devices the fuzzer invents random sender
        // addresses, and on a fork every one of them costs an upstream account lookup
        // — enough to trip the RPC rate limit and abort the run. The handler pranks
        // its own actors internally, so who calls the handler is irrelevant anyway.
        targetSender(address(0xA11CE));
        targetSender(address(0xB0B));
        targetSender(address(0xCA11));
    }

    /// The handler swallows reverts, so a broken handler would make every invariant
    /// above pass while doing nothing at all. Drive it directly and prove each action
    /// actually lands — without this, "3 passed" could mean "3 tested nothing".
    function test_handlerIsNotVacuous() public {
        // Keep the buy small enough not to graduate (~2.8 ETH gross at current ETH
        // price), so the curve is still tradeable for the sell leg below.
        handler.createToken(1, 0.5 ether);
        handler.buy(1, 1 ether);
        handler.sell(1, 50);

        // Then some breadth, including buys that graduate outright.
        for (uint256 i = 2; i <= 6; i++) {
            handler.createToken(i, i * 1 ether);
            handler.buy(i, i * 0.3 ether);
            handler.sell(i, 25);
        }
        handler.donate(1 ether);

        assertGt(handler.creates(), 0, "handler never created a token");
        assertGt(handler.buys(), 0, "handler never bought");
        assertGt(handler.sells(), 0, "handler never sold");
        assertGt(handler.tokenCount(), 0, "no tokens tracked");

        // And the invariants must still hold after real activity.
        assertGe(address(arrowpad).balance, arrowpad.totalCurveEthReserve());
        assertEq(
            arrowpad.withdrawableEth(),
            address(arrowpad).balance - arrowpad.totalCurveEthReserve()
        );
    }

    /// SOLVENCY: the contract must always hold at least what the curves are owed.
    /// A breach means a seller could not be paid — the worst failure available here.
    /// forge-config: default.invariant.runs = 48
    /// forge-config: default.invariant.depth = 24
    function invariant_solventAgainstCurveReserve() public view {
        assertGe(
            address(arrowpad).balance,
            arrowpad.totalCurveEthReserve(),
            "INSOLVENT: balance below accounted curve reserve"
        );
    }

    /// Anything held above the accounted reserve must be explicitly withdrawable —
    /// never silently trapped. This is the invariant the createToken stranding bug
    /// violated (capped-away ETH sat here, owed to nobody, reachable by no one).
    /// forge-config: default.invariant.runs = 48
    /// forge-config: default.invariant.depth = 24
    function invariant_surplusIsAlwaysWithdrawable() public view {
        uint256 surplus = address(arrowpad).balance -
            arrowpad.totalCurveEthReserve();
        assertEq(
            arrowpad.withdrawableEth(),
            surplus,
            "surplus ETH is not accounted as withdrawable"
        );
    }

    /// totalCurveEthReserve must equal the sum of every live pool's ethReserve.
    /// Catches accounting drift in the accumulator across buys/sells/graduations.
    /// forge-config: default.invariant.runs = 48
    /// forge-config: default.invariant.depth = 24
    function invariant_reserveAccumulatorMatchesPools() public view {
        uint256 sum;
        uint256 n = handler.tokenCount();
        for (uint256 i = 0; i < n; i++) {
            IArrowpad.PoolInfo memory p = IArrowpad(address(arrowpad)).tokenPools(
                handler.tokens(i)
            );
            sum += p.ethReserve;
        }
        assertEq(
            sum,
            arrowpad.totalCurveEthReserve(),
            "accumulator drifted from the sum of pool reserves"
        );
    }
}
