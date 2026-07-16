// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {Fyuz, IFyuz} from "../src/Fyuz.sol";
import {FyuzLiquidityManager} from "../src/FyuzLiquidityManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FyuzDeploy} from "../src/FyuzDeploy.sol";

/// @notice Repro: does the last buyer before graduation lose ETH when their
///         requested buyAmount exceeds the remaining curve capacity (the
///         _getMaxBuyForReserve cap)? Measures ETH paid vs. tokens received,
///         and ETH left stranded in the contract beyond accounted reserves.
contract OverchargeReproTest is Test {
    Fyuz fyuz;
    FyuzLiquidityManager lm;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address buyer;

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("FORK_URL", string("https://ethereum-rpc.publicnode.com"))
        );
        address V2_ROUTER = vm.envOr("V2_ROUTER", 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
        address V3_FACTORY = vm.envOr("V3_FACTORY", 0x1F98431c8aD98523631AE4a59f267346ea31F984);
        address V3_POS = vm.envOr("V3_POS_MGR", 0xC36442b4a4522E871399CD717aBDD847Ab11FE88);
        address V4_MGR = vm.envOr("V4_POOL_MGR", 0x000000000004444c5dc75cB358380D2e3dE08A90);
        address UNIV = vm.envOr("UNIVERSAL_ROUTER", 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af);
        address V4_POS = vm.envOr("V4_POS_MGR", 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e);
        address DATA_FEED = vm.envOr("DATA_FEED", 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419);

        lm = FyuzDeploy.deployLiquidityManager(
            V2_ROUTER, V3_FACTORY, V3_POS, V4_MGR, UNIV, V4_POS, PERMIT2,
            address(this), address(this), 10000, 10000,
            address(this)
        );
        fyuz = FyuzDeploy.deployFyuz(
            DATA_FEED, address(lm), address(0xFEE), address(0xD1),
            address(this)
        );
        lm.setAuthorizedCaller(address(fyuz), true);
        // See ClaimFees.t.sol: Robinhood's feed heartbeat exceeds the 1h default,
        // which would stall graduation and make this scenario untestable there.
        fyuz.setPriceStalenessThreshold(86400);

        buyer = makeAddr("buyer");
        vm.deal(buyer, 100_000 ether);
        vm.deal(address(this), 10 ether);
    }

    function _launched(address t) internal view returns (bool l) {
        (, , , , , , , l) = fyuz.tokenPools(t);
    }
    function _vEth(address t) internal view returns (uint256 v) {
        (, , v, , , , , ) = fyuz.tokenPools(t);
    }

    function test_LastBuyerNotOvercharged() public {
        address t = fyuz.createToken{value: 0.001 ether}(
            "Over", "OVR", 0, 0, 0, 1, block.timestamp
        );

        // Approach graduation with fine steps so we stop JUST below the target
        // mcap (not overshoot). Near graduation the reserve cap (~4 ETH) is
        // tighter than MAX_BUY (~vEth), so a single vEth-sized buy will be capped.
        uint256 target = fyuz.TARGET_MARKET_CAP_USD();
        for (uint256 i = 0; i < 5000; i++) {
            if (_launched(t)) revert("graduated too early - tighten loop");
            uint256 mcap = fyuz.getTokenVirtualMarketCap(t);
            if (mcap >= (target * 92) / 100) break; // ~92% of target, pre-graduation
            vm.prank(buyer);
            fyuz.swapExactETHForTokens{value: 0.2 ether}(t, 0.2 ether, 0, block.timestamp);
        }
        require(!_launched(t), "already launched before final buy");

        // Final buyer requests the MAX allowed (vEth). If the reserve cap bites,
        // the effective buy is smaller but the excess ETH must still be refunded.
        uint256 request = _vEth(t); // == MAX_BUY (MAX_BUY_PERCENT=100%)
        uint256 ethBefore = buyer.balance;
        uint256 tokBefore = IERC20(t).balanceOf(buyer);

        vm.prank(buyer);
        fyuz.swapExactETHForTokens{value: request}(t, request, 0, block.timestamp);

        uint256 ethSpent = ethBefore - buyer.balance;
        uint256 tokGot = IERC20(t).balanceOf(buyer) - tokBefore;

        console.log("requested buyAmount (=vEth):", request);
        console.log("ETH actually spent by buyer: ", ethSpent);
        console.log("tokens received:             ", tokGot / 1e18);
        console.log("launched now:                ", _launched(t) ? 1 : 0);
        console.log("fyuz ETH balance after:  ", address(fyuz).balance);

        // Sanity: this buy must have hit the reserve cap (else the scenario didn't
        // trigger). We detect it by the token graduating on this buy.
        assertTrue(_launched(t), "final buy did not graduate - scenario not exercised");

        // THE BUG: buyer sent `request` ETH but only `effective` was priced; the
        // capped-away ETH should be refunded. If it isn't, ethSpent == request.
        assertLt(ethSpent, request, "BUG: buyer charged full request despite reserve cap (ETH stranded)");
    }

    receive() external payable {}
}
