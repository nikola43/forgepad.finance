// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/Fyuz.sol";
import "../src/FyuzLiquidityManager.sol";
import {FyuzDeploy} from "../src/FyuzDeploy.sol";
import {IUniswapV2Factory} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IV3PoolSlot0} from "../src/interfaces/IV3PoolSlot0.sol";

/**
 * End-to-end proof that Fyuz works against REAL PancakeSwap on a BSC mainnet
 * fork: a token launched on the bonding curve must graduate into a real
 * PancakeSwap V2 pair and a real PancakeSwap V3 pool.
 *
 * This is the coverage the rest of the suite lacks — every other test forks
 * Ethereum against Uniswap, which is why the PancakeSwap slot0 ABI break
 * (uint8 vs uint32 feeProtocol) went unnoticed.
 *
 * Run: forge test --match-path test/FyuzBscPancake.t.sol
 *      (BSC_FORK_URL overrides the RPC; defaults to a public BSC node)
 */
contract FyuzBscPancakeTest is Test {
    // ---- Verified PancakeSwap / BSC addresses ----
    address constant V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address constant V2_FACTORY = 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73;
    address constant V3_FACTORY = 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865;
    address constant V3_POSITION_MANAGER =
        0x46A15B0b27311cedF172AB29E4f4766fbE7F4364;
    address constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant DATA_FEED = 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE; // BNB/USD
    address constant V4_DISABLED_SENTINEL =
        0x000000000000000000000000000000000000dEaD;

    uint24 constant POOL_FEE = 100; // FyuzLiquidityManager's hardcoded V3 tier

    Fyuz fyuz;
    FyuzLiquidityManager lm;
    address deployer = address(this);
    address trader = address(0xBEEF);

    /// This contract is the feeAddress/distributor/marginRecipient, so it must
    /// be able to receive BNB or every createToken reverts on the fee transfer.
    receive() external payable {}

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("BSC_FORK_URL", string("https://bsc-dataseed.bnbchain.org"))
        );

        lm = FyuzDeploy.deployLiquidityManager(
            V2_ROUTER,
            V3_FACTORY,
            V3_POSITION_MANAGER,
            V4_DISABLED_SENTINEL,
            V4_DISABLED_SENTINEL,
            V4_DISABLED_SENTINEL,
            PERMIT2,
            deployer,
            deployer,
            10000,
            10000,
            deployer
        );
        fyuz = FyuzDeploy.deployFyuz(
            DATA_FEED,
            address(lm),
            deployer,
            deployer,
            deployer
        );
        lm.setAuthorizedCaller(address(fyuz), true);
        fyuz.setPlatformBuyFeeBps(100);
        fyuz.setPlatformSellFeeBps(100);
        fyuz.setMaxBuyPercent(10000);
        fyuz.setMaxSellPercent(10000);
        fyuz.setPriceStalenessThreshold(3600);

        vm.deal(trader, 20_000 ether);
        vm.deal(deployer, 10 ether);
    }

    /// The oracle really is BNB/USD and Fyuz can read it on BSC.
    function test_oracle_isBnbUsdAndReadable() public {
        uint256 mcap = fyuz.TARGET_MARKET_CAP_USD();
        assertEq(mcap, 30_000 ether, "target mcap");
        // Reading a market cap forces a live oracle read: if the BNB/USD feed
        // were unreadable or judged stale, this reverts and graduation bricks.
        vm.prank(trader);
        address token = fyuz.createToken{value: 0.001 ether}(
            "Oracle", "ORCL", 0, 0, 0, 1, block.timestamp + 1
        );
        uint256 live = fyuz.getTokenVirtualMarketCap(token);
        assertGt(live, 0, "oracle unreadable => graduation would brick");
        emit log_named_uint("opening virtual mcap (USD, 1e18)", live);
    }

    /// Protocol fee split per buy (1% total): treasury 0.6% + leaderboard 0.2%
    /// (the 0.8% platform fee, split 3:1 by _payPlatformFee) + creator 0.2%.
    function test_ProtocolFeeSplit_060_020_020() public {
        address treasury = address(0x1111);
        address leaderboard = address(0x2222);
        address buyer = address(0x3333);
        vm.deal(buyer, 1 ether);

        fyuz.setFeeAddress(treasury);
        fyuz.setDistributorAddress(leaderboard);
        fyuz.setPlatformBuyFeeBps(80); // 0.6% treasury + 0.2% leaderboard
        fyuz.setTokenOwnerFeeBps(20); // 0.2% creator

        vm.prank(trader); // trader becomes pool.owner => the creator
        address token = fyuz.createToken{value: 0.001 ether}(
            "Fee", "FEE", 0, 0, 0, 1, block.timestamp + 1
        );

        uint256 tre0 = treasury.balance;
        uint256 lb0 = leaderboard.balance;
        uint256 cr0 = trader.balance; // creator == trader

        uint256 buyAmt = 0.01 ether; // fees divide evenly at 80/20 bps
        vm.prank(buyer);
        fyuz.swapExactETHForTokens{value: buyAmt}(token, buyAmt, 0, block.timestamp + 1);

        assertEq(treasury.balance - tre0, (buyAmt * 60) / 10000, "treasury 0.6%");
        assertEq(leaderboard.balance - lb0, (buyAmt * 20) / 10000, "leaderboard 0.2%");
        assertEq(trader.balance - cr0, (buyAmt * 20) / 10000, "creator 0.2%");
        // treasury : leaderboard must be exactly 3 : 1
        assertEq(treasury.balance - tre0, 3 * (leaderboard.balance - lb0), "3:1 split");
    }

    /// The curve must actually be ABLE to reach the graduation target on BSC.
    ///
    /// Regression cover for a launch-blocking miscalibration: the virtual reserves
    /// are denominated in the gas token, and the ETH-tuned VIRTUAL_ETH_INITIAL of
    /// 2.5 opened at only ~$1.3K on BNB. The curve can lift the opening mcap by at
    /// most (VTOK / (VTOK - REAL))^2 ~= 14.7x, which capped it at ~$19.7K — under
    /// the target. Every token was unable to graduate, forever.
    function test_curveCeilingClearsGraduationTarget() public {
        vm.prank(trader);
        address token = fyuz.createToken{value: 0.001 ether}(
            "Ceiling", "CEIL", 0, 0, 0, 1, block.timestamp + 1
        );

        uint256 open = fyuz.getTokenVirtualMarketCap(token);
        uint256 vtok = fyuz.VIRTUAL_TOKEN_INITIAL();
        uint256 real = fyuz.REAL_TOKEN_INITIAL();

        // Ceiling = opening * (VTOK / (VTOK - REAL))^2, reached when the curve sells out.
        uint256 ceiling = (open * vtok * vtok) /
            ((vtok - real) * (vtok - real));

        emit log_named_uint("opening mcap  (USD 1e18)", open);
        emit log_named_uint("curve ceiling (USD 1e18)", ceiling);
        emit log_named_uint("target        (USD 1e18)", fyuz.TARGET_MARKET_CAP_USD());

        assertGt(
            ceiling,
            fyuz.TARGET_MARKET_CAP_USD(),
            "curve can never reach the graduation target at this gas-token price"
        );
    }

    /// V4 must be unreachable through createToken.
    function test_v4PoolTypeRejected() public {
        vm.prank(trader);
        vm.expectRevert(bytes("Only V2 or V3 pool type"));
        fyuz.createToken{value: 0.001 ether}(
            "V4", "V4", 0, 0, 0, 3, block.timestamp + 1
        );
    }

    /// Full lifecycle on PancakeSwap V2: curve -> graduation -> real pair.
    function test_graduatesToPancakeV2() public {
        address token = _createAndGraduate(1);

        address pair = IUniswapV2Factory(V2_FACTORY).getPair(token, WBNB);
        assertTrue(pair != address(0), "no PancakeSwap V2 pair created");
        assertGt(pair.code.length, 0, "pair has no code");
        assertGt(
            IERC20(token).balanceOf(pair),
            0,
            "pair holds no tokens => not seeded"
        );
        assertGt(
            IERC20(WBNB).balanceOf(pair),
            0,
            "pair holds no WBNB => not seeded"
        );
        emit log_named_address("PancakeSwap V2 pair", pair);
    }

    /// Full lifecycle on PancakeSwap V3: curve -> graduation -> real pool.
    /// This is the case the slot0 ABI bug silently downgraded to V2.
    function test_graduatesToPancakeV3() public {
        address token = _createAndGraduate(2);

        address pool = IUniswapV3Factory(V3_FACTORY).getPool(
            token,
            WBNB,
            POOL_FEE
        );
        assertTrue(pool != address(0), "no PancakeSwap V3 pool created");
        assertGt(pool.code.length, 0, "pool has no code");

        // Reading through the wide ABI must work on the initialized pool.
        (uint160 sqrtPriceX96, , , , , , ) = IV3PoolSlot0(pool).slot0();
        assertGt(sqrtPriceX96, 0, "V3 pool not initialized");

        // The token must NOT have been silently downgraded to V2.
        assertEq(
            _poolTypeOf(token),
            2,
            "token was downgraded off V3 (the slot0 bug)"
        );
        assertEq(
            IUniswapV2Factory(V2_FACTORY).getPair(token, WBNB),
            address(0),
            "a V2 pair exists => it fell back to V2"
        );
        emit log_named_address("PancakeSwap V3 pool", pool);
    }

    // ---- helpers ----

    function _poolTypeOf(address token) internal view returns (uint8) {
        (, , , , , , uint8 poolType, ) = fyuz.tokenPools(token);
        return poolType;
    }

    /// Create a token on the curve and buy until it graduates.
    function _createAndGraduate(uint8 poolType) internal returns (address) {
        vm.startPrank(trader);
        address token = fyuz.createToken{value: 0.001 ether}(
            "Fyuz Bout",
            "BOUT",
            0,
            0,
            0,
            poolType,
            block.timestamp + 1
        );

        // Buy in chunks until the bonding curve hits TARGET_MARKET_CAP_USD and
        // graduates onto PancakeSwap. Mirrors test_06_GraduationLaunch: msg.value
        // must cover the buy AMOUNT PLUS the platform fee.
        for (uint256 i = 0; i < 500 && !_launched(token); i++) {
            uint256 buyAmt = 0.5 ether;
            uint256 fee = fyuz.getFirstBuyFee(token);
            if (trader.balance <= buyAmt + fee) break;
            fyuz.swapExactETHForTokens{value: buyAmt + fee}(
                token,
                buyAmt,
                0,
                block.timestamp + 1
            );
        }
        vm.stopPrank();

        emit log_named_uint(
            "final virtual mcap (USD, 1e18)",
            fyuz.getTokenVirtualMarketCap(token)
        );

        assertTrue(_launched(token), "token never graduated");
        return token;
    }

    function _launched(address token) internal view returns (bool) {
        (, , , , , , , bool launched) = fyuz.tokenPools(token);
        return launched;
    }
}
