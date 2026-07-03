# ArrowPad — Engagement & Incentive Feature Roadmap

## Context

ArrowPad is a pump.fun-style bonding-curve launchpad on Robinhood Chain (EVM, id 4663) with a Solana adapter. Today it already has: token create/trade/graduation, King of the Hill, a **net-volume leaderboard → weekly ETH rewards (50% of fees)**, a **referral system** (`referral_info.referral_code` + `earnings`, `referrals` table), social **follows**, token **chat/replies**, **holders** tracking, and profiles.

The goal is to add features that **pull users back daily** and **reward the behaviors that grow the platform** (creating, trading, holding, referring, promoting) — without contract changes where avoidable, reusing the existing points/rewards plumbing.

Research (pump.fun / 2026 launchpad trends) points to the highest-leverage retention levers being: **daily quests/streaks, achievements/badges, referral virality, live FOMO feeds, creator rewards, and points→token airdrop narratives** ([pump.fun review](https://cryptoslate.com/launchpads/pump-fun-launchpad-review/), [Pumpland gamified launchpad](https://web3.bitget.com/en/crypto-news/pumpland-launch-the-new-frontier-for-gamified-memecoin-markets), [Gate: meme launchpad showdown](https://www.gate.com/learn/articles/meme-launch-platform-showdown-top-8-overview/4209)).

Everything below reuses the existing stack: **backend-rs** (axum + diesel + the blockchain listener that already writes `trades`/`tokens`/`holders`), **frontend** (Next.js views + SWR hooks), and the deployed **net-volume points** model in `get_leaderboard`.

---

## Tier 1 — Engagement layer (off-chain, no contract changes, highest ROI)

### 1. Rewards Hub: Quests + Daily Streaks
Directed tasks that grant bonus points, plus a daily check-in streak. Drives DAU and steers users toward growth actions.
- **Quests** (examples): "Make your first buy", "Hold a token to graduation", "Refer a friend who trades", "Create a token", "Trade $X net volume today".
- **Streaks**: consecutive days with ≥1 trade → escalating point multiplier.
- **Data**: new tables `quests` (definition), `user_quests` (progress/claimed), `user_streaks`. Progress is derived from existing `trades`/`tokens`/`referrals` rows — the blockchain listener already produces those, so quest evaluation is a query, not new indexing.
- **Backend**: `handlers/quests.rs` + routes; a `services` evaluator run on trade events (hook into `process_swap`/`process_token_created` in `services/blockchain.rs`) or lazily on GET.
- **Frontend**: a `Rewards`/`Quests` view + sidebar entry (pattern already established this session in `AppSidebar.tsx`), progress cards, claim button, streak flame.

### 2. Achievements / Badges
Non-transferable badges shown on profile for social proof: First Buy, Diamond Hands (held through graduation), Token Creator, Graduated Creator, Top-10 Leaderboard, Whale (single trade > $X), Streak-7/30.
- **Data**: `achievements` + `user_achievements`. Awarded by the same evaluator as quests.
- **Frontend**: badge row on `Profile.tsx` (next to the new Points/Reward tiles added this session).

### 3. Referral Dashboard + Referral Leaderboard
The referral system exists but is barely surfaced. Make it viral:
- Personal referral link/code, count of referred users, **fees/points earned from referees**, tiered bonuses (e.g., % of referees' points).
- A **referrals leaderboard** (reuse `get_leaderboard` shape).
- **Backend**: extend `handlers/users.rs` (referral data already there) with a referral-summary endpoint + referral leaderboard query.
- **Frontend**: `Referrals` view + share buttons; wire the existing `?ref=` capture already handled in `create_user`.

### 4. Live Activity Feed / FOMO Ticker
A realtime stream of "big buys", "new graduations", "new King" — the classic arcade FOMO driver. The infra already exists: the WS broadcaster in `services/ws.rs` already emits `Trade` and `Deployed` events over socket.io, and the frontend already subscribes.
- **Frontend-mostly**: a global ticker component fed by the existing socket events + a `/trades/recent` seed; a "Following" activity feed using the `follows` table (already present, currently unused for a feed).

---

## Tier 2 — Creator incentives (creators currently only pay fees)

### 5. Creator Rewards (fee share)
Route a slice of trading fees to the token creator. The contract already has `TOKEN_OWNER_FEE_BPS` (currently 0) in `foundry/src/Arrowpad.sol`.
- **Option A (no redeploy)**: track creator-attributable volume off-chain and pay from the weekly pool by points — fast, flexible.
- **Option B (contract)**: set `TOKEN_OWNER_FEE_BPS > 0` so creators earn per-trade on-chain — stronger but needs a contract owner tx / redeploy and audit care.

### 6. Creator Dashboard
Per-token analytics for creators: volume, unique holders, fees generated, **progress-to-graduation bar**, buy/sell pressure. All derivable from existing `trades`/`holders`/`tokens`.

---

## Tier 3 — Bigger bets (later)

- **Seasons & competitions**: time-boxed leaderboard "seasons" with a visible prize pot and countdown; themed trading competitions.
- **Points → token airdrop**: the pump.fun/PUMP playbook — accrued points become the allocation key for a future platform token. (Points ledger from Tier 1 is the prerequisite.)
- **Staking / fee tiers**: stake for boosted points or fee rebates; volume tiers that lower fees.
- **Watchlists + price alerts** (push/notification retention).
- **KotH enhancements**: crown history, time-held rewards, "dethrone" streaks.
- **Prediction mini-game**: wager points on which token graduates next.

---

## Recommended starting point

**Build Tier 1 as one cohesive "Engagement Layer" release**, because it: (a) reuses the deployed net-volume points + rewards system and the existing WS feed, (b) needs **zero contract changes**, (c) hits daily retention (streaks/quests), social proof (badges), virality (referrals), and FOMO (feed) together, and (d) creates the **points ledger** that later unlocks a token airdrop (Tier 3).

Suggested sequence within Tier 1: **Quests+Streaks → Achievements → Referral dashboard → Activity feed/ticker.**

---

## Verification (per feature, when built)
- Backend: unit-test the quest/achievement evaluator against seeded `trades`; hit new endpoints via curl and confirm JSON shapes; confirm points ledger reconciles with `get_leaderboard`.
- Frontend: drive the Rewards/Referrals views in the running app; confirm streak increments on a new trade (the listener writes the trade → GET reflects it); confirm badges render on profile; confirm the ticker updates from a live socket `m`/`deployed` event.
- End-to-end: perform a small buy on-chain → see quest progress + streak + activity ticker update within a block or two (WS + poll indexing is already live).

---

---

## Detailed first build (recommended): Rewards Hub core — Quests + Streaks + Achievements

Smallest shippable slice of Tier 1. No contract changes. Introduces a **points ledger** so all discrete/bonus points reconcile with the existing net-volume leaderboard and later feed an airdrop. (User was away at plan time; if they prefer a different Tier-1 slice, swap this section — the rest of the roadmap stands.)

### Data model (new diesel migration under `backend-rs/migrations/`)
- `points_ledger(id, user_id, source TEXT /* 'quest'|'streak'|'achievement'|'referral' */, amount FLOAT8, ref TEXT, created_at)` — canonical bonus-point events (trade points stay computed from `trades`).
- `quests(id, key, title, description, kind /* 'oneoff'|'daily' */, target FLOAT8, points FLOAT8, active BOOL)` — seeded with initial quests.
- `user_quests(id, user_id, quest_id, progress FLOAT8, completed_at, claimed_at, period_date DATE)` — `period_date` scopes daily quests; unique on `(user_id, quest_id, period_date)`.
- `user_streaks(user_id PK, current_streak INT, longest_streak INT, last_active_date DATE)`.
- `achievements(id, key, title, description, points FLOAT8)` + `user_achievements(user_id, achievement_id, earned_at)` (unique pair).
- Regenerate `backend-rs/src/schema.rs` (diesel) and add models in `backend-rs/src/models/`.

### Backend
- `handlers/rewards.rs` (+ `routes/rewards.rs`, nest `/rewards` in `routes/mod.rs`):
  - `GET /rewards/:address` → streak, quests w/ progress + claimable flag, achievements, total bonus points.
  - `POST /rewards/quests/:questId/claim` → validates completion, writes `points_ledger`, stamps `claimed_at`.
- `services/rewards.rs` — the evaluator (reused by both GET and event hooks):
  - `evaluate_user(user_id)`: derive quest progress from existing `trades`/`tokens`/`referrals`; award achievements; return state.
  - `touch_streak(user_id, trade_date)`: yesterday→increment, today→noop, gap→reset; award milestone points to ledger.
  - Hook calls into `services/blockchain.rs` `process_swap` and `process_token_created` (right after the trade/token row commits) so streaks/quests update in realtime, then emit a WS nudge via the existing `state.ws_tx` (see `WsEvent` in `lib.rs` / `services/ws.rs`).
- Fold bonus points into existing endpoints: in `get_leaderboard` and `get_user_profile` (`handlers/users.rs`), add `+ COALESCE((SELECT SUM(amount) FROM points_ledger WHERE user_id=…),0)` to `points`, and `reward_eth = points * 0.000006` stays.

### Frontend
- `views/Rewards.tsx` + `app/rewards/page.tsx`: streak flame, quest cards (progress bar + Claim), achievements grid. Reuse `priceFormatter`, `PageBox`, styling from `Leaderboard.tsx`.
- `hooks/rewards.tsx`: SWR hooks (`useRewards(address)`), refresh on the socket `m`/`deployed` events like `hooks/token.tsx` already does.
- Sidebar: add a **Rewards** item in `components/layout/AppSidebar.tsx` (same `items`/`target` pattern just used for Profile).
- Profile: badge row on `views/Profile.tsx` next to the Points/Reward tiles added this session.

### Verification
- Seed quests/achievements; `cargo test` the evaluator against seeded `trades`.
- curl `GET /rewards/<addr>` → shapes; `POST …/claim` → ledger row + points reflected in `get_leaderboard`.
- E2E in the running app: perform a small buy → within a block or two (WS+poll indexing already live) the streak increments, the "make a trade" daily quest completes, and the Rewards view + activity update.

## Open decision
Recommended first build is the **Rewards Hub core** above. Alternative Tier-1 slices (Referral growth, Activity feed) or Tier-2 (Creator rewards) can be detailed instead on request.

---

## Implementation status (as built)

**Live / deployed:**
- **Tier 1.1 Rewards Hub** — `handlers/rewards.rs`: `GET /rewards/:address`, `POST /rewards/:address/claim/:questKey`; 5 quests (one-off + daily), daily streak, 5 achievements; idempotent `points_ledger` (UNIQUE `ref`); bonus points folded into `get_leaderboard` + `get_user_profile`. Frontend `/rewards`, sidebar entry, profile badges.
- **Tier 1.2 Referrals** — `handlers/referrals.rs`: `GET /referrals/:address`, `GET /referrals/leaderboard`; `?ref=` capture wired into auto-register. Frontend `/referrals`.
- **Tier 1.3 Activity ticker** — `components/ActivityTicker.tsx` on Home, fed by the existing `/trades/recent` + socket feed.
- **Tier 2 Creator** — `handlers/creator.rs`: `GET /creator/:address` (per-token volume, fees, holders, traders, graduation progress). +50 idempotent bonus points per graduated token, granted in the rewards evaluator. Frontend `/creator`, sidebar entry.
- **Tier 3 Watchlist** — `handlers/watchlist.rs`: `POST /watchlist/toggle`, `GET /watchlist/:address`; `watchlist` table. Star toggle on the token page, `/watchlist` view, sidebar entry.
- **Tier 3 Points→airdrop narrative** — informational banner on `/rewards` framing points as future-airdrop weight (points ledger is the prerequisite, now in place).

**Deferred (need product / economic / contract decisions):**
- **Seasons with a real prize pot** — needs a funded pool + payout mechanism decision (leaderboard is season-ready via date ranges).
- **Actual points→token airdrop** — needs a platform token + distribution contract.
- **Staking / on-chain fee tiers** — needs staking contract or `TOKEN_OWNER_FEE_BPS`/fee-tier changes to `Arrowpad.sol` (owner tx / redeploy + audit).
- **KotH crown history / price alerts** — small follow-ups; `kings` table already stores history for a "Hall of Kings".

All engagement points are **off-chain and idempotent**; the weekly ETH reward is still distributed manually from the points totals (`reward_eth = points * 0.000006`).

---

## Final status — all planned features LIVE

Deployed + endpoint-verified:
- Tier 1.1 Rewards Hub — `GET/POST /rewards/...` ✅
- Tier 1.2 Referrals — `/referrals/:a`, `/referrals/leaderboard` ✅
- Tier 1.3 Activity ticker — Home ✅
- Tier 2 Creator dashboard + graduation reward — `/creator/:a` ✅
- Tier 3 Watchlist — `/watchlist/...` ✅
- Tier 3 Season leaderboard — `/season` (countdown + prize pot) ✅
- Tier 3 Hall of Kings — `/kings/history` ✅
- Tier 3 Airdrop page — `/airdrop/:a` (points→allocation share) ✅
- Tier 3 Trader Tier — `/tier/:a` (Bronze/Silver/Gold/Diamond) ✅

Still deferred (need economic/contract decisions, not code):
- On-chain fee-tier discounts / staking rewards (need Arrowpad.sol changes or a staking contract).
- A real token airdrop distribution (needs a platform token + distributor).
- Funding the Season prize pot + automated payout (pool is display-only today; weekly rewards still distributed manually from points).
