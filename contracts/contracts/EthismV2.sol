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

interface IEthism {
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

contract EthismV2 is ReentrancyGuard, Ownable, Pausable, EIP712 {
    using ECDSA for bytes32;

    struct PoolInfo {
        uint256 ethReserve;
        uint256 tokenReserve;
        uint256 virtualEthReserve;
        uint256 virtualTokenReserve;
        address token;
        address owner;
        uint8 poolType; // 1 = V2, 2 = V3, 3 = V4
        bool launched;
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
    mapping(address => uint256) private _createTokenNonces; // Nonce tracking for meta-transactions (only for createToken)
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
    ) Ownable(msg.sender) EIP712("Ethism", "1") {
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
        MAX_BUY_PERCENT = 300; // 3%
        CREATE_TOKEN_FEE_AMOUNT = 0;
        TOKEN_OWNER_FEE_PERCENT = 0;
        TARGET_MARKET_CAP = _targetMarketCap;
        TOTAL_SUPPLY = _totalSupply * 1e18;
        burnAddress = 0x000000000000000000000000000000000000dEaD;
        // initialEthLPAmount = 1.766 ether;
        // initialTokenLPAmount = 1_073_000_000 ether;

        // initialEthLPAmount = 50 ether;
        // initialTokenLPAmount = 5_000_000_000 ether;

        initialEthLPAmount = 5 ether;
        initialTokenLPAmount = 900_000_000 ether;

        firstBuyFeeUSD = 0;
        // firstBuyFeeUSD = 3 ether;
        MAX_SELL_PERCENT = 300; // 3%
        PLATFORM_BUY_FEE_PERCENT = 1; // 2%
        PLATFORM_SELL_FEE_PERCENT = 1; // 2%
        platformLPFee = 0.1 ether; // 0.1 ETH
        tokenOwnerLPFee = 0.1 ether; // 0.1 ETH
    }

    // ==================== GASLESS TOKEN CREATION ====================
    /**
     * @dev Get the current nonce for a user's gasless token creation
     */
    function getCreateTokenNonce(address user) public view returns (uint256) {
        return _createTokenNonces[user];
    }

    /**
     * @dev Original createToken function (user pays gas)
     */
    function createToken(
        string memory name,
        string memory symbol,
        uint256 buyAmount,
        uint32 sig,
        uint8 poolType
    ) external payable whenNotPaused returns (address) {
        uint256 firstBuyFee = buyAmount > 0 ? getFirstBuyFee(address(0)) : 0;

        require(
            msg.value >= buyAmount + firstBuyFee + CREATE_TOKEN_FEE_AMOUNT,
            "Insufficient ETH value"
        );

        address newToken = (address)(new Token(name, symbol, TOTAL_SUPPLY));

        IERC20(newToken).approve(address(this), type(uint256).max);

        // Initialize the pool info for the new token
        tokenPools[newToken] = PoolInfo(
            0, // ethReserve
            TOTAL_SUPPLY, // tokenReserve
            initialEthLPAmount, // virtualEthReserve
            initialTokenLPAmount, // virtualTokenReserve
            newToken, // token address
            msg.sender, // owner
            poolType, // poolType (1 = V2, 2 = V3, 3 = V4)
            false // launched
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

    /**
     * @dev Execute gasless token creation via meta-transaction
     */
    function createTokenGasless(
        CreateTokenMetaTx memory metaTx,
        bytes memory signature,
        uint8 poolType,
        uint32 sig
    ) external payable whenNotPaused nonReentrant returns (address) {
        // Verify deadline
        require(block.timestamp <= metaTx.deadline, "Transaction expired");

        // Verify nonce
        require(
            metaTx.nonce == _createTokenNonces[metaTx.creator],
            "Invalid nonce"
        );

        // Verify signature
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    keccak256(
                        "CreateTokenMetaTx(uint256 nonce,address creator,string name,string symbol,uint256 deadline)"
                    ),
                    metaTx.nonce,
                    metaTx.creator,
                    keccak256(bytes(metaTx.name)),
                    keccak256(bytes(metaTx.symbol)),
                    metaTx.deadline
                )
            )
        );

        address signer = digest.recover(signature);
        require(signer == metaTx.creator, "Invalid signature");

        // Increment nonce
        _createTokenNonces[metaTx.creator]++;

        // Execute token creation with relayer as msg.sender but creator as the actual user
        address newToken = _executeCreateToken(
            metaTx.creator,
            metaTx.name,
            metaTx.symbol,
            poolType
        );

        emit TokenCreated(
            newToken,
            getVirtualPrice(newToken),
            getETHPriceByUSD(),
            sig,
            block.timestamp
        );

        return newToken;
    }

    /**
     * @dev Internal function to execute token creation
     */
    function _executeCreateToken(
        address creator,
        string memory name,
        string memory symbol,
        uint8 poolType
    ) internal returns (address) {
        address newToken = (address)(new Token(name, symbol, TOTAL_SUPPLY));

        IERC20(newToken).approve(address(this), type(uint256).max);
        tokenPools[newToken] = PoolInfo(
            0, // ethReserve
            TOTAL_SUPPLY, // tokenReserve
            initialEthLPAmount, // virtualEthReserve
            initialTokenLPAmount, // virtualTokenReserve
            newToken, // token address
            creator, // owner
            poolType, // poolType (1 = V2, 2 = V3, 3 = V4)
            false // launched
        );
        tokenList[tokenCount] = newToken;
        tokenCount++;

        emit TokenCreated(
            newToken,
            getVirtualPrice(newToken),
            getETHPriceByUSD(),
            1,
            block.timestamp
        );

        return newToken;
    }

    /**
     * @dev Get domain separator for EIP-712
     */
    function getDomainSeparator() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ==================== ORIGINAL CONTRACT FUNCTIONS ====================

    function _swapExactETHForTokens(
        address token,
        uint256 buyAmount,
        uint256 minAmountOut
    ) internal {
        require(!tokenPools[token].launched, "Pool has been already launched");

        uint256 amountIn = buyAmount;
        uint256 buyFee = (amountIn * PLATFORM_BUY_FEE_PERCENT) / 100;
        uint256 tokenOwnerFee = 0;
        if (TOKEN_OWNER_FEE_PERCENT > 0) {
            tokenOwnerFee = (amountIn * TOKEN_OWNER_FEE_PERCENT) / 100;
        }

        amountIn -= buyFee + tokenOwnerFee;
        uint256 amountOut = (amountIn * tokenPools[token].virtualTokenReserve) /
            (tokenPools[token].virtualEthReserve + amountIn);
        require(amountOut >= minAmountOut, "Overflow slippage");
        require(
            amountOut < tokenPools[token].tokenReserve,
            "Not enough tokens in the pool"
        );

        IERC20(token).transfer(msg.sender, amountOut);
        tokenPools[token].ethReserve += amountIn;
        tokenPools[token].tokenReserve -= amountOut;
        tokenPools[token].virtualEthReserve += amountIn;
        tokenPools[token].virtualTokenReserve -= amountOut;

        uint256 tokenPrice = getVirtualPrice(token);
        uint256 ethPrice = getETHPriceByUSD();
        uint256 marketCap = getTokenVirtualMarketCap(token);
        tokenTrades[token]++;

        if (tokenOwnerFee > 0) {
            _transferETH(tokenPools[token].owner, tokenOwnerFee);
        }
        if (buyFee > 0) {
            _transferETH(feeAddress, buyFee / 2);
            _transferETH(distributorAddress, buyFee / 2);
        }

        emit BuyTokens(
            msg.sender,
            token,
            amountIn,
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

        uint256 amountOut = buyAmount;
        uint256 amountIn = (amountOut * tokenPools[token].virtualEthReserve) /
            (tokenPools[token].virtualTokenReserve - amountOut) +
            1;

        uint256 totalFeePercent = PLATFORM_BUY_FEE_PERCENT +
            TOKEN_OWNER_FEE_PERCENT;
        uint256 totalAmountIn = (amountIn * 100) / (100 - totalFeePercent);

        uint256 buyFee = (totalAmountIn * PLATFORM_BUY_FEE_PERCENT) / 100;
        uint256 tokenOwnerFee = 0;
        if (TOKEN_OWNER_FEE_PERCENT > 0) {
            tokenOwnerFee = (totalAmountIn * TOKEN_OWNER_FEE_PERCENT) / 100;
        }

        uint256 amountInForSwap = totalAmountIn - buyFee - tokenOwnerFee;

        amountIn -= buyFee + tokenOwnerFee;
        require(amountIn <= maxAmountIn, "Overflow slippage");
        require(
            amountOut < tokenPools[token].tokenReserve,
            "Not enough tokens in the pool"
        );

        IERC20(token).transfer(msg.sender, amountOut);
        tokenPools[token].ethReserve += amountInForSwap;
        tokenPools[token].tokenReserve -= amountOut;
        tokenPools[token].virtualEthReserve += amountInForSwap;
        tokenPools[token].virtualTokenReserve -= amountOut;

        uint256 tokenPrice = getVirtualPrice(token);
        uint256 ethPrice = getETHPriceByUSD();
        uint256 marketCap = getTokenVirtualMarketCap(token);
        tokenTrades[token]++;

        if (tokenOwnerFee > 0) {
            _transferETH(tokenPools[token].owner, tokenOwnerFee);
        }
        if (buyFee > 0) {
            _transferETH(feeAddress, buyFee / 2);
            _transferETH(distributorAddress, buyFee / 2);
        }

        emit BuyTokens(
            msg.sender,
            token,
            amountInForSwap,
            amountOut,
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

        uint256 amountIn = sellAmount;
        uint256 amountOut = (amountIn * tokenPools[token].virtualEthReserve) /
            (tokenPools[token].virtualTokenReserve + amountIn);
        uint256 sellFee = (amountOut * PLATFORM_SELL_FEE_PERCENT) / 100;
        uint256 tokenOwnerFee = 0;
        if (TOKEN_OWNER_FEE_PERCENT > 0) {
            tokenOwnerFee = (amountOut * TOKEN_OWNER_FEE_PERCENT) / 100;
        }
        amountOut -= sellFee + tokenOwnerFee;
        if (minAmountOut > 0)
            require(amountOut >= minAmountOut, "Overflow slippage");
        require(
            amountOut < tokenPools[token].ethReserve,
            "Not enough ETH in the pool"
        );

        IERC20(token).transferFrom(msg.sender, address(this), amountIn);
        _transferETH(msg.sender, amountOut);
        tokenPools[token].ethReserve -= amountOut;
        tokenPools[token].tokenReserve += amountIn;
        tokenPools[token].virtualEthReserve -= amountOut;
        tokenPools[token].virtualTokenReserve += amountIn;

        if (tokenOwnerFee > 0) {
            _transferETH(tokenPools[token].owner, tokenOwnerFee);
        }
        if (sellFee > 0) {
            _transferETH(feeAddress, sellFee / 2);
            _transferETH(distributorAddress, sellFee / 2);
        }

        emit SellTokens(
            msg.sender,
            token,
            amountOut,
            amountIn,
            getVirtualPrice(token),
            getETHPriceByUSD(),
            getTokenVirtualMarketCap(token),
            block.timestamp
        );
    }

    function swapExactETHForTokens(
        address token,
        uint256 buyAmount,
        uint256 minAmountOut
    ) public payable whenNotPaused nonReentrant {
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
        _swapExactTokensForETH(token, sellAmount, minAmountOut);
    }

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
            return (firstBuyFeeUSD * 1 ether) / getETHPriceByUSD();
        }
        return 0;
    }

    function getPrice(address token) public view returns (uint256) {
        PoolInfo storage pool = tokenPools[token];
        if (pool.tokenReserve == 0 || pool.ethReserve == 0) return 0;
        return (pool.ethReserve * 1e18) / pool.tokenReserve;
    }

    function getVirtualPrice(address token) public view returns (uint256) {
        PoolInfo storage pool = tokenPools[token];
        if (pool.virtualEthReserve == 0 || pool.virtualTokenReserve == 0)
            return 0;
        return (pool.virtualEthReserve * 1e18) / pool.virtualTokenReserve;
    }

    // ==================== CRITICAL FIX: _checkAndAddLiquidity ====================
    function _checkAndAddLiquidity(address token) internal {
        // uint256 marketCap = getTokenMarketCap(token);
        uint256 marketCap = getTokenVirtualMarketCap(token);
        if (marketCap >= TARGET_MARKET_CAP * 1 ether) {
            uint256 tokenPrice = getPrice(token);
            require(tokenPrice > 0, "Token price must be greater than 0");

            uint256 totalEthReserve = tokenPools[token].ethReserve;
            uint256 totalTokenReserve = tokenPools[token].tokenReserve;

            // Calculate total fees to reserve
            uint256 totalFeesToReserve = tokenOwnerLPFee + platformLPFee;

            uint256 ethAmountForLP = totalEthReserve;
            uint256 tokenAmountForLP = totalTokenReserve;

            if (totalEthReserve > totalFeesToReserve) {
                // Calculate the ETH amount for liquidity (after reserving fees)
                ethAmountForLP = totalEthReserve - totalFeesToReserve;

                // Calculate proportional token amount to maintain the same ratio
                // ratio = ethAmountForLP / totalEthReserve
                // tokenAmountForLP = totalTokenReserve * ratio
                tokenAmountForLP =
                    (totalTokenReserve * ethAmountForLP) /
                    totalEthReserve;
            }

            ILaunchable(token).launch();
            tokenPools[token].launched = true;

            // Add liquidity with the calculated amounts
            _addLiquidity(token, ethAmountForLP, tokenAmountForLP);

            // get remainint eth reserve after adding liquidity
            uint256 remainingEthReserve = tokenPools[token].ethReserve -
                ethAmountForLP;

            // Burn remaining tokens (if any)
            uint256 remainingTokens = IERC20(token).balanceOf(address(this));
            if (remainingTokens > 0) {
                IERC20(token).transfer(burnAddress, remainingTokens);
            }

            if (remainingEthReserve > 0) {
                _transferETH(tokenPools[token].owner, remainingEthReserve / 2);
                _transferETH(feeAddress, remainingEthReserve / 2);
            }

            // Update pool state
            // tokenPools[token].tokenReserve = 0;
            // tokenPools[token].ethReserve = 0;
            // tokenPools[token].virtualEthReserve = 0;
            // tokenPools[token].virtualTokenReserve = 0;

            emit TokenLaunched(token, block.timestamp);
        }
    }
    // ================================================================================

    function getTokenMarketCap(address token) public view returns (uint256) {
        if (tokenPools[token].ethReserve == 0) return 0;
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
        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "transfer eth failed");
    }

    // ==================== ADMIN FUNCTIONS ====================
    function setTokenOwnerFeePercent(uint256 feePercent) external onlyOwner {
        TOKEN_OWNER_FEE_PERCENT = feePercent;
    }
    function setTargetMarketCap(uint256 targetMarketCap) external onlyOwner {
        TARGET_MARKET_CAP = targetMarketCap;
    }
    function setTotalSupply(uint256 totalSupply) external onlyOwner {
        TOTAL_SUPPLY = totalSupply;
    }
    function setMaxBuyPercent(uint256 percent) external onlyOwner {
        MAX_BUY_PERCENT = percent;
    }
    function setCreateTokenFeeAmount(uint256 feeAmount) external onlyOwner {
        CREATE_TOKEN_FEE_AMOUNT = feeAmount;
    }
    function setInitialEthLPAmount(uint256 amount) external onlyOwner {
        initialEthLPAmount = amount;
    }
    function setInitialTokenLPAmount(uint256 amount) external onlyOwner {
        initialTokenLPAmount = amount;
    }
    function setFirstBuyFee(uint256 fee) external onlyOwner {
        firstBuyFeeUSD = fee;
    }
    function setTokenOwnerLPFee(uint256 fee) external onlyOwner {
        tokenOwnerLPFee = fee;
    }

    function emergencyWithdrawETH(uint256 amount) external onlyOwner {
        _transferETH(owner(), amount);
    }

    function emergencyWithdrawTokens(
        address token,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }

    function setMaxSellPercent(uint256 percent) external onlyOwner {
        MAX_SELL_PERCENT = percent;
    }

    function setPlatformBuyFeePercent(uint256 percent) external onlyOwner {
        PLATFORM_BUY_FEE_PERCENT = percent;
    }

    function setPlatformSellFeePercent(uint256 percent) external onlyOwner {
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
        PoolInfo storage pool = tokenPools[token];
        pool.ethReserve = ethReserve;
        pool.tokenReserve = tokenReserve;
        pool.virtualEthReserve = virtualEthReserve;
        pool.virtualTokenReserve = virtualTokenReserve;
        pool.owner = owner;
        pool.poolType = poolType;
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
        migrated[from][token] = true;
        IEthism.PoolInfo memory pool = IEthism(from).tokenPools(token);
        address newToken = (address)(
            new Token(ERC20(token).name(), ERC20(token).symbol(), TOTAL_SUPPLY)
        );
        for (uint256 i = 0; i < holders.length; i++) {
            uint256 balance = IERC20(token).balanceOf(holders[i]);
            if (balance > 0) IERC20(newToken).transfer(holders[i], balance);
        }
        tokenPools[newToken] = PoolInfo(
            pool.ethReserve,
            pool.tokenReserve,
            pool.virtualEthReserve,
            pool.virtualTokenReserve,
            newToken,
            pool.owner,
            pool.poolType,
            pool.launched
        );

        tokenList[tokenCount] = token;
        tokenCount++;

        emit Migrated(from, token, newToken);
    }
}
