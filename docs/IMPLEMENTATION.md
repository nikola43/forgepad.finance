# Fyuz Phase 1 — Implementation Plan

Developer-facing build doc. **Decisions and rationale live in [`plan.md`](./plan.md)** — this file
does not re-argue them, it says what to type. Where a choice looks arbitrary here, the "why" is in
plan.md under the cited section.

Baseline: `fyuz-bsc` @ `ccb6dd0`. `forge test` = **82 passing, 0 failing, 5 skipped**. Keep it that
way at every commit.

---

## 1. File map

| Action | Path | Notes |
|---|---|---|
| **new** | `src/FyuzPad.sol` | from `src/Arrowpad.sol` (1121 L) — expect ~700 L after cuts |
| **new** | `src/FyuzLiquidityManager.sol` | from `src/ArrowpadLiquidityManager.sol` (1083 L) — V2 only, expect ~350 L |
| **new** | `src/IFyuzLiquidityManager.sol` | from `src/IArrowpadLiquidityManager.sol` — V2 only |
| **reuse as-is** | `src/Token.sol` | already satisfies fixed-supply + no-mint (plan.md §0). Do not touch. |
| **reuse as-is** | `src/MockPriceFeed.sol` | oracle tests |
| **reuse as-is** | `src/interfaces/INineInch*.sol` | UniV2-fork ABI ⇒ PancakeSwap V2 compatible |
| **new** | `script/DeployFyuz.s.sol` | from `script/Deploy.s.sol` |
| **new** | `script/curve.py` | calibration + invariant checker (plan.md appendix) |
| **new** | `test/FyuzPad.t.sol` | port of `Arrowpad.t.sol` |
| **new** | `test/FyuzCalibration.t.sol` | new — the §1 trap, oracle, per-token V |
| **new** | `test/FyuzFees.t.sol` | new — 1% split + referral |
| **new** | `test/FyuzHardening.t.sol` | port of `ArrowpadHardening.t.sol` + `GriefSyncRepro` + `OverchargeRepro` |
| **delete** | `src/Distributor.sol`, `src/EthismFeeDistributor.sol` | Arrowpad revenue-share; Fyuz routes to one treasury |
| **delete** | `src/VRFExample.sol` | unused by this scope |
| **untouched** | `src/Arrowpad*.sol`, existing tests | leave the Arrowpad deployment alone — do not refactor in place |

**Copy, don't refactor in place.** Arrowpad is deployed and has a live security history. A parallel
`Fyuz*` tree keeps its test suite green as an oracle for behaviour we intend to preserve, and keeps
the audit diff readable.

---

## 2. Storage and constants (`FyuzPad.sol`)

### `PoolInfo`

```solidity
struct PoolInfo {
    uint256 bnbReserve;            // renamed from ethReserve
    uint256 tokenReserve;
    uint256 virtualBnbReserve;     // renamed; now initialised per-token, NOT from a constant
    uint256 virtualTokenReserve;
    uint256 graduationReserve;     // NEW — snapshotted at creation (plan.md §1, §6)
    address token;
    address owner;                 // creator; receives the 0.2%
    bool    launched;
    // REMOVED: uint8 poolType   (V2-only, plan.md §8)
}
```

### Constants

```solidity
uint256 public constant TOTAL_SUPPLY          = 1_000_000_000e18;
uint256 public constant VIRTUAL_TOKEN_INITIAL = 1_073_000_000e18;   // T
uint256 public constant REAL_TOKEN_INITIAL    =   793_100_000e18;   // R

uint256 public constant TOTAL_FEE_BPS    = 100;   // 1% — the whole fee, not a component
uint256 public constant CREATOR_FEE_BPS  =  20;   // 0.2% of trade  = 20% of the fee
uint256 public constant REFERRAL_FEE_BPS =  10;   // 0.1% of trade  = 10% of the fee
uint256 public constant MAX_TOTAL_FEE_BPS = 200;  // 2% hard cap, unraisable (plan.md §5)

uint256 public GRADUATION_USD  = 25_000e18;   // multisig-settable, new tokens only
uint256 public minFirstBuyUSD  = 10e18;       // multisig-settable
uint256 public graduationFee;                 // BNB, flat — pending decision (plan.md §9.1)

// REMOVED: VIRTUAL_ETH_INITIAL   (now derived per token)
// REMOVED: TARGET_MARKET_CAP_USD (graduation is reserve-based)
// REMOVED: PLATFORM_BUY_FEE_BPS / PLATFORM_SELL_FEE_BPS / TOKEN_OWNER_FEE_BPS (additive → split)
// REMOVED: CREATE_TOKEN_FEE_AMOUNT, firstBuyFeeUSD, platformLPFee, tokenOwnerLPFee
```

`TOTAL_FEE_BPS` is `constant` deliberately. If a settable total is required later it must clamp to
`MAX_TOTAL_FEE_BPS` — the cap is the anti-rug guarantee and it may not become settable.

### New state

```solidity
mapping(address => address) public referrerOf;   // trader => referrer, write-once
address public treasury;                          // the multisig
address public guardian;                          // pause-only (plan.md §5)
```

---

## 3. Core changes, function by function

Line numbers reference `src/Arrowpad.sol` @ `ccb6dd0`.

### 3.1 `createToken` (L237–295) — the biggest change

Add the calibration read. This is the only place the oracle gates control flow.

```solidity
function createToken(
    string memory name,
    string memory symbol,
    uint256 buyAmount,
    uint256 minAmountOut,
    bytes32 fusionId,        // NEW — emitted only, never stored (plan.md §7)
    address referrer,        // NEW
    uint256 deadline
) external payable whenNotPaused nonReentrant returns (address) {
    require(deadline >= block.timestamp, "Swap expired");

    // --- calibration: ONE oracle read, reverts if stale (plan.md §3a) ---
    uint256 price = getBnbPrice();                       // reverting variant, creation only
    uint256 G = Math.mulDiv(GRADUATION_USD, 1e18, price);
    uint256 V = Math.ceilDiv(G * (VIRTUAL_TOKEN_INITIAL - REAL_TOKEN_INITIAL), REAL_TOKEN_INITIAL);
    // ^ ceilDiv is load-bearing: floor division puts Emax under G and bricks the token. plan.md §1.

    // --- mandatory first buy, $10 floor, same price (plan.md §7) ---
    require(Math.mulDiv(buyAmount, price, 1e18) >= minFirstBuyUSD, "First buy below minimum");

    address newToken = address(new Token(name, symbol, TOTAL_SUPPLY));
    require(msg.value >= buyAmount, "Insufficient BNB");

    tokenPools[newToken] = PoolInfo({
        bnbReserve:         0,
        tokenReserve:       REAL_TOKEN_INITIAL,
        virtualBnbReserve:  V,          // per-token
        virtualTokenReserve: VIRTUAL_TOKEN_INITIAL,
        graduationReserve:  G,          // snapshotted
        token:              newToken,
        owner:              msg.sender,
        launched:           false
    });
    tokenCount++;

    _setReferrer(msg.sender, referrer);
    emit TokenCreated(newToken, msg.sender, fusionId, V, G, price, block.timestamp);

    uint256 used = _swapExactBnbForTokens(newToken, buyAmount, minAmountOut);
    if (msg.value > used) _transferBNB(msg.sender, msg.value - used);
    return newToken;
}
```

Deleted from this function: `poolType` param + validation, `CREATE_TOKEN_FEE_AMOUNT`, `firstBuyFee`,
the `sig` param (replaced by `fusionId`), and the fee transfer to `feeAddress`.

`buyAmount > 0` is now implied by the `$10` floor — the `if (buyAmount > 0)` branch goes away.

### 3.2 Graduation trigger — `_checkAndAddLiquidity` (L666–718)

```solidity
-  if (getTokenVirtualMarketCap(token) < TARGET_MARKET_CAP_USD) return;
+  if (pool.bnbReserve < pool.graduationReserve) return;
```

That single line is the §3 answer. No oracle, no market cap.

### 3.3 LP sizing — replaces `_tokensForTargetMcap` (L811–819)

The curve's own final state *is* the price. Read it straight off the pool:

```solidity
// price = virtualBnbReserve / virtualTokenReserve  =>  tokens = bnb / price
uint256 tokensForLP = Math.mulDiv(lpBnb, pool.virtualTokenReserve, pool.virtualBnbReserve);
```

**Ordering hazard:** `_checkAndAddLiquidity` zeroes the virtual reserves (L690–692) *before* calling
`_addLiquidity`. `tokensForLP` must be computed **before** that clear, or it divides by zero. Compute
it at the top of the function alongside `lpBnb` and pass both down.

Excess tokens are burned by the existing L697–700 path. This holds the LP price gap at −0.007%
(plan.md §1) at any `graduationFee`, because the fee shrinks `lpBnb` and `tokensForLP` together.

Delete `_tokensForTargetMcap` and both `ethPriceUSD` arguments threaded through `_addLiquidity` /
`addLiquidityV2WithTargetMarketCap`. The liquidity manager's V2 entrypoint becomes:

```solidity
function addLiquidityV2(address token, uint256 tokenAmount, uint256 bnbAmount, address recipient)
```

Keep its donation-absorbing logic and direct pair seeding — that is what `test_26` and
`GriefSyncRepro` cover. Only the target-mcap math is removed.

### 3.4 Fees — `_payTokenOwnerFee` (L839–844) + `_payPlatformFee` (L848–853) → one `_payFees`

```solidity
function _payFees(address creator, uint256 fee) private {
    if (fee == 0) return;
    uint256 creatorFee = fee * CREATOR_FEE_BPS / TOTAL_FEE_BPS;   // 20% of the fee = 0.2% of trade
    address ref = referrerOf[msg.sender];
    uint256 refFee = ref == address(0) ? 0 : fee * REFERRAL_FEE_BPS / TOTAL_FEE_BPS;
    uint256 treasuryFee = fee - creatorFee - refFee;              // remainder ⇒ no dust escapes

    if (!_transferBNBTolerant(creator, creatorFee)) treasuryFee += creatorFee;
    if (refFee > 0 && !_transferBNBTolerant(ref, refFee))        treasuryFee += refFee;
    _transferBNBTolerant(treasury, treasuryFee);
}
```

Three properties to preserve, each already load-bearing in Arrowpad:

- **`treasuryFee` is the remainder**, not `fee * 70/100`. Integer division would strand dust and make
  the split fail an exact-sum assertion.
- **Tolerant sends.** A creator that rejects BNB must not brick trading — reroute to treasury. This is
  `test_OwnerFeeHoneypot_DoesNotBrickTrading`; keep it green.
- **Unattributed referral falls to treasury** ⇒ 0.8%, matching plan.md §2's table.

Fee arithmetic in the swap paths collapses to one rate:

```solidity
-  uint256 totalFeeBps = PLATFORM_BUY_FEE_BPS + TOKEN_OWNER_FEE_BPS;   // was 1.2%
+  uint256 totalFeeBps = TOTAL_FEE_BPS;                                 // 1.0%, split downstream
```

`getAmountOut(..., feeBps)` keeps its shape — only the value changes. The sell path keeps
`feeBps = 0` in the formula and applies fees to the output explicitly (L438–450). Do not "unify"
these; buy-side deducts from input and sell-side from output, and that asymmetry is intentional.

### 3.5 Referral

```solidity
function _setReferrer(address trader, address referrer) private {
    if (referrerOf[trader] != address(0)) return;         // write-once, permanent
    if (referrer == address(0) || referrer == trader) return;
    referrerOf[trader] = referrer;
    emit ReferrerSet(trader, referrer);
}
```

Called at the top of `createToken`, `swapExactBnbForTokens`, `swapBnbForExactTokens`,
`swapExactTokensForBNB`. Add `address referrer` to each of those signatures.

Self-referral via a second wallet is out of scope by decision (plan.md §2) — do not add Sybil logic.

### 3.6 Oracle (plan.md §3a)

```solidity
_rawBnbPrice()   // KEEP verbatim from _rawEthPrice (L588-605). Never reverts, returns 0 on
                 // stale / non-positive / incomplete-round / reverting feed. Do not "clean up".
getBnbPrice()    // KEEP shape of getETHPriceByUSD (L609-613): reverts. ONLY caller = createToken.
```

- `priceStalenessThreshold`: default **300**, not 3600 and not 86400 (BSC is an L1 — plan.md §3a).
- `getTokenVirtualMarketCap` (L629–640): keep for events/UI, still on `_rawBnbPrice` ⇒ emits 0 during
  an outage rather than reverting.
- **Delete** `getFirstBuyFee` / `firstBuyFeeUSD` (L615–620) — no launch fee.

### 3.7 V2-only (plan.md §8)

Delete: `poolType` field + param + validation, `_addLiquidity`'s V3/V4 branches (L756–777),
`liquidityManager.addLiquidityV3/V4`, both `try/catch` fallbacks, `recoverPoolType` (L955–963), and
the V3/V4 halves of the liquidity manager. `_addLiquidity` becomes a direct call to the V2 path.

### 3.8 Governance (plan.md §5, §6)

- `Ownable` → **`Ownable2Step`**.
- `guardian` + `onlyGuardianOrOwner` on `pause()`. `unpause()` stays `onlyOwner`.
- `setGraduationUsd(uint256)`: **must re-run the §1 reachability invariant** or a bad value silently
  bricks every future launch.
- `setFeeAddress`/`setDistributorAddress` → single `setTreasury`. Delete `setPlatformBuyFeeBps`,
  `setPlatformSellFeeBps`, `setTokenOwnerFeeBps`, `setCreateTokenFeeAmount`, `setFirstBuyFee`,
  `setPlatformLPFee`, `setTokenOwnerLPFee`.
- **Keep** unchanged: `totalCurveEthReserve` accounting (→ `totalCurveBnbReserve`), the 24h emergency
  withdraw timelock, the 24h liquidity-manager timelock, `withdrawableEth` → `withdrawableBnb`. These
  are the strongest anti-rug properties in the codebase (plan.md §6).

### 3.9 Events

`TokenCreated` gains `creator`, `fusionId`, `virtualBnbReserve`, `graduationReserve`, `bnbPriceUSD`
— the indexer needs the per-token calibration to render progress. `BuyTokens`/`SellTokens` gain
`referrer` and keep `bnbPriceUSD` (0 during an outage). Add `ReferrerSet`.

Coordinate with the backend **before** Phase 3 lands: these are indexer-breaking.

---

## 4. Test plan

### 4.1 Port with mechanical edits (`test/FyuzPad.t.sol`)

47 of the 62 tests in `Arrowpad.t.sol` port with signature/constant edits only. They are the
regression net for everything this plan does *not* intend to change — port them first, before
touching behaviour.

| Test | Change |
|---|---|
| `test_01*`, `test_03*`, `test_04*`, `test_05`, `test_12*`, `test_13` | new `createToken` signature; expect per-token V |
| `test_02b_KPreservationAcrossBuys`, `test_02c/d_MaxBuyForReserve*` | **port verbatim** — curve math is unchanged |
| `test_06_GraduationLaunch`, `test_12b_MultiUserGraduation` | assert on reserve, not mcap |
| `test_08*` (transfer gating) | unchanged — `Token.sol` untouched |
| `test_09a/b` (fee) | rewrite → §4.3 |
| `test_10f/g`, `test_11e/f/g/h/i` | unchanged |
| `test_17/18/19` (price gap, overshoot) | **highest-value ports** — keep the −0.007% assertion |
| `test_26_V2GraduationSurvivesPreSeededPair` | unchanged |
| `test_29_DustFeeBuyDoesNotRevert`, `test_31_V2LiquidityBurned` | unchanged |
| `OverchargeRepro`, `GriefSyncRepro`, `ArrowpadHardening` (4) | port all — regression repros |
| `ArrowpadAdvanced` (14, incl. 2 fuzz) | port; `test_CombinedFeesCannotExceed100` → the 2% cap |

**Delete** (V3/V4, plan.md §8): `test_20`–`test_24`, `test_27`, `test_28`, `test_30`, `test_32`,
`test_33`, `test_10h_InvalidPoolTypeReverts`, `test_V3Griefed_FallsBackToV2`.

### 4.2 New — `test/FyuzCalibration.t.sol` (the trap)

The highest-value file in the plan. Everything here is a silent, permanent failure if wrong.

```
test_Reachability_Invariant                  // graduationReserve <= V*R/(T-R) at creation
testFuzz_Reachability_AcrossBnbPrice         // fuzz price $50-$5,000 — MUST NOT brick
test_FloorDivision_Bricks_ProvingTestHasTeeth// same math with floor div => assert it FAILS
test_IdenticalUsdEconomics_At300_And_1000    // start FDV, grad FDV, LP gap identical (plan.md §1)
test_GraduatesAt25kUsd_AtCreationPrice
test_PriceGapUnder_0_01pct_AcrossBnbPrice    // zero-gap identity is V-independent
test_CalibrationSnapshotted_NotLive          // move oracle mid-curve => threshold does NOT move
test_SetGraduationUsd_CannotBrickNewLaunches
test_CreateReverts_WhenOracleStale           // creation is the ONE path allowed to revert
test_GraduationWorks_WhenOracleDead          // proves the trigger is oracle-free
test_LpSizing_UnaffectedByOracle
```

`test_FloorDivision_Bricks_ProvingTestHasTeeth` exists because the `ceilDiv` regression is invisible:
it passes every ordinary test and only strands the last buyer of every token. The test must
demonstrate the bug it prevents.

### 4.3 New — `test/FyuzFees.t.sol`

```
test_TotalFeeIsExactly1pct_WithReferrer       // 0.2 + 0.1 + 0.7, sums EXACTLY, no dust
test_TotalFeeIsExactly1pct_NoReferrer         // 0.2 + 0.8
test_ReferrerSticky_CannotBeOverwritten
test_SelfReferral_RoutesToTreasury
test_ZeroReferrer_RoutesToTreasury
test_CreatorRejectsBnb_ReroutesToTreasury_NoBrick   // honeypot; port of the hardening test
test_ReferrerRejectsBnb_ReroutesToTreasury_NoBrick
test_FeeCap_Unraisable_Above200Bps
test_FirstBuyFloor_Enforced_At10Usd
test_FirstBuyFloor_MovesWithBnbPrice
testFuzz_FeeSplitSumsToFee                    // fuzz trade size — invariant: sum == fee, always
```

### 4.4 Acceptance gates

Nothing merges to `fyuz-bsc` unless all hold:

1. `forge test` green; no test deleted except the §4.1 list.
2. Reachability invariant passes fuzzed over $50–$5,000 BNB.
3. LP price gap < 0.01% for careful, overshoot, and dust graduations, at 3+ BNB prices.
4. Fee split sums to exactly the fee under fuzz — no dust.
5. Oracle dead ⇒ trading and graduation work; only `createToken` reverts.
6. `forge coverage` ≥ 90% on `FyuzPad.sol`.

---

## 5. Deploy (`script/DeployFyuz.s.sol`)

**All three existing deploy scripts point at ETH/USD feeds** — `Deploy.s.sol:27` uses Ethereum
mainnet's `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`. On BSC that returns a plausible number and
silently mis-calibrates every curve. Verified BNB/USD feeds (queried live 2026-07-14):

```solidity
// BSC mainnet — description() == "BNB / USD", decimals() == 8
address constant DATA_FEED_BSC        = 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE;
// BSC testnet — description() == "BNB / USD"
address constant DATA_FEED_BSC_TEST   = 0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526;
```

Assert it in the script, not in a comment:

```solidity
require(
    keccak256(bytes(AggregatorV3Interface(feed).description())) == keccak256("BNB / USD"),
    "Wrong feed"
);
(, int256 p,,uint256 updatedAt,) = AggregatorV3Interface(feed).latestRoundData();
require(p > 0 && block.timestamp - updatedAt < 300, "Feed stale at deploy");
```

Order: deploy `FyuzLiquidityManager` → `FyuzPad` → wire → set `guardian` →
`transferOwnership(safe)` on both → **assert deployer holds no role** → log for explorer
verification. `Ownable2Step` means the Safe must `acceptOwnership()`; the handover is not complete
until it does, and the script must say so.

Also needed: PancakeSwap V2 router/factory addresses for BSC mainnet + testnet, verified the same way
(call `factory()` on the router and check it matches). Do not copy from a blog post.

---

## 6. PR sequence

Each PR is independently reviewable and leaves the suite green. Do not batch.

| # | Branch | Contents | Gate |
|---|---|---|---|
| 1 | `fyuz/scaffold` | copy `Arrowpad*` → `Fyuz*`, rename BNB, port tests unchanged | suite green — pure rename, zero behaviour change |
| 2 | `fyuz/strip-v3v4` | §3.7 + delete `Distributor`/`EthismFeeDistributor`/`VRFExample`; delete V3/V4 tests | green; ~600 L removed |
| 3 | `fyuz/calibration` | §2 storage, §3.1 `createToken`, §3.2 trigger, §3.3 LP sizing, §3.6 oracle; `FyuzCalibration.t.sol` | **the reachability invariant** |
| 4 | `fyuz/fees-referral` | §3.4, §3.5; `FyuzFees.t.sol` | exact-sum fuzz |
| 5 | `fyuz/governance` | §3.8, §3.9 events | deployer holds nothing |
| 6 | `fyuz/deploy` | §5 + testnet run | end-to-end graduation on live Pancake V2 testnet |

PR 3 is the one to slow down on. PRs 1–2 are mechanical and should be reviewed for *what got
deleted*, not what got written.

**Parallel, unblocked after PR 1** (only needs the ABI): backend fusion pipeline, moderation queue,
indexer, `?ref=` link handling. Do not let this wait on the audit.

---

## 7. Estimate

| PR | Est. | Risk |
|---|---|---|
| 1 — scaffold | 0.5 d | low |
| 2 — strip V3/V4 | 1 d | low — deletion |
| 3 — calibration | 2–3 d | **high — the §1 trap** |
| 4 — fees + referral | 1.5 d | medium — exactness |
| 5 — governance | 1 d | medium — irreversible at deploy |
| 6 — deploy + testnet | 1.5 d | medium — feed/router config |
| | **~8 days** | then audit-gated (2–4 wks, **book now**) |

Credible only because Arrowpad exists and its 82 tests pass today. From scratch: 2–3 months.

---

## 8. Blocked on decisions

From plan.md §9 — these block the PRs listed:

| Decision | Blocks |
|---|---|
| `graduationFee`: 0.01 or 0.05 BNB (plan.md §4) | PR 3 — LP sizing tests need the number |
| Treasury Safe address + 3-of-5 signers confirmed | PR 5, PR 6 |
| `guardian` address | PR 5 |
| Permissionless `createToken` confirmed (plan.md §7) | PR 3 |
| Audit firm booked | PR 6 → mainnet |

---

## 9. Do not touch

Things that look like cleanup and are not. Each is load-bearing, each has a test, each was paid for
in a prior incident (`7713809`):

- **`_rawBnbPrice`'s never-reverts contract** — returns 0 instead of throwing. This is what stops an
  oracle outage from freezing trading.
- **`_getMaxBuyForReserve`** (L362–379) — the overcharge fix. `OverchargeRepro` covers it.
- **`totalCurveBnbReserve` mirroring** — every reserve mutation must update it, or emergency
  withdrawal can reach user funds.
- **Tolerant fee sends vs strict principal sends** — `_transferBNB` reverts, `_transferBNBTolerant`
  does not. Fees use tolerant, user principal uses strict. Never unify them.
- **Effects-before-interactions ordering in `_checkAndAddLiquidity`** — reserves clear before
  `_addLiquidity`. §3.3's `tokensForLP` must be computed before that clear, not after.
- **V2 direct pair seeding + donation absorption** — `test_26`, `GriefSyncRepro`.
- **`Math.ceilDiv` in §3.1** — floor division bricks every token, silently.
