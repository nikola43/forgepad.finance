//  ██████ ██████  ███████  █████  ████████ ███████ ██████       ██████  ███    ██     ███████ ██    ██ ██    ██ ███████    ███████ ██    ██ ███    ██ 
// ██      ██   ██ ██      ██   ██    ██    ██      ██   ██     ██    ██ ████   ██     ██       ██  ██  ██    ██    ███     ██      ██    ██ ████   ██ 
// ██      ██████  █████   ███████    ██    █████   ██   ██     ██    ██ ██ ██  ██     █████     ████   ██    ██   ███      █████   ██    ██ ██ ██  ██ 
// ██      ██   ██ ██      ██   ██    ██    ██      ██   ██     ██    ██ ██  ██ ██     ██         ██    ██    ██  ███       ██      ██    ██ ██  ██ ██ 
//  ██████ ██   ██ ███████ ██   ██    ██    ███████ ██████       ██████  ██   ████     ██         ██     ██████  ███████ ██ ██       ██████  ██   ████ 
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ILaunchable {
    function launch() external;
}

contract Token is ERC20, Ownable, ILaunchable {

    // Custom errors (one per former require/revert string).
    error AlreadyLaunched(); // was: "contract already launched"
    error NotLaunched(); // was: "This token is not launched and cannot be listed on dexes yet."
    error TransferFromFailed(); // was: "transferFrom failed"
    bool public launched;
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        _mint(msg.sender, _totalSupply);
    }

    function launch() external onlyOwner {
        if (launched != false) revert AlreadyLaunched();
        launched = true;
        renounceOwnership();
    }

    function _transferAllowed(
        address from,
        address to
    ) private view returns (bool) {
        if (launched) return true;
        if (from == owner() || to == owner()) return true;
        return false;
    }

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) public override returns (bool) {
        bool isTransferAllowed = _transferAllowed(from, to);
        if (!isTransferAllowed) revert NotLaunched();
        if (!(super.transferFrom(from, to, value))) revert TransferFromFailed();
        return true;
    }

    function transfer(
        address to,
        uint256 value
    ) public virtual override returns (bool) {
        if (!(_transferAllowed(msg.sender, to))) revert NotLaunched();
        super._transfer(msg.sender, to, value);
        return true;
    }
}