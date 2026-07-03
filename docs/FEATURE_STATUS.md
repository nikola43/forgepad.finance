# ArrowPad — Engagement Features: Status & Future Work

Last updated: 2026-07-03. Companion to `ENGAGEMENT_ROADMAP.md` (the full design).

This file is the quick reference: **what is shipped** vs **what is intentionally parked for later** (and what each parked item needs before it can be built).

---

## ✅ DONE — implemented, deployed, and verified live

All engagement points are **off-chain** and recorded in an idempotent `points_ledger`
(UNIQUE `ref` so nothing is ever double-granted). One point is worth
`0.000006 ETH` and folds into the existing net-volume leaderboard + profile.

| Feature | What it does | Backend | Frontend |
|---|---|---|---|
| **Rewards Hub** | 5 quests (one-off + daily) + daily trading streak, claimable for points | `handlers/rewards.rs` — `GET /rewards/:addr`, `POST /rewards/:addr/claim/:questKey` | `/rewards`, sidebar |
| **Achievements / badges** | First Blood, Creator, Whale, Graduate, Week Warrior — auto-granted, shown on profile | in `rewards.rs` | profile badge row |
| **Referrals** | Personal link + `?ref=` capture, referee list, referral leaderboard | `handlers/referrals.rs` — `GET /referrals/:addr`, `GET /referrals/leaderboard` | `/referrals`, sidebar |
| **Activity ticker** | Live FOMO marquee of recent buys/sells | reuses `/trades/recent` + socket | Home ticker |
| **Creator rewards** | +50 points per token you created that graduates | graduation grant in `rewards.rs` | shown in `/rewards` |
| **Creator dashboard** | Per-token volume, fees (1%), holders, unique traders, graduation progress | `handlers/creator.rs` — `GET /creator/:addr` | `/creator`, sidebar |
| **Watchlist** | Star tokens for quick access | `handlers/watchlist.rs` — `POST /watchlist/toggle`, `GET /watchlist/:addr`; `watchlist` table | star on token page, `/watchlist`, sidebar |
| **Season leaderboard** | Time-boxed competition, live countdown, prize-pot display | `handlers/season.rs` — `GET /season` (constants: `SEASON_START/END`, `PRIZE_POT_ETH`) | `/season`, sidebar |
| **Hall of Kings** | History of King-of-the-Hill reigns + duration | `handlers/kings.rs` — `GET /kings/history` (from existing `kings` table) | `/kings`, sidebar |
| **Airdrop page** | Frames accrued points as future-token allocation weight (your points, rank, share %) | `handlers/airdrop.rs` — `GET /airdrop/:addr` | `/airdrop`, sidebar |
| **Trader Tier** | Bronze / Silver / Gold / Diamond by lifetime volume (display-only) | `handlers/tier.rs` — `GET /tier/:addr` | `/tier`, `TraderTierBadge`, sidebar |

Also shipped earlier this session (fixes, not engagement): net-volume leaderboard
formula, 1% fee correction, reward ETH+USD display, favicon = logo, chain logo,
Blockscout explorer, RPC split (Alchemy UI / public node indexer), case-insensitive
token lookup, `fetch_pool_type` selector fix, buy/sell/approve gas-estimation via
read RPC + "Insufficient balance" toasts.

---

## 🔜 FUTURE — designed but NOT built yet (waiting on your decision)

These are intentionally deferred. Each needs a product/economic/contract decision
before it's worth building — code alone won't finish them.

### 1. On-chain fee-tier discounts / staking rewards
- **Idea:** lower trading fees or boost points for stakers / high-volume tiers.
- **Blocked on:** a staking contract, and/or changes to `foundry/src/Arrowpad.sol`
  (`PLATFORM_BUY_FEE_BPS` / `PLATFORM_SELL_FEE_BPS` / a per-address fee override).
  Requires an owner tx or redeploy + audit. The **Trader Tier** UI already exists
  and can drive the display side once the on-chain side is decided.

### 2. Real token airdrop distribution
- **Idea:** convert accrued points into an actual token allocation.
- **Ready:** the `points_ledger` (the allocation key) is fully in place, and the
  `/airdrop` page already shows each user's share.
- **Blocked on:** minting a platform token + a distributor/claim contract + a
  snapshot policy. Pure business/tokenomics decision.

### 3. Funded Season prize pot + automated payout
- **Idea:** the Season leaderboard pays real ETH automatically at season end.
- **Ready:** `/season` computes the ranked board and shows a pot.
- **Blocked on:** deciding pot funding source (share of platform fees) and building
  a payout job. Today the pot is **display-only**; weekly rewards are still
  distributed **manually** from point totals (`reward_eth = points * 0.000006`).

### 4. Creator fee-share on-chain (vs. current off-chain points)
- **Now:** creators earn points (graduation bonus) + see fees in the dashboard.
- **Future:** pay creators a live cut per trade by setting `TOKEN_OWNER_FEE_BPS > 0`
  in `Arrowpad.sol` (currently 0). Contract change + audit.

### 5. Smaller follow-ups (code-only, low risk — do anytime)
- **Price / watchlist alerts** (needs a notification channel: email / web push).
- **KotH extras:** "dethrone" streaks, time-held bonus (the `kings` history is
  already surfaced).
- **Nav consolidation:** the sidebar has 12 items — group Season under Leaderboard,
  Airdrop under Rewards, Tier under Profile for a tighter UX.

---

## Notes for whoever picks this up
- New DB tables added this session: `points_ledger`, `watchlist` (both in the DB
  **and** appended to `migrations/00000000000000_create_schema/up.sql` for fresh deploys).
- Everything is raw `diesel::sql_query` (see `handlers/rewards.rs` for the pattern) —
  no new `schema.rs`/model boilerplate.
- Reward economics knob: `reward_eth = points * 0.000006` (in `users.rs` leaderboard
  + profile, and `airdrop.rs`). Change in one place per file if you retune.
