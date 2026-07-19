# Fyuz Contracts — Pre-Mainnet Security Review

**Date:** 2026-07-19 · **Branch:** `fyuz-bsc-chain` · **Target:** BNB Smart Chain mainnet (chain 56)
**Scope:** `Fyuz.sol`, `FyuzLiquidityManager.sol`, `Token.sol`, `Distributor.sol`, `FyuzDeploy.sol`, deploy scripts.
**Method:** five independent line-by-line adversarial reviews (no automated tooling relied on) + full Foundry suite.

## Verdict

**Not ready to deploy as-is** — but the blockers are configuration and trust-model, not broken contract logic. The bonding-curve math, reentrancy posture, Chainlink handling, and `Token.sol` are all verified sound. Fix the items marked 🔴 before mainnet.

Distributor code fixes from this review are **already applied and tested** (20/20 pass). The rest are deployment steps and Fyuz-core decisions for you to make.

---

## ✅ Already fixed in this review (Distributor.sol)

| ID | Issue | Fix |
| --- | --- | --- |
| H-1 | Poster could post shares *after* the VRF word was revealed and hand-pick the winner | `postShares` now reverts once `hasRandom` is set — the holder set is locked before randomness exists |
| M-1 | No check that shares sum ≤ 2³²; a bad payload could over-pay early holders | `postShares` sums shares and rejects `> 2³²` |
| M-2 | Unbounded holder array could push `distribute` past the block gas limit and freeze the pot | `MAX_HOLDERS = 100` cap enforced on-chain |
| L-1 | Failed payout pushes (contract/AA wallets) were silently stranded | Pull-payment `claimable`/`claim()`; failed pushes credited and held out of the next pot |
| L-2 | Constructor missing zero-checks | `poster`, `keyHash`, `subId` zero-checks added |

Also fixed in `DeployBsc.s.sol`: the **fee split** (was 100/100/0 → now 80/80/20 = 0.6/0.2/0.2) and a missing **`chainid == 56` guard**.

---

## 🔴 Must fix before mainnet (deployment / config)

### 1. All privileged roles + both proxy admins on one EOA
Every auditor flagged this as the top risk. As written, `DeployBsc.s.sol` makes the deployer EOA the owner of Fyuz, the liquidity manager, **both ProxyAdmins**, `feeAddress`, `marginRecipient`, and default `distributor`. A Transparent-proxy `ProxyAdmin` can replace either implementation with **zero delay**, which bypasses every in-contract timelock (emergency-withdraw, liquidity-manager-change) and can drain all curve BNB and all locked LP. **One leaked key = total loss.**

**Fix:** transfer both ProxyAdmins and both `owner()`s to a **multisig behind a TimelockController (≥48h)** before adding real volume. Use distinct addresses for treasury / margin / distributor. Verify on-chain that the deployer retains zero roles.

### 2. Fee split (fixed in script, verify post-deploy)
Done in code, but add a post-deploy assertion reading back `PLATFORM_BUY/SELL_FEE_BPS == 80`, `TOKEN_OWNER_FEE_BPS == 20`.

### 3. Deploy the Distributor *first*, pass its address to `DeployBsc`
Otherwise the 0.2% leaderboard stream silently pays the deployer EOA until someone calls `setDistributorAddress`.

### 4. Distributor needs a mainnet deploy script
The current one is testnet-hardcoded (`require(chainid == 97)`, testnet VRF coordinator). Mainnet values:
- VRF Coordinator: `0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9`
- keyHash (200 gwei lane, recommended): `0x130dba50ad435d4ecc214aad0d5820474137bd68e7e77724144f27c3c377d3d4`
- `require(chainid == 56)`, fund the sub with BNB (native payment), create the subscription in its **own tx first** (v2.5 subIds are blockhash-derived).

---

## 🟠 Fyuz-core decisions to make (economic, not safety bugs)

These need **your** call — they're design/calibration, and one estimate below should be verified before you act on it.

### A. Graduation "margin" diversion — VERIFY THIS
One reviewer estimates that at the current curve calibration, ~40–47% of each V2 graduation's raised BNB is forwarded to `marginRecipient` as "leftover" (because the ~132M unsold tokens only absorb ~half the raised BNB at the target price), leaving the locked LP shallower than "$30k" implies. **This is a calibration-dependent estimate, not a confirmed constant — reproduce it with a fork test before acting.** If the diversion is intended protocol revenue, document it and route `marginRecipient` to a timelocked multisig. If it's meant to back liquidity, recalibrate `VIRTUAL_ETH_INITIAL`/`REAL_TOKEN_INITIAL` so tokens-left ≈ ETH-raised at target price.

### B. V3 opens above target price
When tokens are the binding constraint at graduation, the V3 path deposits all raised BNB against the capped token side, opening the pool above the $30k target (one estimate ~1.9×). Consider scaling `ethAmount` down to `tokenForLP × targetPrice` on the V3 path so it opens at target like V2.

### C. `MAX_BUY_PERCENT = 100%` enables a graduation-dump
No per-tx buy cap means one transaction can cross graduation and hold a dominant share of the float, then dump into the fresh LP (the classic pump.fun graduation dump). Consider a small cap (e.g. 100–300 bps of virtual reserve).

### D. V3-launch griefing → permanent V2 downgrade
Anyone can pre-initialize the V3 pool off-price during the curve phase; graduation then reverts the V3 path and silently falls back to V2, where LP is burned and **`collectFees` reverts forever** — permanently killing the creator/platform fee stream for that token. Consider seeding on an un-initialized fee tier or recording the downgrade for owner re-attempt.

### E. `collectFees` trusts caller-supplied recipients
`collectFees(token, creator, platform)` pays whatever addresses the (authorized) caller passes. In production only Fyuz calls it with the right values, but an owner/authorized key could redirect a creator's 50%. Derive recipients from stored on-chain state instead.

### F. Creator that rejects BNB bricks fee collection
If a token's creator is a contract that reverts on receive, `collectFees` reverts and the **platform's** half is also permanently unclaimable. Make the ETH split tolerant (best-effort creator send, always pay platform) or pull-based.

### G. Fallback V2 spot oracle is flash-loan manipulable
Off by default and gated behind a Chainlink outage — keep it disabled on mainnet, or switch to a TWAP if outage liveness is required.

---

## ✅ Verified sound (no action)

- **Bonding curve:** no buy/sell round-trip or drain extracts more BNB than deposited; rounding consistently favors the contract (`getAmountOut` floors, `getAmountIn` +1).
- **Reentrancy:** all entrypoints `nonReentrant`, CEI respected, `Token` has no transfer hooks; non-upgradeable `ReentrancyGuard` over ERC-7201 bases is proxy-safe in OZ v5.6.1.
- **Chainlink:** price≤0 / incomplete-round / staleness all checked; decimals normalized; no sequencer feed needed on BSC (correct).
- **Upgrade init hygiene:** `_disableInitializers()` in constructors; atomic proxy init; no orphaned initializer; `__gap` present.
- **Token.sol:** standard fixed-supply OZ ERC20, single constructor mint, no hidden mint/fee/blacklist; pre-launch transfer gate is correct and is what makes the "no pre-seeded liquidity" assumption hold.
- **Graduation brick-resistance:** V2 first-mint absorbs donated WETH; V3 aborts on hostile pre-init price via tolerance check with V2 fallback; whole graduation is atomic inside the crossing buy.
- **Distributor (post-fix):** status set before transfers (no reentrancy), stale VRF fulfillments ignored not reverted, pot capped at distributable balance, single reverting holder can't block the round.

---

## Test status

- **Distributor:** 20/20 pass (includes new H-1/M-1/M-2/L-1 regression tests).
- **Legacy fork suites** (`Fyuz.t.sol`, `ClaimFees.t.sol`, etc.): these fork **Ethereum/Uniswap** and inherit `FORK_URL` pointing at a dead Robinhood Alchemy endpoint (`.env` line 6). They fail to instantiate the fork — **not logic failures**. They are pre-BSC-migration tests. **Recommend** repointing them to a BSC fork + PancakeSwap addresses, or retiring them in favor of `FyuzBscPancake.t.sol` (the BSC-native end-to-end test).

## Residual trust assumptions to disclose to users

1. The proxy-admin key can upgrade to arbitrary code and take all TVL — must be multisig+timelock.
2. `owner()` can pause trading, retune fees (≤10%), and change fee/distributor recipients.
3. The $30k graduation target is USD-denominated but priced in volatile BNB; a large BNB drawdown can push the curve ceiling below target and brick graduation (documented in-code).
4. LP positions are permanently locked in the liquidity manager (by design).
5. The leaderboard pot is custodial until distributed; the Distributor owner can pause + emergency-withdraw.
