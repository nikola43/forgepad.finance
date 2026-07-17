#!/usr/bin/env bash
#
# Fyuz localnet: anvil BSC mainnet fork + contracts + dockerised backend.
#
#   ./scripts/localnet.sh            # (re)start the whole localnet
#   ./scripts/localnet.sh --keep-db  # same, but don't wipe indexed tokens
#   ./scripts/localnet.sh --reset-db # DESTROY the pg volume and re-seed the schema
#
# Use --reset-db if you see 500s like 'relation "watchlist" does not exist' or
# 'column t.is_live does not exist': postgres only runs docker-entrypoint-initdb.d
# on an EMPTY data dir, so a pgdata volume created by an older schema never picks
# up changes to migrations/ and silently drifts from the code.
#
# Then run the frontend separately:  cd frontend && npm run dev   -> :3000
#
# FORK_RPC MUST BE AN ARCHIVE NODE. anvil pins the fork at one block and fetches
# state lazily, so it keeps querying that block forever. Non-archive nodes prune
# behind head, and once the fork block is gone every *new* account touch fails
# with "missing trie node" — including the account check inside `new Token(...)`,
# which makes createToken revert with a confusing ethers "missing revert data".
# bsc-dataseed / 1rpc / meowrpc / pokt are all NON-archive and will do this.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_HOST="http://127.0.0.1:8545"          # what the browser + forge talk to
RPC_DOCKER="http://host.docker.internal:8545"  # what the backend container talks to
FORK_RPC="${FORK_RPC:-https://bsc-mainnet.public.blastapi.io}"  # archive — see above
ANVIL_LOG="${TMPDIR:-/tmp}/fyuz-anvil.log"
# The localnet serves BSC's forked state under its OWN chain id. It must NOT be 56:
# wallets match 56 to their built-in BNB Smart Chain network and would route
# transactions to real mainnet instead of this fork. Keep in step with
# NEXT_PUBLIC_BSC_CHAIN_ID in frontend/.env.local.
LOCAL_CHAIN_ID="${LOCAL_CHAIN_ID:-31337}"
# anvil's first dev account, funded with 10000 BNB on the fork.
DEV_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

KEEP_DB=0
RESET_DB=0
case "${1:-}" in
  --keep-db)  KEEP_DB=1 ;;
  --reset-db) RESET_DB=1 ;;
  "")         ;;
  *) echo "unknown flag: $1 (use --keep-db or --reset-db)"; exit 1 ;;
esac

# Stop the backend BEFORE the chain moves. A running indexer holds a cursor from
# the previous fork; once anvil re-forks at a new block that cursor is in the past,
# so anvil proxies getLogs upstream — where archive providers cap the range (blastapi
# allows 10 blocks) and the listener wedges into a retry loop.
echo "==> Stopping backend while the chain is replaced"
docker compose -f "$ROOT/docker-compose.yml" stop backend >/dev/null 2>&1 || true

echo "==> Restarting anvil (BSC fork, chainId $LOCAL_CHAIN_ID)"
pkill -f "anvil --fork-url" 2>/dev/null || true
sleep 1
# --host 0.0.0.0 so the dockerised backend can reach it via host.docker.internal.
anvil --fork-url "$FORK_RPC" --chain-id "$LOCAL_CHAIN_ID" --host 0.0.0.0 --port 8545 \
      --no-rate-limit > "$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!
# Poll the RPC itself: the log line appears fractionally before the socket accepts.
for _ in $(seq 1 60); do
  cast block-number --rpc-url "$RPC_HOST" >/dev/null 2>&1 && break
  kill -0 "$ANVIL_PID" 2>/dev/null || { echo "    anvil died:"; tail -8 "$ANVIL_LOG"; exit 1; }
  sleep 1
done
cast block-number --rpc-url "$RPC_HOST" >/dev/null 2>&1 || {
  echo "    anvil never became ready:"; tail -8 "$ANVIL_LOG"; exit 1; }

FORK_BLOCK="$(cast block-number --rpc-url "$RPC_HOST")"
echo "    forked at block $FORK_BLOCK"

echo "==> Deploying Fyuz + FyuzLiquidityManager"
cd "$ROOT/foundry"
DEPLOY_OUT="$(PRIVATE_KEY=$DEV_PK forge script script/DeployBsc.s.sol:DeployFyuzBsc \
  --rpc-url "$RPC_HOST" --broadcast 2>&1)"
FYUZ_ADDR="$(sed -nE 's/^[[:space:]]*Fyuz:[[:space:]]+(0x[0-9a-fA-F]{40}).*/\1/p' <<<"$DEPLOY_OUT" | head -1)"
if [[ -z "$FYUZ_ADDR" ]]; then
  echo "    DEPLOY FAILED:"; tail -25 <<<"$DEPLOY_OUT"; exit 1
fi
echo "    Fyuz: $FYUZ_ADDR"

# The BNB/USD Chainlink feed is FROZEN at the fork block, but anvil's clock keeps
# advancing with every tx. DeployBsc sets priceStalenessThreshold=3600 (correct
# for live BSC, where the feed updates constantly) — on the fork that trips after
# ~1h of wall-clock, so _rawEthPrice() reads 0, getTokenVirtualMarketCap() reads 0,
# and tokens can neither graduate nor show a correct market cap. Raise it to ~10y
# here so the frozen feed is never treated as stale for the localnet's lifetime.
echo "==> Raising price-staleness threshold for the frozen fork feed"
cast send "$FYUZ_ADDR" "setPriceStalenessThreshold(uint256)" 315360000 \
  --private-key "$DEV_PK" --rpc-url "$RPC_HOST" >/dev/null

echo "==> Starting backend stack"
cd "$ROOT"
# Fusion images: real OpenAI when a key is available, offline mock otherwise.
# Pull ONLY the key out of backend-rs/.env — its other vars (CHAIN_ID,
# DATABASE_URL, ...) are for a non-docker setup and would clash with the
# localnet values below.
if [[ -z "${OPENAI_API_KEY:-}" && -f "$ROOT/backend-rs/.env" ]]; then
  OPENAI_API_KEY="$(sed -n 's/^OPENAI_API_KEY=//p' "$ROOT/backend-rs/.env" | head -1 | tr -d '"' | tr -d "'")"
fi
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  IMAGE_GEN_PROVIDER="${IMAGE_GEN_PROVIDER:-openai}"
else
  IMAGE_GEN_PROVIDER="${IMAGE_GEN_PROVIDER:-mock}"
fi

# Persist the localnet env in $ROOT/.env (gitignored). docker compose auto-loads
# it on EVERY invocation — shell exports would only cover THIS shell, and any
# later `docker compose up --build <svc>` from another shell would silently
# recreate dependent services with the production defaults from the yml (that is
# exactly how a frontend rebuild once reverted the backend to real-BSC config).
#
# Browser-facing vs container-facing RPC deliberately differ: /config hands
# rpcUrl to the BROWSER, which cannot resolve host.docker.internal. Same for
# S3_PUBLIC_URL (host MinIO, not the container-internal S3_ENDPOINT) and the
# NEXT_PUBLIC_* frontend build args. INDEXER_START_BLOCK must be the FORK BLOCK:
# anvil proxies pre-fork getLogs upstream, where public nodes rate-limit us.
cat > "$ROOT/.env" <<EOF
# Generated by scripts/localnet.sh — compose env for the LOCALNET. Do not commit.
BSC_PUBLIC_RPC_URL=$RPC_HOST
BSC_WS_URL=ws://host.docker.internal:8545
BSC_RPC_URL=$RPC_DOCKER
BSC_SERVER_RPC_URL=$RPC_DOCKER
FYUZ_CONTRACT_ADDRESS=$FYUZ_ADDR
CHAIN_ID=$LOCAL_CHAIN_ID
S3_PUBLIC_URL=http://localhost:9000/forgepad
INDEXER_START_BLOCK=$FORK_BLOCK
# The fork's head doesn't advance on its own, so a confirmation lag would stall
# indexing of the newest trades. No reorgs on a single-node anvil → index at head.
INDEXER_CONFIRMATIONS=0
IMAGE_GEN_PROVIDER=$IMAGE_GEN_PROVIDER
OPENAI_API_KEY=$OPENAI_API_KEY
NEXT_PUBLIC_LOCAL_MODE=true
NEXT_PUBLIC_API_URL=http://localhost:5002
EOF

if [[ $RESET_DB -eq 1 ]]; then
  echo "    --reset-db: destroying the postgres volume so initdb re-seeds the schema"
  docker compose rm -sfv postgres >/dev/null 2>&1 || true
  docker volume rm -f forgepadfinance_pgdata >/dev/null 2>&1 || true
fi

docker compose up -d postgres redis minio createbuckets >/dev/null

# Wait for the SCHEMA, not just the port: the postgres entrypoint answers
# pg_isready on a temporary init server while docker-entrypoint-initdb.d is still
# running, so polling readiness alone races the seed and reports a false failure.
SCHEMA_OK=0
for _ in $(seq 1 90); do
  if docker compose exec -T postgres psql -U postgres -d forgepad -c '\d watchlist' >/dev/null 2>&1; then
    SCHEMA_OK=1; break
  fi
  sleep 1
done

# Fail loudly rather than serving 500s if the volume predates the current schema.
if [[ $SCHEMA_OK -eq 0 ]]; then
  echo
  echo "  !! postgres is missing the 'watchlist' table — the pgdata volume was seeded"
  echo "     by an older schema and initdb will not re-run on a non-empty volume."
  echo "     Re-run with:  ./scripts/localnet.sh --reset-db"
  echo
  exit 1
fi

# The cursor is only seeded on a FRESH row, so clear it or the old block sticks.
SQL="DELETE FROM indexing_state WHERE network='bsc';"
[[ $KEEP_DB -eq 0 ]] && SQL="$SQL DELETE FROM tokens;"
docker compose exec -T postgres psql -U postgres -d forgepad -c "$SQL" >/dev/null 2>&1 || true

# --force-recreate: compose keeps a running container when only its .env-derived
# env changed (e.g. CHAIN_ID from a prior Robinhood run), leaving /config serving
# a stale chainId that no longer matches the frontend — force a fresh container.
docker compose up -d --build --force-recreate backend >/dev/null
until curl -s -m 2 "$RPC_HOST" >/dev/null && curl -s -m 2 http://localhost:5002/config >/dev/null; do sleep 1; done

echo "==> Building dockerised frontend (NEXT_PUBLIC_* are baked at build time)"
docker compose up -d --build frontend >/dev/null

echo
echo "================ LOCALNET READY ================"
echo "  anvil (fork)   $RPC_HOST   chainId $LOCAL_CHAIN_ID, block $FORK_BLOCK"
echo "  Fyuz           $FYUZ_ADDR"
echo "  backend        http://localhost:5002  (/config, /tokens)"
echo "  frontend       http://localhost:3001  (docker; or: cd frontend && npm run dev -> :3000)"
echo "  postgres 5433 | redis 6380 | minio 9000"
echo
echo "  Wallet: import anvil dev key into MetaMask and add network"
echo "          RPC http://127.0.0.1:8545  chainId $LOCAL_CHAIN_ID  symbol BNB"
echo "          $DEV_PK"
echo "          (well-known anvil test key — NEVER use it on mainnet)"
echo "==============================================="
