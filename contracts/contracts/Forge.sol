// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IEthismLiquidityManager} from "./IEthismLiquidityManager.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Token} from "./Token.sol";

interface ILaunchable {
    function launch() external;
}

contract MeteoraStyleBondingCurve is ReentrancyGuard, Ownable, Pausable, EIP712 {
    using ECDSA for bytes32;

    // Simplified curve structure
    struct CurveSegment {
        uint256 targetPrice;     // Target price for this segment (in wei per token)
        uint256 tokensAvailable; // How many tokens are available at this price level
    }

    struct PoolInfo {
        uint256 ethReserve;
        uint256 tokenReserve;
        address token;
        address owner;
        uint8 poolType;
        bool launched;
        uint256 currentSegmentIndex;
        uint256 migrationQuoteThreshold;
        uint256 bondingCurveAmount;
        CurveSegment[] curve;
    }

    struct FeeConfig {
        uint256 baseFee;           // Base fee in basis points
        uint256 migrationFee;      // Migration fee percentage (0-50)
        uint256 creatorFeeShare;   // Creator's share of migration fee (0-100)
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
    mapping(address => FeeConfig) public poolFees;
    mapping(address => uint256) private tokenTrades;
    mapping(address => uint256) private _createTokenNonces;
    
    address public burnAddress;
    address public feeAddress;
    address public distributorAddress;
    uint256 public CREATE_TOKEN_FEE_AMOUNT;
    uint256 public TOTAL_SUPPLY;
    uint256 public tokenCount;
    uint256 public DEFAULT_MIGRATION_MARKET_CAP;

    // Events
    event TokenCreated(
        address token,
        uint256 tokenPrice,
        uint256 ethPriceUSD,
        uint32 sig,
        uint256 date
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
    event CurveSegmentChanged(address token, uint256 newSegmentIndex);

    receive() external payable {}

    constructor(
        address _dataFeedAddress,
        address _ethismLiquidityManagerAddress,
        address _feeAddress,
        address _distributorAddress,
        uint256 _totalSupply,
        uint256 _defaultMigrationMarketCap
    ) Ownable(msg.sender) EIP712("MeteoraStyleBondingCurve", "1") {
        require(_dataFeedAddress != address(0), "Data feed address cannot be zero");
        priceFeed = AggregatorV3Interface(_dataFeedAddress);

        require(_ethismLiquidityManagerAddress != address(0), "Liquidity manager cannot be zero");
        liquidityManager = IEthismLiquidityManager(_ethismLiquidityManagerAddress);

        require(_feeAddress != address(0), "Fee address cannot be zero");
        feeAddress = _feeAddress;

        require(_distributorAddress != address(0), "Distributor address cannot be zero");
        distributorAddress = _distributorAddress;

        TOTAL_SUPPLY = _totalSupply * 1e18;
        DEFAULT_MIGRATION_MARKET_CAP = _defaultMigrationMarketCap;
        CREATE_TOKEN_FEE_AMOUNT = 0;
        burnAddress = 0x000000000000000000000000000000000000dEaD;
    }

    // ==================== SIMPLIFIED BONDING CURVE MATH ====================

    /**
     * @dev Calculate the amount of tokens to buy for a given ETH amount
     */
    function calculateBuyAmount(
        address token,
        uint256 ethAmount
    ) public view returns (uint256 tokenAmount, uint256 newSegmentIndex) {
        PoolInfo storage pool = tokenPools[token];
        require(pool.curve.length > 0, "No curve segments configured");

        uint256 remainingEth = ethAmount;
        uint256 totalTokens = 0;
        uint256 currentIndex = pool.currentSegmentIndex;

        while (remainingEth > 0 && currentIndex < pool.curve.length) {
            CurveSegment memory segment = pool.curve[currentIndex];
            
            // Calculate how many tokens we can buy at this price level
            uint256 availableTokens = segment.tokensAvailable;
            uint256 tokenPrice = segment.targetPrice;
            
            if (tokenPrice == 0) {
                currentIndex++;
                continue;
            }
            
            // Calculate ETH needed to buy all available tokens at this level
            uint256 ethNeeded = (availableTokens * tokenPrice) / 1e18;
            
            if (remainingEth >= ethNeeded) {
                // Buy all tokens at this level and move to next
                totalTokens += availableTokens;
                remainingEth -= ethNeeded;
                currentIndex++;
            } else {
                // Buy partial tokens at this level
                uint256 tokensAtThisLevel = (remainingEth * 1e18) / tokenPrice;
                totalTokens += tokensAtThisLevel;
                remainingEth = 0;
            }
        }

        return (totalTokens, currentIndex);
    }

    /**
     * @dev Calculate the amount of ETH to receive for a given token amount (sell)
     */
    function calculateSellAmount(
        address token,
        uint256 tokenAmount
    ) public view returns (uint256 ethAmount, uint256 newSegmentIndex) {
        PoolInfo storage pool = tokenPools[token];
        require(pool.curve.length > 0, "No curve segments configured");
        require(pool.currentSegmentIndex > 0 || pool.ethReserve > 0, "Cannot sell from initial state");

        uint256 remainingTokens = tokenAmount;
        uint256 totalEth = 0;
        uint256 currentIndex = pool.currentSegmentIndex;

        // For sells, we need to work backwards from the current price
        // Start from current segment and work down through lower price tiers
        while (remainingTokens > 0 && currentIndex > 0) {
            CurveSegment memory segment = pool.curve[currentIndex - 1];
            
            uint256 tokenPrice = segment.targetPrice;
            if (tokenPrice == 0) {
                currentIndex--;
                continue;
            }
            
            // Calculate how many tokens were originally available at this tier
            uint256 originalTokensAtTier = (TOTAL_SUPPLY * 80) / 100 / 5; // 80% supply / 5 tiers
            
            // Calculate how many tokens have been sold from this tier
            uint256 tokensSoldFromTier = originalTokensAtTier - segment.tokensAvailable;
            
            // We can sell back tokens that were sold from this tier
            uint256 maxSellableAtTier = tokensSoldFromTier;
            
            if (remainingTokens >= maxSellableAtTier && maxSellableAtTier > 0) {
                // Sell all available tokens at this tier
                uint256 ethAtThisLevel = (maxSellableAtTier * tokenPrice) / 1e18;
                totalEth += ethAtThisLevel;
                remainingTokens -= maxSellableAtTier;
                currentIndex--;
            } else if (maxSellableAtTier > 0) {
                // Sell partial tokens at this tier
                uint256 ethAtThisLevel = (remainingTokens * tokenPrice) / 1e18;
                totalEth += ethAtThisLevel;
                remainingTokens = 0;
            } else {
                // No tokens sold at this tier yet, move to next
                currentIndex--;
            }
        }

        return (totalEth, currentIndex);
    }

    /**
     * @dev Calculate current price based on curve position
     */
    function getCurrentPrice(address token) public view returns (uint256) {
        PoolInfo storage pool = tokenPools[token];
        if (pool.currentSegmentIndex >= pool.curve.length) {
            // If we've exhausted all segments, return the last segment's price
            if (pool.curve.length > 0) {
                return pool.curve[pool.curve.length - 1].targetPrice;
            }
            return 0;
        }

        return pool.curve[pool.currentSegmentIndex].targetPrice;
    }

    /**
     * @dev Calculate migration quote threshold based on target market cap
     */
    function calculateMigrationThreshold(address token) public view returns (uint256) {
        // We launch when market cap reaches $69,000
        // Market cap = token price * total supply
        // We need to find the ETH reserve that corresponds to this market cap
        
        uint256 ethPriceUSD = getETHPriceByUSD();
        if (ethPriceUSD == 0) {
            ethPriceUSD = 3500 * 1e18; // Fallback to $3500
        }
        
        // Target market cap is $69,000
        uint256 targetMarketCapUSD = DEFAULT_MIGRATION_MARKET_CAP * 1e18;
        
        // Calculate required token price for target market cap
        // Required token price = Target Market Cap / Total Supply
        uint256 requiredTokenPriceUSD = (targetMarketCapUSD * 1e18) / TOTAL_SUPPLY;
        
        // Convert to ETH price: USD price / ETH price in USD
        uint256 requiredTokenPriceETH = (requiredTokenPriceUSD * 1e18) / ethPriceUSD;
        
        // Now calculate how much ETH we need to reach this token price
        // This requires simulating purchases through the curve
        return _calculateETHNeededForTokenPrice(token, requiredTokenPriceETH);
    }

    function _calculateETHNeededForTokenPrice(address token, uint256 targetPrice) internal view returns (uint256) {
        PoolInfo storage pool = tokenPools[token];
        uint256 totalETHNeeded = 0;
        uint256 segmentIndex = 0;
        
        // Calculate ETH needed to reach each price tier until we exceed target price
        while (segmentIndex < pool.curve.length) {
            CurveSegment memory segment = pool.curve[segmentIndex];
            
            if (segment.targetPrice >= targetPrice) {
                // We've reached or exceeded our target price
                break;
            }
            
            // Add ETH needed for this entire segment
            uint256 ethForSegment = (segment.tokensAvailable * segment.targetPrice) / 1e18;
            totalETHNeeded += ethForSegment;
            segmentIndex++;
        }
        
        return totalETHNeeded;
    }

    /**
     * @dev Check if token should migrate based on current market cap
     */
    function shouldMigrate(address token) public view returns (bool) {
        if (tokenPools[token].launched) {
            return false;
        }
        
        uint256 currentMarketCapUSD = getTokenMarketCapUSD(token);
        uint256 targetMarketCapUSD = DEFAULT_MIGRATION_MARKET_CAP * 1e18;
        
        return currentMarketCapUSD >= targetMarketCapUSD;
    }

    // ==================== CORE TRADING FUNCTIONS ====================

    function createToken(
        string memory name,
        string memory symbol,
        uint256 buyAmount,
        uint32 sig,
        uint8 poolType
    ) external payable whenNotPaused returns (address) {
        require(msg.value >= buyAmount + CREATE_TOKEN_FEE_AMOUNT, "Insufficient ETH value");

        address newToken = address(new Token(name, symbol, TOTAL_SUPPLY));
        IERC20(newToken).approve(address(this), type(uint256).max);

        // Initialize pool with simple curve segments
        _initializeSimpleCurve(newToken, msg.sender, poolType);

        tokenList[tokenCount] = newToken;
        tokenCount++;

        emit TokenCreated(
            newToken,
            getCurrentPrice(newToken),
            getETHPriceByUSD(),
            sig,
            block.timestamp
        );

        if (buyAmount > 0) {
            _swapExactETHForTokens(newToken, buyAmount, 0);
        }

        if (CREATE_TOKEN_FEE_AMOUNT > 0) {
            _transferETH(feeAddress, CREATE_TOKEN_FEE_AMOUNT);
        }

        if (msg.value > buyAmount + CREATE_TOKEN_FEE_AMOUNT) {
            _transferETH(msg.sender, msg.value - buyAmount - CREATE_TOKEN_FEE_AMOUNT);
        }

        return newToken;
    }

    function _initializeSimpleCurve(
        address token,
        address owner,
        uint8 poolType
    ) internal {
        tokenPools[token].token = token;
        tokenPools[token].owner = owner;
        tokenPools[token].poolType = poolType;
        tokenPools[token].launched = false;
        tokenPools[token].currentSegmentIndex = 0;
        tokenPools[token].tokenReserve = TOTAL_SUPPLY;
        tokenPools[token].ethReserve = 0;

        // Create price tiers that progress toward $69k market cap
        // Total bonding curve tokens = 80% of supply (leave 20% for liquidity)
        uint256 bondingCurveTokens = (TOTAL_SUPPLY * 80) / 100;
        uint256 tokensPerTier = bondingCurveTokens / 5; // 5 tiers for more precision

        // Calculate prices that will reach $69k market cap
        // At $69k market cap: token price = $69,000 / 1B tokens = $0.000069 per token
        // With ETH at $3500: token price = $0.000069 / $3500 = 0.0000000197 ETH ≈ 19.7 gwei
        
        // Calculate the exact price needed for $69k market cap
        // At $69k market cap: token price = $69,000 / 1B tokens = $0.000069 per token
        uint256 ethPriceUSD = getETHPriceByUSD();
        if (ethPriceUSD == 0) {
            ethPriceUSD = 3500 * 1e18; // Fallback to $3500
        }

        // Calculate prices that will reach $69k market cap
        // At $69k market cap: token price = $69,000 / 1B tokens = $0.000069 per token
        // With ETH at $3500: token price = $0.000069 / $3500 = 0.0000000197 ETH ≈ 19.7 gwei
        
        // Use fixed progressive pricing that reaches $69k at around 3.4 ETH
        // With ETH at ~$3560, target is ~19.4 gwei for $69k market cap
        // Start lower to have initial market cap around $4-5k
        // Progressive tiers: 1.5, 4, 8, 12, 19.5 gwei
        
        tokenPools[token].curve.push(CurveSegment({
            targetPrice: 1500000000,    // 1.5 gwei per token (~$5.3k market cap) - good starting point
            tokensAvailable: tokensPerTier
        }));
        
        tokenPools[token].curve.push(CurveSegment({
            targetPrice: 4000000000,    // 4 gwei per token (~$14.2k market cap)
            tokensAvailable: tokensPerTier
        }));
        
        tokenPools[token].curve.push(CurveSegment({
            targetPrice: 8000000000,    // 8 gwei per token (~$28.5k market cap)
            tokensAvailable: tokensPerTier
        }));
        
        tokenPools[token].curve.push(CurveSegment({
            targetPrice: 12000000000,   // 12 gwei per token (~$42.7k market cap)
            tokensAvailable: tokensPerTier
        }));
        
        tokenPools[token].curve.push(CurveSegment({
            targetPrice: 19500000000,   // 19.5 gwei per token (~$69.4k market cap) - hits target!
            tokensAvailable: tokensPerTier
        }));

        // Calculate thresholds based on target market cap
        tokenPools[token].migrationQuoteThreshold = calculateMigrationThreshold(token);
        tokenPools[token].bondingCurveAmount = calculateBondingCurveAmount(token);

        // Initialize default fees
        poolFees[token] = FeeConfig({
            baseFee: 100,    // 1%
            migrationFee: 5, // 5%
            creatorFeeShare: 0 // 0% to creator
        });
    }

    function calculateBondingCurveAmount(address token) public view returns (uint256) {
        PoolInfo storage pool = tokenPools[token];
        uint256 amount = 0;
        
        // Sum all tokens available in the curve
        for (uint256 i = 0; i < pool.curve.length; i++) {
            amount += pool.curve[i].tokensAvailable;
        }
        
        return amount;
    }

    function _swapExactETHForTokens(
        address token,
        uint256 ethAmount,
        uint256 minAmountOut
    ) internal {
        require(!tokenPools[token].launched, "Pool has been already launched");

        FeeConfig memory fees = poolFees[token];
        uint256 feeAmount = (ethAmount * fees.baseFee) / 10000;
        uint256 netEthAmount = ethAmount - feeAmount;

        (uint256 tokenAmount, uint256 newSegmentIndex) = calculateBuyAmount(token, netEthAmount);
        require(tokenAmount >= minAmountOut, "Slippage exceeded");
        require(tokenAmount <= tokenPools[token].tokenReserve, "Insufficient token reserves");

        // Update curve segments to reflect tokens sold
        _updateCurveAfterBuy(token, tokenAmount, newSegmentIndex);

        // Update pool state
        IERC20(token).transfer(msg.sender, tokenAmount);
        tokenPools[token].ethReserve += netEthAmount;
        tokenPools[token].tokenReserve -= tokenAmount;
        
        // Update segment index if changed
        if (newSegmentIndex != tokenPools[token].currentSegmentIndex) {
            tokenPools[token].currentSegmentIndex = newSegmentIndex;
            emit CurveSegmentChanged(token, newSegmentIndex);
        }

        tokenTrades[token]++;

        // Distribute fees
        if (feeAmount > 0) {
            _transferETH(feeAddress, feeAmount / 2);
            _transferETH(distributorAddress, feeAmount / 2);
        }

        emit BuyTokens(
            msg.sender,
            token,
            ethAmount,
            tokenAmount,
            getCurrentPrice(token),
            getETHPriceByUSD(),
            getTokenMarketCapUSD(token),
            block.timestamp
        );

        // Check if we should launch after this purchase
        _checkAndAddLiquidity(token);
    }

    function _updateCurveAfterBuy(
        address token,
        uint256 tokenAmount,
        uint256 newSegmentIndex
    ) internal {
        PoolInfo storage pool = tokenPools[token];
        uint256 remainingTokens = tokenAmount;
        uint256 currentIndex = pool.currentSegmentIndex;

        while (remainingTokens > 0 && currentIndex < pool.curve.length) {
            CurveSegment storage segment = pool.curve[currentIndex];
            
            if (remainingTokens >= segment.tokensAvailable) {
                remainingTokens -= segment.tokensAvailable;
                segment.tokensAvailable = 0;
                currentIndex++;
            } else {
                segment.tokensAvailable -= remainingTokens;
                remainingTokens = 0;
            }
        }
    }

    function _checkAndAddLiquidity(address token) internal {
        // Check if we should migrate based on market cap
        if (shouldMigrate(token)) {
            PoolInfo storage pool = tokenPools[token];
            FeeConfig memory fees = poolFees[token];
            
            uint256 migrationFeeAmount = (pool.ethReserve * fees.migrationFee) / 100;
            uint256 creatorFee = (migrationFeeAmount * fees.creatorFeeShare) / 100;
            uint256 platformFee = migrationFeeAmount - creatorFee;
            
            uint256 ethForLP = pool.ethReserve - migrationFeeAmount;
            uint256 tokensForLP = pool.tokenReserve;

            ILaunchable(token).launch();
            pool.launched = true;

            _addLiquidity(token, ethForLP, tokensForLP);

            if (creatorFee > 0) {
                _transferETH(pool.owner, creatorFee);
            }
            if (platformFee > 0) {
                _transferETH(feeAddress, platformFee);
            }

            uint256 remainingTokens = IERC20(token).balanceOf(address(this));
            if (remainingTokens > 0) {
                IERC20(token).transfer(burnAddress, remainingTokens);
            }

            emit TokenLaunched(token, block.timestamp);
        }
    }

    // ==================== PUBLIC TRADING FUNCTIONS ====================

    function swapExactETHForTokens(
        address token,
        uint256 buyAmount,
        uint256 minAmountOut
    ) public payable whenNotPaused nonReentrant {
        require(msg.value >= buyAmount, "Insufficient ETH value");
        
        _swapExactETHForTokens(token, buyAmount, minAmountOut);
        
        if (msg.value > buyAmount) {
            _transferETH(msg.sender, msg.value - buyAmount);
        }
    }

    function _swapExactTokensForETH(
        address token,
        uint256 tokenAmount,
        uint256 minEthOut
    ) internal {
        require(!tokenPools[token].launched, "Pool has been launched");
        require(tokenAmount > 0, "Token amount must be greater than 0");

        PoolInfo storage pool = tokenPools[token];
        require(tokenAmount <= IERC20(token).balanceOf(msg.sender), "Insufficient token balance");

        FeeConfig memory fees = poolFees[token];
        
        (uint256 grossEthAmount, uint256 newSegmentIndex) = calculateSellAmount(token, tokenAmount);
        require(grossEthAmount > 0, "No ETH to receive");
        require(grossEthAmount <= pool.ethReserve, "Insufficient ETH reserves");

        uint256 feeAmount = (grossEthAmount * fees.baseFee) / 10000;
        uint256 netEthAmount = grossEthAmount - feeAmount;
        
        require(netEthAmount >= minEthOut, "Slippage exceeded");

        IERC20(token).transferFrom(msg.sender, address(this), tokenAmount);

        // Update curve segments to reflect tokens added back
        _updateCurveAfterSell(token, tokenAmount, newSegmentIndex);

        pool.ethReserve -= grossEthAmount;
        pool.tokenReserve += tokenAmount;
        
        if (newSegmentIndex != pool.currentSegmentIndex) {
            pool.currentSegmentIndex = newSegmentIndex;
            emit CurveSegmentChanged(token, newSegmentIndex);
        }

        _transferETH(msg.sender, netEthAmount);

        if (feeAmount > 0) {
            _transferETH(feeAddress, feeAmount / 2);
            _transferETH(distributorAddress, feeAmount / 2);
        }

        emit SellTokens(
            msg.sender,
            token,
            netEthAmount,
            tokenAmount,
            getCurrentPrice(token),
            getETHPriceByUSD(),
            getTokenMarketCapUSD(token),
            block.timestamp
        );
    }

    function _updateCurveAfterSell(
        address token,
        uint256 tokenAmount,
        uint256 newSegmentIndex
    ) internal {
        PoolInfo storage pool = tokenPools[token];
        uint256 remainingTokens = tokenAmount;
        uint256 currentIndex = pool.currentSegmentIndex;

        // Add tokens back to curve segments (working backwards from current segment)
        while (remainingTokens > 0 && currentIndex > 0) {
            CurveSegment storage segment = pool.curve[currentIndex - 1];
            
            // Calculate how many tokens can be added back to this tier
            uint256 originalTokens = (TOTAL_SUPPLY * 80) / 100 / 5; // Original tokens per tier (5 tiers)
            uint256 maxTokensAtTier = originalTokens;
            uint256 maxCanAdd = maxTokensAtTier - segment.tokensAvailable;
            
            if (remainingTokens >= maxCanAdd && maxCanAdd > 0) {
                segment.tokensAvailable += maxCanAdd;
                remainingTokens -= maxCanAdd;
                currentIndex--;
            } else if (maxCanAdd > 0) {
                segment.tokensAvailable += remainingTokens;
                remainingTokens = 0;
            } else {
                currentIndex--;
            }
        }
    }

    function swapExactTokensForETH(
        address token,
        uint256 tokenAmount,
        uint256 minEthOut
    ) public whenNotPaused nonReentrant {
        _swapExactTokensForETH(token, tokenAmount, minEthOut);
    }

    function swapTokensForExactETH(
        address token,
        uint256 ethAmount,
        uint256 maxTokensIn
    ) public whenNotPaused nonReentrant {
        require(!tokenPools[token].launched, "Pool has been launched");
        require(ethAmount > 0, "ETH amount must be greater than 0");

        PoolInfo storage pool = tokenPools[token];
        require(ethAmount <= pool.ethReserve, "Insufficient ETH reserves");

        FeeConfig memory fees = poolFees[token];
        
        uint256 grossEthAmount = (ethAmount * 10000) / (10000 - fees.baseFee);
        
        uint256 tokensNeeded = calculateTokensNeededForEth(token, grossEthAmount);
        require(tokensNeeded <= maxTokensIn, "Slippage exceeded");
        require(tokensNeeded <= IERC20(token).balanceOf(msg.sender), "Insufficient token balance");

        _swapExactTokensForETH(token, tokensNeeded, ethAmount);
    }

    function calculateTokensNeededForEth(
        address token,
        uint256 ethAmount
    ) public view returns (uint256) {
        PoolInfo storage pool = tokenPools[token];
        require(pool.curve.length > 0, "No curve segments configured");

        uint256 currentPrice = getCurrentPrice(token);
        if (currentPrice == 0) return 0;
        
        return (ethAmount * 1e18) / currentPrice;
    }

    // ==================== UTILITY FUNCTIONS ====================

    function getETHPriceByUSD() public view returns (uint256) {
        try priceFeed.latestRoundData() returns (
            uint80,
            int256 price,
            uint256,
            uint256,
            uint80
        ) {
            require(price > 0, "Invalid price");
            return uint256(price) * 1e10;
        } catch {
            // Return a default value if price feed fails
            return 3500 * 1e18; // $3500 default
        }
    }

    function getTokenMarketCapUSD(address token) public view returns (uint256) {
        uint256 currentPrice = getCurrentPrice(token);
        uint256 totalSupply = IERC20(token).totalSupply();
        uint256 ethPriceUSD = getETHPriceByUSD();
        
        if (currentPrice == 0 || totalSupply == 0 || ethPriceUSD == 0) return 0;
        
        // Market cap in ETH
        uint256 marketCapETH = (currentPrice * totalSupply) / 1e18;
        // Convert to USD
        return (marketCapETH * ethPriceUSD) / 1e18;
    }

    function getTokenMarketCap(address token) public view returns (uint256) {
        return getTokenMarketCapUSD(token);
    }

    function _addLiquidity(
        address token,
        uint256 ethAmount,
        uint256 tokenAmount
    ) internal returns (address) {
        PoolInfo memory pool = tokenPools[token];
        
        IERC20(token).approve(address(liquidityManager), tokenAmount);
        
        if (pool.poolType == 1) {
            return liquidityManager.addLiquidityV2{value: ethAmount}(
                token,
                tokenAmount,
                ethAmount,
                burnAddress
            );
        } else if (pool.poolType == 2) {
            liquidityManager.addLiquidityV3{value: ethAmount}(
                token,
                tokenAmount,
                ethAmount,
                burnAddress
            );
        } else if (pool.poolType == 3) {
            liquidityManager.addLiquidityV4{value: ethAmount}(
                token,
                tokenAmount,
                ethAmount,
                burnAddress
            );
        }
        
        return address(0);
    }

    function _transferETH(address to, uint256 amount) internal {
        if (amount > 0) {
            (bool success, ) = payable(to).call{value: amount}("");
            require(success, "ETH transfer failed");
        }
    }

    function setCurveSegments(
        address token,
        CurveSegment[] memory segments
    ) external onlyOwner {
        require(!tokenPools[token].launched, "Cannot modify launched pool");
        require(segments.length > 0, "Must have at least one segment");
        
        delete tokenPools[token].curve;
        
        for (uint256 i = 0; i < segments.length; i++) {
            require(segments[i].targetPrice > 0, "Invalid price");
            require(segments[i].tokensAvailable > 0, "Invalid tokens available");
            tokenPools[token].curve.push(segments[i]);
        }
        
        tokenPools[token].migrationQuoteThreshold = calculateMigrationThreshold(token);
        tokenPools[token].bondingCurveAmount = calculateBondingCurveAmount(token);
    }

    function setPoolFees(
        address token,
        FeeConfig memory fees
    ) external onlyOwner {
        require(fees.baseFee <= 1000, "Base fee too high"); // Max 10%
        require(fees.migrationFee <= 50, "Migration fee too high"); // Max 50%
        require(fees.creatorFeeShare <= 100, "Creator share too high"); // Max 100%
        
        poolFees[token] = fees;
    }

    function setCreateTokenFeeAmount(uint256 feeAmount) external onlyOwner {
        CREATE_TOKEN_FEE_AMOUNT = feeAmount;
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function emergencyWithdrawETH(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "Insufficient balance");
        _transferETH(owner(), amount);
    }

    function emergencyWithdrawTokens(
        address token,
        uint256 amount
    ) external onlyOwner {
        require(amount <= IERC20(token).balanceOf(address(this)), "Insufficient balance");
        IERC20(token).transfer(owner(), amount);
    }

    // ==================== VIEW FUNCTIONS ====================

    function getCurveSegments(address token) external view returns (CurveSegment[] memory) {
        return tokenPools[token].curve;
    }

    function getPoolInfo(address token) external view returns (PoolInfo memory) {
        return tokenPools[token];
    }

    function getCreateTokenNonce(address user) public view returns (uint256) {
        return _createTokenNonces[user];
    }

    // ==================== DEBUGGING FUNCTIONS ====================

    function debugCurveCalculation(address token) external view returns (
        uint256[] memory prices,
        uint256[] memory tokensAvailable,
        uint256 migrationThreshold,
        uint256 bondingCurveAmount
    ) {
        PoolInfo storage pool = tokenPools[token];
        prices = new uint256[](pool.curve.length);
        tokensAvailable = new uint256[](pool.curve.length);
        
        for (uint256 i = 0; i < pool.curve.length; i++) {
            prices[i] = pool.curve[i].targetPrice;
            tokensAvailable[i] = pool.curve[i].tokensAvailable;
        }
        
        migrationThreshold = calculateMigrationThreshold(token);
        bondingCurveAmount = calculateBondingCurveAmount(token);
    }
}