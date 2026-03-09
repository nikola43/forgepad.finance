# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Forgepad.finance is a multi-chain token launchpad with dynamic bonding curves. Currently active on BSC (Ethereum, Base, and Solana are configured but commented out). The platform enables token creation, bonding curve trading, and automated liquidity provision.

## Repository Structure

Four independent packages (not a monorepo — each has its own package.json and dependencies):

- **frontend/** — Next.js 15 (React 19) with static export, MUI 7, Wagmi/Viem for EVM, Reown AppKit for wallet connectivity
- **backend/** — Express.js API with Socket.io, Sequelize ORM on Supabase PostgreSQL, Web3.js/Ethers.js for chain interactions
- **contracts/** — Hardhat smart contracts (Solidity 0.8.26–0.8.28), factory pattern with bonding curves, Uniswap/PancakeSwap integration
- **mbc/** — Meteora Dynamic Bonding Curve integration for Solana (TypeScript)

## Commands

### Frontend (from `frontend/`)
```bash
npm run dev        # Next.js dev server
npm run build      # Production build (static export)
npm run build:cf   # Cloudflare-optimized build
npm run lint       # ESLint
```

### Backend (from `backend/`)
```bash
npm start          # node-dev index.js (auto-reload dev server, port 5000 default)
```

### Contracts (from `contracts/`)
```bash
npm run compile    # Hardhat compile
npm test           # Hardhat tests (Mocha/Chai/Waffle)
npm run localtest  # Tests on localhost network
npm run deploy     # Deploy contracts
npm run verify     # Etherscan verification
npm run rpc        # Start Ganache local fork
```

### MBC (from `mbc/`)
```bash
npm run build      # TypeScript compilation
npm run dev        # ts-node development
```

## Architecture Details

### Frontend
- **App Router** with three pages: `/` (home/listing), `/forge` (token creation), `/token` (token detail with chart)
- **Wallet integration**: Reown AppKit wrapping Wagmi — configured in `src/context/`
- **Config**: `src/config/index.ts` controls API endpoint and environment switching (`isDevEnv` flag)
- **Data fetching**: SWR + TanStack React Query; custom hooks in `src/hooks/` (token.tsx, user.tsx)
- **Static export**: `output: 'export'` in next.config.ts — no server-side rendering
- **Webpack**: chunk splitting at 200KB max, cache disabled, externals for pino-pretty/lokijs/encoding

### Backend
- **MVC pattern**: `app/controllers/`, `app/models/`, `app/routes/`
- **Database**: Supabase PostgreSQL via Sequelize, connection URL parsed from `SUPABASE_URL` env var
- **Models**: tokens, trades, holders, chats, users, followers, followees, requests, indexing, referrals, referral_info, kings, admins
- **Real-time**: Socket.io attached to HTTP server for WebSocket events
- **Chain listeners**: `app/listeners/tokens.listener.js` watches blockchain events and emits via Socket.io
- **Chain config**: `app/config/web3.config.js` defines supported chains with contract addresses, ABIs, bonding curve parameters (virtualEthAmount, virtualTokenAmount, totalSupply, targetMarketCap)
- **File storage**: Supabase S3 for token logos

### Smart Contracts
- **Forgepad.sol** — Main factory: creates tokens, manages bonding curves, handles buy/sell
- **Token.sol** — ERC20 token template deployed by factory
- **ForgepadLiquidityManager.sol** — Automated LP creation when market cap target is reached
- **Distributor.sol / EthismFeeDistributor.sol** — Fee distribution
- **Hardhat config**: BSC fork for local testing (chainId 56, block 68218718), Solidity optimizer with viaIR enabled
- **Networks**: BSC (primary), Ethereum, Base, Arbitrum, Avalanche, PulseChain, Sepolia

### Bonding Curve Mechanics
Each chain config defines: `virtualEthAmount`, `virtualTokenAmount`, `totalSupply`, `targetMarketCap`. When market cap target is hit, liquidity is automatically provided to the configured DEX pool (e.g., `pancakeswap:v2` on BSC).

## Environment Variables

### Backend (.env)
- `SUPABASE_URL` — PostgreSQL connection string (parsed for host/user/password/port/db)
- `SUPABASE_S3_URL`, `SUPABASE_S3_API_KEY`, `SUPABASE_S3_SECRET` — File storage
- `JWT_SECRET_KEY` — Auth tokens
- `PORT` — Server port (default 5000)

### Frontend (.env.local)
- `NEXT_PUBLIC_PROJECT_ID` — Reown AppKit project ID

### Contracts (.env)
- `PRIVATE_KEY` — Deployer wallet
- Etherscan/BSCScan API keys for verification

### MBC (.env)
- `SOLANA_RPC_URL`, `SOLANA_PRIVATE_KEY`, `SOLANA_QUOTE_MINT`

## Ruflo (Agent Orchestration)

Ruflo v3.5.14 is configured for multi-agent orchestration via MCP (`.mcp.json`). Use specialized agents for parallel work across the four packages.

**Key agents for this project:**
- `coder` — Implementation across frontend/backend/contracts
- `tester` — Run and validate contract tests (`contracts/npm test`)
- `reviewer` — Code review before merging
- `system-architect` — Cross-package architecture decisions
- `sparc-coder` — TDD workflow for new features

**Swarm commands:**
```bash
ruflo swarm init --topology hierarchical   # Start a coordinated swarm
ruflo memory search -q "query"             # Search project memory
ruflo memory stats                         # View memory usage
```

**Configuration files:**
- `.mcp.json` — MCP server config (ruflo)
- `.claude/settings.json` — Hooks (pre/post edit, bash, session)
- `.claude/agents/` — 99 agent definitions across 24 categories
- `.claude/skills/` — 30 skills (SPARC, swarm, GitHub, etc.)
- `.claude-flow/config.yaml` — Runtime config
- `.swarm/memory.db` — Persistent vector memory with HNSW indexing

## Key Patterns

- Currently only BSC chain is active in production (other chains are commented out in `web3.config.js`)
- Frontend uses `isDevEnv` flag in `src/config/index.ts` to switch between localhost:5001 and api.forgepad.finance
- Contract ABIs live in `backend/app/listeners/` as JSON files (EthismV1.json, MeteoraDBC.json)
- The Hardhat test suite forks BSC mainnet — tests require network access
- No Docker setup — each component runs independently
- No CI/CD pipeline configured
