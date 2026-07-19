# Fyuz Graduation Report — V2 & V3 (BSC fork)

**Date:** 2026-07-19 · **Environment:** BNB Smart Chain mainnet fork (real PancakeSwap, real Chainlink BNB/USD) · **BNB price at capture:** ~$566.90

Two tokens were launched on the bonding curve and driven to graduation — one onto **PancakeSwap V2**, one onto **PancakeSwap V3** — capturing price in both **BNB** and **USD** at every step. Full data + charts are in the accompanying spreadsheets:

- `fyuz_graduation_report.xlsx` — single-page workbook: summary (V2 vs V3), both data tables, and per-market charts (price in BNB, price in USD, market cap vs the $30k target), split into "bonding curve" and "DEX (post-graduation)" series so the transition is visible. Prices are stored in ×1e-9 BNB / ×1e-6 USD units so every viewer parses them. Regenerate with `python3 scripts/graduation_report.py` (runs the capture test itself, or pass a saved forge log).
- `fyuz_graduation_v2.xlsx` / `fyuz_graduation_v3.xlsx` — earlier per-market workbooks, superseded by the single-page report.

## Results

| Metric | V2 | V3 |
| --- | --- | --- |
| Opening market cap | $4,358 | $4,358 |
| Graduation market cap | $29,104 | $29,104 |
| BNB raised to graduate | 13.6 BNB | 13.6 BNB |
| Opening price | 7.69e-9 BNB ($4.4e-6) | same |
| DEX opening price | 5.29e-8 BNB ($3.0e-5) | 5.29e-8 BNB ($3.0e-5) |
| Curve → DEX price gap | **+3.08%** | **+3.08%** |
| Price appreciation, launch → DEX | **~6.9×** | ~6.9× |

## What the numbers confirm

1. **The curve is correctly calibrated for BNB.** Opening mcap ~$4.4k rises smoothly to the $30k graduation target; the curve ceiling clears the target (a past miscalibration bricked graduation at ~$19.7k — regression-tested).
2. **Graduation is near-continuous.** The DEX pool opens only **+3.08%** above the last curve price — no large gap for arbitrage to bleed the locked liquidity. Both pool types open at the **same** price, confirming the target-mcap seeding logic is consistent across V2 and V3.
3. **No value leaks at graduation.** A dedicated fork test (`test_graduationLeavesNoMargin`) proves **0 BNB** is diverted — 100% of the raised BNB is seeded into the locked pool. (This empirically disproves an audit estimate that ~47% went to a "margin recipient"; that address has since been removed entirely.)
4. **Fees are exactly 0.5% / 0.3% / 0.2%.** Verified per-trade: treasury 0.5%, leaderboard 0.3%, creator 0.2% — and each is now independently tunable on-chain without an upgrade.

## Test status (BSC-relevant suites, all green)

| Suite | Result |
| --- | --- |
| `FyuzBscPancakeTest` (fork: graduation V2+V3, fee split, no-margin, oracle, V4-rejected) | 7/7 ✅ |
| `DistributorTest` (rewards, VRF lottery, share math, claim, access) | 20/20 ✅ |
| `GraduationCurveTest` (this report's data capture, V2+V3) | 2/2 ✅ |
| `PancakeV3Slot0Test` (V3 slot0 ABI) | ✅ |

> Legacy `*.t.sol` suites that fork **Ethereum/Uniswap** via the retired `robinhood` RPC still fail to instantiate their fork — they are pre-BSC-migration tests, not logic failures, and should be repointed to BSC or retired.

## Mainnet-readiness

**Contract logic: ready.** Curve math, graduation, fee split, reward distribution, and both DEX paths are verified on a mainnet fork. Distributor audit findings (winner-fixing, share-sum, gas-limit, stranded payouts) are fixed and regression-tested. The `marginRecipient` value-leak concern is removed.

**Before deploying, the operational steps from `mainnet-audit-2026-07-19.md` still stand:**
1. Set the `MULTISIG` (Gnosis Safe) env var — it becomes both ProxyAdmins, both owners, and treasury. Deployer retains zero roles (asserted in the script).
2. Deploy the **Distributor first** (mainnet VRF coordinator `0xd691f04bc0C9a24Edb78af9E005Cf85768F694C9`, 200-gwei keyHash) and pass its address as `DISTRIBUTOR` so the 0.3% leaderboard stream reaches it.
3. Run `DeployBsc.s.sol` (now guards `chainid == 56`, sets the 0.5/0.3/0.2 split, hands ownership to the multisig, and asserts the final wiring).
4. Verify contracts on BscScan; run one small real-BNB smoke test (create → buy → sell → graduate) and one Distributor round.

The one accepted trust assumption, per your decision: **no timelock** on the multisig — the Safe threshold is the sole guard on upgrades, so use a high threshold and trusted signers.
