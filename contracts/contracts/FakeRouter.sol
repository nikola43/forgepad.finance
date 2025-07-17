import "./interfaces/INineInchRouter02.sol";
import "hardhat/console.sol";

contract FakeRouter is INineInchRouter02 {
    address _WETH = address(0xA1077a294dDE1B09bB078844df40758a5D0f9a27);
    mapping(address => mapping(address => uint256[])) public reserves;

    function factory() external view returns (address) {
        return address(this);
    }

    function WETH() external view returns (address) {
        return _WETH;
    }
    function WPLS() external view returns (address) {
        return _WETH;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity) {
        amountA = 0;
        amountB = 0;
        liquidity = 0;
    }

    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable returns (uint amountToken, uint amountETH, uint liquidity) {
        amountToken = amountTokenDesired;
        amountETH = msg.value;
        liquidity = 0;
        uint256[] memory _reserve = new uint256[](2);
        _reserve[0] = amountToken;
        _reserve[1] = amountETH;
        reserves[token][_WETH] = _reserve;
        _reserve[0] = amountETH;
        _reserve[1] = amountToken;
        reserves[_WETH][token] = _reserve;
        console.log("Add Liquidity", msg.value, amountTokenDesired);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB) {
        amountA = 0;
        amountB = 0;
    }

    function removeLiquidityETH(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external returns (uint amountToken, uint amountETH) {
        amountToken = 0;
        amountETH = 0;
    }

    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint amountA, uint amountB) {
        amountA = 0;
        amountB = 0;
    }

    function removeLiquidityETHWithPermit(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint amountToken, uint amountETH) {
        amountToken = 0;
        amountETH = 0;
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        amounts = new uint[](0);
    }

    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        amounts = new uint[](0);
    }

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts) {
        amounts = new uint[](0);
    }

    function swapTokensForExactETH(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        amounts = new uint[](0);
    }

    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts) {
        amounts = new uint[](0);
    }

    function swapETHForExactTokens(
        uint amountOut,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts) {
        amounts = new uint[](0);
    }

    function quote(
        uint amountA,
        uint reserveA,
        uint reserveB
    ) external pure returns (uint amountB) {
        amountB = 0;
    }

    function getAmountOut(
        uint amountIn,
        uint reserveIn,
        uint reserveOut
    ) external pure returns (uint amountOut) {
        amountOut = 0;
    }

    function getAmountIn(
        uint amountOut,
        uint reserveIn,
        uint reserveOut
    ) external pure returns (uint amountIn) {
        amountIn = 0;
    }

    function getAmountsOut(
        uint amountIn,
        address[] calldata path
    ) external view returns (uint[] memory amounts) {
        uint256[] memory reserve = reserves[path[0]][path[1]];
        uint amountInWithFee = amountIn * 997;
        uint numerator = amountInWithFee * reserve[1];
        uint denominator = reserve[0] * 1000 + amountInWithFee;
        amounts = new uint[](2);
        amounts[0] = amountIn;
        amounts[1] = numerator / denominator;
    }

    function getAmountsIn(
        uint amountOut,
        address[] calldata path
    ) external view returns (uint[] memory amounts) {
        uint256[] memory reserve = reserves[path[0]][path[1]];
        uint numerator = reserve[0] * amountOut * 1000;
        uint denominator = (reserve[1] - amountOut) * 997;
        amounts = new uint[](2);
        amounts[0] = (numerator / denominator) + 1;
        amounts[1] = amountOut;
    }

    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external returns (uint amountETH) {
        amountETH = 0;
    }

    function removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint amountETH) {
        amountETH = 0;
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external {}

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable {}

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external {}

    function getPair(address tokenA, address tokenB) public view returns (address) {
        return address(uint160(tokenA) ^ uint160(tokenB));
    }
}