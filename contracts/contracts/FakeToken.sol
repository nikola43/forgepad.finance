// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/ILaunchable.sol";

contract FakeToken is ERC20 {
    uint8 private _decimals = 18;

    constructor(
        string memory name,
        string memory symbol,
        uint8 precision,
        uint256 supply,
        address to
    ) ERC20(name, symbol) {
        _decimals = precision;
        _mint(to, supply * 10 ** precision);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}
