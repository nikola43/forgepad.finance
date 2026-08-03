# Fyuz Go SDK

Official Go client for the [Fyuz](https://fyuz.fun) public REST API — the
bonding-curve token launchpad on BNB Smart Chain.

- **28 endpoints**, every one unauthenticated and read-only
- **Zero dependencies** — `net/http`, `encoding/json`, `math/big`, stdlib only
- Typed models for every response; no `map[string]any` anywhere
- Automatic retry on `429` and `5xx` with exponential backoff + full jitter
- `context.Context` on every call, functional options, auto-pagination

## Install

```bash
go get github.com/nikola43/forgepad.finance/sdk/go
```

Requires Go 1.21 or newer.

```go
import fyuz "github.com/nikola43/forgepad.finance/sdk/go"
```

## Quickstart

```go
package main

import (
	"context"
	"fmt"
	"log"

	fyuz "github.com/nikola43/forgepad.finance/sdk/go"
)

func main() {
	client := fyuz.New()
	ctx := context.Background()

	tokens, err := client.Discover(ctx, &fyuz.DiscoverOptions{
		Tab:   fyuz.TabTrending,
		Limit: fyuz.Int64(10),
	})
	if err != nil {
		log.Fatal(err)
	}

	for _, t := range tokens {
		fmt.Printf("%-8s $%10.2f  %5.1f%% to graduation  %d holders\n",
			t.Symbol, t.Marketcap, t.GraduationPct, t.Holders)
	}
}
```

## The one thing to understand first

A Fyuz token trades against an **internal bonding curve** until it reaches a
**$30,000 market cap**, at which point it **graduates** into a PancakeSwap V2
pair.

**Before graduation `pairAddress` is `null` and there is no DEX pool anywhere.**
No subgraph, no router quote, no pair reserves — nothing on-chain to read a
price from. For a pre-graduation token *this API is the only source of price,
liquidity and curve state*. That is what `/discover`, `/tokens/{network}/{addr}`
and `/trades/getChartData` exist for.

```go
if !token.Graduated() {
	// PairAddress == nil: curve-only. Price comes from here or nowhere.
}
```

After graduation, `PairAddress` is populated and `PoolType` tells you the venue:
`1` = PancakeSwap V2, `2` = V3, `3` = V4 (direct launches also report `3`). The
API types the field as a plain integer with no enum, so switch on it with a
default branch rather than assuming those are the only values. `Network` is the
chain slug, currently always `"bsc"`.

## Configuration

```go
client := fyuz.New(
	fyuz.WithBaseURL("https://api.fyuz.fun"), // default
	fyuz.WithTimeout(30*time.Second),         // default; per attempt, not per call
	fyuz.WithMaxRetries(3),                   // default; 0 disables retries
	fyuz.WithBackoff(250*time.Millisecond, 8*time.Second),
	fyuz.WithHTTPClient(myClient),            // custom transport / instrumentation
	fyuz.WithUserAgent("acme-indexer/2.0"),   // default: fyuz-sdk-go/<version>
)
```

`Client` is safe for concurrent use — create one and share it so connections
are pooled.

## Methods

Every method takes a `context.Context` first. Options structs are always
pointers; pass `nil` for the server defaults.

| Method | Endpoint | Returns |
| --- | --- | --- |
| `Health(ctx)` | `GET /health` | `*HealthStatus` |
| `GetConfig(ctx)` | `GET /config` | `*ChainConfig` |
| `Discover(ctx, *DiscoverOptions)` | `GET /discover` | `[]DiscoverToken` |
| `ListTokens(ctx, *ListTokensOptions)` | `GET /tokens` | `*TokenPage` |
| `IterateTokens(*ListTokensOptions)` | `GET /tokens` (all pages) | `*TokenIterator` |
| `GetKing(ctx)` | `GET /tokens/king` | `*Token` (nil when the hill is empty) |
| `GetToken(ctx, network, addr, *GetTokenOptions)` | `GET /tokens/{network}/{tokenAddress}` | `*TokenDetail` |
| `GetRecentTrades(ctx, *RecentTradesOptions)` | `GET /trades/recent` | `*RecentTrades` |
| `GetTokenTrades(ctx, addr, *TokenTradesOptions)` | `POST /trades` | `[]Trade` |
| `GetChartData(ctx, *ChartDataOptions)` | `GET /trades/getChartData` | `[]Candle` |
| `GetTokenAnalytics(ctx, network, addr)` | `GET /analytics/token/{network}/{address}` | `*TokenAnalytics` |
| `GetTopTraders(ctx, network, addr)` | `GET /analytics/top-traders/{network}/{address}` | `[]TopTrader` |
| `GetWallet(ctx, addr)` | `GET /wallet/{address}` | `*WalletStats` |
| `GetPortfolio(ctx, addr)` | `GET /portfolio/{address}` | `*Portfolio` |
| `GetUserLeaderboard(ctx, *LeaderboardOptions)` | `GET /users/leaderboard` | `[]LeaderboardEntry` |
| `GetUserProfile(ctx, addr)` | `GET /users/profile/{address}` | `*UserProfile` |
| `GetTopHolders(ctx, count, *TopHoldersOptions)` | `GET /users/top/{count}` | `[]TopHolderEntry` |
| `GetKingsHistory(ctx)` | `GET /kings/history` | `[]KingReign` |
| `GetSeason(ctx)` | `GET /season` | `*Season` |
| `GetReferralLeaderboard(ctx, *LeaderboardOptions)` | `GET /referrals/leaderboard` | `[]ReferralLeaderEntry` |
| `GetTier(ctx, addr)` | `GET /tier/{address}` | `*TierInfo` |
| `GetRewards(ctx, addr)` | `GET /rewards/{address}` | `*Rewards` |
| `Distributor.GetStats(ctx)` | `GET /distributor/stats` | `*PayoutStats` |
| `Distributor.GetPot(ctx)` | `GET /distributor/pot` | `*Pot` |
| `Distributor.GetShares(ctx, *SharesOptions)` | `GET /distributor/shares` | `*Shares` |
| `Distributor.ListRounds(ctx, *ListRoundsOptions)` | `GET /distributor/rounds` | `[]RoundReceipt` |
| `Distributor.GetRound(ctx, id)` | `GET /distributor/rounds/{id}` | `*RoundDetail` |
| `Distributor.GetPayouts(ctx, addr)` | `GET /distributor/payouts/{address}` | `*AddressPayouts` |
| `Distributor.GetClaimable(ctx, addr)` | `GET /distributor/claimable/{address}` | `*Claimable` |

`GetTokenTrades` is an HTTP `POST` because the API takes the token address in
the request body. It is a **read** — nothing is mutated and no auth is
involved.

## Precision: decimal fields are strings, on purpose

**Do not parse the string amount fields into `float64`. Ever.**

Token balances and BNB amounts carry 18 decimals, and wei totals are exact
`uint256` integers. Both routinely exceed the 2^53 range in which `float64` is
exact, so the SDK keeps them as `string` and gives you `math/big` helpers:

```go
stats, _ := client.Distributor.GetStats(ctx)

wei, err := fyuz.ParseWei(stats.TotalPaidWei) // *big.Int, exact
bnb := fyuz.WeiToBNB(wei)                     // *big.Rat, exact
fmt.Println(bnb.FloatString(6))

mcap, err := fyuz.ParseDecimal(token.Marketcap) // *big.Rat, "4472.899483094470000000"
```

String (exact, keep as strings):

- `Token`: `Marketcap`, `Price`, `EthPrice`, `Volume`, `Score`,
  `VirtualEthAmount`, `VirtualTokenAmount`, `Liquidity`
- `Trade`: `EthAmount`, `TokenAmount`, `TokenPrice`, `EthPrice`
- `Holder`: `TokenAmount`, `Marketcap`
- `TokenDetail`: `FifteenMinPrice`, `OneDayLiquidity`, `CurveHolding`
- **every `*Wei` field**, plus `RoundReceipt.VrfRandom` (a decimal string, not
  hex and not a number)

Number (`float64`, already aggregates): everything on `DiscoverToken`,
`TokenAnalytics`, `WalletStats`, `Portfolio`, `Candle`, all points/PnL/USD/BNB
figures (`points`, `rewardEth`, `volumeUsd`, `prizePotEth`, `potBnb`).

## `nil` means unknown, never zero

Nullable fields are pointers and a `nil` is a genuine "we could not read this":
the RPC was unreachable, or the settlement has not been indexed yet. Rendering
`0` in that case is a correctness bug — hide the figure instead.

```go
pot, _ := client.Distributor.GetPot(ctx)
if pot.PotBnb != nil {
	fmt.Printf("%.4f BNB in the pot\n", *pot.PotBnb)
} else {
	fmt.Println("pot size unavailable") // NOT "0 BNB"
}
```

Affected: `Pot.PotBnb`, `Pot.TotalPoints`, `Claimable.ClaimableWei`,
`TokenDetail.CurveHolding`, and `RoundReceipt.PotWei` / `.DistributedWei` /
`.WinnerAmountWei`.

## Errors

Every non-2xx response becomes an `*APIError` carrying `StatusCode`, `Message`
(parsed from the API's `{"error": "..."}` envelope), `Method`, `URL`,
`RetryAfter` and the raw `Body`.

```go
_, err := client.GetToken(ctx, "bsc", addr, nil)
switch {
case errors.Is(err, fyuz.ErrNotFound):    // 404
case errors.Is(err, fyuz.ErrRateLimited): // 429, retries exhausted
case errors.Is(err, fyuz.ErrBadRequest):  // 400
case errors.Is(err, fyuz.ErrServer):      // 5xx
case err != nil:
	var apiErr *fyuz.APIError
	if errors.As(err, &apiErr) {
		log.Printf("HTTP %d: %s", apiErr.StatusCode, apiErr.Message)
	}
}
```

`fyuz.IsRateLimited(err)` and `fyuz.IsNotFound(err)` are shorthands.

## Rate limiting and retries

The API allows **120 requests per minute per IP** and answers `429` with
`{"error": "Too many requests"}`.

The client retries `429` and `5xx` automatically — 3 times by default — with
exponential backoff and full jitter, honouring a `Retry-After` header when the
server sends one (capped at 60s). Transient transport failures (dropped
connections) are retried the same way. **No other `4xx` is ever retried.**
`WithMaxRetries(0)` turns retries off.

`WithTimeout` bounds each individual attempt, so a call that retries twice can
take up to three timeouts of wall clock. Use the context for an overall
deadline:

```go
ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
defer cancel()
```

## Auto-pagination

`/tokens` is paginated (`pageNumber` / `pageSize`, with `tokenCount` in the
response). `IterateTokens` walks every page for you, fetching lazily:

```go
it := client.IterateTokens(&fyuz.ListTokensOptions{
	OrderType: "marketcap",
	OrderFlag: fyuz.SortDesc,
	PageSize:  fyuz.Int64(100), // default 100
})
for it.Next(ctx) {
	token := it.Token()
	fmt.Println(token.TokenSymbol, token.Marketcap)
}
if err := it.Err(); err != nil {
	return err
}
fmt.Println("total matching rows:", it.TotalCount())
```

The iterator stops on a short page, an empty page, or once it has read
`tokenCount` rows. It is not safe for concurrent use; create one per goroutine.

The server clamps `pageSize` to `1..100`, so a `PageSize` above 100 is capped by
the iterator before the request goes out — otherwise every page would come back
shorter than asked for and the walk would stop after the first one.

## Optional parameters

Optional numeric and boolean query parameters are pointers so an explicit zero
is distinguishable from "unset". Use the constructors:

```go
opts := &fyuz.DiscoverOptions{
	MinHolders: fyuz.Int64(0),   // sends minHolders=0
	MinVolume:  nil,             // parameter omitted entirely
}
```

`fyuz.String`, `fyuz.Int64`, `fyuz.Float64`, `fyuz.Bool`. String options use
the empty string for "unset", since no endpoint takes a meaningful empty
string.

Integers are `int64` throughout the models, whatever width the API schema
declares, so a value from one call always feeds straight into another.

## Timestamps

`Date`, `StartedAt`, `EndedAt`, `TimeStart`, `TimeEnd`, `DistributedAt`,
`LastRoundAt`, `RoundEnd`, `StartsAt`, `EndsAt`, `From`, `To` are **UNIX
seconds** (`int64`):

```go
t := fyuz.UnixTime(reign.StartedAt)     // time.Time, UTC
p := fyuz.UnixTimePtr(reign.EndedAt)    // *time.Time; nil stays nil
```

`ChatMessage.Date`, `Token.CreatedAt`, `Token.UpdatedAt`, `Token.LaunchedAt`
and `Token.CreationTime` are RFC-3339 and decode straight into `time.Time`.

## Leaderboard ranks

`Rank` on the user, season and referral leaderboards is a server-assigned
1-based ordinal matching the returned order. **Do not re-sort client-side** —
the server's ordering is the one the payout uses.

## Distributor

The Distributor pays out the leaderboard fee stream each round: `DistributeBps`
of the pot pro-rata by points, the remainder to a single VRF-picked winner.

`RoundDetail` is **flat** on the wire — the receipt fields sit next to
`payouts`, which the SDK reproduces by embedding `RoundReceipt`:

```go
detail, _ := client.Distributor.GetRound(ctx, 12)
fmt.Println(detail.RoundID, detail.TimeEnd, len(detail.Payouts)) // promoted fields
```

Recording a round (`POST /distributor/rounds`) is API-key gated for the
internal round-runner and is deliberately absent from this SDK, as is every
other authenticated route.

## Trading

`client.Trade` builds **unsigned** bonding-curve transactions. It never sees a private key, never
signs and never broadcasts — that is why this module still has zero dependencies.

```go
client := fyuz.New(fyuz.WithRPCURL(os.Getenv("BSC_RPC_URL")))

spend, _ := fyuz.ParseUnits("0.5", 18)
quote, err := client.Trade.QuoteBuy(ctx, "bsc", token, spend)
// quote.AmountOutWei, quote.ValueWei, quote.PriceImpactBps

built, err := client.Trade.BuildBuy(ctx, &fyuz.BuyOptions{
    Token:       token,
    AmountWei:   spend,
    SlippageBps: 100, // 1% — required, there is no default
})
// built.Tx is {ChainID, To, Data, Value} — hand it to your signer
```

Selling needs an ERC-20 approval first, because the contract pulls the tokens with `transferFrom`:

```go
allowance, _ := client.Trade.Allowance(ctx, "bsc", token, owner)
if allowance.Cmp(amount) < 0 {
    approve, _ := client.Trade.BuildApprove(ctx, &fyuz.ApproveOptions{Token: token, AmountWei: amount})
    // sign and send `approve` first
}
sell, err := client.Trade.BuildSell(ctx, &fyuz.SellOptions{
    Token: token, AmountWei: amount, SlippageBps: 150,
})
```

`Tx.Value` already includes `getFirstBuyFee(token)`, which is charged on top of the swap amount. A
token that has graduated returns an error satisfying `fyuz.IsGraduated(err)` rather than building a
transaction that would revert. Contract address, chain id and RPC all come from `GET /config` —
nothing is hardcoded — but set `WithRPCURL` in production, since the published endpoint is shared by
every caller.

Trade sides differ in casing between endpoints, so compare with `trade.Type.Is(fyuz.TradeBuy)`
rather than `==`.

## Testing

```bash
go build ./...
go vet ./...
go test ./...
go test -race -count=1 ./...
```

The test suite runs entirely against `net/http/httptest` stub servers and never
touches the network.

`conformance_test.go` additionally reads [`../shared/test-vectors`](../shared)
from disk — the same fixtures drive the TypeScript, Python and Rust suites, so a
change to the wire contract fails all four at once.

To run every SDK at once, from the repository root:

```bash
sdk/scripts/test-all.sh
```

## Examples

Runnable commands in [`examples/`](examples), each its own `package main` and
built by `go build ./...`:

| Command | What it shows |
|---|---|
| [`quickstart`](examples/quickstart) | Health, chain config, the trending feed, king of the hill |
| [`graduationwatch`](examples/graduationwatch) | Tokens closest to the $30k graduation threshold |
| [`tokendeepdive`](examples/tokendeepdive) | One token: detail, holders, trades, hourly candles |
| [`exporttokens`](examples/exporttokens) | Auto-paginate every token to CSV, summing with `big.Rat` |
| [`resilientpolling`](examples/resilientpolling) | Incremental trade polling, retry tuning, error classification |
| [`trade`](examples/trade) | Quote a buy and a sell, build the unsigned transactions, handle the approval |

```bash
go run ./examples/quickstart
go run ./examples/tokendeepdive 0x42322852a918f94186b7dfda2e0e3f4ad3528480
go run ./examples/exporttokens dog > tokens.csv
```

The same five exist in the TypeScript, Python and Rust clients — see
[`../README.md`](../README.md).

## License

See the repository root.
