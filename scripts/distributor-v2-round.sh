#!/usr/bin/env bash
# DistributorV2 round-runner — the off-chain half of the round.
#
# Chainlink Automation drives startRound / distribute / VRF-retry / cancel
# on-chain. Two things it CANNOT do are left to this script, which is safe to
# run from cron every few minutes and exits quietly when there is nothing due:
#
#   1. postShares — the leaderboard lives in Postgres, not on-chain. Fetches the
#      top-100 by points for the round's window from GET /distributor/shares,
#      prints the payout table (points, share, projected BNB), and posts the
#      packed blob with the poster key.
#   2. POST /distributor/rounds — recording a paid round is what advances the
#      backend's epoch and clears the leaderboard. Automation has no way to call
#      our API, so the script watches for status=2 and records it.
#
# It also mirrors the on-chain actions as a fallback (--force-start,
# --force-distribute) so a round still completes if the upkeep is out of LINK,
# paused, or the v2.1 registry is gone.
#
# Usage:
#   scripts/distributor-v2-round.sh              # do whatever is due
#   scripts/distributor-v2-round.sh --dry-run    # print the table, send nothing
#   scripts/distributor-v2-round.sh --force-start    # ignore the Monday schedule
#   scripts/distributor-v2-round.sh --force-distribute
#
# Required env (put them in fyuz/.env or the crontab):
#   DISTRIBUTOR_V2_ADDRESS   deployed DistributorV2
#   POSTER_PRIVATE_KEY       key authorized as poster on the contract
# Optional:
#   RPC_URL   default https://bsc-rpc.publicnode.com
#   API_URL   default http://localhost:5002
#   API_KEY   backend api-key for POST /rounds (from .env; no default)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$DIR/.env" ] && set -a && . "$DIR/.env" && set +a

RPC_URL="${RPC_URL:-https://bsc-rpc.publicnode.com}"
API_URL="${API_URL:-http://localhost:5002}"
# No default: a fallback key would silently re-open the hole that let
# anyone rewrite the payout window. Fail closed if it is unset.
API_KEY="${API_KEY:?Set API_KEY (see .env) — refusing to use a default}"
CAST="${CAST:-$HOME/.foundry/bin/cast}"

DRY_RUN=0; FORCE_START=0; FORCE_DISTRIBUTE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force-start) FORCE_START=1 ;;
    --force-distribute) FORCE_DISTRIBUTE=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

: "${DISTRIBUTOR_V2_ADDRESS:?Set DISTRIBUTOR_V2_ADDRESS}"
[ "$DRY_RUN" = "1" ] || : "${POSTER_PRIVATE_KEY:?Set POSTER_PRIVATE_KEY}"

send() { "$CAST" send --rpc-url "$RPC_URL" --private-key "$POSTER_PRIVATE_KEY" --json "$@"; }
# Newer cast annotates numeric results, e.g. `1784501680 [1.784e9]`; strip the
# ` [..]` suffix so raw values flow cleanly into URLs and arithmetic.
call() { "$CAST" call --rpc-url "$RPC_URL" "$DISTRIBUTOR_V2_ADDRESS" "$@" | sed 's/ \[[^]]*\]//g'; }

ROUND_STATE_SIG="roundState(uint256)(uint8,uint64,uint64,bool,uint256,uint16,uint16,uint8)"

round_id=$(call "roundId()(uint256)")
mapfile -t st < <(call "$ROUND_STATE_SIG" "$round_id")
status="${st[0]}"; r_start="${st[1]}"; r_end="${st[2]}"
has_random="${st[3]}"; pot="${st[4]}"; cursor="${st[5]}"; holder_count="${st[6]}"

# What the contract itself says is due — the same value checkUpkeep reports.
mapfile -t pending < <(call "pendingAction()(uint8,uint256)")
action="${pending[0]:-0}"
case "$action" in
  0) action_name="none" ;;
  1) action_name="START" ;;
  2) action_name="DISTRIBUTE" ;;
  3) action_name="RETRY_VRF" ;;
  4) action_name="CANCEL" ;;
  *) action_name="unknown($action)" ;;
esac

echo "Round $round_id: status=$status window=$r_start..$r_end pot=$pot wei"
echo "  holders=$holder_count paid=$cursor hasRandom=$has_random | upkeep due: $action_name"

# ---- 1. record a finished round -------------------------------------------
# Automation pays the round out on-chain; the backend only learns about it here.
if [ "$status" = "2" ]; then
  echo "Round $round_id is paid — recording it with the backend"
  if [ "$DRY_RUN" = "1" ]; then
    echo "  (dry run: would POST /distributor/rounds)"
    exit 0
  fi
  curl -sf -X POST "$API_URL/distributor/rounds" \
    -H "content-type: application/json" -H "api-key: $API_KEY" \
    -d "{\"roundId\": $round_id, \"timeStart\": $r_start, \"timeEnd\": $r_end}" > /dev/null
  echo "Recorded — leaderboard window advanced to $r_end. Nothing else to do."
  exit 0
fi

# ---- 2. no active round ----------------------------------------------------
if [ "$status" != "1" ]; then
  if [ "$FORCE_START" = "1" ] && [ "$action" = "1" ]; then
    echo "Automation has not opened the round — starting it from here"
    [ "$DRY_RUN" = "1" ] && { echo "  (dry run: would call startRound())"; exit 0; }
    send "$DISTRIBUTOR_V2_ADDRESS" "startRound()" > /dev/null
    round_id=$(call "roundId()(uint256)")
    mapfile -t st < <(call "$ROUND_STATE_SIG" "$round_id")
    status="${st[0]}"; r_start="${st[1]}"; r_end="${st[2]}"; holder_count="${st[6]}"
    echo "Started round $round_id over $r_start..$r_end"
  else
    next_at=$(call "nextRoundAt()(uint256)")
    echo "No active round (upkeep due: $action_name; next slot: $next_at)"
    echo "  nothing for the poster to do — pass --force-start to run one now"
    exit 0
  fi
fi

# ---- 3. post the leaderboard shares ---------------------------------------
if [ "$holder_count" = "0" ]; then
  echo "Fetching top-100 leaderboard for window $r_start -> $r_end"
  shares_json=$(curl -sf "$API_URL/distributor/shares?from=$r_start&to=$r_end&limit=100")

  # Payout preview: what each holder is actually owed out of this pot, using the
  # contract's own split so the table matches the chain to the wei.
  bps_distribute=$(call "percentForDistribute()(uint256)")
  bps_winner=$(call "percentForWinner()(uint256)")
  echo "$shares_json" | POT="$pot" BPS_D="$bps_distribute" BPS_W="$bps_winner" python3 -c '
import json, os, sys

d = json.load(sys.stdin)
pot = int(os.environ["POT"])
pool = pot * int(os.environ["BPS_D"]) // 10000
lottery = pot * int(os.environ["BPS_W"]) // 10000
holders = d["holders"]
UNIT = 1 << 32

print()
print("  %d holders | total points %.2f | pool %.6f BNB | lottery %.6f BNB to 1 of %d"
      % (len(holders), d["totalPoints"], pool / 1e18, lottery / 1e18, len(holders)))
print("  %3s  %-44s%14s%9s%14s" % ("#", "address", "points", "share%", "BNB"))
paid = 0
for i, h in enumerate(holders, 1):
    bnb = pool * h["share"] // UNIT
    paid += bnb
    print("  %3d  %-44s%14.2f%8.3f%%%14.6f"
          % (i, h["address"], h["points"], h["share"] / UNIT * 100, bnb / 1e18))
print("  rounding dust left for the next round: %.9f BNB" % ((pool - paid) / 1e18))
print()
'

  packed=$(echo "$shares_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['packed'])")
  holders=$(echo "$shares_json" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['holders']))")

  if [ "$packed" = "0x" ] || [ "$holders" = "0" ]; then
    echo "No eligible holders this round — cancelling so the pot rolls forward"
    [ "$DRY_RUN" = "1" ] && { echo "  (dry run: would call cancelRound())"; exit 0; }
    send "$DISTRIBUTOR_V2_ADDRESS" "cancelRound()" > /dev/null
    exit 0
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "(dry run: would postShares($round_id, <$holders holders>) — sending nothing)"
    exit 0
  fi
  echo "Posting $holders holders on-chain (this also fires the VRF request)"
  send "$DISTRIBUTOR_V2_ADDRESS" "postShares(uint256,bytes)" "$round_id" "$packed" > /dev/null
  echo "Posted. Automation takes it from here: VRF -> distribute."
else
  echo "Shares already posted ($holder_count holders) — nothing to post"
fi

# ---- 4. fallback: finish the round ourselves -------------------------------
# Only when explicitly asked. Normally the upkeep does this, and doing it twice
# is harmless (the contract re-validates) but wastes gas.
if [ "$FORCE_DISTRIBUTE" = "1" ]; then
  [ "$DRY_RUN" = "1" ] && { echo "(dry run: would drive distribute() to completion)"; exit 0; }
  echo "Waiting for VRF fulfillment..."
  for _ in $(seq 1 60); do
    has_random=$(call "$ROUND_STATE_SIG" "$round_id" | sed -n 4p)
    [ "$has_random" = "true" ] && break
    sleep 10
  done
  if [ "${has_random:-false}" != "true" ]; then
    echo "VRF not fulfilled after 10 minutes — leaving the round active; rerun to resume" >&2
    exit 1
  fi
  # distribute() pays a bounded batch per call, so drive it until the round closes.
  while :; do
    mapfile -t st < <(call "$ROUND_STATE_SIG" "$round_id")
    [ "${st[0]}" = "1" ] || break
    echo "Distributing round $round_id (paid ${st[5]}/${st[6]})"
    send "$DISTRIBUTOR_V2_ADDRESS" "distribute(uint256)" "$round_id" > /dev/null
  done
  echo "Round $round_id closed with status ${st[0]} — rerun to record it with the backend"
fi
