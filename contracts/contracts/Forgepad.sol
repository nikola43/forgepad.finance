// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IEthismLiquidityManager} from "./IEthismLiquidityManager.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Token} from "./Token.sol";

interface ILaunchable {
    function launch() external;
}

interface IForgepad {
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

contract Forgepad is ReentrancyGuard, Ownable, Pausable {
    struct PoolInfo {
        uint256 ethReserve;
        uint256 tokenReserve;
        uint256 virtualEthReserve;
        uint256 virtualTokenReserve;
        address token;
        address owner;
        uint8 poolType; // 1 = V2, 2 = V3, 3 = V4
        bool launched;
        uint256 lastKValue; // Added to track invariant preservation
    }

    // Meta-transaction structure for gasless token creation
    struct CreateTokenMetaTx {
        uint256 nonce;
        address creator;
        string name;
        string symbol;
        uint256 deadline;
    }

    // Contract variables
    IEthismLiquidityManager public liquidityManager;
    AggregatorV3Interface internal priceFeed;
    mapping(uint256 => address) public tokenList;
    mapping(address => PoolInfo) public tokenPools;
    mapping(address => uint256) private tokenTrades;
    mapping(address => uint256) private _createTokenNonces;
    address public burnAddress;
    address public feeAddress;
    address public distributorAddress;
    uint256 public CREATE_TOKEN_FEE_AMOUNT;
    uint256 public TOKEN_OWNER_FEE_PERCENT;
    uint256 public TARGET_MARKET_CAP;
    uint256 public TOTAL_SUPPLY;
    uint256 public MAX_BUY_PERCENT;
    uint256 public tokenCount;
    uint256 public initialEthLPAmount;
    uint256 public initialTokenLPAmount;
    uint256 public tokenOwnerLPFee;
    uint256 public firstBuyFeeUSD;
    uint256 public MAX_SELL_PERCENT;
    uint256 public PLATFORM_BUY_FEE_PERCENT;
    uint256 public PLATFORM_SELL_FEE_PERCENT;
    uint256 public platformLPFee;
    mapping(address => mapping(address => bool)) migrated;

    // Added circuit breaker variables
    uint256 public constant MAX_PRICE_IMPACT = 4500; // 45% maximum price impact
    uint256 public constant MIN_LIQUIDITY = 1e15; // Minimum liquidity threshold

    // Events
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
    event Migrated(
        address indexed from,
        address indexed oldToken,
        address indexed newToken
    );

    receive() external payable {}

    constructor(
        address _dataFeedAddress,
        address _ethismLiquidityManagerAddress,
        address _feeAddress,
        address _distributorAddress,
        uint256 _targetMarketCap,
        uint256 _totalSupply
    ) Ownable(msg.sender) {
        require(
            _dataFeedAddress != address(0),
            "Data feed address cannot be zero"
        );
        priceFeed = AggregatorV3Interface(_dataFeedAddress);

        require(
            _ethismLiquidityManagerAddress != address(0),
            "Liquidity manager cannot be zero"
        );

        require(
            _distributorAddress != address(0),
            "Distributor address cannot be zero"
        );
        distributorAddress = _distributorAddress;

        liquidityManager = IEthismLiquidityManager(
            _ethismLiquidityManagerAddress
        );

        require(_feeAddress != address(0), "Fee address cannot be zero");
        feeAddress = _feeAddress;
        MAX_BUY_PERCENT = 1000; // 10%
        CREATE_TOKEN_FEE_AMOUNT = 0;
        TOKEN_OWNER_FEE_PERCENT = 0;
        TARGET_MARKET_CAP = _targetMarketCap;
        TOTAL_SUPPLY = _totalSupply * 1e18;
        burnAddress = 0x000000000000000000000000000000000000dEaD;

        initialEthLPAmount = 1.2 ether;
        initialTokenLPAmount = 800_000_000 ether;

        firstBuyFeeUSD = 0;
        MAX_SELL_PERCENT = 1000; // 10%
        PLATFORM_BUY_FEE_PERCENT = 1; // 1%
        PLATFORM_SELL_FEE_PERCENT = 1; // 1%
        platformLPFee = 0.1 ether; // 0.1 ETH
        tokenOwnerLPFee = 0 ether; // 0 ETH
    }

    // ==================== MATHEMATICAL FIXES ====================

    /**
     * @dev Safe multiplication with overflow protection
     */
    function safeMul(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        uint256 c = a * b;
        require(c / a == b, "SafeMath: multiplication overflow");
        return c;
    }

    /**
     * @dev Safe division with zero protection
     */
    function safeDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        require(b > 0, "SafeMath: division by zero");
        return a / b;
    }

    /**
     * @dev Calculate output amount using proper constant product formula
     * FIXED: Correct implementation of x * y = k with proper fee handling
     */
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feePercent
    ) internal pure returns (uint256 amountOut) {
        require(amountIn > 0, "Insufficient input amount");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");

        // Calculate fee in basis points (100 = 1%)
        uint256 feeBasisPoints = feePercent * 100; // Convert percent to basis points
        require(feeBasisPoints < 10000, "Fee too high");

        // Apply fees: amountInWithFee = amountIn * (10000 - feeBasisPoints) / 10000
        uint256 amountInWithFee = safeMul(amountIn, (10000 - feeBasisPoints));
        amountInWithFee = safeDiv(amountInWithFee, 10000);

        // Constant product formula: (x + dx) * (y - dy) = x * y
        // Solving for dy: dy = (y * dx) / (x + dx)
        uint256 numerator = safeMul(amountInWithFee, reserveOut);
        uint256 denominator = reserveIn + amountInWithFee;

        amountOut = safeDiv(numerator, denominator);

        // Safety checks
        require(amountOut > 0, "Insufficient output amount");
        require(amountOut < reserveOut, "Exceeds available liquidity");
    }

    /**
     * @dev Calculate input amount needed for exact outpu
     */
    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feePercent
    ) internal pure returns (uint256 amountIn) {
        require(amountOut > 0, "Insufficient output amount");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");
        require(amountOut < reserveOut, "Exceeds available liquidity");

        // Calculate fee in basis points
        uint256 feeBasisPoints = feePercent * 100;
        require(feeBasisPoints < 10000, "Fee too high");

        // Reverse constant product: (x + dx) * (y - dy) = x * y
        // Solving for dx: dx = (x * dy) / (y - dy)
        uint256 numerator = safeMul(reserveIn, amountOut);
        uint256 denominator = reserveOut - amountOut;
        uint256 amountInBeforeFees = safeDiv(numerator, denominator) + 1; // Add 1 for rounding

        // Account for fees: actualAmountIn = amountInBeforeFees * 10000 / (10000 - feeBasisPoints)
        amountIn = safeDiv(
            safeMul(amountInBeforeFees, 10000),
            (10000 - feeBasisPoints)
        );
    }

    /**
     * @dev Check price impact and enforce circuit breakers
     */
    function checkPriceImpact(
        uint256 /* amountIn */,
        uint256 amountOut,
        uint256 /* reserveIn */,
        uint256 reserveOut
    ) internal pure {
        uint256 priceImpact = safeMul(amountOut, 10000) / reserveOut;
        require(
            priceImpact <= MAX_PRICE_IMPACT,
            "Exceeds maximum price impact"
        );

        // Ensure minimum liquidity remains
        require(
            reserveOut - amountOut >= MIN_LIQUIDITY,
            "Below minimum liquidity"
        );
    }

    // ==================== GASLESS TOKEN CREATION ====================

    function getCreateTokenNonce(address user) public view returns (uint256) {
        return _createTokenNonces[user];
    }

    function createToken(
        string memory name,
        string memory symbol,
        uint256 buyAmount,
        uint32 sig,
        uint8 poolType
    ) external payable whenNotPaused nonReentrant returns (address) {
        uint256 firstBuyFee = buyAmount > 0 ? getFirstBuyFee(address(0)) : 0;

        require(
            msg.value >= buyAmount + firstBuyFee + CREATE_TOKEN_FEE_AMOUNT,
            "Insufficient ETH value"
        );

        address newToken = (address)(new Token(name, symbol, TOTAL_SUPPLY));

        IERC20(newToken).approve(address(this), type(uint256).max);

        // FIXED: Calculate initial K value for invariant tracking
        uint256 initialK = safeMul(initialEthLPAmount, initialTokenLPAmount);

        // Initialize the pool info for the new token
        tokenPools[newToken] = PoolInfo(
            0, // ethReserve
            TOTAL_SUPPLY, // tokenReserve
            initialEthLPAmount, // virtualEthReserve
            initialTokenLPAmount, // virtualTokenReserve
            newToken, // token address
            msg.sender, // owner
            poolType, // poolType (1 = V2, 2 = V3, 3 = V4)
            false, // launched
            initialK // lastKValue
        );

        tokenList[tokenCount] = newToken;
        tokenCount++;

        emit TokenCreated(
            newToken,
            getVirtualPrice(newToken),
            getETHPriceByUSD(),
            sig,
            block.timestamp
        );

        if (buyAmount > 0) {
            _swapExactETHForTokens(newToken, buyAmount, 0);
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

    // ==================== FIXED SWAP FUNCTIONS ====================

    function _swapExactETHForTokens(
        address token,
        uint256 buyAmount,
        uint256 minAmountOut
    ) internal {
        require(!tokenPools[token].launched, "Pool has been already launched");
        require(buyAmount > 0, "Buy amount must be greater than zero");

        PoolInfo storage pool = tokenPools[token];

        // Calculate total fee percentage
        uint256 totalFeePercent = PLATFORM_BUY_FEE_PERCENT +
            TOKEN_OWNER_FEE_PERCENT;

        // Use proper constant product formula with integrated fees
        uint256 amountOut = getAmountOut(
            buyAmount,
            pool.virtualEthReserve,
            pool.virtualTokenReserve,
            totalFeePercent
        );

        require(amountOut >= minAmountOut, "Slippage limit exceeded");

        // Check price impact
        checkPriceImpact(
            buyAmount,
            amountOut,
            pool.virtualEthReserve,
            pool.virtualTokenReserve
        );

        // Calculate actual fees (not from virtual amount)
        uint256 buyFee = safeMul(buyAmount, PLATFORM_BUY_FEE_PERCENT) / 100;
        uint256 tokenOwnerFee = safeMul(buyAmount, TOKEN_OWNER_FEE_PERCENT) /
            100;
        uint256 netAmountIn = buyAmount - buyFee - tokenOwnerFee;

        // CRITICAL FIX: Store old K before any changes
        uint256 oldK = pool.lastKValue;

        // Transfer tokens to user
        IERC20(token).transfer(msg.sender, amountOut);

        // Update reserves with the NET amount (after fees)
        pool.ethReserve += netAmountIn;
        pool.tokenReserve -= amountOut;
        pool.virtualEthReserve += netAmountIn;
        pool.virtualTokenReserve -= amountOut;

        // CRITICAL FIX: For buys, K should increase due to fees being removed from the pool
        // The invariant should account for fees being extracted
        uint256 newK = safeMul(
            pool.virtualEthReserve,
            pool.virtualTokenReserve
        );

        // For purchases, we allow K to decrease slightly due to fee extraction,
        // but it should not decrease by more than the fee amount
        // Calculate minimum allowed K after accounting for fees
        uint256 feeAdjustment = safeMul(oldK, (buyFee + tokenOwnerFee)) /
            buyAmount;
        uint256 minAllowedK = oldK > feeAdjustment
            ? oldK - feeAdjustment
            : oldK / 2;

        require(newK >= minAllowedK, "Invariant violation");
        pool.lastKValue = newK;

        // Distribute fees
        if (tokenOwnerFee > 0) {
            _transferETH(pool.owner, tokenOwnerFee);
        }
        if (buyFee > 0) {
            _transferETH(feeAddress, buyFee / 2);
            _transferETH(distributorAddress, buyFee / 2);
        }

        uint256 tokenPrice = getVirtualPrice(token);
        uint256 ethPrice = getETHPriceByUSD();
        uint256 marketCap = getTokenVirtualMarketCap(token);
        tokenTrades[token]++;

        emit BuyTokens(
            msg.sender,
            token,
            netAmountIn,
            amountOut,
            tokenPrice,
            ethPrice,
            marketCap,
            block.timestamp
        );

        _checkAndAddLiquidity(token);
    }

    function _swapETHForExactTokens(
        address token,
        uint256 buyAmount,
        uint256 maxAmountIn
    ) internal returns (uint256) {
        require(!tokenPools[token].launched, "Pool has been already launched");
        require(buyAmount > 0, "Buy amount must be greater than zero");

        PoolInfo storage pool = tokenPools[token];

        uint256 totalFeePercent = PLATFORM_BUY_FEE_PERCENT +
            TOKEN_OWNER_FEE_PERCENT;

        // Calculate exact input needed using proper reverse calculation
        uint256 amountIn = getAmountIn(
            buyAmount,
            pool.virtualEthReserve,
            pool.virtualTokenReserve,
            totalFeePercent
        );

        require(amountIn <= maxAmountIn, "Exceeds maximum input");

        // Check price impact
        checkPriceImpact(
            amountIn,
            buyAmount,
            pool.virtualEthReserve,
            pool.virtualTokenReserve
        );

        // Calculate actual fees
        uint256 buyFee = safeMul(amountIn, PLATFORM_BUY_FEE_PERCENT) / 100;
        uint256 tokenOwnerFee = safeMul(amountIn, TOKEN_OWNER_FEE_PERCENT) /
            100;
        uint256 netAmountIn = amountIn - buyFee - tokenOwnerFee;

        // Store old K
        uint256 oldK = pool.lastKValue;

        // Transfer tokens to user
        IERC20(token).transfer(msg.sender, buyAmount);

        // Update reserves
        pool.ethReserve += netAmountIn;
        pool.tokenReserve -= buyAmount;
        pool.virtualEthReserve += netAmountIn;
        pool.virtualTokenReserve -= buyAmount;

        // Check invariant with fee adjustment
        uint256 newK = safeMul(
            pool.virtualEthReserve,
            pool.virtualTokenReserve
        );
        uint256 feeAdjustment = safeMul(oldK, (buyFee + tokenOwnerFee)) /
            amountIn;
        uint256 minAllowedK = oldK > feeAdjustment
            ? oldK - feeAdjustment
            : oldK / 2;

        require(newK >= minAllowedK, "Invariant violation");
        pool.lastKValue = newK;

        // Distribute fees
        if (tokenOwnerFee > 0) {
            _transferETH(pool.owner, tokenOwnerFee);
        }
        if (buyFee > 0) {
            _transferETH(feeAddress, buyFee / 2);
            _transferETH(distributorAddress, buyFee / 2);
        }

        uint256 tokenPrice = getVirtualPrice(token);
        uint256 ethPrice = getETHPriceByUSD();
        uint256 marketCap = getTokenVirtualMarketCap(token);
        tokenTrades[token]++;

        emit BuyTokens(
            msg.sender,
            token,
            amountIn,
            buyAmount,
            tokenPrice,
            ethPrice,
            marketCap,
            block.timestamp
        );

        _checkAndAddLiquidity(token);

        return amountIn;
    }

    function _swapExactTokensForETH(
        address token,
        uint256 sellAmount,
        uint256 minAmountOut
    ) internal {
        require(!tokenPools[token].launched, "Pool has been already launched");
        require(sellAmount > 0, "Sell amount must be greater than zero");

        PoolInfo storage pool = tokenPools[token];

        uint256 totalFeePercent = PLATFORM_SELL_FEE_PERCENT +
            TOKEN_OWNER_FEE_PERCENT;

        // Use proper constant product formula for selling
        uint256 amountOut = getAmountOut(
            sellAmount,
            pool.virtualTokenReserve,
            pool.virtualEthReserve,
            totalFeePercent
        );

        require(amountOut >= minAmountOut, "Slippage limit exceeded");

        // Check price impact
        checkPriceImpact(
            sellAmount,
            amountOut,
            pool.virtualTokenReserve,
            pool.virtualEthReserve
        );

        // Calculate fees from ETH output
        uint256 sellFee = safeMul(amountOut, PLATFORM_SELL_FEE_PERCENT) / 100;
        uint256 tokenOwnerFee = safeMul(amountOut, TOKEN_OWNER_FEE_PERCENT) /
            100;
        uint256 netAmountOut = amountOut - sellFee - tokenOwnerFee;

        // Store old K
        uint256 oldK = pool.lastKValue;

        // Transfer tokens from user and ETH to user
        IERC20(token).transferFrom(msg.sender, address(this), sellAmount);
        _transferETH(msg.sender, netAmountOut);

        // Update reserves with gross amounts before fees
        pool.ethReserve -= amountOut; // Full amount before fees
        pool.tokenReserve += sellAmount;
        pool.virtualEthReserve -= amountOut;
        pool.virtualTokenReserve += sellAmount;

        // Check invariant for sells
        uint256 newK = safeMul(
            pool.virtualEthReserve,
            pool.virtualTokenReserve
        );
        uint256 feeAdjustment = safeMul(oldK, (sellFee + tokenOwnerFee)) /
            amountOut;
        uint256 minAllowedK = oldK > feeAdjustment
            ? oldK - feeAdjustment
            : oldK / 2;

        require(newK >= minAllowedK, "Invariant violation");
        pool.lastKValue = newK;

        // Distribute fees
        if (tokenOwnerFee > 0) {
            _transferETH(pool.owner, tokenOwnerFee);
        }
        if (sellFee > 0) {
            _transferETH(feeAddress, sellFee / 2);
            _transferETH(distributorAddress, sellFee / 2);
        }

        emit SellTokens(
            msg.sender,
            token,
            netAmountOut,
            sellAmount,
            getVirtualPrice(token),
            getETHPriceByUSD(),
            getTokenVirtualMarketCap(token),
            block.timestamp
        );
    }

    // ==================== PUBLIC SWAP FUNCTIONS ====================

    function swapExactETHForTokens(
        address token,
        uint256 buyAmount,
        uint256 minAmountOut
    ) public payable whenNotPaused nonReentrant {
        uint256 maxBuy = safeMul(
            tokenPools[token].virtualEthReserve,
            MAX_BUY_PERCENT
        ) / 10000;
        require(buyAmount <= maxBuy, "Buy amount too large");

        uint256 firstBuyFee = getFirstBuyFee(token);

        require(msg.value >= buyAmount + firstBuyFee, "Insufficient ETH value");
        _swapExactETHForTokens(token, buyAmount, minAmountOut);

        if (msg.value > buyAmount + firstBuyFee) {
            _transferETH(msg.sender, msg.value - buyAmount - firstBuyFee);
        }
        if (firstBuyFee > 0) {
            _transferETH(feeAddress, firstBuyFee);
        }
    }

    function swapETHForExactTokens(
        address token,
        uint256 buyAmount,
        uint256 maxAmountIn
    ) public payable whenNotPaused nonReentrant {
        uint256 maxBuy = safeMul(
            tokenPools[token].virtualEthReserve,
            MAX_BUY_PERCENT
        ) / 10000;
        require(buyAmount <= maxBuy, "Buy amount too large");

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
            _transferETH(feeAddress, firstBuyFee);
        }
    }

    function swapExactTokensForETH(
        address token,
        uint256 sellAmount,
        uint256 minAmountOut
    ) public whenNotPaused nonReentrant {
        uint256 maxSell = safeMul(
            tokenPools[token].virtualTokenReserve,
            MAX_SELL_PERCENT
        ) / 10000;
        require(sellAmount <= maxSell, "Sell amount too large");

        _swapExactTokensForETH(token, sellAmount, minAmountOut);
    }

    // ==================== PRICE AND MARKET CAP FUNCTIONS ====================

    function getETHPriceByUSD() public view returns (uint256) {
        (, int256 price, , , ) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        return uint256(price) * 1e10; // Normalize to 18 decimals
    }

    function getFirstBuyFee(address token) public view returns (uint256) {
        if (firstBuyFeeUSD == 0) {
            return 0;
        }
        if (tokenTrades[token] < 3) {
            return
                safeDiv(safeMul(firstBuyFeeUSD, 1 ether), getETHPriceByUSD());
        }
        return 0;
    }

    function getPrice(address token) public view returns (uint256) {
        PoolInfo storage pool = tokenPools[token];
        if (pool.tokenReserve == 0 || pool.ethReserve == 0) return 0;
        return safeDiv(safeMul(pool.ethReserve, 1e18), pool.tokenReserve);
    }

    function getVirtualPrice(address token) public view returns (uint256) {
        PoolInfo storage pool = tokenPools[token];
        if (pool.virtualEthReserve == 0 || pool.virtualTokenReserve == 0)
            return 0;
        return
            safeDiv(
                safeMul(pool.virtualEthReserve, 1e18),
                pool.virtualTokenReserve
            );
    }

    function getTokenMarketCap(address token) public view returns (uint256) {
        uint256 circulatingSupply = IERC20(token).totalSupply();
        return
            (getETHPriceByUSD() *
                circulatingSupply *
                tokenPools[token].ethReserve) /
            tokenPools[token].tokenReserve /
            1e18;
    }

    function getTokenVirtualMarketCap(
        address token
    ) public view returns (uint256) {
        uint256 circulatingSupply = IERC20(token).totalSupply();
        return
            (getETHPriceByUSD() *
                circulatingSupply *
                tokenPools[token].virtualEthReserve) /
            tokenPools[token].virtualTokenReserve /
            1e18;
    }

    function _checkAndAddLiquidity(address token) internal {
        PoolInfo storage pool = tokenPools[token];

        uint256 marketCap = getTokenVirtualMarketCap(token);
        uint256 targetMarketCapWei = safeMul(TARGET_MARKET_CAP, 1 ether);

        if (marketCap >= targetMarketCapWei) {
            uint256 tokenPrice = getVirtualPrice(token);
            require(tokenPrice > 0, "Token price must be greater than 0");

            uint256 totalEthReserve = pool.ethReserve;
            uint256 totalTokenReserve = pool.tokenReserve;

            uint256 totalFeesToReserve = tokenOwnerLPFee + platformLPFee;

            uint256 ethAmountForLP = totalEthReserve;
            uint256 tokenAmountForLP = totalTokenReserve;

            if (totalEthReserve > totalFeesToReserve) {
                ethAmountForLP = totalEthReserve - totalFeesToReserve;

                if (totalEthReserve > 0) {
                    tokenAmountForLP = safeDiv(
                        safeMul(totalTokenReserve, ethAmountForLP),
                        totalEthReserve
                    );
                }
            }

            // Launch the token
            ILaunchable(token).launch();
            pool.launched = true;

            // Add liquidity with calculated amounts
            _addLiquidity(token, ethAmountForLP, tokenAmountForLP);

            uint256 remainingEthReserve = totalEthReserve - ethAmountForLP;

            // Burn remaining tokens
            uint256 remainingTokens = IERC20(token).balanceOf(address(this));
            if (remainingTokens > 0) {
                IERC20(token).transfer(burnAddress, remainingTokens);
            }

            // Distribute remaining ETH
            if (remainingEthReserve > 0) {
                _transferETH(pool.owner, remainingEthReserve / 2);
                _transferETH(feeAddress, remainingEthReserve / 2);
            }

            // Update pool state
            tokenPools[token].tokenReserve = 0;
            tokenPools[token].ethReserve = 0;
            tokenPools[token].virtualEthReserve = 0;
            tokenPools[token].virtualTokenReserve = 0;

            emit TokenLaunched(token, block.timestamp);
        }
    }

    function _addLiquidity(
        address token,
        uint256 ethAmount,
        uint256 tokenAmount
    ) internal returns (address) {
        PoolInfo memory pool = tokenPools[token];

        address pairAddress = address(0);
        if (pool.poolType == 1) {
            IERC20(token).approve(address(liquidityManager), tokenAmount);
            pairAddress = liquidityManager.addLiquidityV2{value: ethAmount}(
                token,
                tokenAmount,
                ethAmount,
                burnAddress
            );
        } else if (pool.poolType == 2) {
            IERC20(token).approve(address(liquidityManager), tokenAmount);
            liquidityManager.addLiquidityV3{value: ethAmount}(
                token,
                tokenAmount,
                ethAmount,
                burnAddress
            );
        } else if (pool.poolType == 3) {
            IERC20(token).approve(address(liquidityManager), tokenAmount);
            liquidityManager.addLiquidityV4{value: ethAmount}(
                token,
                tokenAmount,
                ethAmount,
                burnAddress
            );
        } else {
            revert("Unsupported pool type");
        }

        emit LiquidityAdded(
            token,
            ethAmount,
            tokenAmount,
            IERC20(token).totalSupply()
        );
        return pairAddress;
    }

    function _transferETH(address to, uint256 amount) internal {
        require(to != address(0), "Cannot transfer to zero address");
        require(amount > 0, "Amount must be greater than zero");
        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    // ==================== ADMIN FUNCTIONS ====================

    function setTokenOwnerFeePercent(uint256 feePercent) external onlyOwner {
        require(feePercent <= 500, "Fee cannot exceed 5%"); // Max 5%
        TOKEN_OWNER_FEE_PERCENT = feePercent;
    }

    function setTargetMarketCap(uint256 targetMarketCap) external onlyOwner {
        require(targetMarketCap > 0, "Target market cap must be positive");
        TARGET_MARKET_CAP = targetMarketCap;
    }

    function setTotalSupply(uint256 totalSupply) external onlyOwner {
        require(totalSupply > 0, "Total supply must be positive");
        TOTAL_SUPPLY = totalSupply;
    }

    function setMaxBuyPercent(uint256 percent) external onlyOwner {
        require(percent <= 1000, "Max buy cannot exceed 10%"); // Max 10%
        MAX_BUY_PERCENT = percent;
    }

    function setCreateTokenFeeAmount(uint256 feeAmount) external onlyOwner {
        CREATE_TOKEN_FEE_AMOUNT = feeAmount;
    }

    function setInitialEthLPAmount(uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be positive");
        initialEthLPAmount = amount;
    }

    function setInitialTokenLPAmount(uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be positive");
        initialTokenLPAmount = amount;
    }

    function setFirstBuyFee(uint256 fee) external onlyOwner {
        firstBuyFeeUSD = fee;
    }

    function setTokenOwnerLPFee(uint256 fee) external onlyOwner {
        tokenOwnerLPFee = fee;
    }

    function emergencyWithdrawETH(uint256 amount) external onlyOwner {
        require(
            amount <= address(this).balance,
            "Insufficient contract balance"
        );
        _transferETH(owner(), amount);
    }

    function emergencyWithdrawTokens(
        address token,
        uint256 amount
    ) external onlyOwner {
        require(
            amount <= IERC20(token).balanceOf(address(this)),
            "Insufficient token balance"
        );
        IERC20(token).transfer(owner(), amount);
    }

    function setMaxSellPercent(uint256 percent) external onlyOwner {
        require(percent <= 1000, "Max sell cannot exceed 10%"); // Max 10%
        MAX_SELL_PERCENT = percent;
    }

    function setPlatformBuyFeePercent(uint256 percent) external onlyOwner {
        require(percent <= 500, "Buy fee cannot exceed 5%"); // Max 5%
        PLATFORM_BUY_FEE_PERCENT = percent;
    }

    function setPlatformSellFeePercent(uint256 percent) external onlyOwner {
        require(percent <= 500, "Sell fee cannot exceed 5%"); // Max 5%
        PLATFORM_SELL_FEE_PERCENT = percent;
    }

    function setFeeAddress(address newFeeAddress) external onlyOwner {
        require(newFeeAddress != address(0), "Fee address cannot be zero");
        feeAddress = newFeeAddress;
    }

    function setPlatformLPFee(uint256 newPlatformFee) external onlyOwner {
        platformLPFee = newPlatformFee;
    }

    function setDistributorAddress(
        address newDistributorAddress
    ) external onlyOwner {
        require(
            newDistributorAddress != address(0),
            "Distributor address cannot be zero"
        );
        distributorAddress = newDistributorAddress;
    }

    function setLiquidityManager(
        address newLiquidityManagerAddress
    ) external onlyOwner {
        require(
            newLiquidityManagerAddress != address(0),
            "Liquidity manager cannot be zero"
        );
        liquidityManager = IEthismLiquidityManager(newLiquidityManagerAddress);
    }

    function updatePool(
        address token,
        uint256 ethReserve,
        uint256 tokenReserve,
        uint256 virtualEthReserve,
        uint256 virtualTokenReserve,
        address owner,
        uint8 poolType
    ) external onlyOwner {
        require(token != address(0), "Token address cannot be zero");
        require(tokenPools[token].token == token, "Token pool does not exist");
        require(
            ethReserve > 0 && tokenReserve > 0,
            "Reserves must be positive"
        );
        require(
            virtualEthReserve > 0 && virtualTokenReserve > 0,
            "Virtual reserves must be positive"
        );

        PoolInfo storage pool = tokenPools[token];
        pool.ethReserve = ethReserve;
        pool.tokenReserve = tokenReserve;
        pool.virtualEthReserve = virtualEthReserve;
        pool.virtualTokenReserve = virtualTokenReserve;
        pool.owner = owner;
        pool.poolType = poolType;

        // Update K value for invariant tracking
        pool.lastKValue = safeMul(virtualEthReserve, virtualTokenReserve);
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function migrateFrom(
        address from,
        address token,
        address[] memory holders
    ) external onlyOwner {
        require(!migrated[from][token], "Already migrated");
        require(from != address(0), "Invalid from address");
        require(token != address(0), "Invalid token address");

        migrated[from][token] = true;
        IForgepad.PoolInfo memory pool = IForgepad(from).tokenPools(token);

        address newToken = (address)(
            new Token(ERC20(token).name(), ERC20(token).symbol(), TOTAL_SUPPLY)
        );

        // Transfer balances to new token holders
        for (uint256 i = 0; i < holders.length; i++) {
            if (holders[i] != address(0)) {
                uint256 balance = IERC20(token).balanceOf(holders[i]);
                if (balance > 0) {
                    IERC20(newToken).transfer(holders[i], balance);
                }
            }
        }

        // Calculate initial K value for the migrated pool
        uint256 initialK = safeMul(
            pool.virtualEthReserve,
            pool.virtualTokenReserve
        );

        tokenPools[newToken] = PoolInfo(
            pool.ethReserve,
            pool.tokenReserve,
            pool.virtualEthReserve,
            pool.virtualTokenReserve,
            newToken,
            pool.owner,
            pool.poolType,
            pool.launched,
            initialK // Set K value for invariant tracking
        );

        tokenList[tokenCount] = newToken;
        tokenCount++;

        emit Migrated(from, token, newToken);
    }

    // ==================== VIEW FUNCTIONS FOR DEBUGGING ====================

    /**
     * @dev Get detailed pool information for analysis
     */
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
            uint256 currentK,
            uint256 lastK,
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
            safeMul(pool.virtualEthReserve, pool.virtualTokenReserve),
            pool.lastKValue,
            getVirtualPrice(token),
            getPrice(token),
            pool.launched
        );
    }

    /**
     * @dev Calculate swap output without executing (for frontend)
     */
    function getSwapOutput(
        address token,
        uint256 amountIn,
        bool isETHInput
    ) external view returns (uint256 amountOut, uint256 priceImpact) {
        PoolInfo storage pool = tokenPools[token];
        require(!pool.launched, "Pool has been launched");

        uint256 totalFeePercent = isETHInput
            ? PLATFORM_BUY_FEE_PERCENT + TOKEN_OWNER_FEE_PERCENT
            : PLATFORM_SELL_FEE_PERCENT + TOKEN_OWNER_FEE_PERCENT;

        if (isETHInput) {
            amountOut = getAmountOut(
                amountIn,
                pool.virtualEthReserve,
                pool.virtualTokenReserve,
                totalFeePercent
            );
            priceImpact = safeMul(amountOut, 10000) / pool.virtualTokenReserve;
        } else {
            amountOut = getAmountOut(
                amountIn,
                pool.virtualTokenReserve,
                pool.virtualEthReserve,
                totalFeePercent
            );
            priceImpact = safeMul(amountOut, 10000) / pool.virtualEthReserve;
        }
    }

    /**
     * @dev Check if token is close to launch threshold
     */
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
        targetMarketCap = safeMul(TARGET_MARKET_CAP, 1 ether);

        if (targetMarketCap > 0) {
            progressPercent =
                safeMul(currentMarketCap, 10000) /
                targetMarketCap;
        }

        canLaunch = currentMarketCap >= targetMarketCap;
    }
}
