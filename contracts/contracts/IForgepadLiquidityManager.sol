// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

interface IForgepadLiquidityManager {
    function getAmountsOut(
        uint amountIn,
        address[] memory path
    ) external view returns (uint[] memory amounts);

    function WETH() external view returns (address);

    function getRouterV2() external view returns (address);

    function addLiquidityV2(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address recipient
    ) external payable returns (address);

    function addLiquidityV2WithTargetMarketCap(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address recipient,
        uint256 targetMarketCap,
        uint256 ethPriceUSD
    ) external payable returns (address);

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
        );

    function addLiquidityV4(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address recipient
    ) external payable;
}
