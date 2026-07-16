// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

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