// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from
    "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "forge-std/Script.sol";
import "forge-std/console.sol";
import {Fyuz} from "../src/Fyuz.sol";
import {FyuzLiquidityManager} from "../src/FyuzLiquidityManager.sol";

/// @notice Upgrades the live BSC-mainnet Fyuz + FyuzLiquidityManager proxies to the
///         audit-fix build. These hold REAL user funds (bonding-curve BNB and locked
///         V3 positions), so every invariant is asserted before and after.
///
///         Fixes carried by these implementations:
///           MEDIUM  graduation price manipulation via a pre-seeded V2 pair. The V2
///                   target-mcap mint sized the token side off the pair's WETH only,
///                   on the premise that the pre-launch transfer gate made token-side
///                   donations impossible. It does not: Token._transferAllowed permits
///                   sends to any address with no code yet, and a V2 pair address is
///                   CREATE2-derived, so tokens can be parked at the future pair before
///                   it exists. The pair's TOTAL token balance sets the opening price,
///                   so a donation opened the pool BELOW target and bled the burned LP
///                   to arbitrage. Now credits the pair's existing token balance against
///                   the target — and deliberately does NOT revert when a donation
///                   already covers it, because reverting would brick graduation
///                   permanently, which is what this direct-mint path exists to avoid.
///           MEDIUM  collectFees was unrecoverably freezable. _sendETH reverted on a
///                   failed send, so a creator contract that rejects ETH took the whole
///                   collect down — including the platform's 50% — leaving the fees
///                   stuck inside the Uniswap position with no path to them (the revert
///                   preceded any ETH landing, so recoverETH could not help). Now
///                   reroutes the creator's half to the platform and never reverts.
///           MEDIUM  the creator fee was sent with the FULL gas frame. A creator
///                   contract could burn it; with the 1/64 rule leaving the outer frame
///                   only gasleft()/64, a normally-funded trade then died of OOG. That
///                   is a honeypot: the creator can grief sells of its own token while
///                   buys still work. Creator sends are now capped at 30k gas
///                   (owner-configured recipients keep the full frame on purpose).
///
/// @dev Pure implementation swap, ONE transaction each, NO initializer: this build
///      adds no storage. Verified two ways — the diff declares no new state
///      variables and every __gap is unchanged, and every live slot on both proxies
///      was compared against `forge inspect storage-layout` and matched.
///
///      Run:
///        PRIVATE_KEY=0x... forge script \
///          script/UpgradeFyuzSecurityFixBsc.s.sol \
///          --rpc-url https://bsc-dataseed.bnbchain.org --broadcast
contract UpgradeFyuzSecurityFixBsc is Script {
    address constant FYUZ_PROXY = 0x33A98BeF6496684a8daC83734D9CEB0CEFC7019c;
    address constant LM_PROXY = 0x5220da0B1A778C0D414f082A5ea3670b70D59b00;

    function _adminOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT))));
    }

    function _implOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.IMPLEMENTATION_SLOT))));
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        require(pk != 0, "Set PRIVATE_KEY env var");
        require(block.chainid == 56, "This script targets BSC mainnet (56)");
        address caller = vm.addr(pk);

        Fyuz fyuz = Fyuz(payable(FYUZ_PROXY));
        FyuzLiquidityManager lm = FyuzLiquidityManager(payable(LM_PROXY));
        ProxyAdmin fyuzAdmin = ProxyAdmin(_adminOf(FYUZ_PROXY));
        ProxyAdmin lmAdmin = ProxyAdmin(_adminOf(LM_PROXY));

        require(fyuzAdmin.owner() == caller, "caller does not own the Fyuz ProxyAdmin");
        require(lmAdmin.owner() == caller, "caller does not own the LM ProxyAdmin");

        // ---- snapshot the live state the upgrade must not disturb -----------
        uint256 tokenCountBefore = fyuz.tokenCount();
        uint256 curveEthBefore = fyuz.totalCurveEthReserve();
        address lmBefore = address(fyuz.liquidityManager());
        address feeAddrBefore = fyuz.feeAddress();
        address distAddrBefore = fyuz.distributorAddress();
        uint256 buyFeeBefore = fyuz.PLATFORM_BUY_FEE_BPS();
        uint256 sellFeeBefore = fyuz.PLATFORM_SELL_FEE_BPS();
        uint256 treasuryShareBefore = fyuz.platformTreasuryShareBps();
        uint256 fyuzBalBefore = FYUZ_PROXY.balance;
        address routerBefore = address(lm.routerV2());
        bool authBefore = lm.authorizedCallers(FYUZ_PROXY);

        console.log("Caller        :", caller);
        console.log("Fyuz proxy    :", FYUZ_PROXY);
        console.log("  old impl    :", _implOf(FYUZ_PROXY));
        console.log("  tokenCount  :", tokenCountBefore);
        console.log("  curveEth    :", curveEthBefore);
        console.log("  balance     :", fyuzBalBefore);
        console.log("LM proxy      :", LM_PROXY);
        console.log("  old impl    :", _implOf(LM_PROXY));

        vm.startBroadcast(pk);
        Fyuz fyuzImpl = new Fyuz();
        FyuzLiquidityManager lmImpl = new FyuzLiquidityManager();
        console.log("new Fyuz impl :", address(fyuzImpl));
        console.log("new LM impl   :", address(lmImpl));
        fyuzAdmin.upgradeAndCall(ITransparentUpgradeableProxy(FYUZ_PROXY), address(fyuzImpl), "");
        lmAdmin.upgradeAndCall(ITransparentUpgradeableProxy(LM_PROXY), address(lmImpl), "");
        vm.stopBroadcast();

        // ---- prove the live state survived ----------------------------------
        require(_implOf(FYUZ_PROXY) == address(fyuzImpl), "Fyuz impl did not change");
        require(_implOf(LM_PROXY) == address(lmImpl), "LM impl did not change");
        require(fyuz.tokenCount() == tokenCountBefore, "tokenCount moved");
        require(fyuz.totalCurveEthReserve() == curveEthBefore, "curve reserve moved");
        require(address(fyuz.liquidityManager()) == lmBefore, "liquidityManager moved");
        require(fyuz.feeAddress() == feeAddrBefore, "feeAddress moved");
        require(fyuz.distributorAddress() == distAddrBefore, "distributorAddress moved");
        require(fyuz.PLATFORM_BUY_FEE_BPS() == buyFeeBefore, "buy fee moved");
        require(fyuz.PLATFORM_SELL_FEE_BPS() == sellFeeBefore, "sell fee moved");
        require(fyuz.platformTreasuryShareBps() == treasuryShareBefore, "treasury share moved");
        require(FYUZ_PROXY.balance == fyuzBalBefore, "Fyuz balance moved");
        require(fyuz.owner() == caller, "Fyuz ownership moved");
        require(address(lm.routerV2()) == routerBefore, "LM router moved");
        require(lm.authorizedCallers(FYUZ_PROXY) == authBefore, "LM authorization moved");
        require(lm.owner() == caller, "LM ownership moved");
        // The curve BNB must still be fully backed, or a withdrawal path opened up.
        require(fyuz.withdrawableEth() == fyuzBalBefore - curveEthBefore, "withdrawable drifted");

        console.log("--- after ---");
        console.log("Fyuz impl     :", _implOf(FYUZ_PROXY));
        console.log("LM impl       :", _implOf(LM_PROXY));
        console.log("tokenCount    :", fyuz.tokenCount());
        console.log("curveEth      :", fyuz.totalCurveEthReserve());
        console.log("withdrawable  :", fyuz.withdrawableEth());
        console.log("");
        console.log("State preserved. Graduation, collectFees and creator-fee fixes are live.");
    }
}
