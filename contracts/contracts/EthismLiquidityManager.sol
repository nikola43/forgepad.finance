// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {IUniswapV2Factory} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import {INonfungiblePositionManager} from "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import "./v4-core/interfaces/IHooks.sol";
import "./v4-core/types/Currency.sol";
import "./v4-core//interfaces/IPoolManager.sol";
import "./v4-core/libraries/LiquidityAmounts.sol";
import "./v4-core/libraries/TickMath.sol";
import "./v4-core/libraries/Actions.sol";
import "./v4-periphery/interfaces/IPositionManager.sol";
import "./permit2/interfaces/IPermit2.sol";

/**
 * @title EthismLiquidityManager
 * @author Ethism Protocol
 * @notice A comprehensive liquidity management contract supporting Uniswap V2, V3, and V4
 * @dev This contract allows users to add liquidity to different versions of Uniswap protocols
 *      while maintaining security through reentrancy protection
 */
contract EthismLiquidityManager is
    ReentrancyGuard,
    Ownable,
    Pausable,
    IERC721Receiver
{
    using CurrencyLibrary for Currency;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    int24 private constant MIN_TICK = -887272;
    int24 private constant MAX_TICK = 887272;

    /// @dev Tick spacing for pool positions
    int24 private constant TICK_SPACING = 60;

    /// @dev Default pool fee (0.3%)
    uint24 private constant POOL_FEE = 3000;

    /// @dev Default deadline buffer for transactions
    uint256 private constant DEADLINE_BUFFER = 10 minutes;

    /// @dev Q96 for calculations
    uint256 internal constant Q96 = 0x1000000000000000000000000;

    /*//////////////////////////////////////////////////////////////
                            STATE VARIABLES
    //////////////////////////////////////////////////////////////*/

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

    address public marginRecipient;

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

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Initializes the contract with Uniswap protocol addresses
     * @param _routerV2 Uniswap V2 router address
     * @param _routerV3 Uniswap V3 position manager address
     * @param _poolV4Manager Uniswap V4 pool manager address
     * @param _universalRouter Universal router address for V4 operations
     * @param _positionManager Position manager for V4 operations
     * @param _permit2 Permit2 contract address for token approvals
     * @param _marginRecipient Recipient address for margin ETH after adding liquidity
     * @param _owner Initial owner of the contract
     */
    constructor(
        address _routerV2,
        address _routerV3,
        address _poolV4Manager,
        address _universalRouter,
        address _positionManager,
        address _permit2,
        address _marginRecipient,
        address _owner
    ) Ownable(_owner) {
        if (_routerV2 == address(0)) revert ZeroAddress();
        if (_routerV3 == address(0)) revert ZeroAddress();
        if (_poolV4Manager == address(0)) revert ZeroAddress();
        if (_universalRouter == address(0)) revert ZeroAddress();
        if (_positionManager == address(0)) revert ZeroAddress();
        if (_marginRecipient == address(0)) revert ZeroAddress();

        routerV2 = IUniswapV2Router02(_routerV2);
        nonfungiblePositionManager = INonfungiblePositionManager(_routerV3);
        factoryV3 = IUniswapV3Factory(nonfungiblePositionManager.factory());
        poolV4Manager = IPoolManager(_poolV4Manager);
        universalRouter = _universalRouter;
        positionManager = IPositionManager(_positionManager);
        permit2 = IPermit2(_permit2);
        marginRecipient = _marginRecipient;
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

        // Add liquidity
        routerV2.addLiquidityETH{value: ethAmount}(
            token,
            tokenAmount,
            0, // Accept any amount of tokens
            0, // Accept any amount of ETH
            recipient,
            block.timestamp + DEADLINE_BUFFER
        );

        // Get pair address
        pairAddress = IUniswapV2Factory(routerV2.factory()).getPair(
            token,
            routerV2.WETH()
        );

        emit LiquidityAddedV2(
            token,
            tokenAmount,
            ethAmount,
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
     * @param recipient Address to receive the position NFT
     * @return tokenId The ID of the minted NFT position
     * @return liquidity The amount of liquidity added
     * @return amount0 The amount of token0 actually used
     * @return amount1 The amount of token1 actually used
     */
    function addLiquidityV3(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address recipient
    )
        external
        payable
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

        uint256 amount0Desired = tokenAmount;
        uint256 amount1Desired = ethAmount;

        if (token0Address > token1Address) {
            (token0Address, token1Address) = (token1Address, token0Address);
            amount0Desired = ethAmount;
            amount1Desired = tokenAmount;
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
                amount0Min: 0,
                amount1Min: 0,
                recipient: recipient,
                deadline: block.timestamp + 10 minutes
            });

        (tokenId, liquidity, amount0, amount1) = nonfungiblePositionManager
            .mint(params);

        if (IERC20(token).balanceOf(address(this)) > 0) {
            IERC20(token).transfer(address(0xdead), IERC20(token).balanceOf(address(this)));
        }
        
        uint256 wad = IWETH(routerV2.WETH()).balanceOf(address(this));
        if (wad > 0) {
            IWETH(routerV2.WETH()).withdraw(wad);
            (bool success, ) = address(marginRecipient).call{value: wad}("");
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
     * @param recipient Address to receive the liquidity position
     */
    function addLiquidityV4(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address recipient
    )
        external
        payable
        nonReentrant
        whenNotPaused
        validAmounts(tokenAmount, ethAmount)
        notZeroAddress(token)
        notZeroAddress(recipient)
    {
        _validateTokenTransfer(token, tokenAmount);
        _validateETHBalance(ethAmount);

        // Transfer tokens from caller
        _transferTokensFrom(token, tokenAmount);

        address token0Address = token;
        address token1Address = routerV2.WETH();

        uint256 amount0Desired = tokenAmount;
        uint256 amount1Desired = ethAmount;

        if (token0Address > token1Address) {
            (token0Address, token1Address) = (token1Address, token0Address);
            amount0Desired = ethAmount;
            amount1Desired = tokenAmount;
        }

        // address token0Address = token;
        // address token1Address = routerV2.WETH();
        // uint256 token0Amount = tokenAmount;
        // uint256 token1Amount = ethAmount;

        // // Sort tokens (V4 requirement: token0 < token1)
        // if (token0Address > token1Address) {
        //     (token0Address, token1Address) = (token1Address, token0Address);
        //     (token0Amount, token1Amount) = (token1Amount, token0Amount);
        // }

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

        (int24 tickLower, int24 tickUpper) = getFullRangeTicks(POOL_FEE);

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
                recipient,
                hookData
            );

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

        // // If the pool is an ETH pair, native tokens are to be transferred
        // uint256 valueToPass = Currency
        //     .wrap(address(token0Address))
        //     .isAddressZero()
        //     ? amount0Desired + 1
        //     : 0;

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

        if (IERC20(token).balanceOf(address(this)) > 0) {
            IERC20(token).transfer(address(0xdead), IERC20(token).balanceOf(address(this)));
        }

        uint256 wad = IWETH(routerV2.WETH()).balanceOf(address(this));
        if (wad > 0) {
            IWETH(routerV2.WETH()).withdraw(wad);
            (bool success, ) = address(marginRecipient).call{value: wad}("");
        }
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
        int24 tickSpacing = getTickSpacing(fee);

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
        sqrtPriceX96 = uint160((sqrtPrice * Q96) / 1e18);
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
            IUniswapV3Pool(pool).initialize(sqrtPriceX96);

            emit PoolCreatedV3(token, weth, fee, pool);
        }
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

    function _mintLiquidityParams(
        PoolKey memory poolKey,
        int24 _tickLower,
        int24 _tickUpper,
        uint256 liquidity,
        uint256 amount0Max,
        uint256 amount1Max,
        address recipient,
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
            recipient,
            hookData
        );
        params[1] = abi.encode(poolKey.currency0, poolKey.currency1);
        params[2] = abi.encode(poolKey.currency0, recipient);
        params[3] = abi.encode(poolKey.currency1, recipient);

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
}
