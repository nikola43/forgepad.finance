// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/Fyuz.sol";

/// @notice Upgrades the live BSC-testnet Fyuz proxy to the new protocol-fee split
///         (_payPlatformFee now splits the platform fee 3:1) and wires the config:
///         per buy/sell, 1% total = 0.6% treasury + 0.2% leaderboard + 0.2% creator.
///
///         Pure logic upgrade — no storage layout change, so the proxy keeps all
///         state (pools, balances, the existing token). Run:
///           PRIVATE_KEY=0x... forge script script/UpgradeFeesBscTestnet.s.sol \
///             --rpc-url bsc_testnet --broadcast
contract UpgradeFeesBscTestnet is Script {
    address constant FYUZ_PROXY = 0x24FEBdCc41C804873dbBfE703cD9D2D4b771C236;
    // feeAddress = treasury (0.6%), distributorAddress = leaderboard (0.2%).
    address constant TREASURY = 0xFD84d752ca76C0C74EF13902ed388f2f9530E8B1;
    address constant LEADERBOARD = 0x180b9B92da14818A82503b93BAa35B942BD63447;
    uint256 constant PLATFORM_FEE_BPS = 80; // 0.6% treasury + 0.2% leaderboard
    uint256 constant CREATOR_FEE_BPS = 20; // 0.2% token creator

    function _adminOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT))));
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        address caller = vm.addr(pk);

        Fyuz fyuz = Fyuz(payable(FYUZ_PROXY));
        ProxyAdmin admin = ProxyAdmin(_adminOf(FYUZ_PROXY));

        console.log("Caller     :", caller);
        console.log("Proxy      :", FYUZ_PROXY);
        console.log("ProxyAdmin :", address(admin));
        console.log("Admin owner:", admin.owner());
        console.log("Fyuz owner :", fyuz.owner());
        require(admin.owner() == caller, "caller is not ProxyAdmin owner");
        require(fyuz.owner() == caller, "caller is not Fyuz owner");

        vm.startBroadcast(pk);

        // 1. Deploy the new implementation (bare/uninitialized; the proxy keeps
        //    its own state — no initialize is run on upgrade).
        Fyuz newImpl = new Fyuz();
        console.log("New impl   :", address(newImpl));

        // 2. Point the proxy at the new implementation. Empty calldata = no re-init.
        admin.upgradeAndCall(
            ITransparentUpgradeableProxy(FYUZ_PROXY),
            address(newImpl),
            ""
        );

        // 3. Wire the fee split on the (now upgraded) proxy.
        fyuz.setFeeAddress(TREASURY);
        fyuz.setDistributorAddress(LEADERBOARD);
        fyuz.setPlatformBuyFeeBps(PLATFORM_FEE_BPS);
        fyuz.setPlatformSellFeeBps(PLATFORM_FEE_BPS);
        fyuz.setTokenOwnerFeeBps(CREATOR_FEE_BPS);

        vm.stopBroadcast();

        console.log("");
        console.log("=== FEE CONFIG AFTER UPGRADE ===");
        console.log("treasury    (0.6%):", fyuz.feeAddress());
        console.log("leaderboard (0.2%):", fyuz.distributorAddress());
        console.log("platform buy  bps :", fyuz.PLATFORM_BUY_FEE_BPS());
        console.log("platform sell bps :", fyuz.PLATFORM_SELL_FEE_BPS());
        console.log("creator       bps :", fyuz.TOKEN_OWNER_FEE_BPS());
    }
}
