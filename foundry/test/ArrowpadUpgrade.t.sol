// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {Arrowpad, IArrowpad} from "../src/Arrowpad.sol";
import {ArrowpadLiquidityManager} from "../src/ArrowpadLiquidityManager.sol";
import {ArrowpadDeploy} from "../src/ArrowpadDeploy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

/// @dev A realistic V2: appends state AFTER the parent's reserved gap, exactly the
///      way a future upgrade would. If the gap were missing, `version` would land on
///      a slot the V1 layout already uses and the upgrade would silently corrupt it.
contract ArrowpadV2 is Arrowpad {
    uint256 public version;

    function setVersion(uint256 v) external {
        version = v;
    }
}

contract ArrowpadUpgradeTest is Test {
    Arrowpad public arrowpad;
    ArrowpadLiquidityManager public liquidityManager;
    ProxyAdmin public arrowpadAdmin;

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

        liquidityManager = ArrowpadDeploy.deployLiquidityManager(
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
        arrowpad = ArrowpadDeploy.deployArrowpad(
            DATA_FEED,
            address(liquidityManager),
            FEE_WALLET,
            DIST_ADDR,
            address(this)
        );
        liquidityManager.setAuthorizedCaller(address(arrowpad), true);

        arrowpadAdmin = ProxyAdmin(_adminOf(address(arrowpad)));
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
            arrowpad.createToken{value: 1 ether}(
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
        assertEq(arrowpad.burnAddress(), 0x000000000000000000000000000000000000dEaD);
        assertEq(arrowpad.CREATE_TOKEN_FEE_AMOUNT(), 0.001 ether);
        assertEq(arrowpad.priceStalenessThreshold(), 3600);
        assertEq(arrowpad.PLATFORM_BUY_FEE_BPS(), 100);
        assertEq(arrowpad.PLATFORM_SELL_FEE_BPS(), 100);
        assertEq(arrowpad.platformLPFee(), 0.1 ether);
        assertEq(arrowpad.MAX_BUY_PERCENT(), 10_000);
        assertEq(arrowpad.MAX_SELL_PERCENT(), 10_000);
        assertEq(arrowpad.owner(), address(this));
        assertEq(address(arrowpad.liquidityManager()), address(liquidityManager));
        assertEq(arrowpad.feeAddress(), FEE_WALLET);
    }

    function test_Upgrade02_LiquidityManagerInitializerDefaults() public view {
        assertEq(liquidityManager.owner(), address(this));
        assertEq(address(liquidityManager.routerV2()), V2_ROUTER);
        assertEq(liquidityManager.marginRecipient(), address(this));
        assertTrue(liquidityManager.authorizedCallers(address(arrowpad)));
    }

    function test_Upgrade03_CannotInitializeProxyTwice() public {
        vm.expectRevert(); // InvalidInitialization
        arrowpad.initialize(DATA_FEED, address(liquidityManager), FEE_WALLET, DIST_ADDR);
    }

    /// @dev An uninitialized implementation is hijackable if it can still be
    ///      initialized; _disableInitializers() in the constructor is what stops it.
    function test_Upgrade04_ImplementationCannotBeInitialized() public {
        Arrowpad impl = new Arrowpad();
        vm.expectRevert(); // InvalidInitialization
        impl.initialize(DATA_FEED, address(liquidityManager), FEE_WALLET, DIST_ADDR);

        ArrowpadLiquidityManager lmImpl = new ArrowpadLiquidityManager();
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
        address newImpl = address(new ArrowpadV2());

        vm.prank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        arrowpadAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(arrowpad)),
            newImpl,
            ""
        );
    }

    /// @dev The contract owner is not automatically the upgrade admin — losing the
    ///      owner key must not hand over the implementation.
    function test_Upgrade06_ContractOwnerIsNotUpgradeAdmin() public {
        arrowpad.transferOwnership(alice);
        assertEq(arrowpad.owner(), alice);

        address newImpl = address(new ArrowpadV2());
        vm.prank(alice);
        vm.expectRevert();
        arrowpadAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(arrowpad)),
            newImpl,
            ""
        );
    }

    // ==================== STATE PRESERVATION ACROSS UPGRADE ====================

    function test_Upgrade07_StateSurvivesUpgrade() public {
        address token = _create("PreUpgrade", "PRE");
        arrowpad.setPlatformBuyFeeBps(250);

        uint256 balBefore = IERC20(token).balanceOf(address(this));
        uint256 countBefore = arrowpad.tokenCount();
        uint256 curveEthBefore = arrowpad.totalCurveEthReserve();
        uint256 priceBefore = arrowpad.getVirtualPrice(token);
        IArrowpad.PoolInfo memory poolBefore = IArrowpad(address(arrowpad))
            .tokenPools(token);

        arrowpadAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(arrowpad)),
            address(new ArrowpadV2()),
            ""
        );

        assertEq(arrowpad.tokenCount(), countBefore, "tokenCount");
        assertEq(arrowpad.totalCurveEthReserve(), curveEthBefore, "curve ETH");
        assertEq(arrowpad.PLATFORM_BUY_FEE_BPS(), 250, "owner-set fee survives");
        assertEq(arrowpad.owner(), address(this), "owner");
        assertEq(arrowpad.burnAddress(), 0x000000000000000000000000000000000000dEaD);
        assertEq(IERC20(token).balanceOf(address(this)), balBefore, "user balance");
        assertEq(arrowpad.getVirtualPrice(token), priceBefore, "price feed still wired");

        IArrowpad.PoolInfo memory poolAfter = IArrowpad(address(arrowpad))
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

        arrowpadAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(arrowpad)),
            address(new ArrowpadV2()),
            ""
        );

        vm.startPrank(alice);
        uint256 before = IERC20(token).balanceOf(alice);
        arrowpad.swapExactETHForTokens{value: 1 ether}(
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
    ///      slot 73, with 50 reserved slots below it. Adding a variable to Arrowpad
    ///      without decrementing __gap moves that and breaks this test — which is the
    ///      whole point.
    uint256 constant FIRST_CHILD_SLOT = 73;
    uint256 constant GAP_SLOTS = 50;

    function test_Upgrade09_GapReservesFiftySlotsBelowChildState() public {
        arrowpadAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(arrowpad)),
            address(new ArrowpadV2()),
            ""
        );
        ArrowpadV2 v2 = ArrowpadV2(payable(address(arrowpad)));

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
            "inheritor state moved: decrement __gap when adding Arrowpad state, or every deployed proxy's layout shifts"
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
    ///      Simulating it directly would need a duplicated Arrowpad with a shrunken
    ///      gap, which would rot out of sync with the real one.

    // ==================== LIQUIDITY MANAGER UPGRADE ====================

    function test_Upgrade11_LiquidityManagerUpgradePreservesWiring() public {
        ProxyAdmin lmAdmin = ProxyAdmin(_adminOf(address(liquidityManager)));

        lmAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(liquidityManager)),
            address(new ArrowpadLiquidityManager()),
            ""
        );

        assertTrue(
            liquidityManager.authorizedCallers(address(arrowpad)),
            "authorization survives"
        );
        assertEq(address(liquidityManager.routerV2()), V2_ROUTER, "router survives");
        assertEq(liquidityManager.owner(), address(this), "owner survives");
        assertEq(liquidityManager.marginRecipient(), address(this));
    }

    receive() external payable {}
}
