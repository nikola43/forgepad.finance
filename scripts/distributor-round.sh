#!/usr/bin/env bash
# Distributor round-runner: drives one full payout round of the Distributor
# contract. Safe to run from cron — it exits quietly when a round isn't due.
#
#   1. startRound(from, now)        — from = last paid round's timeEnd
#   2. GET  /distributor/shares     — top-100 leaderboard, packed for the chain
#   3. postShares(roundId, packed)
#   4. wait for VRF fulfillment     — polls rounds(roundId).hasRandom
#   5. distribute(roundId)          — 90% pro-rata + 10% to the VRF winner
#   6. POST /distributor/rounds     — records the round; clears the leaderboard
#
# Required env (put them in fyuz/.env or the crontab):
#   DISTRIBUTOR_ADDRESS   deployed Distributor
#   POSTER_PRIVATE_KEY    key authorized as poster on the contract
# Optional:
#   RPC_URL      default https://bsc-testnet.rpc.sentio.xyz
#   API_URL      default http://localhost:5002
#   API_KEY      backend api-key for POST /rounds (default from .env API_KEY)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$DIR/.env" ] && set -a && . "$DIR/.env" && set +a

RPC_URL="${RPC_URL:-https://bsc-testnet.rpc.sentio.xyz}"
API_URL="${API_URL:-http://localhost:5002}"
API_KEY="${API_KEY:-hola}"
CAST="${CAST:-$HOME/.foundry/bin/cast}"

: "${DISTRIBUTOR_ADDRESS:?Set DISTRIBUTOR_ADDRESS}"
: "${POSTER_PRIVATE_KEY:?Set POSTER_PRIVATE_KEY}"

send() { "$CAST" send --rpc-url "$RPC_URL" --private-key "$POSTER_PRIVATE_KEY" --json "$@"; }
call() { "$CAST" call --rpc-url "$RPC_URL" "$DISTRIBUTOR_ADDRESS" "$@"; }

now=$(date +%s)
round_id=$(call "roundId()(uint256)")
status=$(call "rounds(uint256)(uint8,uint64,uint64,bool,uint256,uint256,uint256,bytes)" "$round_id" | sed -n 1p)

if [ "$status" = "1" ]; then
  echo "Round $round_id already active — resuming it"
else
  last_end=$(call "rounds(uint256)(uint8,uint64,uint64,bool,uint256,uint256,uint256,bytes)" "$round_id" | sed -n 3p || echo 0)
  period=$(call "period()(uint256)")
  last_time=$(call "lastRoundTime()(uint256)")
  if [ "$now" -lt "$((last_time + period))" ]; then
    echo "Period not elapsed ($((last_time + period - now))s remaining) — nothing to do"
    exit 0
  fi
  balance=$("$CAST" balance --rpc-url "$RPC_URL" "$DISTRIBUTOR_ADDRESS")
  if [ "$balance" = "0" ]; then
    echo "Pot is empty — nothing to do"
    exit 0
  fi
  from="${last_end:-0}"
  echo "Starting round: window $from -> $now, pot $balance wei"
  send "$DISTRIBUTOR_ADDRESS" "startRound(uint64,uint64)" "$from" "$now" > /dev/null
  round_id=$(call "roundId()(uint256)")
fi

# Window bounds come from the chain so retries stay consistent.
r_start=$(call "rounds(uint256)(uint8,uint64,uint64,bool,uint256,uint256,uint256,bytes)" "$round_id" | sed -n 2p)
r_end=$(call "rounds(uint256)(uint8,uint64,uint64,bool,uint256,uint256,uint256,bytes)" "$round_id" | sed -n 3p)

echo "Fetching top-100 shares for window $r_start -> $r_end"
shares_json=$(curl -sf "$API_URL/distributor/shares?from=$r_start&to=$r_end&limit=100")
packed=$(echo "$shares_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['packed'])")
holders=$(echo "$shares_json" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['holders']))")

if [ "$packed" = "0x" ] || [ "$holders" = "0" ]; then
  echo "No eligible holders this round — cancelling so the pot rolls forward"
  send "$DISTRIBUTOR_ADDRESS" "cancelRound()" > /dev/null
  exit 0
fi

echo "Posting $holders holders on-chain"
send "$DISTRIBUTOR_ADDRESS" "postShares(uint256,bytes)" "$round_id" "$packed" > /dev/null

echo "Waiting for VRF fulfillment..."
for i in $(seq 1 60); do
  has_random=$(call "rounds(uint256)(uint8,uint64,uint64,bool,uint256,uint256,uint256,bytes)" "$round_id" | sed -n 4p)
  [ "$has_random" = "true" ] && break
  sleep 10
done
if [ "${has_random:-false}" != "true" ]; then
  echo "VRF not fulfilled after 10 minutes — leaving round active; rerun to resume" >&2
  exit 1
fi

echo "Distributing round $round_id"
tx=$(send "$DISTRIBUTOR_ADDRESS" "distribute(uint256)" "$round_id" | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
echo "Distributed in $tx"

curl -sf -X POST "$API_URL/distributor/rounds" \
  -H "content-type: application/json" -H "api-key: $API_KEY" \
  -d "{\"roundId\": $round_id, \"timeStart\": $r_start, \"timeEnd\": $r_end, \"txHash\": \"$tx\"}" > /dev/null
echo "Round $round_id recorded — leaderboard reset. Done."
