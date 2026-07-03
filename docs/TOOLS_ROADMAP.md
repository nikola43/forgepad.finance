# ArrowPad — Trader Tools, Discovery & Streaming (Growth Round 2)

## Context

ArrowPad now has a deep **engagement layer** (rewards, quests, referrals, seasons, creator tools, watchlist, tiers). What it still lacks — and what actually pulls new traders in daily on the platforms they already use — are **discovery, portfolio/PnL, safety analytics, wallet/top-trader tracking, live streaming, and a risk-free way to learn**. This round adds those "tool sections" so a new user landing on ArrowPad finds the same firepower as GMGN / Axiom / DexScreener / pump.fun.

Research (2026 terminals) — what the leaders have that we don't:
- **Discovery**: trending/"Trenches" feed, new-pairs scanner, gainers/losers, rich filters — [DexScreener screener](https://www.dextools.io/tutorials/how-to-use-dexscreener-token-screener-tutorial-2026), [terminals ranked 2026](https://www.mexc.com/news/1031729).
- **Portfolio + realized/unrealized PnL**, **wallet tracker**, **top-traders-per-token (PnL)**, **AI/rug safety scans** — GMGN/Axiom.
- **Livestreaming on the coin page** — pump.fun's signature growth loop.
- **Trading simulator / paper trading** — DEXTools; the best low-risk onboarding hook for new users.

Everything below **reuses existing data** (the indexer already fills `trades`, `tokens`, `holders`, `users`, `chats`) and the established patterns: raw-SQL axum handlers (`backend-rs/src/handlers/rewards.rs`), route files (`src/routes/*.rs`), Next.js views + SWR hooks + `AppSidebar` items. `list_tokens` (`handlers/tokens.rs`) already supports `order_type` (createdAt / trends / bump with a decay `score`), `network`, `search_word`, paging — the screener extends it rather than replacing it.

---

## Tier A — Discovery & Portfolio (highest ROI, pure data reuse, no new infra)

### A1. Discover / Trending screener
A dedicated **/discover** terminal with tabs **Trending · New · Gainers · About-to-Graduate**, plus filters.
- **Backend**: extend `list_tokens` `ListTokensQuery` with `order_type` values `marketcap | volume | holders | graduation | gainers` and new optional filters `min_marketcap`, `min_volume`, `min_holders`, `max_age_secs`, `status` (bonding|graduated). Compute volume/holders/price-change via joins/subqueries on `trades`/`holders` (24h window from `traded_at`). Reuse the existing raw-SQL path already used for `trends`/`bump`.
- **Frontend**: `views/Discover.tsx` + `/discover` page + sidebar; filter bar + tab switch; reuse `TokenCard`.

### A2. Portfolio / PnL tracker
**/portfolio** — the page traders return for.
- **Backend** `handlers/portfolio.rs` — `GET /portfolio/:address`: per token the wallet holds or traded, cost basis = Σ(buy eth·ethPrice) − Σ(sell proceeds), current value = on-curve balance × current price, **unrealized PnL**, **realized PnL**, ROI%. Totals across all positions. All from `trades` + `holders` + `tokens.price`.
- **Frontend**: `views/Portfolio.tsx` + hook + `/portfolio` page + sidebar. Holdings table (token, balance, value, PnL $/%), header totals.

---

## Tier B — Analytics & Trust (depth that builds confidence)

### B1. Token safety / analytics panel (on the token page)
- **Backend** `GET /tokens/:net/:addr/analytics`: holder count, **top-10 holder %**, **creator holdings %**, buy/sell counts + pressure, **bundle flag** (multiple buys same block/`traded_at`+`log_index` cluster at creation), graduation %.
- **Frontend**: an "Analytics/Safety" card/tab on `views/Token.tsx` with a simple risk read-out (concentration, dev %, graduated/LP).

### B2. Top Traders + Wallet tracker (GMGN's hook)
- **Backend**: `GET /tokens/:net/:addr/top-traders` (per-token PnL leaderboard, labels: creator/whale) and `GET /wallet/:address` (any wallet's trades, realized+unrealized PnL, win-rate, tokens traded, volume).
- **Frontend**: "Top Traders" tab on the token page + a `views/Wallet.tsx` explorer at `/wallet/:address` (link every address across the app to it).

---

## Tier C — Streaming & Onboarding (pump.fun growth loop + new-user magnet)

### C1. Livestreaming on token pages — NATIVE in-app broadcast (chosen)
Creators broadcast **from the browser** (camera / mic / screen-share) directly on their coin page; viewers watch + chat live in-platform — the full pump.fun loop, no third-party embed.
- **Media infra**: self-hosted **LiveKit** (open-source WebRTC SFU) added as a `docker-compose` service (`livekit/livekit-server`), with `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` env; it ships an embedded TURN for NAT traversal. Signaling (wss) + the LiveKit endpoint are exposed through the existing **cloudflared tunnel** on a subdomain (e.g. `livekit.arrowpad.io`). One room per token (room name = token address).
- **Backend** `handlers/stream.rs`: mint LiveKit access tokens (JWT, HS256 over the API secret with LiveKit's `video` grant claims — use the `jsonwebtoken` crate already implied by the stack):
  - `POST /stream/start` (creator, signed via `verify_signed_action`) → token with `canPublish` for their room; set `is_live=true`, `stream_started_at`.
  - `GET /stream/:tokenAddress/join?address=…` → viewer (subscribe-only) token; bump viewer count.
  - `POST /stream/stop` (creator) → `is_live=false`.
  - Schema: `streams` table (or `tokens.is_live BOOL`, `tokens.stream_started_at`), + a `viewers` counter (redis or table).
- **Frontend**: `@livekit/components-react` + `livekit-client`. Token page: creator sees **Go Live** (publish cam/mic/screen); everyone else auto-subscribes to the video + a **🔴 LIVE (n watching)** badge that also shows in Discover/Home listings. Live chat reuses the existing `chats` + socket.
- **Ops note**: WebRTC/LiveKit is the one piece needing a new service + tunnel route; it's self-contained in docker and does not touch the chain/indexer.

### C2. Trading simulator / paper trading (onboarding)
A risk-free "practice mode" so newcomers learn the bonding curve before spending ETH.
- **Backend** `handlers/paper.rs` + `paper_positions` table: virtual ETH balance per address; buy/sell run the **same bonding-curve math** the contract uses (mirror `getAmountOut` from `foundry/src/Arrowpad.sol`) against live reserves — no chain tx. Track simulated PnL; optional "paper leaderboard".
- **Frontend**: a "Practice" toggle on the trade box (or `/simulator`) with a clear "SIMULATED" banner.

---

## Build order (decided: build everything, in tiers)
Ship **A → B → C in sequence**, deploying + verifying each tier before the next:
- **Tier A** (Discover screener + Portfolio/PnL) — pure data reuse, no infra; fastest pull. Parallelizable via an ultracode workflow (screener + portfolio are independent).
- **Tier B** (analytics panel + top-traders + wallet tracker) — independent endpoints; parallelize the finders/handlers via a workflow, wire centrally.
- **Tier C** (native streaming + paper trading) — streaming needs the **LiveKit docker service + tunnel route** (the only new infra); paper trading is independent and can be built in parallel.
Each tier follows the proven loop from last round: new files per feature (disjoint paths) → I wire the central files → one build → deploy → verify.

## Critical files
- Backend: `handlers/tokens.rs` (extend `list_tokens`), new `handlers/{portfolio,analytics,wallet,paper}.rs` + matching `routes/*.rs`, wire in `handlers/mod.rs`/`routes/mod.rs`; migration append in `migrations/00000000000000_create_schema/up.sql` for `stream_url`/`paper_positions`.
- Frontend: new `views/{Discover,Portfolio,Wallet,Simulator}.tsx` + hooks + `app/*/page.tsx`; edits to `views/Token.tsx` (analytics/top-traders/stream) and `components/layout/AppSidebar.tsx`.
- Reuse: raw-SQL handler pattern (`handlers/rewards.rs`), `TokenCard`, `priceFormatter`, socket feed (`services/ws.rs`), `verify_signed_action` (`middleware/auth.rs`).

## Verification
- Backend: curl each new endpoint; check PnL reconciles against a known wallet's `trades`; screener filters return expected sets.
- Frontend: drive `/discover`, `/portfolio`, `/wallet/:a` in the running app; set a stream URL → 🔴 LIVE badge + embed renders; paper-buy updates simulated PnL.
- E2E: a small real buy → appears in Discover "New", in the wallet's Portfolio with correct PnL, and in the token's Top Traders.

## Decisions locked
- **Scope:** build all tool sections, Tier A → B → C in sequence.
- **Streaming:** native in-app WebRTC broadcast via self-hosted LiveKit (not external embed).

---

## Status — all three tiers SHIPPED

- **Tier A** ✅ `/discover` screener + `/portfolio` PnL (handlers `discover.rs`/`portfolio.rs`, views + sidebar).
- **Tier B** ✅ Token **Analytics** tab + **Top Traders** (`analytics.rs`, `TokenAnalyticsPanel` wired into `views/Token.tsx`) + `/wallet` explorer (`wallet.rs`).
- **Tier C** ✅ Native LiveKit streaming + paper trading:
  - Backend `handlers/stream.rs` — `POST /stream/start|stop` (creator, signature-gated), `GET /stream/:addr` (status/badge), `GET /stream/:addr/join` (viewer token), `POST /stream/:addr/heartbeat`. Mints LiveKit HS256 JWTs (`jsonwebtoken`); live viewer count in Redis (`stream_viewers:<addr>` ZSET). `tokens.is_live` / `stream_started_at` columns added.
  - Backend `handlers/paper.rs` — `GET /paper/:addr`, `POST /paper/buy|sell|reset`. Mirrors `Arrowpad.getAmountOut` (constant-product, 1% fee) against live `virtual_eth_amount`/`virtual_token_amount`. Tables `paper_accounts` (10 ETH start) + `paper_positions`.
  - Frontend — `components/StreamPanel.tsx` (LiveKit `LiveKitRoom`/`VideoConference`), **Live** tab + 🔴 LIVE badge on `views/Token.tsx`; `views/Simulator.tsx` at `/simulator` + **Practice** sidebar item. Hooks `stream.tsx`/`paper.tsx`.

### Ops / deploy notes for Tier C streaming
- New docker-compose service **`livekit`** (`livekit/livekit-server`), config in `livekit/livekit.yaml`, keys injected via `LIVEKIT_KEYS` env (no secret committed).
- **Required env** (backend + livekit must share the key/secret):
  - `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (≥32 chars) — same value on both services.
  - `LIVEKIT_URL` — the **public wss** the browser connects to (e.g. `wss://livekit.arrowpad.io`); defaults to `ws://localhost:7880` for local.
- Expose LiveKit signaling (7880) through the cloudflared tunnel as a subdomain; forward media ports 7881/tcp + 50000-50100/udp, and enable TURN in `livekit.yaml` for production NAT traversal.
- Without LiveKit configured everything degrades gracefully: `is_live` stays false, the Live tab shows "No live stream", paper trading is unaffected.
