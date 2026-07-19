// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {
    Initializable
} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
// OZ >=5.5 ReentrancyGuard is already proxy-safe: ERC-7201 fixed slot, and the
// guard only trips on `== ENTERED`, so a fresh proxy's zero slot reads as
// not-entered. That is why OZ dropped ReentrancyGuardUpgradeable in v5.
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {
    SafeERC20,
    IERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFyuzLiquidityManager} from "./IFyuzLiquidityManager.sol";
import {
    AggregatorV3Interface
} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {
    IERC20Metadata
} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {
    IUniswapV2Router02
} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {
    IUniswapV2Factory
} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {
    IUniswapV2Pair
} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import {Token} from "./Token.sol";

interface ILaunchable {
    function launch() external;
}

interface IFyuz {
    struct PoolInfo {
        uint256 ethReserve;
        uint256 tokenReserve;
        uint256 virtualEthReserve;
        uint256 virtualTokenReserve;
        address token;
        address owner;
        uint8 poolType;
        bool launched;
    }

    function tokenPools(address) external view returns (PoolInfo memory);
}

contract Fyuz is
    Initializable,
    ReentrancyGuard,
    OwnableUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ==================== PUMP.FUN EXACT PARAMETERS (confirmed from protocol) ====================
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;
    uint256 public constant TARGET_MARKET_CAP_USD = 30_000 * 1e18; // Graduation at $30K virtual MCAP

    // CALIBRATED FOR BNB SMART CHAIN. The gas token is BNB (~$575), not ETH, and
    // these virtual reserves are denominated in the gas token — so they cannot be
    // carried over from an ETH chain unchanged.
    //
    // Opening mcap = ethPrice * TOTAL_SUPPLY * VIRTUAL_ETH_INITIAL / VIRTUAL_TOKEN_INITIAL,
    // i.e. it scales with the gas token's USD price. The original ETH calibration
    // (2.5 ether) opened at ~$4.4K with ETH at $1.9K. On BNB the same 2.5 opens at
    // only ~$1.3K, and because the curve can multiply the opening mcap by at most
    // ~14.7x (VIRTUAL_TOKEN_INITIAL / (VIRTUAL_TOKEN_INITIAL - REAL_TOKEN_INITIAL))^2,
    // its ceiling lands near $19.7K — BELOW the graduation target. Every token
    // would have been unable to graduate, permanently.
    //
    // 8.25 BNB reproduces the ETH design's ~$4.4K opening mcap at BNB ~$575, which
    // puts the $30K target at ~83% of the curve and keeps graduation reachable
    // until BNB falls under ~$266.
    //
    // NOTE: this is a USD target priced off a volatile gas token. If BNB drops far
    // enough, the ceiling falls back under the target and graduation bricks again.
    // Re-check this calibration before any large BNB drawdown.
    uint256 public constant VIRTUAL_ETH_INITIAL = 8.25 ether;
    uint256 public constant VIRTUAL_TOKEN_INITIAL = 1_073_000_000 * 1e18; // Virtual tokens for pricing curve
    uint256 public constant REAL_TOKEN_INITIAL = 793_100_000 * 1e18; // Real tokens available on curve (sellable)

    struct PoolInfo {
        uint256 ethReserve; // REAL ETH in contract (used for LP)
        uint256 tokenReserve; // REAL tokens held by contract (available to buy/sell)
        uint256 virtualEthReserve; // VIRTUAL ETH for constant-product pricing (x in x*y=k)
        uint256 virtualTokenReserve; // VIRTUAL tokens for constant-product pricing (y in x*y=k)
        address token;
        address owner;
        uint8 poolType; // 1 = V2, 2 = V3, 3 = V4
        bool launched;
    }

    // ==================== STATE VARIABLES ====================
    IFyuzLiquidityManager public liquidityManager;
    // Chainlink ETH/USD feed — read automatically (view call) on every trade/mcap
    // query. No owner, backend, or transaction is ever needed to read it.
    // Set once in initialize() and never written again: no setter exists, so it is
    // only changeable via a proxy upgrade (was `immutable` pre-proxy).
    AggregatorV3Interface internal priceFeed;
    uint8 private priceFeedDecimals;

    // ---- Uniswap V2 ETH/stable price fallback (opt-in, off by default) ----
    // Only consulted when the Chainlink feed is stale/down. Zero address = disabled,
    // in which case _rawEthPrice() behaves exactly as it did before this existed.
    //
    // WARNING: this is a SPOT price, not a TWAP — it is manipulable inside a single
    // transaction (flash loan skews the pair, price reverts on the next block). It is
    // deliberately gated on Chainlink being down so the exposure window is limited to
    // an outage, and on a liquidity floor so a shallow pair cannot set the price.
    // Treat it as a liveness aid, not a trust-minimised oracle. See
    // MIN_FALLBACK_WETH_LIQUIDITY.
    IUniswapV2Router02 public fallbackRouterV2;
    address public fallbackStable;
    uint8 private fallbackStableDecimals;

    mapping(address => PoolInfo) public tokenPools;
    mapping(address => uint256) private tokenTrades;

    // NOTE: declaration-time values are NOT initializers — behind a proxy they would
    // never run (they live in the implementation's constructor). Every default below
    // is assigned in initialize() instead; the values here are documentation only.
    address public burnAddress;
    address public feeAddress;
    address public distributorAddress;

    uint256 public CREATE_TOKEN_FEE_AMOUNT; // 0.001 ether, ~Pump.fun creation fee equivalent
    // Fees in basis points (1 bps = 0.01%), same DIVISOR basis as MAX_BUY/SELL_PERCENT
    // Optional creator fee (e.g. 30 = 0.3%). Held at 0 in production — the setter and
    // the sell-side application (unlike Pump.fun, this also applies to sells) are kept
    // deliberately, not dead code. Reviewers keep flagging the sell path: it is
    // intentional and inert while this is 0.
    uint256 public TOKEN_OWNER_FEE_BPS;
    // Chainlink staleness threshold. Default 3600s (1h) for Ethereum mainnet. On L2
    // chains (Arbitrum, Robinhood Chain) the feed's updatedAt is the L1 timestamp
    // and can lag hours behind the L2 block time — set this to 86400 (24h) or more.
    uint256 public priceStalenessThreshold;
    uint256 public PLATFORM_BUY_FEE_BPS; // 100 = 1%
    uint256 public PLATFORM_SELL_FEE_BPS; // 100 = 1%
    uint256 public platformLPFee; // 0.1 ether
    uint256 public tokenOwnerLPFee; // 0
    uint256 public firstBuyFeeUSD; // 0

    // Circuit breakers (same safety as Pump.fun)
    uint256 public constant MAX_PRICE_IMPACT = 9_999; // 99.99% max impact
    uint256 public constant MIN_LIQUIDITY = 1e15;
    /// @dev A V2 spot price is only as trustworthy as the pair is deep. Below this
    ///      much WETH the fallback pair is ignored (price reads 0) rather than
    ///      trusted: skewing a shallow pair is cheap.
    uint256 public constant MIN_FALLBACK_WETH_LIQUIDITY = 50 ether;
    uint256 private constant DIVISOR = 10_000;

    uint256 public MAX_BUY_PERCENT; // DIVISOR = 100%
    uint256 public MAX_SELL_PERCENT; // DIVISOR = 100%

    uint256 public tokenCount;

    // Sum of ethReserve across all un-graduated pools. Mirrors every pool.ethReserve
    // change so emergency withdrawal can be capped to only stray/donated ETH and can
    // never touch the ETH backing active bonding curves (anti soft-rug).
    uint256 public totalCurveEthReserve;

    // Timelock for emergency withdrawals
    uint256 public constant EMERGENCY_TIMELOCK = 24 hours;
    uint256 public emergencyWithdrawRequestTime;
    uint256 public emergencyWithdrawAmount;

    // Timelock for liquidity manager changes (graduation ETH flows here, so an
    // instant swap would let the owner drain the next graduation)
    address public pendingLiquidityManager;
    uint256 public liquidityManagerChangeTime;

    // ==================== EVENTS ====================
    event TokenCreated(
        address token,
        uint256 tokenPrice,
        uint256 ethPriceUSD,
        uint32 sig,
        uint256 date
    );
    event LiquidityAdded(
        address token,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 totalSupply
    );
    event BuyTokens(
        address user,
        address token,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 tokenPrice,
        uint256 ethPriceUSD,
        uint256 marketCap,
        uint256 date
    );
    event SellTokens(
        address user,
        address token,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 tokenPrice,
        uint256 ethPriceUSD,
        uint256 marketCap,
        uint256 date
    );
    event TokenLaunched(address token, uint256 date);
    event FeesClaimed(
        address token,
        address creator,
        uint256 ethFees,
        uint256 tokenFees,
        uint256 date
    );
    event EmergencyWithdrawRequested(uint256 amount, uint256 executeAfter);
    event EmergencyWithdrawExecuted(uint256 amount);
    event EmergencyWithdrawCancelled();
    event EthUsdFallbackUpdated(address router, address stable);
    event LiquidityManagerChangeRequested(
        address newManager,
        uint256 executeAfter
    );
    event LiquidityManagerChanged(address newManager);
    event LiquidityManagerChangeCancelled();

    /// @notice Treasury's share of the platform fee, in bps of 10000. The
    ///         remainder goes to the leaderboard (distributorAddress). Default
    ///         6250 = 62.5%, which turns an 80bps platform fee into 0.5%
    ///         treasury + 0.3% leaderboard. Owner-tunable via
    ///         setPlatformTreasuryShareBps so the split can be retuned without
    ///         an upgrade. Appended here (not among the other fee vars) to keep
    ///         the upgradeable storage layout append-only.
    uint256 public platformTreasuryShareBps;

    // ==================== UPGRADE GAP ====================
    /// @dev Reserved storage so future upgrades can append state without colliding
    ///      with any child contract's slots. Decrement this when adding a variable.
    ///      The OZ *Upgradeable bases use ERC-7201 namespaced storage and need no gap
    ///      of their own.
    // 50 -> 48: fallbackRouterV2 takes one slot, fallbackStable + fallbackStableDecimals
    // pack into a second. 48 -> 47: platformTreasuryShareBps appended above.
    uint256[47] private __gap;

    receive() external payable {}

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _dataFeedAddress,
        address _liquidityManagerAddress,
        address _feeAddress,
        address _distributorAddress
    ) external initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();

        require(_dataFeedAddress != address(0), "Data feed cannot be zero");
        require(
            _liquidityManagerAddress != address(0),
            "Liquidity manager cannot be zero"
        );
        require(_feeAddress != address(0), "Fee address cannot be zero");
        require(
            _distributorAddress != address(0),
            "Distributor cannot be zero"
        );

        priceFeed = AggregatorV3Interface(_dataFeedAddress);
        priceFeedDecimals = priceFeed.decimals();
        liquidityManager = IFyuzLiquidityManager(_liquidityManagerAddress);
        feeAddress = _feeAddress;
        distributorAddress = _distributorAddress;

        // Defaults that used to live on the declarations (constructor-only, so a
        // proxy would leave them all zero).
        burnAddress = 0x000000000000000000000000000000000000dEaD;
        CREATE_TOKEN_FEE_AMOUNT = 0.001 ether;
        priceStalenessThreshold = 3600;
        PLATFORM_BUY_FEE_BPS = 100;
        PLATFORM_SELL_FEE_BPS = 100;
        platformTreasuryShareBps = 6250; // 62.5% → 0.5% treasury / 0.3% leaderboard at 80bps
        platformLPFee = 0.1 ether;
        MAX_BUY_PERCENT = DIVISOR;
        MAX_SELL_PERCENT = DIVISOR;
    }

    // ==================== MATH HELPERS (native ^0.8.26) ====================
    function _mul(uint256 a, uint256 b) private pure returns (uint256) {
        uint256 c = a * b;
        require(a == 0 || c / a == b, "Math: mul overflow");
        return c;
    }

    function _div(uint256 a, uint256 b) private pure returns (uint256) {
        require(b > 0, "Math: div by zero");
        return a / b;
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeBps
    ) internal pure returns (uint256) {
        require(amountIn > 0, "Insufficient input");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        require(feeBps < DIVISOR, "Fee too high");

        uint256 amountInWithFee = _mul(amountIn, DIVISOR - feeBps) / DIVISOR;
        uint256 numerator = _mul(amountInWithFee, reserveOut);
        uint256 denominator = reserveIn + amountInWithFee;
        return _div(numerator, denominator);
    }

    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeBps
    ) internal pure returns (uint256) {
        require(amountOut > 0 && amountOut < reserveOut, "Invalid output");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        require(feeBps < DIVISOR, "Fee too high");

        uint256 numerator = _mul(reserveIn, amountOut);
        uint256 denominator = reserveOut - amountOut;
        uint256 amountInBeforeFee = _div(numerator, denominator) + 1;

        return _mul(amountInBeforeFee, DIVISOR) / (DIVISOR - feeBps);
    }

    function checkPriceImpact(
        uint256 amountOut,
        uint256 reserveOut
    ) internal pure {
        uint256 impact = _mul(amountOut, DIVISOR) / reserveOut;
        require(impact <= MAX_PRICE_IMPACT, "Exceeds max price impact");
        require(reserveOut - amountOut >= MIN_LIQUIDITY, "Below min liquidity");
    }

    function createToken(
        string memory name,
        string memory symbol,
        uint256 buyAmount,
        uint256 minAmountOut,
        uint32 sig,
        uint8 poolType,
        uint256 deadline
    ) external payable whenNotPaused nonReentrant returns (address) {
        require(deadline >= block.timestamp, "Swap expired");
        // V4 (poolType 3) is deliberately gated off: the V4 seeding/graduation
        // internals remain in FyuzLiquidityManager but are unreachable. Only
        // 1 = Uniswap/Pancake V2 and 2 = Uniswap/Pancake V3 may be selected.
        require(poolType == 1 || poolType == 2, "Only V2 or V3 pool type");

        address newToken = address(new Token(name, symbol, TOTAL_SUPPLY));

        uint256 firstBuyFee = buyAmount > 0 ? getFirstBuyFee(newToken) : 0;
        require(
            msg.value >= buyAmount + firstBuyFee + CREATE_TOKEN_FEE_AMOUNT,
            "Insufficient ETH value"
        );

        // Initialize exactly like Pump.fun: virtual curve + real reserves
        tokenPools[newToken] = PoolInfo({
            ethReserve: 0,
            tokenReserve: REAL_TOKEN_INITIAL,
            virtualEthReserve: VIRTUAL_ETH_INITIAL,
            virtualTokenReserve: VIRTUAL_TOKEN_INITIAL,
            token: newToken,
            owner: msg.sender,
            poolType: poolType,
            launched: false
        });

        tokenCount++;

        // _rawEthPrice(), not getETHPriceByUSD(): the latter reverts on a stale feed,
        // which would brick token creation over a reporting-only field. Nothing else
        // here needs the oracle (getFirstBuyFee already skips itself when it is down),
        // so report 0 and let creation through — same as createTokenDirect.
        emit TokenCreated(
            newToken,
            getVirtualPrice(newToken),
            _rawEthPrice(),
            sig,
            block.timestamp
        );

        // Refund against the ACTUAL ETH consumed, not the requested buyAmount:
        // the reserve cap may shrink the effective buy near graduation, and the
        // capped-away ETH must be returned or it is stranded in the contract.
        if (buyAmount > 0) {
            buyAmount = _swapExactETHForTokens(newToken, buyAmount, minAmountOut);
        }

        if (CREATE_TOKEN_FEE_AMOUNT + firstBuyFee > 0) {
            _transferETH(feeAddress, CREATE_TOKEN_FEE_AMOUNT + firstBuyFee);
        }

        if (msg.value > buyAmount + firstBuyFee + CREATE_TOKEN_FEE_AMOUNT) {
            _transferETH(
                msg.sender,
                msg.value - buyAmount - firstBuyFee - CREATE_TOKEN_FEE_AMOUNT
            );
        }

        return newToken;
    }

    // ==================== DIRECT LAUNCH (removed) ====================
    // createTokenDirect (Klik-style, bonding-curve-less launch straight onto V4)
    // was removed from the external ABI along with the V4 gate in createToken.
    // Every launch now goes through the bonding curve and graduates to V2 or V3.
    // The V4 seeding path it used (FyuzLiquidityManager.addLiquidityV4SingleSided)
    // is intentionally left in place but is now unreachable from Fyuz.

    // ==================== FEE CLAIMING ====================
    /// @notice Claim the token's accrued V3/V4 trading fees: 50% to the token's
    ///         creator, 50% to the platform. Callable by anyone — the payout targets
    ///         are fixed by on-chain state, so there is nothing to gain by front-
    ///         running it, and the UI can let a creator claim without gating.
    /// @dev Deliberately NOT `whenNotPaused`: these are user funds already earned,
    ///      and a pause should stop trading, not freeze someone's fees.
    ///      V2 tokens have nothing to claim — their fees are only realisable by
    ///      burning LP, which would withdraw principal — so this reverts for them.
    function claimFees(
        address token
    ) external nonReentrant returns (uint256 ethFees, uint256 tokenFees) {
        PoolInfo storage pool = tokenPools[token];
        require(pool.token != address(0), "Unknown token");
        require(pool.launched, "Not launched");

        (ethFees, tokenFees) = liquidityManager.collectFees(
            token,
            pool.owner,
            feeAddress
        );

        emit FeesClaimed(
            token,
            pool.owner,
            ethFees,
            tokenFees,
            block.timestamp
        );
    }

    // To show a claimable amount, the UI eth_call's claimFees() and reads the
    // returned (ethFees, tokenFees) — a simulated call costs nothing and needs no
    // on-chain view. A real `claimable` view would have to recompute Uniswap's
    // feeGrowthInside math, since tokensOwed is only accurate after a poke.

    // ==================== FIXED SWAP FUNCTIONS (exact Pump.fun constant-product) ====================
    /// @return usedBuyAmount The ETH actually consumed by the swap (may be less
    ///         than the requested buyAmount when the reserve cap bites near
    ///         graduation). Callers MUST refund `msg.value - usedBuyAmount`
    ///         (net of fees) or the capped-away ETH is stranded in the contract.
    function _swapExactETHForTokens(
        address token,
        uint256 buyAmount,
        uint256 minAmountOut
    ) internal returns (uint256 usedBuyAmount) {
        require(!tokenPools[token].launched, "Pool has been already launched");
        PoolInfo storage pool = tokenPools[token];

        uint256 totalFeeBps = PLATFORM_BUY_FEE_BPS + TOKEN_OWNER_FEE_BPS;

        // Cap the effective buyAmount so the computed output never exceeds the
        // available real token reserve. Without this, a buyer near graduation
        // pays for the full output but the capped output is less — the
        // difference is silently absorbed rather than refunded.
        uint256 maxEffectiveBuy = _getMaxBuyForReserve(
            pool.virtualEthReserve,
            pool.virtualTokenReserve,
            pool.tokenReserve,
            totalFeeBps
        );
        if (buyAmount > maxEffectiveBuy) {
            buyAmount = maxEffectiveBuy;
        }

        uint256 amountOut = getAmountOut(
            buyAmount,
            pool.virtualEthReserve,
            pool.virtualTokenReserve,
            totalFeeBps
        );
        require(amountOut >= minAmountOut, "Slippage limit exceeded");

        checkPriceImpact(amountOut, pool.virtualTokenReserve);

        uint256 buyFee = _mul(buyAmount, PLATFORM_BUY_FEE_BPS) / DIVISOR;
        uint256 tokenOwnerFee = _mul(buyAmount, TOKEN_OWNER_FEE_BPS) / DIVISOR;
        uint256 netAmountIn = buyAmount - buyFee - tokenOwnerFee;

        // Update real + virtual reserves (K preserved by construction)
        pool.ethReserve += netAmountIn;
        pool.tokenReserve -= amountOut;
        pool.virtualEthReserve += netAmountIn;
        pool.virtualTokenReserve -= amountOut;
        totalCurveEthReserve += netAmountIn;

        IERC20(token).safeTransfer(msg.sender, amountOut);

        _payTokenOwnerFee(pool.owner, tokenOwnerFee);
        _payPlatformFee(buyFee);

        _emitBuy(token, netAmountIn, amountOut);
        _checkAndAddLiquidity(token);

        return buyAmount;
    }

    /// @dev Largest buyAmount (in ETH, before fees) that still produces an
    ///      amountOut <= tokenReserve. Solves for buyAmount in:
    ///        amountOut = (buyAmount * (1 - fee)) * vToken / (vEth + buyAmount * (1 - fee))
    ///      capped at amountOut <= tokenReserve.
    function _getMaxBuyForReserve(
        uint256 vEth,
        uint256 vToken,
        uint256 tokenReserve,
        uint256 totalFeeBps
    ) internal pure returns (uint256) {
        if (tokenReserve == 0) return 0;
        // netBuy = buyAmount * (DIVISOR - totalFeeBps) / DIVISOR
        // amountOut = netBuy * vToken / (vEth + netBuy)
        // Solve: netBuy * vToken / (vEth + netBuy) <= tokenReserve
        // => netBuy * vToken <= tokenReserve * vEth + tokenReserve * netBuy
        // => netBuy * (vToken - tokenReserve) <= tokenReserve * vEth
        // => netBuy <= tokenReserve * vEth / (vToken - tokenReserve)
        if (vToken <= tokenReserve) return type(uint256).max; // reserve is ample
        uint256 maxNet = _mul(tokenReserve, vEth) / (vToken - tokenReserve);
        // Convert back to gross (pre-fee) buyAmount
        return _mul(maxNet, DIVISOR) / (DIVISOR - totalFeeBps);
    }

    function _swapETHForExactTokens(
        address token,
        uint256 buyAmount,
        uint256 maxAmountIn
    ) internal returns (uint256) {
        require(!tokenPools[token].launched, "Pool has been already launched");
        PoolInfo storage pool = tokenPools[token];

        uint256 totalFeeBps = PLATFORM_BUY_FEE_BPS + TOKEN_OWNER_FEE_BPS;

        // Cap the requested output to what the curve can actually deliver BEFORE
        // pricing it. Otherwise amountIn is computed for the full request but only
        // the capped amount is transferred — the buyer overpays with no refund.
        if (buyAmount > pool.tokenReserve) {
            buyAmount = pool.tokenReserve;
        }

        uint256 amountIn = getAmountIn(
            buyAmount,
            pool.virtualEthReserve,
            pool.virtualTokenReserve,
            totalFeeBps
        );
        require(amountIn <= maxAmountIn, "Exceeds maximum input");

        checkPriceImpact(buyAmount, pool.virtualTokenReserve);

        uint256 buyFee = _mul(amountIn, PLATFORM_BUY_FEE_BPS) / DIVISOR;
        uint256 tokenOwnerFee = _mul(amountIn, TOKEN_OWNER_FEE_BPS) / DIVISOR;
        uint256 netAmountIn = amountIn - buyFee - tokenOwnerFee;

        pool.ethReserve += netAmountIn;
        pool.tokenReserve -= buyAmount;
        pool.virtualEthReserve += netAmountIn;
        pool.virtualTokenReserve -= buyAmount;
        totalCurveEthReserve += netAmountIn;

        IERC20(token).safeTransfer(msg.sender, buyAmount);

        _payTokenOwnerFee(pool.owner, tokenOwnerFee);
        _payPlatformFee(buyFee);

        _emitBuy(token, amountIn, buyAmount);
        _checkAndAddLiquidity(token);

        return amountIn;
    }

    function _swapExactTokensForETH(
        address token,
        uint256 sellAmount,
        uint256 minAmountOut
    ) internal {
        require(!tokenPools[token].launched, "Pool has been already launched");
        PoolInfo storage pool = tokenPools[token];

        // Sell uses 0 fee in formula (fees applied explicitly on output)
        uint256 grossOut = getAmountOut(
            sellAmount,
            pool.virtualTokenReserve,
            pool.virtualEthReserve,
            0
        );

        // Protect against virtual > real ETH (Pump.fun safety)
        if (grossOut > pool.ethReserve) grossOut = pool.ethReserve;

        uint256 sellFee = _mul(grossOut, PLATFORM_SELL_FEE_BPS) / DIVISOR;
        uint256 tokenOwnerFee = _mul(grossOut, TOKEN_OWNER_FEE_BPS) / DIVISOR;
        uint256 netAmountOut = grossOut - sellFee - tokenOwnerFee;

        require(netAmountOut >= minAmountOut, "Slippage limit exceeded");

        checkPriceImpact(grossOut, pool.virtualEthReserve);

        pool.ethReserve -= grossOut;
        pool.tokenReserve += sellAmount;
        pool.virtualEthReserve -= grossOut;
        pool.virtualTokenReserve += sellAmount;
        totalCurveEthReserve -= grossOut;

        IERC20(token).safeTransferFrom(msg.sender, address(this), sellAmount);
        _transferETH(msg.sender, netAmountOut);

        _payTokenOwnerFee(pool.owner, tokenOwnerFee);
        _payPlatformFee(sellFee);

        _emitSell(token, netAmountOut, sellAmount);
    }

    function _emitBuy(address token, uint256 ethIn, uint256 tokensOut) private {
        tokenTrades[token]++;
        emit BuyTokens(
            msg.sender,
            token,
            ethIn,
            tokensOut,
            getVirtualPrice(token),
            _rawEthPrice(),
            getTokenVirtualMarketCap(token),
            block.timestamp
        );
    }

    function _emitSell(
        address token,
        uint256 ethOut,
        uint256 tokensIn
    ) private {
        emit SellTokens(
            msg.sender,
            token,
            ethOut,
            tokensIn,
            getVirtualPrice(token),
            _rawEthPrice(),
            getTokenVirtualMarketCap(token),
            block.timestamp
        );
    }

    // ==================== PUBLIC SWAP ENTRYPOINTS ====================
    function swapExactETHForTokens(
        address token,
        uint256 buyAmount,
        uint256 minAmountOut,
        uint256 deadline
    ) public payable whenNotPaused nonReentrant {
        require(deadline >= block.timestamp, "Swap expired");
        require(tokenPools[token].token != address(0), "Pool does not exist");
        uint256 maxBuy = _mul(
            tokenPools[token].virtualEthReserve,
            MAX_BUY_PERCENT
        ) / DIVISOR;
        require(buyAmount <= maxBuy, "Exceeds maximum price impact");

        uint256 firstBuyFee = getFirstBuyFee(token);
        require(msg.value >= buyAmount + firstBuyFee, "Insufficient ETH value");

        // Refund against the ACTUAL ETH consumed, not the requested buyAmount:
        // the reserve cap may shrink the effective buy near graduation, and the
        // capped-away ETH must be returned or it is stranded in the contract.
        uint256 usedBuy = _swapExactETHForTokens(
            token,
            buyAmount,
            minAmountOut
        );

        if (msg.value > usedBuy + firstBuyFee) {
            _transferETH(msg.sender, msg.value - usedBuy - firstBuyFee);
        }
        if (firstBuyFee > 0) {
            _transferETHTolerant(feeAddress, firstBuyFee);
        }
    }

    function swapETHForExactTokens(
        address token,
        uint256 buyAmount,
        uint256 maxAmountIn,
        uint256 deadline
    ) public payable whenNotPaused nonReentrant {
        require(deadline >= block.timestamp, "Swap expired");
        require(tokenPools[token].token != address(0), "Pool does not exist");
        uint256 maxBuy = _mul(
            tokenPools[token].virtualTokenReserve,
            MAX_BUY_PERCENT
        ) / DIVISOR;
        require(buyAmount <= maxBuy, "Exceeds maximum price impact");

        uint256 firstBuyFee = getFirstBuyFee(token);
        require(
            msg.value >= maxAmountIn + firstBuyFee,
            "Insufficient ETH value"
        );

        uint256 amountIn = _swapETHForExactTokens(
            token,
            buyAmount,
            maxAmountIn
        );

        if (msg.value > amountIn + firstBuyFee) {
            _transferETH(msg.sender, msg.value - amountIn - firstBuyFee);
        }
        if (firstBuyFee > 0) {
            _transferETHTolerant(feeAddress, firstBuyFee);
        }
    }

    function swapExactTokensForETH(
        address token,
        uint256 sellAmount,
        uint256 minAmountOut,
        uint256 deadline
    ) public whenNotPaused nonReentrant {
        require(deadline >= block.timestamp, "Swap expired");
        require(tokenPools[token].token != address(0), "Pool does not exist");
        uint256 maxSell = _mul(
            tokenPools[token].virtualTokenReserve,
            MAX_SELL_PERCENT
        ) / DIVISOR;
        require(sellAmount <= maxSell, "Sell amount too large");

        _swapExactTokensForETH(token, sellAmount, minAmountOut);
    }

    // ==================== PRICE AND MARKET CAP FUNCTIONS ====================
    /// @dev ETH/USD normalized to 18 decimals, or 0 if the feed is unavailable,
    ///      stale (>1h), non-positive, or from an incomplete round. NEVER reverts —
    ///      so trades (buy/sell events, mcap) can't be frozen by an oracle outage.
    /// @notice ETH/USD, 18 decimals. Chainlink first; the V2 pair only if Chainlink
    ///         is stale/down AND a fallback has been configured. 0 = no price.
    function _rawEthPrice() internal view returns (uint256) {
        uint256 p = _rawEthPriceFromChainlink();
        if (p != 0) return p;
        return _rawEthPriceFromRouterV2();
    }

    /// @notice Spot ETH price from the configured Uniswap V2 ETH/stable pair.
    /// @dev Returns 0 when unconfigured, when the pair is missing, or when the pair
    ///      is too shallow to trust. Never reverts — a price source that can revert
    ///      bricks every trading path that reads it.
    function _rawEthPriceFromRouterV2() internal view returns (uint256) {
        IUniswapV2Router02 router = fallbackRouterV2;
        if (address(router) == address(0)) return 0;

        address weth = router.WETH();
        address pair = IUniswapV2Factory(router.factory()).getPair(
            weth,
            fallbackStable
        );
        if (pair == address(0)) return 0;

        (uint112 r0, uint112 r1, ) = IUniswapV2Pair(pair).getReserves();
        (uint256 wethReserve, uint256 stableReserve) = IUniswapV2Pair(pair)
            .token0() == weth
            ? (uint256(r0), uint256(r1))
            : (uint256(r1), uint256(r0));

        if (wethReserve < MIN_FALLBACK_WETH_LIQUIDITY) return 0;
        if (stableReserve == 0) return 0;

        // stable-per-WETH, normalised to 18 decimals.
        return
            (stableReserve *
                (10 ** (18 - fallbackStableDecimals)) *
                1e18) / wethReserve;
    }

    function _rawEthPriceFromChainlink() internal view returns (uint256) {
        try priceFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (price <= 0) return 0;
            if (answeredInRound < roundId) return 0; // incomplete round
            if (
                updatedAt == 0 ||
                block.timestamp - updatedAt > priceStalenessThreshold
            ) return 0;
            uint8 dec = priceFeedDecimals;
            if (dec <= 18) return uint256(price) * (10 ** (18 - dec));
            return uint256(price) / (10 ** (dec - 18));
        } catch {
            return 0;
        }
    }

    /// @notice ETH/USD normalized to 18 decimals. Reverts if unavailable — used
    ///         only where a real price is mandatory (graduation LP sizing).
    function getETHPriceByUSD() public view returns (uint256) {
        uint256 p = _rawEthPrice();
        require(p > 0, "Invalid or stale price feed");
        return p;
    }

    function getFirstBuyFee(address token) public view returns (uint256) {
        if (firstBuyFeeUSD == 0 || tokenTrades[token] >= 3) return 0;
        uint256 p = _rawEthPrice();
        if (p == 0) return 0; // oracle down -> skip first-buy fee rather than brick the buy
        return _mul(firstBuyFeeUSD, 1 ether) / p;
    }

    function getVirtualPrice(address token) public view returns (uint256) {
        PoolInfo storage pool = tokenPools[token];
        if (pool.virtualEthReserve == 0 || pool.virtualTokenReserve == 0)
            return 0;
        return _mul(pool.virtualEthReserve, 1e18) / pool.virtualTokenReserve;
    }

    function getTokenVirtualMarketCap(
        address token
    ) public view returns (uint256) {
        PoolInfo storage pool = tokenPools[token];
        if (pool.virtualEthReserve == 0 || pool.virtualTokenReserve == 0)
            return 0;

        return
            (_rawEthPrice() * TOTAL_SUPPLY * pool.virtualEthReserve) /
            pool.virtualTokenReserve /
            1e18;
    }

    function getMaxSellableETH(address token) external view returns (uint256) {
        return tokenPools[token].ethReserve;
    }

    // Pump.fun-style bonding curve progress (percentage of curve filled)
    function getBondingCurveProgress(
        address token
    ) external view returns (uint256 progressPercent) {
        PoolInfo storage pool = tokenPools[token];
        if (pool.virtualTokenReserve == 0) return 10000; // 100%

        // tokensSold here equals REAL tokens sold from the curve, because
        // virtualTokenReserve == tokenReserve + (VIRTUAL_TOKEN_INITIAL -
        // REAL_TOKEN_INITIAL). So the correct denominator is REAL_TOKEN_INITIAL;
        // the old (VIRTUAL_TOKEN_INITIAL - REAL_TOKEN_INITIAL) under-counted and
        // let this report >100%.
        uint256 tokensSold = VIRTUAL_TOKEN_INITIAL - pool.virtualTokenReserve;
        uint256 maxSellable = REAL_TOKEN_INITIAL;

        if (maxSellable == 0) return 0;
        progressPercent = _mul(tokensSold, DIVISOR) / maxSellable;
        if (progressPercent > DIVISOR) progressPercent = DIVISOR;
    }

    function _checkAndAddLiquidity(address token) internal {
        PoolInfo storage pool = tokenPools[token];

        if (getTokenVirtualMarketCap(token) < TARGET_MARKET_CAP_USD) {
            return;
        }

        pool.launched = true;
        ILaunchable(token).launch();

        uint256 totalFeesToReserve = tokenOwnerLPFee + platformLPFee;
        uint256 ethAmountForLP = pool.ethReserve > totalFeesToReserve
            ? pool.ethReserve - totalFeesToReserve
            : pool.ethReserve;

        // Use actual contract balance — real reserve may be depleted near graduation
        uint256 tokenAmountForLP = IERC20(token).balanceOf(address(this));
        uint256 remainingEthReserve = pool.ethReserve - ethAmountForLP;
        address poolOwner = pool.owner;

        // Effects before interactions: clear reserves up front. poolType/owner
        // stay intact for _addLiquidity, which reads token balance, not reserves.
        totalCurveEthReserve -= pool.ethReserve;
        pool.ethReserve = 0;
        pool.tokenReserve = 0;
        pool.virtualEthReserve = 0;
        pool.virtualTokenReserve = 0;

        _addLiquidity(token, ethAmountForLP, tokenAmountForLP);

        // Burn any remaining tokens (Pump.fun style)
        uint256 remainingTokens = IERC20(token).balanceOf(address(this));
        if (remainingTokens > 0) {
            IERC20(token).safeTransfer(burnAddress, remainingTokens);
        }

        // Distribute the reserved LP fees to their designated recipients:
        // platformLPFee -> project fee address, tokenOwnerLPFee -> token creator.
        // remainingEthReserve is either 0 or exactly platformLPFee + tokenOwnerLPFee.
        if (remainingEthReserve > 0) {
            uint256 ownerFee = tokenOwnerLPFee > remainingEthReserve
                ? remainingEthReserve
                : tokenOwnerLPFee;
            uint256 platformFee = remainingEthReserve - ownerFee;
            if (ownerFee > 0) {
                if (!_transferETHTolerant(poolOwner, ownerFee))
                    _transferETHTolerant(feeAddress, ownerFee);
            }
            if (platformFee > 0) _transferETHTolerant(feeAddress, platformFee);
        }

        emit TokenLaunched(token, block.timestamp);
    }

    function _addLiquidity(
        address token,
        uint256 ethAmount,
        uint256 tokenAmount
    ) internal {
        uint8 pt = tokenPools[token].poolType;
        uint256 ethPriceUSD = getETHPriceByUSD();

        if (pt == 1) {
            _addLiquidityV2(token, ethAmount, tokenAmount, ethPriceUSD);
        } else if (pt == 2) {
            // V3/V4 derive the pool price from the amounts we hand them, so we
            // must pin the token amount to the target here (or the pool would
            // open far below the curve graduation price). Excess tokens are
            // burned by the caller after this returns.
            uint256 tokenForLP = _tokensForTargetMcap(
                ethAmount,
                tokenAmount,
                ethPriceUSD
            );
            IERC20(token).approve(address(liquidityManager), tokenForLP);
            try
                liquidityManager.addLiquidityV3{value: ethAmount}(
                    token,
                    tokenForLP,
                    ethAmount,
                    burnAddress
                )
            {} catch {
                // A griefer pre-initialized the V3 pool at a hostile price, so the
                // tolerance check reverts. Fall back to the brick-proof V2 first-mint
                // path instead of freezing graduation (and reverting the buyer's tx).
                IERC20(token).approve(address(liquidityManager), 0);
                tokenPools[token].poolType = 1;
                _addLiquidityV2(token, ethAmount, tokenAmount, ethPriceUSD);
            }
        } else if (pt == 3) {
            uint256 tokenForLP = _tokensForTargetMcap(
                ethAmount,
                tokenAmount,
                ethPriceUSD
            );
            IERC20(token).approve(address(liquidityManager), tokenForLP);
            try
                liquidityManager.addLiquidityV4{value: ethAmount}(
                    token,
                    tokenForLP,
                    ethAmount,
                    burnAddress
                )
            {} catch {
                IERC20(token).approve(address(liquidityManager), 0);
                tokenPools[token].poolType = 1;
                _addLiquidityV2(token, ethAmount, tokenAmount, ethPriceUSD);
            }
        } else {
            revert("Unsupported pool type");
        }

        emit LiquidityAdded(
            token,
            ethAmount,
            tokenAmount,
            IERC20(token).totalSupply()
        );
    }

    /// @dev V2 first-mint graduation. Brick-proof: the pair is seeded directly (not
    ///      via the router), the token is transfer-gated pre-launch so nobody can
    ///      seed token-side liquidity, and any donated WETH is absorbed to keep the
    ///      opening price at target. Used both as the V2 path and the V3/V4 fallback.
    function _addLiquidityV2(
        address token,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 ethPriceUSD
    ) private {
        IERC20(token).approve(address(liquidityManager), tokenAmount);
        liquidityManager.addLiquidityV2WithTargetMarketCap{value: ethAmount}(
            token,
            tokenAmount,
            ethAmount,
            burnAddress,
            TARGET_MARKET_CAP_USD,
            ethPriceUSD
        );
    }

    /// @dev Tokens to pair with `ethAmount` so the DEX pool opens at the target
    ///      market cap — i.e. the same price the bonding curve graduated at, so
    ///      there is no price gap on migration. Mirrors the V2 target math.
    function _tokensForTargetMcap(
        uint256 ethAmount,
        uint256 availableTokens,
        uint256 ethPriceUSD
    ) internal pure returns (uint256) {
        uint256 required = (ethAmount * TOTAL_SUPPLY) / 1e18;
        required = (required * ethPriceUSD) / TARGET_MARKET_CAP_USD;
        return required < availableTokens ? required : availableTokens;
    }

    function _transferETH(address to, uint256 amount) internal {
        require(to != address(0), "Cannot transfer to zero address");
        require(amount > 0, "Amount must be greater than zero");
        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    /// @dev Best-effort ETH send that NEVER reverts — used only for protocol/creator
    ///      FEES, so a hostile creator or misconfigured fee recipient can't brick
    ///      trading. User principal (sale proceeds, refunds) still uses _transferETH.
    function _transferETHTolerant(
        address to,
        uint256 amount
    ) internal returns (bool) {
        if (to == address(0) || amount == 0) return false;
        (bool ok, ) = payable(to).call{value: amount}("");
        return ok;
    }

    /// @dev Pay the token creator's fee; if the (untrusted) creator refuses ETH,
    ///      route it to the platform instead of reverting the trade (anti-honeypot).
    function _payTokenOwnerFee(address owner_, uint256 fee) private {
        if (fee == 0) return;
        if (!_transferETHTolerant(owner_, fee)) {
            _transferETHTolerant(feeAddress, fee);
        }
    }

    /// @dev Split the per-trade platform fee between treasury (feeAddress) and
    ///      leaderboard (distributorAddress) by platformTreasuryShareBps. At the
    ///      default 6250 (62.5%) with an 80bps platform fee this realizes 0.5%
    ///      treasury + 0.3% leaderboard per buy/sell; the token creator's 0.2%
    ///      is paid separately in _payTokenOwnerFee. The leaderboard takes the
    ///      remainder (fee - treasuryCut) so no wei is lost to rounding.
    ///      Tolerant of a misconfigured recipient so a bad address never bricks
    ///      trading.
    function _payPlatformFee(uint256 fee) private {
        if (fee == 0) return;
        uint256 treasuryCut = (fee * platformTreasuryShareBps) / DIVISOR;
        if (treasuryCut > 0) _transferETHTolerant(feeAddress, treasuryCut);
        _transferETHTolerant(distributorAddress, fee - treasuryCut);
    }

    /// @notice Retune the treasury vs leaderboard split of the platform fee,
    ///         in bps of 10000 (e.g. 6250 = 62.5% treasury / 37.5% leaderboard).
    ///         The creator fee (TOKEN_OWNER_FEE_BPS) and the total platform fee
    ///         (PLATFORM_BUY/SELL_FEE_BPS) are set separately, so all three
    ///         destinations are independently tunable without an upgrade.
    function setPlatformTreasuryShareBps(uint256 bps) external onlyOwner {
        require(bps <= DIVISOR, "Share cannot exceed 100%");
        platformTreasuryShareBps = bps;
    }

    // ==================== ADMIN FUNCTIONS ====================
    function setTokenOwnerFeeBps(uint256 bps) external onlyOwner {
        require(bps <= 1000, "Fee cannot exceed 10%");
        TOKEN_OWNER_FEE_BPS = bps;
    }

    function setCreateTokenFeeAmount(uint256 feeAmount) external onlyOwner {
        CREATE_TOKEN_FEE_AMOUNT = feeAmount;
    }

    function setFirstBuyFee(uint256 fee) external onlyOwner {
        firstBuyFeeUSD = fee;
    }

    /// @notice Set the Chainlink staleness threshold. On L2 chains where the feed
    ///         timestamp originates from L1, increase this to 86400+ (24h).
    function setPriceStalenessThreshold(uint256 threshold) external onlyOwner {
        require(threshold > 0, "Threshold must be > 0");
        priceStalenessThreshold = threshold;
    }

    /// @notice Configure (or clear) the Uniswap V2 ETH/stable price fallback used
    ///         only while the Chainlink feed is stale or down.
    /// @dev Pass address(0) for either argument to disable the fallback entirely,
    ///      which restores pre-fallback behaviour (no price = no graduation).
    ///      Read the WARNING on fallbackRouterV2 before enabling: this is a spot
    ///      price and is manipulable within a transaction.
    /// @param router Uniswap V2 router (used for its factory + WETH).
    /// @param stable A USD stablecoin paired with WETH on that factory (USDC/USDT).
    function setEthUsdFallback(address router, address stable) external onlyOwner {
        if (router == address(0) || stable == address(0)) {
            fallbackRouterV2 = IUniswapV2Router02(address(0));
            fallbackStable = address(0);
            fallbackStableDecimals = 0;
            emit EthUsdFallbackUpdated(address(0), address(0));
            return;
        }

        uint8 dec = IERC20Metadata(stable).decimals();
        require(dec <= 18, "Unsupported stable decimals");

        // Resolve the pair now so a typo fails here, loudly, instead of silently
        // reading 0 forever during the outage the fallback exists to cover.
        address pair = IUniswapV2Factory(IUniswapV2Router02(router).factory())
            .getPair(IUniswapV2Router02(router).WETH(), stable);
        require(pair != address(0), "No V2 pair for stable");

        fallbackRouterV2 = IUniswapV2Router02(router);
        fallbackStable = stable;
        fallbackStableDecimals = dec;
        emit EthUsdFallbackUpdated(router, stable);
    }

    function setTokenOwnerLPFee(uint256 fee) external onlyOwner {
        tokenOwnerLPFee = fee;
    }

    function setPlatformLPFee(uint256 newPlatformFee) external onlyOwner {
        platformLPFee = newPlatformFee;
    }

    function setMaxBuyPercent(uint256 percent) external onlyOwner {
        require(percent <= DIVISOR, "Max buy cannot exceed 100%");
        MAX_BUY_PERCENT = percent;
    }

    function setMaxSellPercent(uint256 percent) external onlyOwner {
        require(percent <= DIVISOR, "Max sell cannot exceed 100%");
        MAX_SELL_PERCENT = percent;
    }

    function setPlatformBuyFeeBps(uint256 bps) external onlyOwner {
        require(bps <= 1000, "Buy fee cannot exceed 10%");
        PLATFORM_BUY_FEE_BPS = bps;
    }

    function setPlatformSellFeeBps(uint256 bps) external onlyOwner {
        require(bps <= 1000, "Sell fee cannot exceed 10%");
        PLATFORM_SELL_FEE_BPS = bps;
    }

    function setFeeAddress(address newFeeAddress) external onlyOwner {
        require(newFeeAddress != address(0), "Fee address cannot be zero");
        feeAddress = newFeeAddress;
    }

    function setDistributorAddress(
        address newDistributorAddress
    ) external onlyOwner {
        require(
            newDistributorAddress != address(0),
            "Distributor cannot be zero"
        );
        distributorAddress = newDistributorAddress;
    }

    function requestLiquidityManagerChange(
        address newLiquidityManagerAddress
    ) external onlyOwner {
        require(
            newLiquidityManagerAddress != address(0),
            "Liquidity manager cannot be zero"
        );
        pendingLiquidityManager = newLiquidityManagerAddress;
        liquidityManagerChangeTime = block.timestamp;
        emit LiquidityManagerChangeRequested(
            newLiquidityManagerAddress,
            block.timestamp + EMERGENCY_TIMELOCK
        );
    }

    function executeLiquidityManagerChange() external onlyOwner {
        require(pendingLiquidityManager != address(0), "No pending change");
        require(
            block.timestamp >= liquidityManagerChangeTime + EMERGENCY_TIMELOCK,
            "Timelock not expired"
        );
        liquidityManager = IFyuzLiquidityManager(pendingLiquidityManager);
        emit LiquidityManagerChanged(pendingLiquidityManager);
        pendingLiquidityManager = address(0);
        liquidityManagerChangeTime = 0;
    }

    function cancelLiquidityManagerChange() external onlyOwner {
        pendingLiquidityManager = address(0);
        liquidityManagerChangeTime = 0;
        emit LiquidityManagerChangeCancelled();
    }

    /// @notice Recovery: reroute a not-yet-launched token to another DEX version.
    /// @dev If a griefer pre-initializes the target DEX pool at a hostile price,
    ///      graduation aborts (funds safe, but the token is stuck). The owner can
    ///      move it to a clean path (e.g. V2, which is brick-proof) and finalize.
    function recoverPoolType(
        address token,
        uint8 newPoolType
    ) external onlyOwner {
        require(tokenPools[token].token != address(0), "Pool does not exist");
        require(!tokenPools[token].launched, "Already launched");
        // Must match createToken's gate, or V4 would be reachable through this
        // owner-only back door despite being disabled at creation time.
        require(newPoolType == 1 || newPoolType == 2, "Only V2 or V3 pool type");
        tokenPools[token].poolType = newPoolType;
    }

    /// @notice ETH the owner may emergency-withdraw: contract balance minus the
    ///         ETH backing active bonding curves. Ensures emergency recovery can
    ///         only ever touch stray/donated ETH, never users' curve funds.
    function withdrawableEth() public view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > totalCurveEthReserve ? bal - totalCurveEthReserve : 0;
    }

    function requestEmergencyWithdrawETH(uint256 amount) external onlyOwner {
        require(
            amount <= withdrawableEth(),
            "Exceeds withdrawable (curve-backed ETH protected)"
        );
        emergencyWithdrawRequestTime = block.timestamp;
        emergencyWithdrawAmount = amount;
        emit EmergencyWithdrawRequested(
            amount,
            block.timestamp + EMERGENCY_TIMELOCK
        );
    }

    function executeEmergencyWithdrawETH() external onlyOwner {
        require(emergencyWithdrawRequestTime > 0, "No pending withdrawal");
        require(
            block.timestamp >=
                emergencyWithdrawRequestTime + EMERGENCY_TIMELOCK,
            "Timelock not expired"
        );
        uint256 amount = emergencyWithdrawAmount;
        require(
            amount <= withdrawableEth(),
            "Exceeds withdrawable (curve-backed ETH protected)"
        );

        emergencyWithdrawRequestTime = 0;
        emergencyWithdrawAmount = 0;

        _transferETH(owner(), amount);
        emit EmergencyWithdrawExecuted(amount);
    }

    function cancelEmergencyWithdraw() external onlyOwner {
        emergencyWithdrawRequestTime = 0;
        emergencyWithdrawAmount = 0;
        emit EmergencyWithdrawCancelled();
    }

    function emergencyWithdrawTokens(
        address token,
        uint256 amount
    ) external onlyOwner {
        require(
            amount <= IERC20(token).balanceOf(address(this)),
            "Insufficient token balance"
        );
        require(
            tokenPools[token].launched || tokenPools[token].token == address(0),
            "Cannot withdraw from active pool"
        );
        IERC20(token).safeTransfer(owner(), amount);
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    // ==================== VIEW FUNCTIONS FOR DEBUGGING / FRONTEND ====================
    function getPoolDetails(
        address token
    )
        external
        view
        returns (
            uint256 ethReserve,
            uint256 tokenReserve,
            uint256 virtualEthReserve,
            uint256 virtualTokenReserve,
            uint256 virtualPrice,
            uint256 actualPrice,
            bool launched
        )
    {
        PoolInfo storage pool = tokenPools[token];
        return (
            pool.ethReserve,
            pool.tokenReserve,
            pool.virtualEthReserve,
            pool.virtualTokenReserve,
            getVirtualPrice(token),
            getPrice(token),
            pool.launched
        );
    }

    function getPrice(address token) public view returns (uint256) {
        PoolInfo storage pool = tokenPools[token];
        if (pool.tokenReserve == 0 || pool.ethReserve == 0) return 0;
        return _mul(pool.ethReserve, 1e18) / pool.tokenReserve;
    }

    function getSwapOutput(
        address token,
        uint256 amountIn,
        bool isETHInput
    ) external view returns (uint256 amountOut, uint256 priceImpact) {
        PoolInfo storage pool = tokenPools[token];
        require(!pool.launched, "Pool has been launched");

        if (isETHInput) {
            uint256 totalFeeBps = PLATFORM_BUY_FEE_BPS + TOKEN_OWNER_FEE_BPS;
            amountOut = getAmountOut(
                amountIn,
                pool.virtualEthReserve,
                pool.virtualTokenReserve,
                totalFeeBps
            );
            priceImpact = _mul(amountOut, DIVISOR) / pool.virtualTokenReserve;
        } else {
            uint256 grossOut = getAmountOut(
                amountIn,
                pool.virtualTokenReserve,
                pool.virtualEthReserve,
                0
            );
            uint256 sellFee = _mul(grossOut, PLATFORM_SELL_FEE_BPS) / DIVISOR;
            uint256 tokenOwnerFee = _mul(grossOut, TOKEN_OWNER_FEE_BPS) /
                DIVISOR;
            amountOut = grossOut - sellFee - tokenOwnerFee;
            priceImpact = _mul(grossOut, DIVISOR) / pool.virtualEthReserve;
        }
    }

    function getLaunchProgress(
        address token
    )
        external
        view
        returns (
            uint256 currentMarketCap,
            uint256 targetMarketCap,
            uint256 progressPercent,
            bool canLaunch
        )
    {
        currentMarketCap = getTokenVirtualMarketCap(token);
        targetMarketCap = TARGET_MARKET_CAP_USD;

        if (targetMarketCap > 0) {
            progressPercent = _mul(currentMarketCap, DIVISOR) / targetMarketCap;
        }

        canLaunch = currentMarketCap >= targetMarketCap;
    }
}
