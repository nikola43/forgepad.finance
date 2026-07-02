// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {
    SafeERC20,
    IERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IArrowpadLiquidityManager} from "./IArrowpadLiquidityManager.sol";
import {
    AggregatorV3Interface
} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {Token} from "./Token.sol";

interface ILaunchable {
    function launch() external;
}

interface IArrowpad {
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

contract Arrowpad is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ==================== PUMP.FUN EXACT PARAMETERS (confirmed from protocol) ====================
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18;
    uint256 public constant TARGET_MARKET_CAP_USD = 20_000 * 1e18; // Graduation at ~$20K virtual MCAP
    uint256 public constant VIRTUAL_ETH_INITIAL = 2.5 ether; // ~$4.8K initial mcap, graduates at ~$70K
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
    IArrowpadLiquidityManager public liquidityManager;
    // Immutable Chainlink ETH/USD feed — read automatically (view call) on every
    // trade/mcap query. No owner, backend, or transaction is ever needed to read it,
    // and it cannot be changed after deployment (fully trustless).
    AggregatorV3Interface internal immutable priceFeed;
    uint8 private immutable priceFeedDecimals;

    mapping(address => PoolInfo) public tokenPools;
    mapping(address => uint256) private tokenTrades;

    address public burnAddress = 0x000000000000000000000000000000000000dEaD;
    address public feeAddress;
    address public distributorAddress;

    uint256 public CREATE_TOKEN_FEE_AMOUNT = 0.001 ether; // ~Pump.fun creation fee equivalent
    // Fees in basis points (1 bps = 0.01%), same DIVISOR basis as MAX_BUY/SELL_PERCENT
    uint256 public TOKEN_OWNER_FEE_BPS = 0; // Optional (e.g. 30 = 0.3%)
    // Chainlink staleness threshold. Default 3600s (1h) for Ethereum mainnet. On L2
    // chains (Arbitrum, Robinhood Chain) the feed's updatedAt is the L1 timestamp
    // and can lag hours behind the L2 block time — set this to 86400 (24h) or more.
    uint256 public priceStalenessThreshold = 3600;
    uint256 public PLATFORM_BUY_FEE_BPS = 100; // 1%
    uint256 public PLATFORM_SELL_FEE_BPS = 100; // 1%
    uint256 public platformLPFee = 0.1 ether;
    uint256 public tokenOwnerLPFee = 0 ether;
    uint256 public firstBuyFeeUSD = 0;

    // Circuit breakers (same safety as Pump.fun)
    uint256 public constant MAX_PRICE_IMPACT = 4_500; // 45% max impact
    uint256 public constant MIN_LIQUIDITY = 1e15;
    uint256 private constant DIVISOR = 10_000;

    uint256 public MAX_BUY_PERCENT = DIVISOR; // 100%
    uint256 public MAX_SELL_PERCENT = DIVISOR; // 100%

    uint256 public tokenCount;

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
    event EmergencyWithdrawRequested(uint256 amount, uint256 executeAfter);
    event EmergencyWithdrawExecuted(uint256 amount);
    event LiquidityManagerChangeRequested(
        address newManager,
        uint256 executeAfter
    );
    event LiquidityManagerChanged(address newManager);

    receive() external payable {}

    constructor(
        address _dataFeedAddress,
        address _liquidityManagerAddress,
        address _feeAddress,
        address _distributorAddress
    ) Ownable(msg.sender) {
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
        liquidityManager = IArrowpadLiquidityManager(_liquidityManagerAddress);
        feeAddress = _feeAddress;
        distributorAddress = _distributorAddress;
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
        require(poolType >= 1 && poolType <= 3, "Invalid pool type");

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

        emit TokenCreated(
            newToken,
            getVirtualPrice(newToken),
            getETHPriceByUSD(),
            sig,
            block.timestamp
        );

        if (buyAmount > 0) {
            _swapExactETHForTokens(newToken, buyAmount, minAmountOut);
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

    // ==================== FIXED SWAP FUNCTIONS (exact Pump.fun constant-product) ====================
    function _swapExactETHForTokens(
        address token,
        uint256 buyAmount,
        uint256 minAmountOut
    ) internal {
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

        IERC20(token).safeTransfer(msg.sender, amountOut);

        _payTokenOwnerFee(pool.owner, tokenOwnerFee);
        _payPlatformFee(buyFee);

        _emitBuy(token, netAmountIn, amountOut);
        _checkAndAddLiquidity(token);
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

        _swapExactETHForTokens(token, buyAmount, minAmountOut);

        if (msg.value > buyAmount + firstBuyFee) {
            _transferETH(msg.sender, msg.value - buyAmount - firstBuyFee);
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
    function _rawEthPrice() internal view returns (uint256) {
        try priceFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (price <= 0) return 0;
            if (answeredInRound < roundId) return 0; // incomplete round
            if (updatedAt == 0 || block.timestamp - updatedAt > priceStalenessThreshold) return 0;
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

        uint256 tokensSold = VIRTUAL_TOKEN_INITIAL - pool.virtualTokenReserve;
        uint256 maxSellable = VIRTUAL_TOKEN_INITIAL - REAL_TOKEN_INITIAL;

        if (maxSellable == 0) return 0;
        progressPercent = _mul(tokensSold, DIVISOR) / maxSellable;
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
    function _transferETHTolerant(address to, uint256 amount) internal returns (bool) {
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

    /// @dev Split a platform fee to feeAddress + distributor, tolerant of a
    ///      misconfigured recipient (never bricks trading).
    function _payPlatformFee(uint256 fee) private {
        if (fee == 0) return;
        uint256 half = fee / 2;
        if (half > 0) _transferETHTolerant(feeAddress, half);
        _transferETHTolerant(distributorAddress, fee - half);
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
        liquidityManager = IArrowpadLiquidityManager(pendingLiquidityManager);
        emit LiquidityManagerChanged(pendingLiquidityManager);
        pendingLiquidityManager = address(0);
        liquidityManagerChangeTime = 0;
    }

    function cancelLiquidityManagerChange() external onlyOwner {
        pendingLiquidityManager = address(0);
        liquidityManagerChangeTime = 0;
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
        require(newPoolType >= 1 && newPoolType <= 3, "Invalid pool type");
        tokenPools[token].poolType = newPoolType;
    }

    function requestEmergencyWithdrawETH(uint256 amount) external onlyOwner {
        require(
            amount <= address(this).balance,
            "Insufficient contract balance"
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
            amount <= address(this).balance,
            "Insufficient contract balance"
        );

        emergencyWithdrawRequestTime = 0;
        emergencyWithdrawAmount = 0;

        _transferETH(owner(), amount);
        emit EmergencyWithdrawExecuted(amount);
    }

    function cancelEmergencyWithdraw() external onlyOwner {
        emergencyWithdrawRequestTime = 0;
        emergencyWithdrawAmount = 0;
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
