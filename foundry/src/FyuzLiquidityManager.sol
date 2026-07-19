// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {
    Initializable
} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
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
    INonfungiblePositionManager
} from "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import {
    IUniswapV3Factory
} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {
    IUniswapV3Pool
} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IV3PoolSlot0} from "./interfaces/IV3PoolSlot0.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {
    IERC721Receiver
} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import "./v4-core/interfaces/IHooks.sol";
import "./v4-core/types/Currency.sol";
import "./v4-core//interfaces/IPoolManager.sol";
import "./v4-core/libraries/LiquidityAmounts.sol";
import "./v4-core/libraries/TickMath.sol";
import "./v4-core/libraries/Actions.sol";
import {StateLibrary} from "./v4-core/libraries/StateLibrary.sol";
import {PoolId, PoolIdLibrary} from "./v4-core/types/PoolId.sol";
import "./v4-periphery/interfaces/IPositionManager.sol";
import "./permit2/interfaces/IPermit2.sol";

/**
 * @title FyuzLiquidityManager
 * @author Fyuz Protocol
 * @notice A comprehensive liquidity management contract supporting Uniswap V2, V3, and V4
 * @dev This contract allows users to add liquidity to different versions of Uniswap protocols
 *      while maintaining security through reentrancy protection
 */
contract FyuzLiquidityManager is
    Initializable,
    ReentrancyGuard,
    OwnableUpgradeable,
    PausableUpgradeable,
    IERC721Receiver
{
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    int24 private constant MIN_TICK = -887272;
    int24 private constant MAX_TICK = 887272;

    /// @dev Tick spacing for pool positions
    int24 private constant TICK_SPACING = 60;

    /// @dev Default pool fee (0.1%)
    uint24 private constant POOL_FEE = 100;
    /// @dev Default deadline buffer for transactions
    uint256 private constant DEADLINE_BUFFER = 10 minutes;

    /// @dev Q96 for calculations
    uint256 internal constant Q96 = 0x1000000000000000000000000;

    /// @dev Max allowed deviation (bps) between a pre-existing DEX pool's price and
    ///      our target price before graduation aborts. Guards against a griefer
    ///      pre-initializing the pool at a hostile price to skim the migrated ETH.
    uint256 internal constant PRICE_TOLERANCE_BPS = 500; // 5%
    /// @dev Slippage floor (bps) applied to concentrated-liquidity mint amounts.
    uint256 internal constant MINT_SLIPPAGE_BPS = 500; // 5%

    /*//////////////////////////////////////////////////////////////
                            STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice Authorized callers mapping
    mapping(address => bool) public authorizedCallers;

    /// @notice Uniswap V2 Router interface
    IUniswapV2Router02 public routerV2;

    /// @notice Uniswap V3 Nonfungible Position Manager
    INonfungiblePositionManager public nonfungiblePositionManager;

    /// @notice Uniswap V3 Factory interface
    IUniswapV3Factory public factoryV3;

    /// @notice Uniswap V4 Pool Manager interface
    IPoolManager public poolV4Manager;

    /// @notice Universal Router address for V4 operations
    address public universalRouter;

    /// @notice Position Manager for V4 operations
    IPositionManager public positionManager;

    IPermit2 permit2;

    // Set in initialize() — declaration-time values never run behind a proxy.
    uint16 ethAmountPercentToLP; // 10000 = 100%
    uint16 tokenAmountPercentToLP; // 10000 = 100%

    /// @notice V3 position NFT this contract holds for a launched token (0 = none).
    /// @dev The position is retained here forever so its trading fees stay
    ///      collectable. Burning it to 0xdEaD would strand them permanently — see
    ///      collectFees(). There is deliberately no path that decreases liquidity or
    ///      transfers this NFT out, so the LP itself can never be withdrawn.
    mapping(address => uint256) public v3PositionOf;

    /// @notice V4 position NFT this contract holds for a launched token (0 = none).
    mapping(address => uint256) public v4PositionOf;

    /// @notice PoolKey per launched token — required to address the V4 pool on collect.
    mapping(address => PoolKey) public v4PoolKeyOf;

    /// @dev Reserved storage for future upgrades. Decrement when appending state.
    uint256[47] private __gap;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Emitted when liquidity is added to a Uniswap V2 pool
     * @param token The token address
     * @param tokenAmount Amount of tokens added
     * @param ethAmount Amount of ETH added
     * @param pairAddress The created/existing pair address
     * @param recipient Address receiving LP tokens
     */
    event LiquidityAddedV2(
        address indexed token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address indexed pairAddress,
        address indexed recipient
    );

    /**
     * @notice Emitted when liquidity is added to a Uniswap V3 pool
     * @param token The token address
     * @param tokenAmount Amount of tokens added
     * @param ethAmount Amount of ETH added
     * @param tokenId The NFT token ID representing the position
     * @param recipient Address receiving the NFT
     */
    event LiquidityAddedV3(
        address indexed token,
        uint256 tokenAmount,
        uint256 ethAmount,
        uint256 indexed tokenId,
        address indexed recipient
    );

    /**
     * @notice Emitted when a new Uniswap V3 pool is created
     * @param token The token address
     * @param weth The WETH address
     * @param fee The pool fee
     * @param pool The created pool address
     */
    event PoolCreatedV3(
        address indexed token,
        address indexed weth,
        uint24 fee,
        address indexed pool
    );

    /// @notice A position NFT is now held by this contract permanently. Emitted
    ///         instead of a burn so indexers can prove the LP is locked, not rugged.
    event PositionLocked(
        address indexed token,
        uint256 indexed tokenId,
        uint8 version
    );

    event FeesCollected(
        address indexed token,
        address indexed creator,
        address indexed platform,
        uint256 ethFees,
        uint256 tokenFees
    );

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error InsufficientAllowance();
    error InsufficientTokenBalance();
    error InsufficientETHBalance();
    error TransferFailed();
    error SqrtPriceOverflow();
    error InvalidTokenOrder();
    error ZeroAmount();
    error ZeroAddress();

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Validates that amounts are greater than zero
     * @param tokenAmount Token amount to validate
     * @param ethAmount ETH amount to validate
     */
    modifier validAmounts(uint256 tokenAmount, uint256 ethAmount) {
        if (tokenAmount == 0) revert ZeroAmount();
        if (ethAmount == 0) revert ZeroAmount();
        _;
    }

    /**
     * @dev Validates that the address is not zero
     * @param addr Address to validate
     */
    modifier notZeroAddress(address addr) {
        if (addr == address(0)) revert ZeroAddress();
        _;
    }

    modifier onlyAuthorized() {
        require(
            authorizedCallers[msg.sender] || msg.sender == owner(),
            "Unauthorized"
        );
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Initializes the contract with Uniswap protocol addresses
     * @param _routerV2 Uniswap V2 router address
     * @param _factoryV3 Uniswap V3 factory address
     * @param _v3PositionManager Uniswap V3 position manager address
     * @param _poolV4Manager Uniswap V4 pool manager address
     * @param _universalRouter Universal router address for V4 operations
     * @param _v4PositionManager V4 position manager address
     * @param _permit2 Permit2 contract address for token approvals
     * @param _owner Initial owner of the contract
     * @param _ethAmountPercentToLP Percent of ETH to use for LP (in basis points)
     * @param _tokenAmountPercentToLP Percent of tokens to use for LP (in basis points)
     */
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _routerV2,
        address _factoryV3,
        address _v3PositionManager,
        address _poolV4Manager,
        address _universalRouter,
        address _v4PositionManager,
        address _permit2,
        address _owner,
        uint16 _ethAmountPercentToLP,
        uint16 _tokenAmountPercentToLP
    ) external initializer {
        __Ownable_init(_owner);
        __Pausable_init();

        if (_routerV2 == address(0)) revert ZeroAddress();
        if (_factoryV3 == address(0)) revert ZeroAddress();
        if (_poolV4Manager == address(0)) revert ZeroAddress();
        if (_universalRouter == address(0)) revert ZeroAddress();
        if (_v4PositionManager == address(0)) revert ZeroAddress();

        routerV2 = IUniswapV2Router02(_routerV2);
        factoryV3 = IUniswapV3Factory(_factoryV3);
        nonfungiblePositionManager = INonfungiblePositionManager(
            _v3PositionManager
        );
        poolV4Manager = IPoolManager(_poolV4Manager);
        universalRouter = _universalRouter;
        positionManager = IPositionManager(_v4PositionManager);
        permit2 = IPermit2(_permit2);
        ethAmountPercentToLP = _ethAmountPercentToLP;
        tokenAmountPercentToLP = _tokenAmountPercentToLP;
    }

    /*//////////////////////////////////////////////////////////////
                            RECEIVE FUNCTION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Allows the contract to receive ETH
     */
    receive() external payable {}

    /**
     * @notice Handles the receipt of an NFT
     * @dev Required for receiving Uniswap V3 position NFTs
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Returns the Uniswap V2 router address
     * @return The router V2 address
     */
    function getRouterV2() external view returns (address) {
        return address(routerV2);
    }

    /**
     * @notice Calculates output amounts for a given input amount and path
     * @param amountIn Input amount
     * @param path Array of token addresses representing the swap path
     * @return amounts Array of output amounts for each step in the path
     */
    function getAmountsOut(
        uint amountIn,
        address[] memory path
    ) external view returns (uint[] memory amounts) {
        return routerV2.getAmountsOut(amountIn, path);
    }

    /**
     * @notice Returns the WETH address from the V2 router
     * @return The WETH address
     */
    function WETH() external view returns (address) {
        return routerV2.WETH();
    }

    /*//////////////////////////////////////////////////////////////
                         UNISWAP V2 FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Adds liquidity to a Uniswap V2 pool
     * @dev Creates a new pool if one doesn't exist
     * @param token The ERC20 token address to pair with ETH
     * @param tokenAmount Amount of tokens to add as liquidity
     * @param ethAmount Amount of ETH to add as liquidity
     * @param recipient Address to receive the LP tokens
     * @return pairAddress The address of the created or existing pair
     */
    function addLiquidityV2(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address recipient
    )
        external
        payable
        nonReentrant
        whenNotPaused
        onlyAuthorized
        validAmounts(tokenAmount, ethAmount)
        notZeroAddress(token)
        notZeroAddress(recipient)
        returns (address pairAddress)
    {
        _validateTokenTransfer(token, tokenAmount);
        _validateETHBalance(ethAmount);

        // Transfer tokens from caller to this contract
        _transferTokensFrom(token, tokenAmount);

        // Approve router to spend tokens
        IERC20(token).approve(address(routerV2), tokenAmount);

        uint256 ethAmountToLP = (ethAmount * ethAmountPercentToLP) / 10000; // Calculate ETH amount to LP
        uint256 tokenAmountToLP = (tokenAmount * tokenAmountPercentToLP) /
            10000; // Calculate token amount to LP

        // Add liquidity with 2% slippage tolerance
        uint256 tokenMin = (tokenAmountToLP * 98) / 100;
        uint256 ethMin = (ethAmountToLP * 98) / 100;
        routerV2.addLiquidityETH{value: ethAmountToLP}(
            token,
            tokenAmountToLP,
            tokenMin,
            ethMin,
            recipient,
            block.timestamp + DEADLINE_BUFFER
        );

        // Reset approval after router call
        IERC20(token).approve(address(routerV2), 0);

        // Get pair address
        pairAddress = IUniswapV2Factory(routerV2.factory()).getPair(
            token,
            routerV2.WETH()
        );

        emit LiquidityAddedV2(
            token,
            tokenAmountToLP,
            ethAmountToLP,
            pairAddress,
            recipient
        );
    }

    /**
     * @notice Adds liquidity to a Uniswap V2 pool with target market cap preservation
     * @dev Calculates optimal ETH and token amounts to maintain target market cap
     * @param token The ERC20 token address to pair with ETH
     * @param tokenAmount Available tokens to add as liquidity
     * @param ethAmount Available ETH to add as liquidity
     * @param recipient Address to receive the LP tokens
     * @param targetMarketCap Target market cap in USD (18 decimals)
     * @param ethPriceUSD Current ETH price in USD (18 decimals)
     * @return pairAddress The address of the created or existing pair
     */
    function addLiquidityV2WithTargetMarketCap(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address recipient,
        uint256 targetMarketCap,
        uint256 ethPriceUSD
    )
        external
        payable
        nonReentrant
        whenNotPaused
        onlyAuthorized
        validAmounts(tokenAmount, ethAmount)
        notZeroAddress(token)
        notZeroAddress(recipient)
        returns (address pairAddress)
    {
        require(targetMarketCap > 0, "Target market cap must be positive");
        require(ethPriceUSD > 0, "ETH price must be positive");

        _validateTokenTransfer(token, tokenAmount);
        _validateETHBalance(ethAmount);

        // Transfer tokens from caller to this contract
        _transferTokensFrom(token, tokenAmount);

        // Get total supply of the token
        uint256 totalSupply = IERC20(token).totalSupply();
        require(totalSupply > 0, "Total supply must be positive");

        // Calculate the required ratio: ethReserve / tokenReserve = targetMarketCap / (totalSupply * ethPriceUSD)
        // tokenToAdd = ethToAdd * totalSupply * ethPriceUSD / targetMarketCap / 1e18

        // Calculate optimal amounts maintaining the target market cap
        uint256 ethAmountToLP;
        uint256 tokenAmountToLP;

        // Try using all available ETH and calculate required tokens
        uint256 requiredTokensForAllEth = (ethAmount * totalSupply) / 1e18;
        requiredTokensForAllEth =
            (requiredTokensForAllEth * ethPriceUSD) /
            targetMarketCap;

        if (requiredTokensForAllEth <= tokenAmount) {
            // We can use all ETH
            ethAmountToLP = ethAmount;
            tokenAmountToLP = requiredTokensForAllEth;
        } else {
            // We need to use all tokens and calculate required ETH
            ethAmountToLP = (tokenAmount * targetMarketCap) / totalSupply;
            ethAmountToLP = (ethAmountToLP * 1e18) / ethPriceUSD;
            tokenAmountToLP = tokenAmount;
        }

        // Ensure we have the amounts
        require(
            ethAmountToLP > 0 && tokenAmountToLP > 0,
            "Calculated amounts must be positive"
        );
        require(ethAmountToLP <= ethAmount, "Not enough ETH");
        require(tokenAmountToLP <= tokenAmount, "Not enough tokens");

        // Seed the pair directly via first-mint instead of the router. The router
        // reverts if a pre-existing pair has one-sided (donated) reserves, which
        // would let a griefer permanently brick graduation for a few gwei. Since
        // the token is transfer-gated until launch(), nobody can have supplied
        // token-side liquidity, so graduation is always the first real mint and
        // sets the price; any donated WETH dust is simply absorbed into the LP.
        address weth = routerV2.WETH();
        IUniswapV2Factory factory = IUniswapV2Factory(routerV2.factory());
        pairAddress = factory.getPair(token, weth);
        if (pairAddress == address(0)) {
            pairAddress = factory.createPair(token, weth);
        }

        // Always wrap and deposit our FULL ethAmountToLP. UniswapV2 mint() credits
        // the first-mint liquidity on the balance-minus-reserve DELTA, so depositing
        // our full amount guarantees a strictly-positive WETH delta — the first mint
        // can never underflow-revert, even if a griefer pre-donated WETH and called
        // sync() to fold it into the pair's reserves (which balanceOf-only accounting
        // cannot see, and which previously bricked graduation permanently).
        IWETH(weth).deposit{value: ethAmountToLP}();
        IERC20(weth).safeTransfer(pairAddress, ethAmountToLP);

        // Size the token side to the pool's TOTAL WETH (our deposit + any donation)
        // so it opens at the target market cap. A donation can only push the opening
        // price ABOVE target (never below, which would bleed the burned LP to
        // arbitrage); the griefer's WETH is locked into the burned LP. Cap at the
        // tokens we actually hold.
        uint256 poolWeth = IERC20(weth).balanceOf(pairAddress);
        uint256 tokenForPool = (poolWeth * totalSupply) / 1e18;
        tokenForPool = (tokenForPool * ethPriceUSD) / targetMarketCap;
        if (tokenForPool > tokenAmount) tokenForPool = tokenAmount;
        require(tokenForPool > 0, "Calculated token amount must be positive");

        IERC20(token).safeTransfer(pairAddress, tokenForPool);
        IUniswapV2Pair(pairAddress).mint(recipient);

        // Transfer any remaining tokens to dead address
        uint256 remainingTokens = IERC20(token).balanceOf(address(this));
        if (remainingTokens > 0) {
            IERC20(token).safeTransfer(address(0xdead), remainingTokens);
        }

        // Sweep any leftover ETH to the owner (treasury). In the target-mcap V2
        // path the full raise is deposited into the pair above, so this is 0 in
        // practice — it's only a dust catcher, never a share of the raise.
        uint256 remainingETH = address(this).balance;
        if (remainingETH > 0) {
            (bool success, ) = owner().call{value: remainingETH}("");
            require(success, "ETH transfer failed");
        }

        emit LiquidityAddedV2(
            token,
            tokenAmountToLP,
            ethAmountToLP,
            pairAddress,
            recipient
        );
    }

    /*//////////////////////////////////////////////////////////////
                         UNISWAP V3 FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Adds liquidity to a Uniswap V3 pool
     * @dev Creates a new pool if one doesn't exist, mints a new NFT position
     * @param token The ERC20 token address to pair with ETH
     * @param tokenAmount Amount of tokens to add as liquidity
     * @param ethAmount Amount of ETH to add as liquidity
     * @param dustRecipient Address that receives leftover dust — NOT the position.
     *        The position NFT is retained by this contract so its fees stay
     *        collectable; see collectFees(). There is no path to withdraw it.
     * @return tokenId The ID of the minted NFT position
     * @return liquidity The amount of liquidity added
     * @return amount0 The amount of token0 actually used
     * @return amount1 The amount of token1 actually used
     */
    function addLiquidityV3(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address dustRecipient
    )
        external
        payable
        nonReentrant
        whenNotPaused
        onlyAuthorized
        validAmounts(tokenAmount, ethAmount)
        notZeroAddress(token)
        notZeroAddress(dustRecipient)
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        _validateTokenTransfer(token, tokenAmount);
        _validateETHBalance(ethAmount);

        address token0Address = token;
        address token1Address = routerV2.WETH();

        uint256 ethAmountToLP = (ethAmount * ethAmountPercentToLP) / 10000; // Calculate ETH amount to LP
        uint256 tokenAmountToLP = (tokenAmount * tokenAmountPercentToLP) /
            10000; // Calculate token amount to LP

        uint256 amount0Desired = tokenAmountToLP;
        uint256 amount1Desired = ethAmountToLP;

        if (token0Address > token1Address) {
            (token0Address, token1Address) = (token1Address, token0Address);
            amount0Desired = ethAmountToLP;
            amount1Desired = tokenAmountToLP;
        }

        uint160 sqrtPriceX96 = calculateSqrtPriceX96(
            amount0Desired,
            amount1Desired
        );

        _createOrGetPoolV3(token, POOL_FEE, sqrtPriceX96);

        IERC20 token0 = IERC20(token0Address);
        IERC20 token1 = IERC20(token1Address);

        if (address(token0) != routerV2.WETH()) {
            token0.transferFrom(msg.sender, address(this), tokenAmount);
        } else {
            token1.transferFrom(msg.sender, address(this), tokenAmount);
        }
        IWETH(routerV2.WETH()).deposit{value: ethAmount}();

        token0.approve(address(nonfungiblePositionManager), amount0Desired);
        token1.approve(address(nonfungiblePositionManager), amount1Desired);

        (int24 tickLower, int24 tickUpper) = getFullRangeTicks(POOL_FEE);

        INonfungiblePositionManager.MintParams
            memory params = INonfungiblePositionManager.MintParams({
                token0: token0Address,
                token1: token1Address,
                fee: POOL_FEE,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: (amount0Desired * (10_000 - MINT_SLIPPAGE_BPS)) /
                    10_000,
                amount1Min: (amount1Desired * (10_000 - MINT_SLIPPAGE_BPS)) /
                    10_000,
                // Held by this contract, NOT sent to `recipient` (0xdEaD). A burned
                // NFT can never call collect(), which would strand every fee the
                // position ever earns. Locked here instead: no withdraw path exists.
                recipient: address(this),
                deadline: block.timestamp + 10 minutes
            });

        (tokenId, liquidity, amount0, amount1) = nonfungiblePositionManager
            .mint(params);
        v3PositionOf[token] = tokenId;
        emit PositionLocked(token, tokenId, 3);

        // Don't leave standing allowances to the position manager.
        token0.approve(address(nonfungiblePositionManager), 0);
        token1.approve(address(nonfungiblePositionManager), 0);

        if (IERC20(token).balanceOf(address(this)) > 0) {
            IERC20(token).transfer(
                address(0xdead),
                IERC20(token).balanceOf(address(this))
            );
        }

        uint256 wad = IWETH(routerV2.WETH()).balanceOf(address(this));
        if (wad > 0) {
            IWETH(routerV2.WETH()).withdraw(wad);
            (bool success, ) = owner().call{value: wad}("");
            if (!success) revert TransferFailed();
        }
    }

    /*//////////////////////////////////////////////////////////////
                         UNISWAP V4 FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Adds liquidity to a Uniswap V4 pool
     * @dev Creates a new V4 pool if one doesn't exist
     * @param token The ERC20 token address to pair with ETH
     * @param tokenAmount Amount of tokens to add as liquidity
     * @param ethAmount Amount of ETH to add as liquidity
     * @param dustRecipient Address that receives leftover dust — NOT the position.
     *        The position is retained by this contract so its fees stay collectable.
     */
    function addLiquidityV4(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address dustRecipient
    )
        external
        payable
        nonReentrant
        whenNotPaused
        onlyAuthorized
        validAmounts(tokenAmount, ethAmount)
        notZeroAddress(token)
        notZeroAddress(dustRecipient)
    {
        _validateTokenTransfer(token, tokenAmount);
        _validateETHBalance(ethAmount);

        // Transfer tokens from caller
        _transferTokensFrom(token, tokenAmount);

        address token0Address = token;
        address token1Address = routerV2.WETH();

        uint256 ethAmountToLP = 0;
        if (ethAmount > 0) {
            ethAmountToLP = (ethAmount * ethAmountPercentToLP) / 10000; // Calculate ETH amount to LP
        }

        uint256 tokenAmountToLP = (tokenAmount * tokenAmountPercentToLP) /
            10000; // Calculate token amount to LP

        uint256 amount0Desired = tokenAmountToLP;
        uint256 amount1Desired = ethAmountToLP;

        if (token0Address > token1Address) {
            (token0Address, token1Address) = (token1Address, token0Address);
            amount0Desired = ethAmountToLP;
            amount1Desired = tokenAmountToLP;
        }

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(token0Address),
            currency1: Currency.wrap(token1Address),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        uint160 sqrtPriceX96 = calculateSqrtPriceX96(
            amount0Desired,
            amount1Desired
        );

        // If a griefer pre-initialized this pool, initializePool() below silently
        // no-ops; abort unless the existing price matches our target so we never
        // mint into a hostile pool.
        (uint160 existingV4, , , ) = poolV4Manager.getSlot0(poolKey.toId());
        if (existingV4 != 0) {
            require(
                _withinTolerance(existingV4, sqrtPriceX96),
                "V4 pool price mismatch"
            );
        }

        // V4 pool uses TICK_SPACING, so full-range ticks must align to it.
        (int24 tickLower, int24 tickUpper) = _fullRangeTicks(TICK_SPACING);

        // Converts token amounts to liquidity units
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            uint160(sqrtPriceX96),
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            amount0Desired,
            amount1Desired
        );

        bytes memory hookData = new bytes(0);
        (
            bytes memory actions,
            bytes[] memory mintParams
        ) = _mintLiquidityParams(
                poolKey,
                tickLower,
                tickUpper,
                liquidity,
                amount0Desired + 1,
                amount1Desired + 1,
                address(this), // position stays here so fees remain collectable
                dustRecipient, // only dust is burned, never the position
                hookData
            );

        // v4-periphery assigns tokenId = nextTokenId++, so the id read here is the
        // one this mint receives.
        uint256 v4TokenId = positionManager.nextTokenId();

        // multicall parameters
        bytes[] memory params = new bytes[](2);

        // Initialize Pool
        params[0] = abi.encodeWithSelector(
            positionManager.initializePool.selector,
            poolKey,
            sqrtPriceX96,
            hookData
        );

        // Mint Liquidity
        params[1] = abi.encodeWithSelector(
            positionManager.modifyLiquidities.selector,
            abi.encode(actions, mintParams),
            block.timestamp + 3600
        );

        IWETH(routerV2.WETH()).deposit{value: ethAmount}();

        IERC20(token0Address).approve(address(permit2), type(uint256).max);
        permit2.approve(
            token0Address,
            address(positionManager),
            type(uint160).max,
            type(uint48).max
        );

        IERC20(token1Address).approve(address(permit2), type(uint256).max);
        permit2.approve(
            token1Address,
            address(positionManager),
            type(uint160).max,
            type(uint48).max
        );

        positionManager.multicall(params);

        v4PositionOf[token] = v4TokenId;
        v4PoolKeyOf[token] = poolKey;
        emit PositionLocked(token, v4TokenId, 4);

        // Revoke the approvals granted above (don't leave standing allowances).
        IERC20(token0Address).approve(address(permit2), 0);
        IERC20(token1Address).approve(address(permit2), 0);
        permit2.approve(token0Address, address(positionManager), 0, 0);
        permit2.approve(token1Address, address(positionManager), 0, 0);

        if (IERC20(token).balanceOf(address(this)) > 0) {
            IERC20(token).transfer(
                address(0xdead),
                IERC20(token).balanceOf(address(this))
            );
        }

        uint256 wad = IWETH(routerV2.WETH()).balanceOf(address(this));
        if (wad > 0) {
            IWETH(routerV2.WETH()).withdraw(wad);
            (bool success, ) = owner().call{value: wad}("");
            if (!success) revert TransferFailed();
        }
    }

    /*//////////////////////////////////////////////////////////////
                     UNISWAP V4 SINGLE-SIDED (DIRECT LAUNCH)
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Seeds a V4 pool with tokens ONLY — no ETH — for direct launches.
     * @dev A Uniswap position holds both assets only while the price sits inside its
     *      range. Park the range entirely ABOVE the opening price and it holds pure
     *      token: buyers walk the price up through the supply and pay ETH in as they
     *      go, so the pool needs no ETH to start. That is why this cannot reuse
     *      addLiquidityV4, which assumes a two-sided full-range mint.
     *
     *      `ethAmountForPrice` is NOTIONAL — it is never transferred. It only fixes
     *      the opening price via the tokenAmount:ethAmountForPrice ratio, i.e. what
     *      the whole supply is deemed to be worth at launch.
     *
     *      The position is retained here forever, exactly like the two-sided path,
     *      so its trading fees stay collectable via collectFees().
     * @param token The launched token
     * @param tokenAmount Tokens to deposit — the entire supply for a direct launch
     * @param ethAmountForPrice Notional ETH value of tokenAmount, sets opening price
     * @param dustRecipient Receives leftover dust only, never the position
     */
    function addLiquidityV4SingleSided(
        address token,
        uint256 tokenAmount,
        uint256 ethAmountForPrice,
        address dustRecipient
    )
        external
        nonReentrant
        whenNotPaused
        onlyAuthorized
        notZeroAddress(token)
        notZeroAddress(dustRecipient)
    {
        if (tokenAmount == 0 || ethAmountForPrice == 0) revert ZeroAmount();
        _validateTokenTransfer(token, tokenAmount);
        _transferTokensFrom(token, tokenAmount);

        // WETH, not native ETH: V2/V3/V4 all pair against WETH protocol-wide, so the
        // token may sort either side of it and BOTH currency orderings are reachable.
        // (Klik pairs V4 against native ETH, which makes the token always currency1 —
        // we deliberately keep the WETH pairing consistent across versions instead.)
        address weth = routerV2.WETH();
        bool tokenIsCurrency0 = token < weth;

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(tokenIsCurrency0 ? token : weth),
            currency1: Currency.wrap(tokenIsCurrency0 ? weth : token),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });

        // Price is always currency1 per currency0, so the notional amounts must be
        // ordered the same way as the currencies.
        uint160 sqrtPriceX96 = tokenIsCurrency0
            ? calculateSqrtPriceX96(tokenAmount, ethAmountForPrice)
            : calculateSqrtPriceX96(ethAmountForPrice, tokenAmount);

        // Same guard as the two-sided path: never mint into a pool a griefer
        // pre-initialised at a hostile price.
        (uint160 existingV4, , , ) = poolV4Manager.getSlot0(poolKey.toId());
        if (existingV4 != 0) {
            require(
                _withinTolerance(existingV4, sqrtPriceX96),
                "V4 pool price mismatch"
            );
        }

        int24 startTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;

        if (tokenIsCurrency0) {
            // Holding only currency0 means the range must sit STRICTLY above the
            // current tick. Aligning startTick alone is not enough: when startTick
            // is already a multiple of TICK_SPACING, tickLower lands on spot, the
            // position straddles the price and the mint needs currency1 it is
            // capped at zero for — reverting the launch. +1 forces the next spacing.
            tickLower = _alignUp(startTick + 1, TICK_SPACING);
            tickUpper = _alignDown(TickMath.MAX_TICK, TICK_SPACING);
            liquidity = LiquidityAmounts.getLiquidityForAmount0(
                TickMath.getSqrtPriceAtTick(tickLower),
                TickMath.getSqrtPriceAtTick(tickUpper),
                tokenAmount
            );
        } else {
            // Mirror image: holding only currency1 needs the range at or below the
            // current tick, so round the upper bound DOWN. Landing exactly on spot is
            // safe on this side: at the boundary the currency0 amount is zero.
            tickLower = _alignUp(TickMath.MIN_TICK, TICK_SPACING);
            tickUpper = _alignDown(startTick, TICK_SPACING);
            liquidity = LiquidityAmounts.getLiquidityForAmount1(
                TickMath.getSqrtPriceAtTick(tickLower),
                TickMath.getSqrtPriceAtTick(tickUpper),
                tokenAmount
            );
        }
        require(liquidity > 0, "Zero liquidity");

        uint256 v4TokenId = positionManager.nextTokenId();

        bytes memory hookData = new bytes(0);
        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION),
            uint8(Actions.SETTLE_PAIR),
            uint8(Actions.SWEEP),
            uint8(Actions.SWEEP)
        );
        bytes[] memory mintParams = new bytes[](4);
        mintParams[0] = abi.encode(
            poolKey,
            tickLower,
            tickUpper,
            liquidity,
            // Cap the token side, and hard-cap the ETH side at zero: if the mint ever
            // tried to pull WETH the position would not be single-sided, and this
            // reverts rather than silently taking funds we do not have.
            tokenIsCurrency0 ? tokenAmount : 0,
            tokenIsCurrency0 ? 0 : tokenAmount,
            address(this), // position locked here so fees stay collectable
            hookData
        );
        mintParams[1] = abi.encode(poolKey.currency0, poolKey.currency1);
        mintParams[2] = abi.encode(poolKey.currency0, dustRecipient);
        mintParams[3] = abi.encode(poolKey.currency1, dustRecipient);

        bytes[] memory params = new bytes[](2);
        params[0] = abi.encodeWithSelector(
            positionManager.initializePool.selector,
            poolKey,
            sqrtPriceX96,
            hookData
        );
        params[1] = abi.encodeWithSelector(
            positionManager.modifyLiquidities.selector,
            abi.encode(actions, mintParams),
            block.timestamp + DEADLINE_BUFFER
        );

        IERC20(token).approve(address(permit2), tokenAmount);
        permit2.approve(
            token,
            address(positionManager),
            type(uint160).max,
            type(uint48).max
        );

        positionManager.multicall(params);

        IERC20(token).approve(address(permit2), 0);
        permit2.approve(token, address(positionManager), 0, 0);

        v4PositionOf[token] = v4TokenId;
        v4PoolKeyOf[token] = poolKey;
        emit PositionLocked(token, v4TokenId, 4);

        // Should be nothing left — the whole balance went in as liquidity.
        uint256 leftover = IERC20(token).balanceOf(address(this));
        if (leftover > 0) {
            IERC20(token).safeTransfer(dustRecipient, leftover);
        }
    }

    /// @dev Round a tick UP to the next multiple of `spacing`. Solidity truncates
    ///      toward zero, so negative ticks need the correction added back.
    function _alignUp(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 aligned = (tick / spacing) * spacing;
        if (tick > 0 && aligned < tick) aligned += spacing;
        if (tick < 0 && aligned < tick) aligned += spacing;
        if (aligned < TickMath.MIN_TICK) aligned += spacing;
        return aligned;
    }

    /// @dev Round a tick DOWN to the previous multiple of `spacing`.
    function _alignDown(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 aligned = (tick / spacing) * spacing;
        if (aligned > tick) aligned -= spacing;
        if (aligned > TickMath.MAX_TICK) aligned -= spacing;
        return aligned;
    }

    /*//////////////////////////////////////////////////////////////
                              FEE COLLECTION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Collects accrued trading fees for a locked V3/V4 position and splits
     *         them 50/50 between the token's creator and the platform.
     * @dev Only ever moves FEES, never principal:
     *      - V3 collect() pays out `tokensOwed`, which accumulates from swap fees and
     *        from decreaseLiquidity. This contract never calls decreaseLiquidity with
     *        a non-zero amount, so tokensOwed can only ever be fees.
     *      - V4 DECREASE_LIQUIDITY with liquidityDelta = 0 pokes the position to
     *        realise fees without touching the principal, then TAKE_PAIR sweeps them.
     *      There is no code path in this contract that removes liquidity or transfers
     *      a position NFT, so the LP is locked even though the fees are not.
     * @param token The launched token whose pool fees are being collected
     * @param creator Receives 50% — the token's creator, supplied by Fyuz
     * @param platform Receives 50% — the protocol fee address
     * @return ethFees Total ETH fees collected (before the split)
     * @return tokenFees Total token fees collected (before the split)
     */
    function collectFees(
        address token,
        address creator,
        address platform
    )
        external
        nonReentrant
        onlyAuthorized
        notZeroAddress(token)
        notZeroAddress(creator)
        notZeroAddress(platform)
        returns (uint256 ethFees, uint256 tokenFees)
    {
        uint256 v3Id = v3PositionOf[token];
        uint256 v4Id = v4PositionOf[token];
        // V2 LP is fungible and its fees accrue straight into the pool reserves —
        // the only way to realise them is to burn LP, which would withdraw principal
        // too. There is nothing collectable, so callers must not be told otherwise.
        require(v3Id != 0 || v4Id != 0, "No claimable position");

        // Every pool (V2/V3/V4) pairs against WETH, so fees always arrive as WETH and
        // the ETH side is always the WETH balance delta.
        address weth = routerV2.WETH();
        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        uint256 tokenBefore = IERC20(token).balanceOf(address(this));

        if (v3Id != 0) {
            nonfungiblePositionManager.collect(
                INonfungiblePositionManager.CollectParams({
                    tokenId: v3Id,
                    recipient: address(this),
                    amount0Max: type(uint128).max,
                    amount1Max: type(uint128).max
                })
            );
        } else {
            _collectV4(v4Id, v4PoolKeyOf[token]);
        }

        // Measure the delta rather than trusting balances: unrelated dust or margin
        // ETH already sitting here must not be paid out as though it were fees.
        ethFees = IERC20(weth).balanceOf(address(this)) - wethBefore;
        tokenFees = IERC20(token).balanceOf(address(this)) - tokenBefore;

        if (ethFees > 0) {
            IWETH(weth).withdraw(ethFees);
            uint256 creatorEth = ethFees / 2;
            _sendETH(creator, creatorEth);
            _sendETH(platform, ethFees - creatorEth); // remainder: no dust stranded
        }
        if (tokenFees > 0) {
            uint256 creatorTokens = tokenFees / 2;
            IERC20(token).safeTransfer(creator, creatorTokens);
            IERC20(token).safeTransfer(platform, tokenFees - creatorTokens);
        }

        emit FeesCollected(token, creator, platform, ethFees, tokenFees);
    }

    /// @dev Poke the V4 position with a zero liquidity delta to realise fees, then
    ///      take both currencies. Zero delta is what keeps principal untouched.
    function _collectV4(uint256 tokenId, PoolKey memory poolKey) internal {
        bytes memory actions = abi.encodePacked(
            uint8(Actions.DECREASE_LIQUIDITY),
            uint8(Actions.TAKE_PAIR)
        );
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            tokenId,
            uint256(0),
            uint128(0),
            uint128(0),
            bytes("")
        );
        params[1] = abi.encode(
            poolKey.currency0,
            poolKey.currency1,
            address(this)
        );
        positionManager.modifyLiquidities(
            abi.encode(actions, params),
            block.timestamp + DEADLINE_BUFFER
        );
    }

    /// ponytail: reverts if a recipient rejects ETH, which also blocks the other
    /// half's payout. Claiming blocks nobody else, so a pull-based split is only
    /// worth it if a creator contract actually turns out to reject ETH.
    function _sendETH(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /**
     * @notice Get tick spacing for a given fee tier
     * @param fee The fee tier (100, 500, 3000, or 10000)
     * @return tickSpacing The tick spacing for the fee tier
     */
    function getTickSpacing(
        uint24 fee
    ) public pure returns (int24 tickSpacing) {
        if (fee == 100) return 1; // 0.01%
        if (fee == 500) return 10; // 0.05%
        if (fee == 3000) return 60; // 0.3%
        if (fee == 10000) return 200; // 1%
        revert("Invalid fee tier");
    }

    /**
     * @notice Calculate full-range tick bounds for a given fee tier
     * @param fee The fee tier
     * @return tickLower The lower tick bound
     * @return tickUpper The upper tick bound
     */
    function getFullRangeTicks(
        uint24 fee
    ) public pure returns (int24 tickLower, int24 tickUpper) {
        return _fullRangeTicks(getTickSpacing(fee));
    }

    /// @dev Full-range ticks aligned to an explicit tick spacing. V4 sets its
    ///      tick spacing independently of the fee tier, so it must align ticks to
    ///      that spacing rather than the fee-derived one (or the mint reverts).
    function _fullRangeTicks(
        int24 tickSpacing
    ) internal pure returns (int24 tickLower, int24 tickUpper) {
        // Calculate nearest valid ticks for full range
        tickLower = (MIN_TICK / tickSpacing) * tickSpacing;
        tickUpper = (MAX_TICK / tickSpacing) * tickSpacing;

        // Ensure ticks are within valid bounds
        if (tickLower < MIN_TICK) tickLower += tickSpacing;
        if (tickUpper > MAX_TICK) tickUpper -= tickSpacing;
    }

    /*//////////////////////////////////////////////////////////////
                         INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Validates token transfer requirements
     * @param token Token address
     * @param amount Amount to transfer
     */
    function _validateTokenTransfer(
        address token,
        uint256 amount
    ) internal view {
        if (IERC20(token).allowance(msg.sender, address(this)) < amount) {
            revert InsufficientAllowance();
        }
        if (IERC20(token).balanceOf(msg.sender) < amount) {
            revert InsufficientTokenBalance();
        }
    }

    /**
     * @dev Validates contract has sufficient ETH balance
     * @param amount ETH amount required
     */
    function _validateETHBalance(uint256 amount) internal view {
        if (msg.value < amount) {
            revert InsufficientETHBalance();
        }
    }

    /**
     * @dev Transfers tokens from caller to this contract
     * @param token Token address
     * @param amount Amount to transfer
     */
    function _transferTokensFrom(address token, uint256 amount) internal {
        bool success = IERC20(token).transferFrom(
            msg.sender,
            address(this),
            amount
        );
        if (!success) revert TransferFailed();
    }

    function calculateSqrtPriceX96(
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint160 sqrtPriceX96) {
        require(amount0 > 0 && amount1 > 0, "Invalid amounts");

        // Calculate price as amount1/amount0
        uint256 price = (amount1 * 1e18) / amount0;

        // Calculate sqrt(price) * 2^96
        uint256 sqrtPrice = _sqrt(price * 1e18);
        uint256 result = (sqrtPrice * Q96) / 1e18;
        // Revert instead of silently truncating on the uint160 cast (wrong price).
        if (result > type(uint160).max) revert SqrtPriceOverflow();
        sqrtPriceX96 = uint160(result);
    }

    /**
     * @dev Creates or retrieves existing Uniswap V3 pool
     * @param token Token address
     * @param fee Pool fee
     * @param sqrtPriceX96 Initial price
     * @return pool Pool address
     */
    function _createOrGetPoolV3(
        address token,
        uint24 fee,
        uint160 sqrtPriceX96
    ) internal returns (address pool) {
        address weth = routerV2.WETH();

        pool = factoryV3.getPool(token, weth, fee);

        if (pool == address(0)) {
            pool = factoryV3.createPool(token, weth, fee);
        }

        // Read via the uint32-feeProtocol signature: Uniswap V3 uses uint8 but
        // PancakeSwap V3 widened it, and the narrow signature reverts on any
        // already-initialized Pancake pool. See IV3PoolSlot0.
        (uint160 existing, , , , , , ) = IV3PoolSlot0(pool).slot0();
        if (existing == 0) {
            // Freshly created (or created-but-not-initialized): set our price.
            IUniswapV3Pool(pool).initialize(sqrtPriceX96);
            emit PoolCreatedV3(token, weth, fee, pool);
        } else {
            // Pool already initialized (possibly by a griefer at a hostile price).
            // Abort unless its price is within tolerance of our target.
            require(
                _withinTolerance(existing, sqrtPriceX96),
                "V3 pool price mismatch"
            );
        }
    }

    /// @dev True if the pool PRICE implied by `actual` sqrtPrice is within
    ///      PRICE_TOLERANCE_BPS of the `target` price. Price ∝ sqrtPrice², so a
    ///      naive band on the sqrtPrice would be ~2x looser than the constant
    ///      claims (5% on sqrt ≈ 10% on price). We compare in price space: the
    ///      normalized ratio (actual/target) is ~1e4 when equal, squared back to
    ///      price units, then bounded — overflow-safe (ratio ≈ 1e4, ratio² ≈ 1e8).
    function _withinTolerance(
        uint160 actual,
        uint160 target
    ) internal pure returns (bool) {
        if (target == 0) return false;
        uint256 ratio = (uint256(actual) * 1e4) / uint256(target); // ~1e4 at parity
        uint256 priceRatio = (ratio * ratio) / 1e4; // (actual/target)^2, ~1e4 at parity
        uint256 diff = priceRatio > 1e4 ? priceRatio - 1e4 : 1e4 - priceRatio;
        return diff <= PRICE_TOLERANCE_BPS;
    }

    /**
     * @dev Creates a Uniswap V4 pool
     * @param token0 First token address
     * @param token1 Second token address
     * @param swapFee Pool swap fee
     * @param tickSpacing Tick spacing
     * @param hook Hook address
     * @param sqrtPriceX96 Initial price
     */
    function _createPoolV4(
        address token0,
        address token1,
        uint24 swapFee,
        int24 tickSpacing,
        address hook,
        uint160 sqrtPriceX96
    ) internal {
        // Sort tokens (V4 requirement: token0 < token1)
        if (token0 > token1) {
            (token0, token1) = (token1, token0);
        }

        PoolKey memory pool = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: swapFee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hook)
        });

        poolV4Manager.initialize(pool, sqrtPriceX96);
    }

    /// @param positionOwner Who ends up owning the position NFT — this contract, so
    ///        its fees stay collectable.
    /// @param sweepTo Where leftover dust goes (the burn address), which is a
    ///        different destination from the position itself.
    function _mintLiquidityParams(
        PoolKey memory poolKey,
        int24 _tickLower,
        int24 _tickUpper,
        uint256 liquidity,
        uint256 amount0Max,
        uint256 amount1Max,
        address positionOwner,
        address sweepTo,
        bytes memory hookData
    ) internal pure returns (bytes memory, bytes[] memory) {
        bytes memory actions = abi.encodePacked(
            uint8(Actions.MINT_POSITION),
            uint8(Actions.SETTLE_PAIR),
            uint8(Actions.SWEEP),
            uint8(Actions.SWEEP)
        );

        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(
            poolKey,
            _tickLower,
            _tickUpper,
            liquidity,
            amount0Max,
            amount1Max,
            positionOwner,
            hookData
        );
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1);
        params[2] = abi.encode(poolKey.currency0, sweepTo);
        params[3] = abi.encode(poolKey.currency1, sweepTo);

        return (actions, params);
    }

    /**
     * @dev Calculates square root using Babylonian method
     * @param x Input value
     * @return y Square root of x
     */
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /*//////////////////////////////////////////////////////////////
                         ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Pauses the contract (admin only)
     * @dev Prevents execution of functions with whenNotPaused modifier
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the contract (admin only)
     * @dev Allows execution of functions with whenNotPaused modifier
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency function to recover stuck ETH (admin only)
     * @param to Address to send ETH to
     * @param amount Amount of ETH to send
     */
    function recoverETH(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount > address(this).balance) revert InsufficientETHBalance();

        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Emergency function to recover stuck ERC20 tokens (admin only)
     * @param token Token address to recover
     * @param to Address to send tokens to
     * @param amount Amount of tokens to send
     */
    function recoverERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();

        bool success = IERC20(token).transfer(to, amount);
        if (!success) revert TransferFailed();
    }

    function setEthAmountPercentToLP(
        uint16 _ethAmountPercentToLP
    ) external onlyOwner {
        require(
            _ethAmountPercentToLP > 0 && _ethAmountPercentToLP <= 10000,
            "Invalid percent"
        );
        ethAmountPercentToLP = _ethAmountPercentToLP;
    }

    function setTokenAmountPercentToLP(
        uint16 _tokenAmountPercentToLP
    ) external onlyOwner {
        require(
            _tokenAmountPercentToLP > 0 && _tokenAmountPercentToLP <= 10000,
            "Invalid percent"
        );
        tokenAmountPercentToLP = _tokenAmountPercentToLP;
    }

    function setAuthorizedCaller(
        address caller,
        bool authorized
    ) external onlyOwner {
        require(caller != address(0), "Zero address");
        authorizedCallers[caller] = authorized;
    }
}
