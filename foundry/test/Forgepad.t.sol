// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {Forgepad, IForgepad} from "../src/Forgepad.sol";
import {ForgepadLiquidityManager} from "../src/ForgepadLiquidityManager.sol";
import {Token} from "../src/Token.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IUniswapV2Router02
} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {
    IUniswapV2Factory
} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {
    IUniswapV2Pair
} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

contract ForgepadTest is Test {
    Forgepad public forgepad;
    ForgepadLiquidityManager public liquidityManager;
    IForgepad public iForgepad; // interface view for struct returns

    address public addr1;
    address public addr2;
    address public addr3;

    // address constant PANCAKE_V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    // address constant V3_POS_MGR = 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364;
    // address constant V4_POOL_MGR = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    // address constant UNIVERSAL_ROUTER = 0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB;
    // address constant V4_POS_MGR = 0x7C5f5A4bBd8fD63184577525326123B519429bDc;
    // address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    // address constant DATA_FEED = 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE;
    // address constant FEE_WALLET = 0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103;
    // address constant DIST_ADDR = 0xF2917a81fF74406fbCf01c507057e101Db8f2F12;

    // Ethereum Mainnet (Uniswap)

    address constant UNISWAP_V2_ROUTER =
        0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address constant V3_POS_MGR = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
    address constant V4_POOL_MGR = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant UNIVERSAL_ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;
    address constant V4_POS_MGR = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Chainlink ETH/USD on Ethereum
    address constant DATA_FEED = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;

    // Your same custom addresses (unchanged)
    address constant FEE_WALLET = 0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103;
    address constant DIST_ADDR = 0xF2917a81fF74406fbCf01c507057e101Db8f2F12;

    function setUp() public {
        vm.createSelectFork("https://ethereum-rpc.publicnode.com");

        addr1 = makeAddr("addr1");
        addr2 = makeAddr("addr2");
        addr3 = makeAddr("addr3");

        vm.deal(address(this), 100000 ether);
        vm.deal(addr1, 100000 ether);
        vm.deal(addr2, 100000 ether);
        vm.deal(addr3, 100000 ether);

        liquidityManager = new ForgepadLiquidityManager(
            UNISWAP_V2_ROUTER,
            V3_POS_MGR,
            V4_POOL_MGR,
            UNIVERSAL_ROUTER,
            V4_POS_MGR,
            PERMIT2_ADDR,
            address(this),
            address(this),
            10000,
            10000
        );

        forgepad = new Forgepad(
            DATA_FEED,
            address(liquidityManager),
            FEE_WALLET,
            DIST_ADDR
        );
        iForgepad = IForgepad(address(forgepad));

        liquidityManager.setAuthorizedCaller(address(forgepad), true);
        forgepad.setPlatformBuyFeePercent(3);
        forgepad.setPlatformSellFeePercent(3);
        forgepad.setMaxBuyPercent(300);
        forgepad.setMaxSellPercent(300);
    }

    // ---- Helper: create token and return address via event ----
    function _create(
        string memory name,
        string memory sym,
        uint8 pt
    ) internal returns (address) {
        vm.recordLogs();
        forgepad.createToken{value: 0.001 ether}(name, sym, 0, 0, 0, pt);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        // TokenCreated(address token, uint256 tokenPrice, uint256 ethPriceUSD, uint32 sig, uint256 date)
        bytes32 tcSig = keccak256(
            "TokenCreated(address,uint256,uint256,uint32,uint256)"
        );
        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == tcSig) {
                // token address is the first field in data (non-indexed)
                (address tokenAddr, , , , ) = abi.decode(
                    logs[i].data,
                    (address, uint256, uint256, uint32, uint256)
                );
                return tokenAddr;
            }
        }
        revert("TokenCreated not found");
    }

    // ---- Helper: get pool via interface (returns struct) ----
    function _pool(
        address t
    ) internal view returns (IForgepad.PoolInfo memory) {
        return iForgepad.tokenPools(t);
    }

    // ============================================================
    // 1. Token Creation
    // ============================================================
    function test_01_CreateToken() public {
        address t = _create("TestToken", "TEST", 1);
        assertTrue(t != address(0));

        IForgepad.PoolInfo memory p = _pool(t);
        console.log("Token:", t);
        console.log("Virtual ETH Reserve:", p.virtualEthReserve);
        console.log("Virtual Token Reserve:", p.virtualTokenReserve);
        assertTrue(p.virtualEthReserve > 0, "vETH > 0");
        assertTrue(p.virtualTokenReserve > 0, "vToken > 0");
        assertFalse(p.launched);
    }

    // ============================================================
    // 2. Buy on Bonding Curve
    // ============================================================
    function test_02_Buy() public {
        address t = _create("TestToken", "TEST", 1);
        uint256 fee = forgepad.getFirstBuyFee(t);
        uint256 size = 0.01 ether;

        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: size + fee}(t, size, 0);

        uint256 bal = IERC20(t).balanceOf(addr1);
        assertTrue(bal > 0, "Should have tokens");
        console.log("Tokens received:", bal);
    }

    // ============================================================
    // 2.5. Sell with Correct 3% Fee
    // ============================================================
    function test_025_SellCorrectFee() public {
        address t = _create("TestToken", "TEST", 1);

        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.0001 ether + fee}(
            t,
            0.0001 ether,
            0
        );

        IForgepad.PoolInfo memory pBefore = _pool(t);
        if (pBefore.launched) {
            return; // Skip test if token launched
        }

        uint256 balance = IERC20(t).balanceOf(addr1);
        uint256 sellAmt = balance / 10;

        vm.startPrank(addr1);
        IERC20(t).approve(address(forgepad), sellAmt);
        uint256 ethBefore = addr1.balance;
        forgepad.swapExactTokensForETH(t, sellAmt, 0);
        uint256 ethAfter = addr1.balance;
        vm.stopPrank();

        uint256 received = ethAfter - ethBefore;
        IForgepad.PoolInfo memory pAfter = _pool(t);
        uint256 gross = pBefore.ethReserve - pAfter.ethReserve;
        if (gross > 0) {
            uint256 feeTaken = gross - received;
            uint256 feeBps = (feeTaken * 10000) / gross;
            console.log("Fee bps:", feeBps, "(expected 300)");
            assertGe(feeBps, 299);
            assertLe(feeBps, 301);
        }
    }

    // ============================================================
    // 3. Hit Market Cap -> DEX Migration
    // ============================================================
    function test_03_HitMarketCap() public {
        address t = _create("TestToken", "TEST", 1);

        bool launched = false;
        for (uint i = 0; i < 500; i++) {
            uint256 fee = forgepad.getFirstBuyFee(t);
            vm.prank(addr2);
            forgepad.swapExactETHForTokens{value: 0.1 ether + fee}(
                t,
                0.1 ether,
                0
            );

            IForgepad.PoolInfo memory p = _pool(t);
            if (p.launched) {
                launched = true;
                console.log("Launched after buy:", i + 1);

                // Verify DEX pair exists
                IUniswapV2Router02 router = IUniswapV2Router02(
                    UNISWAP_V2_ROUTER
                );
                address weth = router.WETH();
                address pair = IUniswapV2Factory(router.factory()).getPair(
                    t,
                    weth
                );
                assertTrue(pair != address(0), "Pair exists");

                assertEq(p.virtualEthReserve, 0);
                assertEq(p.virtualTokenReserve, 0);

                // Sell on DEX
                uint256 tokens = IERC20(t).balanceOf(addr2);
                if (tokens > 0) {
                    vm.startPrank(addr2);
                    IERC20(t).approve(UNISWAP_V2_ROUTER, tokens);
                    address[] memory path = new address[](2);
                    path[0] = t;
                    path[1] = weth;
                    router.swapExactTokensForETHSupportingFeeOnTransferTokens(
                        tokens,
                        0,
                        path,
                        addr2,
                        block.timestamp + 600
                    );
                    vm.stopPrank();
                    console.log("DEX sell succeeded");
                }
                break;
            }
        }
        assertTrue(launched, "Should launch");
    }

    // ============================================================
    // 4. Transfer Restrictions Before Launch
    // ============================================================
    function test_04_TransferRestrictions() public {
        address t = _create("Restricted", "RTKN", 2);

        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr2);
        forgepad.swapExactETHForTokens{value: 0.00001 ether + fee}(
            t,
            0.00001 ether,
            0
        );

        uint256 bal = IERC20(t).balanceOf(addr2);
        assertTrue(bal > 0);

        IForgepad.PoolInfo memory p = _pool(t);
        if (p.launched) {
            return;
        }

        assertFalse(Token(t).launched());

        vm.prank(addr2);
        vm.expectRevert(
            "This token is not launched and cannot be listed on dexes yet."
        );
        IERC20(t).transfer(addr3, bal / 2);

        vm.startPrank(addr2);
        IERC20(t).approve(address(forgepad), bal / 4);
        forgepad.swapExactTokensForETH(t, bal / 4, 0);
        vm.stopPrank();
    }

    // ============================================================
    // 5. K-Value Preservation
    // ============================================================
    function test_05_KValue() public {
        address t = _create("Multi", "MTT", 1);

        uint256 f1 = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.0001 ether + f1}(
            t,
            0.0001 ether,
            0
        );
        uint256 b1 = IERC20(t).balanceOf(addr1);

        IForgepad.PoolInfo memory p1 = _pool(t);
        if (p1.launched) return;
        uint256 k1 = p1.virtualEthReserve * p1.virtualTokenReserve;

        uint256 f2 = forgepad.getFirstBuyFee(t);
        vm.prank(addr2);
        forgepad.swapExactETHForTokens{value: 0.0001 ether + f2}(
            t,
            0.0001 ether,
            0
        );
        uint256 b2 = IERC20(t).balanceOf(addr2);

        IForgepad.PoolInfo memory p2 = _pool(t);
        if (p2.launched) return;
        uint256 k2 = p2.virtualEthReserve * p2.virtualTokenReserve;

        if (b1 > 0) {
            vm.startPrank(addr1);
            IERC20(t).approve(address(forgepad), b1 / 100);
            forgepad.swapExactTokensForETH(t, b1 / 100, 0);
            vm.stopPrank();
        }

        IForgepad.PoolInfo memory pSells = _pool(t);
        if (pSells.launched) return;
        uint256 kSells = pSells.virtualEthReserve * pSells.virtualTokenReserve;

        assertGe(kSells, k2, "K preserved after sells");
        assertFalse(pSells.launched);
    }

    // ============================================================
    // 6. Edge Cases
    // ============================================================
    function test_06_EdgeCases() public {
        address t = _create("Edge", "EDGE", 1);

        // Zero buy
        vm.prank(addr1);
        vm.expectRevert();
        forgepad.swapExactETHForTokens{value: 0}(t, 0, 0);

        // Buy small amount to avoid launch
        uint256 fee = forgepad.getFirstBuyFee(t);
        vm.prank(addr1);
        forgepad.swapExactETHForTokens{value: 0.001 ether + fee}(
            t,
            0.001 ether,
            0
        );

        // Zero sell
        vm.startPrank(addr1);
        IERC20(t).approve(address(forgepad), type(uint256).max);
        vm.expectRevert();
        forgepad.swapExactTokensForETH(t, 0, 0);
        vm.stopPrank();

        // Non-existent pool
        vm.prank(addr1);
        vm.expectRevert("Pool does not exist");
        forgepad.swapExactETHForTokens{value: 0.001 ether}(
            address(1),
            0.001 ether,
            0
        );

        vm.prank(addr1);
        vm.expectRevert("Pool does not exist");
        forgepad.swapExactTokensForETH(address(1), 1 ether, 0);
    }

    // ============================================================
    // 7. Admin Access Control
    // ============================================================
    function test_07_AdminAccess() public {
        forgepad.setFeeAddress(addr3);
        assertEq(forgepad.feeAddress(), addr3);

        vm.prank(addr1);
        vm.expectRevert();
        forgepad.setFeeAddress(addr1);
        forgepad.setFeeAddress(FEE_WALLET);

        forgepad.setDistributorAddress(addr3);
        assertEq(forgepad.distributorAddress(), addr3);

        vm.prank(addr1);
        vm.expectRevert();
        forgepad.setDistributorAddress(addr1);
        forgepad.setDistributorAddress(DIST_ADDR);

        vm.expectRevert("Buy fee cannot exceed 10%");
        forgepad.setPlatformBuyFeePercent(11);

        vm.expectRevert("Sell fee cannot exceed 10%");
        forgepad.setPlatformSellFeePercent(11);

        vm.expectRevert("Fee address cannot be zero");
        forgepad.setFeeAddress(address(0));

        vm.expectRevert("Distributor cannot be zero");
        forgepad.setDistributorAddress(address(0));
    }

    receive() external payable {}
}
