# fyuz-sdk (Python)

Typed Python client for the [Fyuz](https://fyuz.fun) public REST API — the
bonding-curve token launchpad on BNB Smart Chain.

- **Zero runtime dependencies.** Standard library only (`urllib`, `json`,
  `dataclasses`). No `requests`, no `httpx`, no `pydantic`.
- **Python 3.9+**, fully type-hinted, ships a `py.typed` marker.
- **Every response is a real frozen dataclass**, not a `dict`.
- Automatic retry with exponential backoff and full jitter for `429`/`5xx`.
- Auto-pagination, typed errors, context-manager support.

## Why this API matters

A Fyuz token trades on an **internal bonding curve** until it reaches a
**$30,000 market cap**, at which point it *graduates* into a PancakeSwap V2
pair.

> **Before graduation, `pair_address` is `None` and there is no DEX pool
> anywhere on chain.** This API is the *only* source of price, liquidity and
> curve state for a pre-graduation token. Nothing on PancakeSwap, DexScreener
> or any DEX aggregator will show it, because it does not exist there yet.

`pool_type` is `1` for PancakeSwap V2 and `2` for V3. `network` is the chain
slug and is currently always `"bsc"`.

## Install

```bash
pip install fyuz-sdk
```

From this repository:

```bash
pip install /path/to/fyuz/sdk/python
```

## Quickstart

```python
from fyuz import FyuzClient

with FyuzClient() as fyuz:
    # The densest market-data endpoint: one row per token.
    for token in fyuz.discover(tab="trending", limit=10):
        print(f"{token.symbol:8} ${token.marketcap:,.0f}  {token.graduation_pct:.1f}% to graduation")

    # Full curve state for one token.
    detail = fyuz.get_token("bsc", "0x23a84ba5bf7bf3236491fa2b5a9807a274337135")
    token = detail.token_details
    print(token.price)              # '0.000004472899483094'  <- exact string
    print(token.virtual_eth_amount) # bonding-curve virtual BNB reserve
    print(token.graduated)          # False while still on the curve

    # Walk every page of the token list without doing the paging yourself.
    for token in fyuz.iter_tokens(order_type="marketcap", order_flag="desc"):
        ...
```

## Precision: decimal fields are strings, and they stay strings

Token amounts, prices, market caps and every `*_wei` value come back from the
API as **decimal strings**, because 18-decimal values and `uint256` wei amounts
do not survive a round trip through a 64-bit float:

```python
>>> float("123456789.123456789123456789")
123456789.12345679          # four digits gone, silently
```

This SDK therefore keeps them as `str` in the models and **never** parses them
into `float`. When you need arithmetic, use the opt-in helpers — they go
through `decimal.Decimal` and are exact:

```python
from fyuz import to_decimal, wei_to_bnb

mcap = to_decimal(token.marketcap)                  # Decimal('4472.899483094470000000')
paid = wei_to_bnb(stats.total_paid_wei)             # Decimal BNB, no rounding
```

Aggregates computed server-side — `volume_usd`, `points`, `reward_eth`,
`pot_bnb`, everything on `DiscoverToken`, `Portfolio`, `WalletStats` and the
analytics endpoints — are genuine `float` values on the wire and are typed as
`float` here.

Timestamps: `Trade.date`, `KingReign.started_at`, `RoundReceipt.time_end` and
friends are `int` UNIX **seconds**. The `Token.created_at` /`updated_at` /
`launched_at` / `creation_time` and `ChatMessage.date` fields are RFC-3339
strings. Convert either with `from_unix()` / `parse_datetime()`.

## `None` is not `0`

Several fields are nullable and their `None` means **unknown**, not zero —
usually because an RPC read failed or an on-chain settlement has not been
indexed yet. Rendering them as `0` is a correctness bug:

| Field | `None` means |
| --- | --- |
| `Pot.pot_bnb`, `Pot.total_points` | RPC unreachable / no Distributor configured — hide the figure |
| `Claimable.claimable_wei` | Unknown — hide the banner, do not say "nothing owed" |
| `TokenDetail.curve_holding` | The chain read failed — the curve balance is unknown |
| `RoundReceipt.pot_wei` / `distributed_wei` / `winner_amount_wei` | Settlement not indexed yet |
| `Token.pair_address`, `Token.launched_at` | The token has not graduated |
| `KingReign.ended_at` | The reign is still running |

## Errors

```python
from fyuz import FyuzClient, FyuzRateLimitError, FyuzNotFoundError, FyuzAPIError, FyuzError

with FyuzClient() as fyuz:
    try:
        profile = fyuz.get_user_profile("0xdead...")
    except FyuzNotFoundError:
        profile = None
    except FyuzRateLimitError as exc:          # 429, after retries were exhausted
        print("slow down", exc.retry_after)
    except FyuzAPIError as exc:                # any other non-2xx
        print(exc.status, exc.message)         # message from the {"error": ...} envelope
    except FyuzError:                          # transport / decode failures
        raise
```

| Exception | Raised when |
| --- | --- |
| `FyuzError` | Base class for everything below |
| `FyuzAPIError` | Non-2xx response; carries `.status`, `.message`, `.body`, `.retry_after` |
| `FyuzRateLimitError` | `429`, after retries; subclass of `FyuzAPIError` |
| `FyuzNotFoundError` | `404`; subclass of `FyuzAPIError` |
| `FyuzConnectionError` | DNS/refused/reset/timeout, after retries |
| `FyuzDecodeError` | Response body was not the JSON shape the endpoint promises |

## Rate limits and retries

The API rate-limits **per client IP at 120 requests/minute** and answers `429`
with `{"error": "Too many requests"}`.

The client retries `429`, `5xx` and transport failures automatically, with
exponential backoff and full jitter (`sleep = uniform(0, min(cap, 0.25 * 2**n))`).
A `Retry-After` header, when present, raises the computed backoff — it can
lengthen the wait but never shorten it, so `Retry-After: 0` cannot spin the
retries away — and is capped at 60s. It is honoured on a `503` from a draining
load balancer just as much as on a `429`. **No other 4xx is ever retried.**

```python
FyuzClient(
    "https://api.fyuz.fun",
    timeout=30.0,          # seconds, per request
    max_retries=3,         # 0 disables retrying entirely
    backoff_initial=0.25,
    backoff_max=8.0,
    user_agent="my-indexer/1.0",   # default: fyuz-sdk-python/<version>
)
```

## Pagination

`list_tokens()` returns one page plus `token_count`. `iter_tokens()` walks
every page lazily — pages are fetched on demand, so breaking out of the loop
stops the requests:

```python
for token in fyuz.iter_tokens(search_word="pepe", page_size=100):
    if token.graduated:
        print(token.token_symbol, token.pair_address)
```

## Methods

All 28 endpoints are unauthenticated and read-only.

| Method | Endpoint | Returns |
| --- | --- | --- |
| `health()` | `GET /health` | `HealthStatus` |
| `get_config()` | `GET /config` | `ChainConfig` |
| `discover(...)` | `GET /discover` | `List[DiscoverToken]` |
| `list_tokens(...)` | `GET /tokens` | `TokenPage` |
| `iter_tokens(...)` | `GET /tokens` (all pages) | `Iterator[Token]` |
| `get_king()` | `GET /tokens/king` | `Optional[Token]` |
| `get_token(network, token_address, ...)` | `GET /tokens/{network}/{tokenAddress}` | `TokenDetail` |
| `get_recent_trades(...)` | `GET /trades/recent` | `RecentTrades` |
| `get_token_trades(token_address, ...)` | `POST /trades` | `List[Trade]` |
| `get_chart_data(token_address, interval, from_ts, to_ts, ...)` | `GET /trades/getChartData` | `List[Candle]` |
| `get_token_analytics(network, address)` | `GET /analytics/token/{network}/{address}` | `TokenAnalytics` |
| `get_top_traders(network, address)` | `GET /analytics/top-traders/{network}/{address}` | `List[TopTrader]` |
| `get_wallet(address)` | `GET /wallet/{address}` | `WalletStats` |
| `get_portfolio(address)` | `GET /portfolio/{address}` | `Portfolio` |
| `get_user_leaderboard(limit=...)` | `GET /users/leaderboard` | `List[LeaderboardEntry]` |
| `get_user_profile(address)` | `GET /users/profile/{address}` | `UserProfile` |
| `get_top_holders(count, ...)` | `GET /users/top/{count}` | `List[TopHolderEntry]` |
| `get_kings_history()` | `GET /kings/history` | `List[KingReign]` |
| `get_season()` | `GET /season` | `Season` |
| `get_referral_leaderboard(limit=...)` | `GET /referrals/leaderboard` | `List[ReferralLeaderEntry]` |
| `get_tier(address)` | `GET /tier/{address}` | `TierInfo` |
| `get_rewards(address)` | `GET /rewards/{address}` | `Rewards` |
| `distributor.get_stats()` | `GET /distributor/stats` | `PayoutStats` |
| `distributor.get_pot()` | `GET /distributor/pot` | `Pot` |
| `distributor.get_shares(...)` | `GET /distributor/shares` | `Shares` |
| `distributor.list_rounds(...)` | `GET /distributor/rounds` | `List[RoundReceipt]` |
| `distributor.get_round(round_id)` | `GET /distributor/rounds/{id}` | `RoundDetail` |
| `distributor.get_payouts(address)` | `GET /distributor/payouts/{address}` | `AddressPayouts` |
| `distributor.get_claimable(address)` | `GET /distributor/claimable/{address}` | `Claimable` |

`POST /trades` is a POST only because the token address travels in the body. It
is unauthenticated, read-only and safe to poll.

### Helpers

| Helper | Purpose |
| --- | --- |
| `to_decimal(str)` | Decimal-string field → exact `Decimal` |
| `wei_to_bnb(str)` | Wei decimal string → exact `Decimal` BNB |
| `parse_datetime(str)` | RFC-3339 field → aware `datetime` |
| `from_unix(int)` | UNIX-seconds field → aware UTC `datetime` |

All four pass `None` straight through, so nullable fields stay nullable.

## Notes for indexers and data partners

- `GET /discover` is the highest-signal single call: market cap, 24h volume,
  buy/sell counts, holders, price change and graduation progress per token.
- `get_recent_trades(latest_trade_id=...)` polls the platform-wide feed
  incrementally — pass back the highest `Trade.id` you have seen.
- `rank` on every leaderboard is a server-assigned 1-based ordinal in returned
  order. Do not re-sort client-side; the server's ordering is what the payout
  logic uses.
- Response models ignore unknown fields, so a server-side addition will never
  break a deployed client. Collection fields are tuples (the models are frozen);
  endpoints returning a bare JSON array give you a `list`.

## Development

```bash
cd sdk/python

# Tests — a local stub HTTP server, never the network
python -m unittest discover -s tests

# Type check (strict) and lint
pip install -e ".[dev]"
mypy
ruff check src tests
ruff format --check src tests

# Build the distributions
pip install build
python -m build
```

## License

MIT
