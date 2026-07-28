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

    /// @dev Who may move tokens while the token is still on the bonding curve.
    ///
    /// The restriction exists to stop a token being listed on a DEX before it
    /// graduates — a parallel market would break price discovery on the curve and
    /// let holders exit around it. It was never meant to stop one person paying
    /// another, but that is what it did: the only permitted counterparty was the
    /// curve itself, so every wallet-to-wallet transfer reverted with NotLaunched.
    ///
    /// Wallets are now free to move tokens between themselves; only sends to
    /// CONTRACTS stay blocked, since a DEX pair, router or liquidity manager is
    /// always a contract.
    ///
    /// LIMIT, stated plainly: `to.code.length == 0` is not proof of an EOA. An
    /// address has no code before it is deployed, and V2-style pair addresses are
    /// CREATE2-derived and therefore known in advance — so tokens can be sent to a
    /// pair address first and the pair deployed at it afterwards. It also reads 0
    /// for a contract still inside its own constructor. This raises the cost of
    /// pre-graduation listing; it does not make it impossible.
    function _transferAllowed(
        address from,
        address to
    ) private view returns (bool) {
        if (launched) return true;
        address curve = owner();
        if (from == curve || to == curve) return true;
        return to.code.length == 0;
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