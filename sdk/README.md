# Fyuz SDKs

Four clients for the [Fyuz](https://fyuz.fun) public REST API — bonding-curve token market data on
BNB Smart Chain. One repository, four independently published packages, one shared set of test
vectors that keeps them honest about the same wire contract.

Every endpoint is unauthenticated and safe to poll.

| Language | Package | Registry | Runtime dependencies |
|---|---|---|---|
| [TypeScript](typescript) | `@fyuz/sdk` | npm | none — native `fetch` |
| [Go](go) | `github.com/nikola43/forgepad.finance/sdk/go` | Go modules | none — `net/http` |
| [Python](python) | `fyuz-sdk` | PyPI | none — stdlib `urllib` |
| [Rust](rust) | `fyuz-sdk` | crates.io | reqwest, serde, tokio |

```bash
pnpm add @fyuz/sdk
go get github.com/nikola43/forgepad.finance/sdk/go
pip install fyuz-sdk
cargo add fyuz-sdk
```

## Quickstart

<table>
<tr><td>

```ts
import { FyuzClient } from '@fyuz/sdk';

const client = new FyuzClient();
const trending = await client.discover({
  tab: 'trending',
  limit: 10,
});

for (const t of trending) {
  console.log(t.symbol, t.marketcap, t.graduationPct);
}
```

</td><td>

```go
client := fyuz.New()

trending, err := client.Discover(ctx, &fyuz.DiscoverOptions{
    Tab:   fyuz.TabTrending,
    Limit: fyuz.Int64(10),
})

for _, t := range trending {
    fmt.Println(t.Symbol, t.Marketcap, t.GraduationPct)
}
```

</td></tr>
<tr><td>

```python
from fyuz import FyuzClient

with FyuzClient() as fyuz:
    for t in fyuz.discover(tab="trending", limit=10):
        print(t.symbol, t.marketcap, t.graduation_pct)
```

</td><td>

```rust
let client = FyuzClient::new()?;

let trending = client
    .discover(&DiscoverParams::new()
        .tab(DiscoverTab::Trending)
        .limit(10))
    .await?;

for t in &trending {
    println!("{} {} {}", t.symbol, t.marketcap, t.graduation_pct);
}
```

</td></tr>
</table>

All four expose the same logical surface over the 28 read endpoints, differing only in naming
convention. Shared behaviour: 30s default timeout, automatic retry on 429/5xx with exponential
backoff and full jitter, typed errors with a distinguishable rate-limit variant, and auto-pagination
over the token list. The API rate-limits at 120 requests/minute per IP.

## Trading

Every SDK can also **build bonding-curve trades**. They build *unsigned transactions* — no SDK here
ever sees a private key, signs, or broadcasts. You get `{ to, data, value }` and hand it to whatever
wallet you already have (viem, ethers, go-ethereum, web3.py, alloy, a hardware signer, a multisig).
That is what keeps the zero-dependency promise intact: signing is the part that needs a crypto
library, and it lives in your wallet, not here.

<table>
<tr><td>

```ts
const quote = await client.trade.quoteBuy({
  token, amountWei: parseUnits('0.5'),
});

const { transaction } = await client.trade.buildBuy({
  token,
  amountWei: parseUnits('0.5'),
  slippageBps: 100,        // 1% — required
});
await walletClient.sendTransaction(transaction);
```

</td><td>

```python
quote = fyuz.trade.quote_buy(token, parse_units("0.5"))

built = fyuz.trade.build_buy(
    token, parse_units("0.5"),
    slippage_bps=100,        # 1% — required
)
w3.eth.send_transaction(built.transaction.as_dict())
```

</td></tr>
</table>

| | |
|---|---|
| `quoteBuy` / `quoteSell` | Priced by `eth_call` to the contract's own `getSwapOutput`, never by arithmetic in the SDK |
| `buildBuy` | `swapExactETHForTokens` — spend an exact amount of BNB |
| `buildBuyExactTokens` | `swapETHForExactTokens` — get an exact number of tokens, capping the spend |
| `buildSell` | `swapExactTokensForETH` — needs an ERC-20 approval first |
| `buildApprove` | The approval a sell requires; exact amount by default, unlimited on request |
| `allowance` / `balanceOf` / `isGraduated` / `firstBuyFee` | The reads you need around a trade |

Three things the trading layer will not do to you:

**Slippage is never chosen for you.** `buildBuy` and `buildSell` require `slippageBps` or an explicit
limit. There is no default, because a default is a number picked by someone who cannot see the trade.

**`msg.value` includes the first-buy fee.** `getFirstBuyFee(token)` is charged *on top of* the amount
you are swapping; sending only the swap amount reverts with `InsufficientEthValue`. The built
transaction's `value` already accounts for it.

**A graduated token is refused, not attempted.** Once a token hits $30k the curve closes and every
swap entrypoint reverts with `AlreadyLaunched()`. The SDK checks and raises a typed error rather than
letting you pay gas to discover it.

Nothing is hardcoded: the contract address, chain id and RPC all come from `GET /config`, so a
contract upgrade or a new chain needs no SDK release. The RPC endpoint published there belongs to the
API operator and is shared by every caller — pass your own for anything in production.

## Two invariants worth knowing before you write any code

**Decimal amounts are strings, and stay strings.** Market caps, token amounts, prices and every
`*_wei` value carry up to 18 decimals and exceed the exact range of an IEEE-754 double. They are
modelled as strings in all four clients and never parsed into a float on your behalf. Use a
big-decimal type at the edge of your own code when you need arithmetic — `big.Rat` in Go,
`decimal.Decimal` in Python, `rust_decimal`/`bigdecimal` in Rust, a bignum library in JavaScript.

The concrete failure this prevents: `29999.999999999999999999` becomes exactly `30000` as a double,
and `30000` is the graduation threshold — a float-parsing client reports a token as graduated while
it is still on the curve.

**`null` is not `0`.** A null `liquidity` or `curveHolding` means the on-chain read failed and the
value is *unknown*. A null `pairAddress` means the token has not graduated and no DEX pool exists
anywhere. Every nullable field is modelled as optional, never zero-defaulted; rendering `0` tells a
user something false.

Aggregates the server already computed in floating point — `volume24h`, `points`, `graduationPct`,
PnL figures — arrive as JSON numbers and are typed as floats. That distinction is deliberate.

## Known API inconsistency: trade side casing

`GET /trades/recent` sends `"buy"`/`"sell"`; the trades embedded in `GET /tokens/{network}/{address}`
send `"BUY"`/`"SELL"`. Compare case-insensitively:

| | Wrong | Right |
|---|---|---|
| TypeScript | `trade.type === 'buy'` | `trade.type.toLowerCase() === 'buy'` |
| Go | `trade.Type == fyuz.TradeBuy` | `trade.Type.Is(fyuz.TradeBuy)` |
| Python | `trade.type == "buy"` | `trade.type.lower() == "buy"` |
| Rust | — | `matches!(trade.trade_side, TradeSide::Buy)` folds the case for you |

Pinned by [`shared/test-vectors/trade-side.json`](shared/test-vectors/trade-side.json).

## Examples

The same five programs exist in every language, so you can read the one you know and port it:

| | What it shows |
|---|---|
| **quickstart** | Health, chain config, the trending feed, king of the hill |
| **graduation watch** | Tokens closest to the $30k graduation threshold, and why there is no DEX price before it |
| **token deep dive** | One token: detail, holders, trades, hourly candles |
| **export tokens** | Auto-paginate every token to CSV, with decimal-exact arithmetic |
| **resilient polling** | Incremental trade polling, retry tuning, error classification |
| **trade** | Quote a buy and a sell, build the unsigned transactions, handle the approval |

```bash
cd typescript && pnpm build:examples && node build/examples/01-quickstart.js
cd go         && go run ./examples/quickstart
cd python     && PYTHONPATH=src python examples/01_quickstart.py
cd rust       && cargo run --example quickstart
```

## Layout

```
sdk/
├── typescript/     @fyuz/sdk          — src/, test/, examples/
├── go/             module .../sdk/go  — *.go, examples/<name>/main.go
├── python/         fyuz-sdk           — src/fyuz/, tests/, examples/
├── rust/           fyuz-sdk           — src/, tests/, examples/
├── shared/
│   └── test-vectors/                  — fixtures all four clients assert against
└── scripts/
    └── test-all.sh                    — runs every suite
```

Each language keeps its own package manifest and releases independently — the version numbers are
not tied together. There is no `packages/` nesting level because there is nothing for it to
disambiguate: these four directories *are* the packages, and the Go module path
`.../forgepad.finance/sdk/go` is a published import path that a rename would break.

Contract ABIs and deployment addresses are deliberately absent: these are clients for the public
read API and never touch a contract. Chain metadata is available at runtime from `GET /config`.

## Testing

```bash
scripts/test-all.sh              # every SDK with an installed toolchain
scripts/test-all.sh go rust      # just those two
```

No suite touches the network — all four drive a stub HTTP server on a loopback port.

On top of each client's own tests, every SDK has a **conformance** suite that reads
[`shared/test-vectors/`](shared) from disk and asserts the same things: decimals survive
byte-identical, nulls stay null, each HTTP status maps to the documented error variant, and only the
retryable statuses are retried. Changing the wire contract fails all four suites at once, which is
the point — see [`shared/README.md`](shared/README.md).

CI runs the four suites plus `gofmt`, `go vet`, `cargo fmt`, `clippy -D warnings`, `ruff` and `mypy`
on every push touching `sdk/**` ([`.github/workflows/sdk.yml`](../.github/workflows/sdk.yml)).

## Docs

- Per-language READMEs: [TypeScript](typescript/README.md) · [Go](go/README.md) ·
  [Python](python/README.md) · [Rust](rust/README.md)
- OpenAPI spec and Swagger UI: served by the backend
- API root: `https://api.fyuz.fun`
