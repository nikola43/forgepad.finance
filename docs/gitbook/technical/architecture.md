# 🏗️ Architecture

For the technically curious: what Fyuz is actually made of.

## The stack

```
┌─────────────────────────────────────────────────────┐
│  Frontend — Next.js + MUI, Reown AppKit wallets     │
└──────────────────────────┬──────────────────────────┘
                           │ REST + WebSocket
┌──────────────────────────▼──────────────────────────┐
│  Backend — Rust (Axum), one binary                  │
│  · REST API + Socket.IO realtime                    │
│  · Chain indexer (event ingestion, reorg-aware)     │
│  · AI image-generation job queue                    │
│  · Points, quests, referrals, leaderboard engine    │
└───────┬──────────────┬───────────────┬──────────────┘
        │              │               │
   PostgreSQL        Redis        S3 (MinIO)
   (trades, users,  (jobs, anti-  (fusion images)
    tokens, points)  replay)
                           │
┌──────────────────────────▼──────────────────────────┐
│  BNB Smart Chain (56)      │  Robinhood Chain (4663)│
│  · Fyuz — bonding curves, fees, graduation          │
│  · PancakeSwap (BSC) / V2-V3 (Robinhood) —          │
│      post-graduation liquidity                      │
│  · Chainlink — BNB/USD (BSC), ETH/USD (Robinhood)   │
│                                                     │
│  BSC only:                                          │
│  · Distributor — reward rounds + VRF v2.5 lottery   │
│  · CREPoster — Chainlink CRE drives each round      │
└─────────────────────────────────────────────────────┘
```

## Design choices worth knowing

* **One Rust binary** runs the API, the indexer, and the websocket hub — no microservice sprawl, deployed as a single container.
* **The chain is the source of truth.** The backend indexes on-chain events (with a configurable confirmation lag for reorg safety); the database is a queryable cache of chain reality, not a parallel ledger.
* **Points are an idempotent ledger.** Every grant is keyed by a unique reference — re-running any computation can never double-pay.
* **Anti-replay signatures.** Paid or state-changing API actions require fresh, single-use wallet signatures tracked in Redis (fail-closed).
* **Async image jobs.** AI generation runs as background jobs with polled progress — a dropped connection never wastes a render.
* **Provider-agnostic AI.** The image pipeline speaks the OpenAI-compatible API shape and currently runs FLUX.2 Pro via Together AI, with local CPU (stable-diffusion.cpp) and mock providers as drop-in fallbacks.

## Realtime

Trades, new launches, and graduations stream to the UI over Socket.IO the moment the indexer confirms them — charts and boards update without refreshes.
