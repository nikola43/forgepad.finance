#!/usr/bin/env bash
# Local test loop for the CRE distributor-runner workflow: every 5 minutes it
# pushes a full Distributor payout round through the REAL Chainlink CRE
# simulator against an anvil fork of BSC testnet.
#
#   anvil fork (sentio archive RPC) ─┐
#   shares API stub on :5002        ├─ cre workflow simulate --broadcast
#   CREPoster deployed + wired      ─┘    └ report → mock forwarder → CREPoster
#                                             └ startRound + postShares
#   then (fork stand-ins for live infra):
#     impersonated VRF coordinator fulfills randomness,
#     distribute() pays the round, pot refilled, sleep 300, repeat.
#
# If the real backend is up on :5002 its /distributor/shares is used instead of
# the stub. On the real testnet, VRF + Chainlink Automation replace the
# impersonated fulfill/distribute steps.
#
# Usage: scripts/cre-local-round.sh [iterations]   # default 0 = loop forever

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAST=${CAST:-$HOME/.foundry/bin/cast}
FORGE=${FORGE:-$HOME/.foundry/bin/forge}
ANVIL=${ANVIL:-$HOME/.foundry/bin/anvil}
CRE=${CRE:-$HOME/.cre/bin/cre}
RPC=http://localhost:8545
# publicnode refuses state for non-recent blocks (fork goes stale in minutes);
# sentio serves archive state free.
FORK_URL=${FORK_URL:-https://bsc-testnet.rpc.sentio.xyz}

DISTRIBUTOR=0x38743b976b0f684Be5CB51F9EE417666CD636C75
PROD_FORWARDER=0x76c9cf548b4179F8901cda1f8623568b58215E62
# KeystoneForwarder the CRE CLI actually routes through in `simulate --broadcast`
MOCK_FORWARDER=0xa238e42cb8782808dbb2f37e19859244ec4779b0
COORDINATOR=0xDA3b641D438362C440Ac5458c57e00a712b66700 # VRF v2.5, BSC testnet
OWNER=0x1c774298BAEA6b0A9a952b67f89d69866F010b04       # Distributor owner
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # anvil #0

cleanup() {
  [ -n "${ANVIL_PID:-}" ] && kill "$ANVIL_PID" 2>/dev/null
  [ -n "${STUB_PID:-}" ] && kill "$STUB_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

send() { "$CAST" send --rpc-url $RPC "$@" > /dev/null; }
call() { "$CAST" call --rpc-url $RPC "$@" | sed 's/ \[[^]]*\]//'; }
round_field() { call "$DISTRIBUTOR" "rounds(uint256)(uint8,uint64,uint64,bool,uint256,uint256,uint256,bytes)" "$1" | sed -n "${2}p"; }

# 1. anvil fork of BSC testnet (reused if one is already on :8545)
if ! "$CAST" chain-id --rpc-url $RPC > /dev/null 2>&1; then
  echo "Starting anvil fork of BSC testnet..."
  "$ANVIL" --fork-url "$FORK_URL" --port 8545 --silent &
  ANVIL_PID=$!
  until "$CAST" chain-id --rpc-url $RPC > /dev/null 2>&1; do sleep 1; done
fi

# 2. shares API stub, unless the real backend answers on :5002
if ! curl -sf -m 2 "http://localhost:5002/distributor/shares?limit=1" > /dev/null 2>&1; then
  echo "Backend not on :5002 — starting 2-holder shares stub"
  bun -e 'const p="0x"+"11".repeat(20)+"80000000"+"22".repeat(20)+"80000000";Bun.serve({port:5002,fetch(req){const u=new URL(req.url);if(u.pathname!=="/distributor/shares")return new Response("",{status:404});const to=Number(u.searchParams.get("to")??Math.floor(Date.now()/1000));return Response.json({from:1751000000,to,totalPoints:100,holders:[],packed:p})}})' &
  STUB_PID=$!
fi

# 3. hot-swap the fork's Distributor to the CURRENT source. The testnet address
#    still runs an older build; without this the fork tests bytecode nobody is
#    about to deploy (and the new CREPoster.ready() would revert calling
#    distributable()). Code-only swap — no storage layout change — so the VRF
#    subscription, poster and pot on the fork all survive.
"$FORGE" build --root "$DIR/foundry" > /dev/null
NEW_CODE=$(jq -r '.deployedBytecode.object' "$DIR/foundry/out/Distributor.sol/Distributor.json")
"$CAST" rpc anvil_setCode "$DISTRIBUTOR" "$NEW_CODE" --rpc-url $RPC > /dev/null
echo "Distributor hot-swapped to current source ($(( ${#NEW_CODE} / 2 - 1 )) bytes)"

# 4. deploy CREPoster on the fork and wire it up
POSTER=$("$FORGE" create src/CREPoster.sol:CREPoster --root "$DIR/foundry" \
  --rpc-url $RPC --private-key $KEY --broadcast \
  --constructor-args $DISTRIBUTOR $PROD_FORWARDER 2> /dev/null \
  | grep "Deployed to" | awk '{print $3}')
echo "CREPoster on fork: $POSTER"
"$CAST" rpc anvil_impersonateAccount $OWNER --rpc-url $RPC > /dev/null
"$CAST" rpc anvil_setBalance $OWNER 0x8AC7230489E80000 --rpc-url $RPC > /dev/null
send "$DISTRIBUTOR" "setPoster(address)" "$POSTER" --from $OWNER --unlocked
send "$POSTER" "setForwarder(address,bool)" $MOCK_FORWARDER true --private-key $KEY
python3 -c "import json;p='$DIR/cre/distributor-runner/config.staging.json';d=json.load(open(p));d['receiver']='$POSTER';json.dump(d,open(p,'w'),indent=2)"

i=0
N=${1:-0}
# 5. round loop: simulate -> report -> startRound+postShares -> VRF -> distribute
while :; do
  pot=$("$CAST" balance --rpc-url $RPC "$DISTRIBUTOR")
  [ "$pot" = "0" ] && send "$DISTRIBUTOR" --value 1ether --private-key $KEY \
    && echo "Pot refilled with 1 BNB"

  (cd "$DIR/cre" && "$CRE" workflow simulate distributor-runner \
    --target staging-settings --broadcast --trigger-index 0 --non-interactive) \
    2>&1 | grep -E "USER LOG|Simulation Result" || true

  rid=$(call "$DISTRIBUTOR" "roundId()(uint256)")
  if [ "$rid" != "0" ] && [ "$(round_field "$rid" 1)" = "1" ]; then
    req=$(round_field "$rid" 7)
    "$CAST" rpc anvil_impersonateAccount $COORDINATOR --rpc-url $RPC > /dev/null
    "$CAST" rpc anvil_setBalance $COORDINATOR 0xDE0B6B3A7640000 --rpc-url $RPC > /dev/null
    send "$DISTRIBUTOR" "rawFulfillRandomWords(uint256,uint256[])" "$req" "[$((RANDOM * 31337 + i))]" --from $COORDINATOR --unlocked
    send "$DISTRIBUTOR" "distribute(uint256)" "$rid" --private-key $KEY
    echo "Round $rid: VRF fulfilled + distributed (status $(round_field "$rid" 1))"
  fi

  i=$((i + 1))
  [ "$N" != "0" ] && [ "$i" -ge "$N" ] && break
  echo "Sleeping 300s until next tick..."
  sleep 300
done
