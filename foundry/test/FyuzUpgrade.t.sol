// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Fyuz, IFyuz} from "../src/Fyuz.sol";
import {FyuzLiquidityManager} from "../src/FyuzLiquidityManager.sol";
import {FyuzDeploy} from "../src/FyuzDeploy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

/// @dev A realistic V2: appends state AFTER the parent's reserved gap, exactly the
///      way a future upgrade would. If the gap were missing, `version` would land on
///      a slot the V1 layout already uses and the upgrade would silently corrupt it.
contract FyuzV2 is Fyuz {
    uint256 public version;

    function setVersion(uint256 v) external {
        version = v;
    }
}

contract FyuzUpgradeTest is Test {
    Fyuz public fyuz;
    FyuzLiquidityManager public liquidityManager;
    ProxyAdmin public fyuzAdmin;

    address constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant FEE_WALLET = 0x33f4Cf3C025Ba87F02fB4f00E2E1EA7c8646A103;
    address constant DIST_ADDR = 0xF2917a81fF74406fbCf01c507057e101Db8f2F12;

    address V2_ROUTER;
    address V3_FACTORY;
    address V3_POS_MGR;
    address V4_POOL_MGR;
    address UNIVERSAL_ROUTER;
    address V4_POS_MGR;
    address DATA_FEED;

    address alice;

    function setUp() public {
        vm.createSelectFork(
            vm.envOr("FORK_URL", string("https://ethereum-rpc.publicnode.com"))
        );

        V2_ROUTER = vm.envOr("V2_ROUTER", 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
        V3_FACTORY = vm.envOr("V3_FACTORY", 0x1F98431c8aD98523631AE4a59f267346ea31F984);
        V3_POS_MGR = vm.envOr("V3_POS_MGR", 0xC36442b4a4522E871399CD717aBDD847Ab11FE88);
        V4_POOL_MGR = vm.envOr("V4_POOL_MGR", 0x000000000004444c5dc75cB358380D2e3dE08A90);
        UNIVERSAL_ROUTER = vm.envOr("UNIVERSAL_ROUTER", 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af);
        V4_POS_MGR = vm.envOr("V4_POS_MGR", 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e);
        DATA_FEED = vm.envOr("DATA_FEED", 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419);

        alice = makeAddr("alice");
        vm.deal(address(this), 10_000 ether);
        vm.deal(alice, 10_000 ether);

        liquidityManager = FyuzDeploy.deployLiquidityManager(
            V2_ROUTER,
            V3_FACTORY,
            V3_POS_MGR,
            V4_POOL_MGR,
            UNIVERSAL_ROUTER,
            V4_POS_MGR,
            PERMIT2_ADDR,
            address(this),
            address(this),
            10000,
            10000,
            address(this)
        );
        fyuz = FyuzDeploy.deployFyuz(
            DATA_FEED,
            address(liquidityManager),
            FEE_WALLET,
            DIST_ADDR,
            address(this)
        );
        liquidityManager.setAuthorizedCaller(address(fyuz), true);

        fyuzAdmin = ProxyAdmin(_adminOf(address(fyuz)));
    }

    /// @dev TransparentUpgradeableProxy deploys its own ProxyAdmin and records it in
    ///      the ERC-1967 admin slot; that slot is the only way to find it.
    function _adminOf(address proxy) internal view returns (address) {
        return
            address(
                uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT)))
            );
    }

    function _create(string memory n, string memory s) internal returns (address) {
        return
            fyuz.createToken{value: 1 ether}(
                n,
                s,
                0.5 ether,
                0,
                0,
                1,
                block.timestamp + 1
            );
    }

    // ==================== INITIALIZATION ====================

    function test_Upgrade01_ProxyRanInitializerDefaults() public view {
        // Every default below used to be a declaration-time value, which a proxy
        // would leave at zero if initialize() didn't assign it.
        assertEq(fyuz.burnAddress(), 0x000000000000000000000000000000000000dEaD);
        assertEq(fyuz.CREATE_TOKEN_FEE_AMOUNT(), 0.001 ether);
        assertEq(fyuz.priceStalenessThreshold(), 3600);
        assertEq(fyuz.PLATFORM_BUY_FEE_BPS(), 100);
        assertEq(fyuz.PLATFORM_SELL_FEE_BPS(), 100);
        assertEq(fyuz.platformLPFee(), 0.1 ether);
        assertEq(fyuz.MAX_BUY_PERCENT(), 10_000);
        assertEq(fyuz.MAX_SELL_PERCENT(), 10_000);
        assertEq(fyuz.owner(), address(this));
        assertEq(address(fyuz.liquidityManager()), address(liquidityManager));
        assertEq(fyuz.feeAddress(), FEE_WALLET);
    }

    function test_Upgrade02_LiquidityManagerInitializerDefaults() public view {
        assertEq(liquidityManager.owner(), address(this));
        assertEq(address(liquidityManager.routerV2()), V2_ROUTER);
        assertEq(liquidityManager.marginRecipient(), address(this));
        assertTrue(liquidityManager.authorizedCallers(address(fyuz)));
    }

    function test_Upgrade03_CannotInitializeProxyTwice() public {
        vm.expectRevert(); // InvalidInitialization
        fyuz.initialize(DATA_FEED, address(liquidityManager), FEE_WALLET, DIST_ADDR);
    }

    /// @dev An uninitialized implementation is hijackable if it can still be
    ///      initialized; _disableInitializers() in the constructor is what stops it.
    function test_Upgrade04_ImplementationCannotBeInitialized() public {
        Fyuz impl = new Fyuz();
        vm.expectRevert(); // InvalidInitialization
        impl.initialize(DATA_FEED, address(liquidityManager), FEE_WALLET, DIST_ADDR);

        FyuzLiquidityManager lmImpl = new FyuzLiquidityManager();
        vm.expectRevert();
        lmImpl.initialize(
            V2_ROUTER,
            V3_FACTORY,
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
    }

    // ==================== ACCESS CONTROL ====================

    function test_Upgrade05_OnlyProxyAdminOwnerCanUpgrade() public {
        address newImpl = address(new FyuzV2());

        vm.prank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        fyuzAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(fyuz)),
            newImpl,
            ""
        );
    }

    /// @dev The contract owner is not automatically the upgrade admin — losing the
    ///      owner key must not hand over the implementation.
    function test_Upgrade06_ContractOwnerIsNotUpgradeAdmin() public {
        fyuz.transferOwnership(alice);
        assertEq(fyuz.owner(), alice);

        address newImpl = address(new FyuzV2());
        vm.prank(alice);
        vm.expectRevert();
        fyuzAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(fyuz)),
            newImpl,
            ""
        );
    }

    // ==================== STATE PRESERVATION ACROSS UPGRADE ====================

    function test_Upgrade07_StateSurvivesUpgrade() public {
        address token = _create("PreUpgrade", "PRE");
        fyuz.setPlatformBuyFeeBps(250);

        uint256 balBefore = IERC20(token).balanceOf(address(this));
        uint256 countBefore = fyuz.tokenCount();
        uint256 curveEthBefore = fyuz.totalCurveEthReserve();
        uint256 priceBefore = fyuz.getVirtualPrice(token);
        IFyuz.PoolInfo memory poolBefore = IFyuz(address(fyuz))
            .tokenPools(token);

        fyuzAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(fyuz)),
            address(new FyuzV2()),
            ""
        );

        assertEq(fyuz.tokenCount(), countBefore, "tokenCount");
        assertEq(fyuz.totalCurveEthReserve(), curveEthBefore, "curve ETH");
        assertEq(fyuz.PLATFORM_BUY_FEE_BPS(), 250, "owner-set fee survives");
        assertEq(fyuz.owner(), address(this), "owner");
        assertEq(fyuz.burnAddress(), 0x000000000000000000000000000000000000dEaD);
        assertEq(IERC20(token).balanceOf(address(this)), balBefore, "user balance");
        assertEq(fyuz.getVirtualPrice(token), priceBefore, "price feed still wired");

        IFyuz.PoolInfo memory poolAfter = IFyuz(address(fyuz))
            .tokenPools(token);
        assertEq(poolAfter.ethReserve, poolBefore.ethReserve, "pool ethReserve");
        assertEq(poolAfter.tokenReserve, poolBefore.tokenReserve, "pool tokenReserve");
        assertEq(poolAfter.virtualEthReserve, poolBefore.virtualEthReserve, "vEth");
        assertEq(poolAfter.virtualTokenReserve, poolBefore.virtualTokenReserve, "vTok");
        assertEq(poolAfter.token, poolBefore.token, "pool token");
        assertEq(poolAfter.owner, poolBefore.owner, "pool owner");
        assertEq(poolAfter.poolType, poolBefore.poolType, "pool type");
        assertEq(poolAfter.launched, poolBefore.launched, "launched flag");
    }

    function test_Upgrade08_TradingStillWorksAfterUpgrade() public {
        address token = _create("Tradeable", "TRD");

        fyuzAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(fyuz)),
            address(new FyuzV2()),
            ""
        );

        vm.startPrank(alice);
        uint256 before = IERC20(token).balanceOf(alice);
        fyuz.swapExactETHForTokens{value: 1 ether}(
            token,
            1 ether,
            0,
            block.timestamp + 1
        );
        assertGt(IERC20(token).balanceOf(alice), before, "buy works post-upgrade");
        vm.stopPrank();
    }

    // ==================== THE GAP ====================

    /// @dev What __gap actually buys: it does NOT stop a child's state from
    ///      overlapping the parent's — the compiler already places children last. It
    ///      reserves a window so the parent can LATER append state (by decrementing
    ///      __gap) without shoving every inheritor's slots down, which would silently
    ///      reinterpret live storage in already-deployed proxies.
    ///
    ///      So the invariant worth locking is positional: inheritor state starts at
    ///      slot 73, with 50 reserved slots below it. Adding a variable to Fyuz
    ///      without decrementing __gap moves that and breaks this test — which is the
    ///      whole point.
    uint256 constant FIRST_CHILD_SLOT = 73;
    uint256 constant GAP_SLOTS = 50;

    function test_Upgrade09_GapReservesFiftySlotsBelowChildState() public {
        fyuzAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(fyuz)),
            address(new FyuzV2()),
            ""
        );
        FyuzV2 v2 = FyuzV2(payable(address(fyuz)));

        uint256 sentinel = 0xdecafbad;
        v2.setVersion(sentinel);

        uint256 versionSlot = type(uint256).max;
        for (uint256 i = 0; i < 256; i++) {
            if (uint256(vm.load(address(v2), bytes32(i))) == sentinel) {
                versionSlot = i;
                break;
            }
        }
        assertEq(
            versionSlot,
            FIRST_CHILD_SLOT,
            "inheritor state moved: decrement __gap when adding Fyuz state, or every deployed proxy's layout shifts"
        );

        for (uint256 i = versionSlot - GAP_SLOTS; i < versionSlot; i++) {
            assertEq(
                uint256(vm.load(address(v2), bytes32(i))),
                0,
                "reserved window must be unused parent storage"
            );
        }
    }

    /// @dev Parent-grows-into-the-gap is covered by the slot assertion above: an
    ///      upgrade that appends parent state and decrements __gap leaves `version` at
    ///      73 and still passes; one that forgets to decrement moves it and fails.
    ///      Simulating it directly would need a duplicated Fyuz with a shrunken
    ///      gap, which would rot out of sync with the real one.

    // ==================== LIQUIDITY MANAGER UPGRADE ====================

    function test_Upgrade11_LiquidityManagerUpgradePreservesWiring() public {
        ProxyAdmin lmAdmin = ProxyAdmin(_adminOf(address(liquidityManager)));

        lmAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(liquidityManager)),
            address(new FyuzLiquidityManager()),
            ""
        );

        assertTrue(
            liquidityManager.authorizedCallers(address(fyuz)),
            "authorization survives"
        );
        assertEq(address(liquidityManager.routerV2()), V2_ROUTER, "router survives");
        assertEq(liquidityManager.owner(), address(this), "owner survives");
        assertEq(liquidityManager.marginRecipient(), address(this));
    }

    receive() external payable {}
}
