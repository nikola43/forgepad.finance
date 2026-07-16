// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

interface IFyuzLiquidityManager {
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

    /// @param dustRecipient Receives leftover dust only. The LP position itself is
    ///        locked in the manager forever so its trading fees stay claimable.
    function addLiquidityV3(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address dustRecipient
    )
        external
        payable
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        );

    /// @param dustRecipient Receives leftover dust only. The LP position itself is
    ///        locked in the manager forever so its trading fees stay claimable.
    function addLiquidityV4(
        address token,
        uint256 tokenAmount,
        uint256 ethAmount,
        address dustRecipient
    ) external payable;

    /// @notice Seeds a V4 pool with tokens only (no ETH) for direct launches.
    /// @param ethAmountForPrice Notional only — never transferred; sets opening price.
    /// @param dustRecipient Receives leftover dust only; the position is locked.
    function addLiquidityV4SingleSided(
        address token,
        uint256 tokenAmount,
        uint256 ethAmountForPrice,
        address dustRecipient
    ) external;

    function collectFees(
        address token,
        address creator,
        address platform
    ) external returns (uint256 ethFees, uint256 tokenFees);

    function v3PositionOf(address token) external view returns (uint256);

    function v4PositionOf(address token) external view returns (uint256);
}
