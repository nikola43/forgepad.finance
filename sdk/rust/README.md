# fyuz-sdk

Async Rust client for the [Fyuz](https://fyuz.fun) public REST API — bonding-curve
token market data on BNB Smart Chain.

- Crate: `fyuz-sdk` · library name: `fyuz`
- Base URL: `https://api.fyuz.fun`
- Every endpoint here is **unauthenticated** and safe to poll
- 28 endpoints, every response a real named type

---

## The one thing to understand first

A Fyuz token trades on an **internal bonding curve** until it reaches a **$30,000
market cap**, at which point it *graduates* into a PancakeSwap V2 pair.

**Before graduation there is no DEX pool anywhere.** `pair_address` is `None`,
there is no pair to quote, no aggregator has a price, and no on-chain read will
give you one. For a pre-graduation token **this API is the only source of price,
liquidity and volume data.** If you are building an indexer, a bot or a
portfolio tracker, that is the fact that decides your architecture.

`progress` / `graduation_pct` tell you how close a token is to that moment.
`pool_type` is `1` for PancakeSwap V2 and `2` for V3. `network` is currently
always `"bsc"`.

## Install

```toml
[dependencies]
fyuz-sdk = "1.0"
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

The crate is standalone — it is not part of any Cargo workspace. Build it from
`sdk/rust`:

```bash
cd sdk/rust
cargo build
cargo test
```

## Quickstart

```rust
use fyuz::{DiscoverParams, DiscoverTab, FyuzClient};

#[tokio::main]
async fn main() -> Result<(), fyuz::Error> {
    let client = FyuzClient::new()?;

    let trending = client
        .discover(&DiscoverParams::new().tab(DiscoverTab::Trending).limit(10))
        .await?;

    for token in &trending {
        println!(
            "{:<10} ${:>12.0} mcap   {:>6.2}% to graduation",
            token.symbol, token.marketcap, token.graduation_pct
        );
    }

    Ok(())
}
```

Configuration is a builder; every knob is optional:

```rust
use std::time::Duration;

let client = fyuz::FyuzClient::builder()
    .base_url("https://api.fyuz.fun")?          // default
    .timeout(Duration::from_secs(30))            // default
    .max_retries(3)                              // default; 0 disables retrying
    .retry_base_delay(Duration::from_millis(250))// default
    .max_retry_delay(Duration::from_secs(8))     // default
    .user_agent("acme-indexer/2.1 (ops@acme.example)")
    .build()?;
```

`FyuzClient` is cheap to clone (everything is behind an `Arc`, including the
connection pool). Build one per process and clone it around.

## Decimal strings are strings. Keep them that way.

Token balances, prices, market caps and **every `*_wei` field** come back as
decimal strings and stay `String` in this crate's models. An 18-decimal token
amount, or a `uint256` wei total, does not survive `f64`:

```rust
let wire = "123456789012345678901234567890";
let lossy = wire.parse::<f64>().unwrap();
assert_ne!(format!("{lossy:.0}"), wire);  // silently wrong
```

If you need arithmetic, parse at the edge of *your* code with a big-integer or
decimal type (`rust_decimal`, `bigdecimal`, `primitive_types::U256`). This SDK
deliberately does not choose one for you and never parses these into `f64`
behind your back.

Aggregates the server already computed in floating point — `volume_usd`,
`points`, `reward_eth`, `pot_bnb`, PnL, percentages — arrive as JSON numbers and
are modelled as `f64`.

`RoundReceipt::vrf_random` is also a decimal string (a `uint256` VRF word), not
hex and not a number.

## `None` is not `0`

`Pot::pot_bnb`, `Pot::total_points`, `Claimable::claimable_wei`,
`TokenDetail::curve_holding` and the nullable `*_wei` fields on `RoundReceipt`
are `None` when the value is **unknown** — the RPC was unreachable, or the
settlement has not been indexed yet. Rendering `0` in that case tells a user
something false. Hide the figure instead.

## Errors and rate limiting

The API allows **120 requests per minute per IP** and answers `429` with
`{"error": "Too many requests"}` past that.

The client retries `429`, `5xx` and transport failures automatically with
exponential backoff and **full jitter**, honouring `Retry-After` when the server
sends one (capped at 60s). Other `4xx` statuses are **never** retried. Once the
retries are spent you get a typed error:

```rust
match client.get_user_profile(address).await {
    Ok(profile) => { /* … */ }
    Err(e) if e.is_rate_limited() => {
        // Distinct variant so backpressure can be handled specifically.
        eprintln!("throttled, retry after {:?}", e.retry_after());
    }
    Err(e) if e.is_not_found() => eprintln!("no such profile"),
    Err(fyuz::Error::Api { status, message }) => eprintln!("HTTP {status}: {message}"),
    Err(e) => return Err(e),
}
```

`Error` variants: `Api { status, message }`, `RateLimited { message, retry_after }`,
`Transport`, `Decode { message, body }`, `InvalidBaseUrl { url, message }`.
Helpers: `status()`, `is_rate_limited()`, `is_not_found()`, `is_timeout()`,
`retry_after()`.

## Auto-pagination

`GET /tokens` is the one paginated endpoint. `token_pages` walks it for you and
stops once the server's `tokenCount` is covered:

```rust
use fyuz::ListTokensParams;

let mut pager = client.token_pages(&ListTokensParams::new().page_size(100));

// Token at a time…
while let Some(token) = pager.next_token().await? {
    println!("{}", token.token_symbol);
}

// …or page at a time.
let mut pager = client.token_pages(&ListTokensParams::new());
while let Some(page) = pager.next_page().await? {
    println!("{} rows of {:?}", page.len(), pager.total_count());
}
```

## Methods

All methods are `async` and return `fyuz::Result<T>`. Optional query parameters
live in per-endpoint params structs with chainable setters
(`DiscoverParams::new().tab(..).limit(..)`); unset values are simply not sent.

| Method | HTTP | Returns |
|---|---|---|
| `health()` | `GET /health` | `HealthStatus` |
| `get_config()` | `GET /config` | `ChainConfig` |
| `discover(&DiscoverParams)` | `GET /discover` | `Vec<DiscoverToken>` |
| `list_tokens(&ListTokensParams)` | `GET /tokens` | `TokenPage` |
| `token_pages(&ListTokensParams)` | `GET /tokens` (all pages) | `TokenPager` |
| `get_king()` | `GET /tokens/king` | `Option<Token>` |
| `get_token(network, address, &TokenDetailParams)` | `GET /tokens/{network}/{tokenAddress}` | `TokenDetail` |
| `get_recent_trades(&RecentTradesParams)` | `GET /trades/recent` | `RecentTrades` |
| `get_token_trades(address, &TokenTradesParams)` | `POST /trades` | `Vec<Trade>` |
| `get_chart_data(&ChartDataParams)` | `GET /trades/getChartData` | `Vec<Candle>` |
| `get_token_analytics(network, address)` | `GET /analytics/token/{network}/{address}` | `TokenAnalytics` |
| `get_top_traders(network, address)` | `GET /analytics/top-traders/{network}/{address}` | `Vec<TopTrader>` |
| `get_wallet(address)` | `GET /wallet/{address}` | `WalletStats` |
| `get_portfolio(address)` | `GET /portfolio/{address}` | `Portfolio` |
| `get_user_leaderboard(Option<limit>)` | `GET /users/leaderboard` | `Vec<LeaderboardEntry>` |
| `get_user_profile(address)` | `GET /users/profile/{address}` | `UserProfile` |
| `get_top_holders(count, &TopHoldersParams)` | `GET /users/top/{count}` | `Vec<TopHolderEntry>` |
| `get_kings_history()` | `GET /kings/history` | `Vec<KingReign>` |
| `get_season()` | `GET /season` | `Season` |
| `get_referral_leaderboard(Option<limit>)` | `GET /referrals/leaderboard` | `Vec<ReferralLeaderEntry>` |
| `get_tier(address)` | `GET /tier/{address}` | `TierInfo` |
| `get_rewards(address)` | `GET /rewards/{address}` | `Rewards` |
| `distributor().get_stats()` | `GET /distributor/stats` | `PayoutStats` |
| `distributor().get_pot()` | `GET /distributor/pot` | `Pot` |
| `distributor().get_shares(&SharesParams)` | `GET /distributor/shares` | `Shares` |
| `distributor().list_rounds(&RoundsParams)` | `GET /distributor/rounds` | `Vec<RoundReceipt>` |
| `distributor().get_round(id)` | `GET /distributor/rounds/{id}` | `RoundDetail` |
| `distributor().get_payouts(address)` | `GET /distributor/payouts/{address}` | `AddressPayouts` |
| `distributor().get_claimable(address)` | `GET /distributor/claimable/{address}` | `Claimable` |

Endpoints that can answer `404`: `get_token`, `get_token_analytics`,
`get_user_profile`, `distributor().get_round`. Use `Error::is_not_found()`.

### Notes on a few endpoints

- **`get_token_trades` is a `POST`** only because the token address travels in
  the request body. It is a read, it mutates nothing and it needs no auth.
- **Leaderboard `rank` is server-assigned**, 1-based, already in returned order.
  Do not re-sort client side.
- **`RoundDetail` is flattened on the wire**: the receipt fields sit at the top
  level next to `payouts`. In Rust they live under `detail.round` via
  `#[serde(flatten)]`, so `detail.round.round_id` reads the `roundId` key the API
  actually sends.
- **Timestamps** are UNIX **seconds** (`i64`) everywhere except
  `Token::created_at` / `updated_at` / `launched_at` / `creation_time` and
  `ChatMessage::date`, which are RFC-3339 strings. The crate does not depend on
  `chrono`; parse those with whatever date library you already use.

### What is deliberately missing

Only the public, unauthenticated surface is implemented. The API-key-gated routes
have no client methods — including `POST /distributor/rounds`, which shares a
path with `distributor().list_rounds()` but is internal to the round-runner, and
the authenticated `/users`, `/chats`, `/watchlist`, `/stream`, `/paper`,
`/creator`, `/airdrop`, `/referrals/{address}` routes.

## Dependencies

Four, all justified:

| Crate | Why |
|---|---|
| `reqwest` | HTTP, `default-features = false` + `rustls` so no OpenSSL headers are needed |
| `serde` / `serde_json` | Response models and the error envelope |
| `thiserror` | The `Error` enum |
| `tokio` | `time` only, for retry backoff sleeps |

## Trading

[`FyuzClient::trade`] builds **unsigned** bonding-curve transactions. It never sees a private key,
never signs and never broadcasts — you hand the result to `alloy`, `ethers-rs`, a hardware signer or
a multisig, and that library owns the key.

```rust
let client = FyuzClient::builder().rpc_url(std::env::var("BSC_RPC_URL")?).build()?;

let spend = parse_units("0.5", 18)?;
let quote = client.trade().quote_buy("bsc", token, spend).await?;
println!("{} tokens", format_units(quote.amount_out_wei, 18));

let built = client
    .trade()
    .build_buy(&BuyParams::new(token, spend).slippage_bps(100))  // 1% — required
    .await?;
// built.transaction is { chain_id, to, data, value } — sign it with your wallet
```

Selling needs an ERC-20 approval first, because the contract pulls the tokens with `transferFrom`:

```rust
if client.trade().allowance("bsc", token, owner).await? < amount {
    let approve = client.trade().build_approve("bsc", token, amount).await?;
    // sign and send `approve` first
}
let sell = client
    .trade()
    .build_sell(&SellParams::new(token, amount).slippage_bps(150))
    .await?;
```

`transaction.value` already includes `getFirstBuyFee(token)`, which is charged on top of the swap
amount. A graduated token yields an error satisfying `Error::is_graduated()` rather than a
transaction that would revert. Contract address, chain id and RPC all come from `GET /config` —
nothing is hardcoded — but set `rpc_url` in production, since the published endpoint is shared by
every caller.

Amounts use [`U256`], a big-endian `[u8; 32]` with the handful of operations this crate performs.
`u128` would not do: an ERC-20 allowance is `2^256 - 1` for every wallet that ever approved unlimited
spending, and that is the most ordinary value there is.

## Tests

```bash
cargo test          # unit + integration + doctests
cargo test --test integration
```

The suite never touches the network: `tests/common/mod.rs` is a stub HTTP server
on a plain `tokio::net::TcpListener` (no `wiremock`), binding `127.0.0.1:0`. It
covers the happy path, 429-then-success retry, 5xx retry, "4xx is never retried",
error-envelope parsing, decimal-string round-tripping without precision loss,
`null` vs `0`, the flattened `RoundDetail`, query/body encoding and
auto-pagination.

`tests/conformance.rs` additionally pulls in [`../shared/test-vectors`](../shared)
with `include_str!` — the same fixtures drive the TypeScript, Go and Python
suites, so a change to the wire contract fails all four at once.

To run every SDK at once, from the repository root:

```bash
sdk/scripts/test-all.sh
```

## Examples

Runnable programs in [`examples/`](examples), compiled by `cargo build --examples`:

| Example | What it shows |
|---|---|
| [`quickstart`](examples/quickstart.rs) | Health, chain config, the trending feed, king of the hill |
| [`graduation_watch`](examples/graduation_watch.rs) | Tokens closest to the $30k graduation threshold |
| [`token_deep_dive`](examples/token_deep_dive.rs) | One token: detail, holders, trades, hourly candles |
| [`export_tokens`](examples/export_tokens.rs) | Auto-paginate every token to CSV with exact decimals |
| [`resilient_polling`](examples/resilient_polling.rs) | Incremental trade polling, retry tuning, error matching |
| [`trade`](examples/trade.rs) | Quote a buy and a sell, build the unsigned transactions, handle the approval |
| [`live_smoke`](examples/live_smoke.rs) | Minimal check against the production API |

```bash
cargo run --example quickstart
cargo run --example token_deep_dive -- 0x42322852a918f94186b7dfda2e0e3f4ad3528480
cargo run --example export_tokens -- dog > tokens.csv
```

The same five exist in the TypeScript, Go and Python clients — see
[`../README.md`](../README.md).

## License

MIT
