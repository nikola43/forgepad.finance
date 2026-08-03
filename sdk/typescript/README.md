# @fyuz/sdk

TypeScript SDK for the [Fyuz](https://fyuz.fun) public REST API — bonding-curve token market data on BNB Smart Chain.

- **Zero runtime dependencies.** Native `fetch`, nothing else. Node 18+ and modern browsers.
- **Fully typed.** Every response is a named interface, not `any`.
- **Handles the boring parts.** Timeouts, 429 backoff, typed errors, auto-pagination.

## The one thing to understand first

A Fyuz token trades on an **internal bonding curve** until it reaches a **$30,000 market cap**, at which
point it *graduates* into a PancakeSwap V2 pair.

**Before graduation there is no DEX pool anywhere — no PancakeSwap pair, nothing for an aggregator to
index. This API is the only source of price data for a pre-graduation token.** `pairAddress` is `null`
and `launched` is `false` for exactly those tokens, and the price you need lives in the bonding-curve
state this API serves (`price`, `marketcap`, `virtualEthAmount`, `virtualTokenAmount`).

After graduation, `pairAddress` is populated and `poolType` tells you the pool flavour: `1` =
PancakeSwap V2, `2` = V3, `3` = V4 / direct launch. `network` is the chain slug, currently always
`"bsc"`.

## Install

```bash
pnpm add @fyuz/sdk
```

## Quickstart

```ts
import { FyuzClient } from '@fyuz/sdk';

const client = new FyuzClient(); // defaults to https://api.fyuz.fun

// The highest-signal endpoint: one pre-aggregated row per token.
const trending = await client.discover({ tab: 'trending', limit: 20 });
for (const token of trending) {
  const venue = token.launched ? 'PancakeSwap' : 'bonding curve';
  console.log(`${token.symbol}  $${token.marketcap.toFixed(0)}  ${token.graduationPct.toFixed(1)}%  (${venue})`);
}

// Full curve state for one token.
const detail = await client.getToken('bsc', '0x23a84ba5bf7bf3236491fa2b5a9807a274337135');
console.log(detail.tokenDetails.price);      // "0.000004472899483094" — a STRING, see below
console.log(detail.tokenDetails.pairAddress); // null while still on the curve

// OHLCV candles for charting.
const now = Math.floor(Date.now() / 1000);
const candles = await client.getChartData({
  tokenAddress: '0x23a84ba5bf7bf3236491fa2b5a9807a274337135',
  interval: '5',            // minutes, or '1D'
  from: now - 86_400,       // UNIX seconds
  to: now,
});
```

Every endpoint is unauthenticated and safe to poll.

## Decimal fields are strings. Keep them that way.

Token amounts carry 18 decimals and wei values are uint256. Neither fits in a JavaScript `number`
exactly, so the API returns them as **decimal strings** and this SDK keeps them as `string`:

```ts
const stats = await client.distributor.getStats();

stats.totalPaidWei;                 // "1250000000000000001"  ✅ exact
BigInt(stats.totalPaidWei);         // ✅ arithmetic that stays exact
Number(stats.totalPaidWei);         // ❌ 1250000000000000000 — silently wrong
```

The rule: anything named `*Wei`, plus `marketcap` / `price` / `volume` / `tokenAmount` /
`ethAmount` / `virtual*Amount` / `liquidity` on `Token`, `Holder` and `Trade`, is a string. Convert to
`BigInt` for integers, or a decimal library for fractional values, and only at the point of display.

Analytics, portfolio and leaderboard endpoints return `number` instead — those values are already
rounded aggregates, so there is no precision to protect.

### `null` never means zero

`Pot.potBnb`, `Pot.totalPoints`, `Claimable.claimableWei`, `TokenDetail.curveHolding` and the
`RoundReceipt` wei fields are `null` when the chain read failed or the round has not been indexed yet.
That means **unknown**, not zero. Hide the figure; do not render `0`.

```ts
const pot = await client.distributor.getPot();
console.log(pot.potBnb === null ? 'Pot: —' : `Pot: ${pot.potBnb} BNB`);
```

## Auto-pagination

`GET /tokens` is the one paginated endpoint. Async generators walk it for you:

```ts
// One token at a time, pages fetched lazily as you consume them.
for await (const token of client.iterateTokens({ orderType: 'marketcap', orderFlag: 'desc' })) {
  console.log(token.tokenSymbol, token.marketcap);
  if (token.id === 500) break; // breaking stops fetching immediately
}

// Or page by page.
for await (const page of client.iterateTokenPages({ pageSize: 100 })) {
  console.log(`${page.tokenList.length} of ${page.tokenCount}`);
}
```

## Configuration

```ts
const client = new FyuzClient({
  baseUrl: 'https://api.fyuz.fun', // default
  timeoutMs: 30_000,               // per attempt, default 30s
  maxRetries: 3,                   // default 3; 0 disables retrying
  retryBaseDelayMs: 250,           // first backoff window
  retryMaxDelayMs: 8_000,          // ceiling on any single sleep
  headers: { 'x-app': 'my-indexer' },
  fetch: myInstrumentedFetch,      // defaults to the global fetch
});
```

Every method takes the same options per call as its last argument, plus an `AbortSignal`:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 1_000);
await client.discover({ tab: 'new' }, { signal: controller.signal, maxRetries: 0 });
```

## Rate limits, retries and errors

The API allows **120 requests/minute per IP** and answers `429 {"error": "Too many requests"}` beyond
that. The client retries `429` and `5xx` automatically with exponential backoff and full jitter,
honouring `Retry-After` when present — on a `503` from a draining load balancer just as much as on a
`429`. The header can only lengthen the wait (so `Retry-After: 0` cannot spin the retries away) and is
clamped to `retryMaxDelayMs`. Connection failures are retried too. Timeouts, aborts and every other
`4xx` are surfaced immediately — retrying those would only waste the caller's deadline.

```ts
import { FyuzRateLimitError, FyuzNotFoundError, FyuzApiError, FyuzError } from '@fyuz/sdk';

try {
  await client.getUserProfile('0xabc…');
} catch (err) {
  if (err instanceof FyuzRateLimitError) {
    console.warn(`rate limited, retry after ${err.retryAfterSeconds ?? '?'}s`);
  } else if (err instanceof FyuzNotFoundError) {
    console.warn('no profile for that address');
  } else if (err instanceof FyuzApiError) {
    console.error(err.status, err.message); // message is the server's {"error": …} envelope
  } else if (err instanceof FyuzError) {
    console.error('transport failure', err.message);
  } else {
    throw err;
  }
}
```

| Error | Thrown when |
| --- | --- |
| `FyuzApiError` | Any non-2xx response. Carries `status`, `method`, `url`, `body`, `retryAfterSeconds`. |
| `FyuzRateLimitError` | HTTP 429. Extends `FyuzApiError`. |
| `FyuzNotFoundError` | HTTP 404. Extends `FyuzApiError`. |
| `FyuzTimeoutError` | The per-attempt timeout elapsed. |
| `FyuzConnectionError` | The request never reached the API (DNS, refused, TLS, dropped socket). |
| `FyuzParseError` | A 2xx body that was not valid JSON — usually a proxy in the way. |
| `FyuzInvalidArgumentError` | An argument failed validation before anything was sent. |
| `FyuzError` | Base class for all of the above. |

## Methods

All 28 documented endpoints. Timestamps are UNIX **seconds** unless noted.

| Method | Endpoint | Returns |
| --- | --- | --- |
| `health()` | `GET /health` | `HealthStatus` |
| `getConfig()` | `GET /config` | `ChainConfig` |
| `discover(params?)` | `GET /discover` | `DiscoverToken[]` |
| `listTokens(params?)` | `GET /tokens` | `TokenPage` |
| `iterateTokens(params?)` | `GET /tokens` (all pages) | `AsyncGenerator<Token>` |
| `iterateTokenPages(params?)` | `GET /tokens` (all pages) | `AsyncGenerator<TokenPage>` |
| `getKing()` | `GET /tokens/king` | `Token \| null` (`null` when the hill is empty) |
| `getToken(network, address, params?)` | `GET /tokens/{network}/{tokenAddress}` | `TokenDetail` |
| `getRecentTrades(params?)` | `GET /trades/recent` | `RecentTrades` |
| `getTokenTrades(address, params?)` | `POST /trades` | `Trade[]` |
| `getChartData(params)` | `GET /trades/getChartData` | `Candle[]` |
| `getTokenAnalytics(network, address)` | `GET /analytics/token/{network}/{address}` | `TokenAnalytics` |
| `getTopTraders(network, address)` | `GET /analytics/top-traders/{network}/{address}` | `TopTrader[]` |
| `getWallet(address)` | `GET /wallet/{address}` | `WalletStats` |
| `getPortfolio(address)` | `GET /portfolio/{address}` | `Portfolio` |
| `getUserLeaderboard(params?)` | `GET /users/leaderboard` | `LeaderboardEntry[]` |
| `getUserProfile(address)` | `GET /users/profile/{address}` | `UserProfile` |
| `getTopHolders(count, params?)` | `GET /users/top/{count}` | `TopHolderEntry[]` |
| `getKingsHistory()` | `GET /kings/history` | `KingReign[]` |
| `getSeason()` | `GET /season` | `Season` |
| `getReferralLeaderboard(params?)` | `GET /referrals/leaderboard` | `ReferralLeaderEntry[]` |
| `getTier(address)` | `GET /tier/{address}` | `TierInfo` |
| `getRewards(address)` | `GET /rewards/{address}` | `Rewards` |
| `distributor.getStats()` | `GET /distributor/stats` | `PayoutStats` |
| `distributor.getPot()` | `GET /distributor/pot` | `Pot` |
| `distributor.getShares(params?)` | `GET /distributor/shares` | `Shares` |
| `distributor.listRounds(params?)` | `GET /distributor/rounds` | `RoundReceipt[]` |
| `distributor.getRound(id)` | `GET /distributor/rounds/{id}` | `RoundDetail` |
| `distributor.getPayouts(address)` | `GET /distributor/payouts/{address}` | `AddressPayouts` |
| `distributor.getClaimable(address)` | `GET /distributor/claimable/{address}` | `Claimable` |

`POST /trades` is a read, not a mutation — the token address travels in the body. No authentication
is needed for it or for anything else here.

### Notes on individual endpoints

- **`discover`** is the endpoint to build an indexer on: market cap, 24h volume, buy/sell counts,
  holder count, price change and graduation progress in one row per token.
- **`getRecentTrades`** supports incremental polling: pass the highest `id` you have seen as
  `latestTradeId` and you get only what is new.
- **Leaderboard `rank`** is a server-assigned 1-based ordinal matching the returned order. Do not
  re-sort client-side; the ordering key is not always the column you are displaying.
- **`getRound`** returns the receipt fields *flattened* alongside `payouts` — `round.potWei`, not
  `round.round.potWei`.
- **`ChatMessage.date`** and `Token.createdAt` / `updatedAt` / `launchedAt` / `creationTime` are
  RFC-3339 strings. Every other timestamp in the API (`startedAt`, `timeEnd`, `roundEnd`, `from`,
  `to`, `Trade.date`, …) is UNIX seconds.

## Distributor in one paragraph

A slice of every trade fee accumulates in the Distributor contract. At the end of each round, 90% of
the pot is paid out pro-rata by leaderboard points and the rest goes to one Chainlink-VRF-picked
winner. `distributor.getPot()` shows the live pot, `getShares()` shows the allocation the round-runner
will post on-chain (including the exact `postShares` calldata), and `listRounds()` / `getRound()` are
the public ledger of everything already paid. `getClaimable()` covers the rare case where a push
payment failed and the wallet must call `claim()` itself — this SDK only reads; signing is yours.

## Browser use

Works unchanged in the browser. `User-Agent` is a forbidden header name there, so browsers drop the
SDK's identifying header — nothing else changes. Only `getTokenTrades` (`POST /trades`) triggers a
CORS preflight, because its `content-type: application/json` is not a safelisted value; every other
call is a simple request. Either way, browser use requires your origin to be on the API's allow-list.

## Development

```bash
pnpm install
pnpm build           # tsc -> dist/ with .d.ts declarations
pnpm test            # compiles src+test+examples -> build/, then node --test
pnpm typecheck       # type-check without emitting
pnpm build:examples  # compile examples/ -> build/examples/
```

Tests run against a local `node:http` stub server on a loopback port — the suite never touches the
network.

## Trading

`client.trade` builds **unsigned** bonding-curve transactions. It never sees a private key, never
signs and never broadcasts — that is why this package still has zero runtime dependencies.

```ts
import { FyuzClient, parseUnits, formatUnits } from '@fyuz/sdk';

const client = new FyuzClient({ trade: { rpcUrl: process.env.BSC_RPC_URL } });

const quote = await client.trade.quoteBuy({ token, amountWei: parseUnits('0.5') });
console.log(`${formatUnits(quote.amountOutWei)} tokens for ${formatUnits(quote.valueWei)} BNB`);

const { transaction } = await client.trade.buildBuy({
  token,
  amountWei: parseUnits('0.5'),
  slippageBps: 100,   // 1% — required, there is no default
});

await walletClient.sendTransaction(transaction);   // your wallet, your key
```

Selling needs an ERC-20 approval first, because the contract pulls the tokens with `transferFrom`:

```ts
const allowance = await client.trade.allowance({ token, owner });
if (BigInt(allowance) < BigInt(amountWei)) {
  await walletClient.sendTransaction(await client.trade.buildApprove({ token, amountWei }));
}
const sell = await client.trade.buildSell({ token, amountWei, slippageBps: 150 });
```

`transaction.value` already includes `getFirstBuyFee(token)`, which is charged on top of the swap
amount. A token that has graduated raises `FyuzTokenGraduatedError` rather than building a
transaction that would revert. Contract address, chain id and RPC all come from `GET /config` —
nothing is hardcoded — but pass your own `rpcUrl` in production, since the published one is shared
by every caller.

## Examples

Runnable programs in [`examples/`](examples), compiled by `pnpm build:examples`:

| Example | What it shows |
|---|---|
| [`01-quickstart.ts`](examples/01-quickstart.ts) | Health, chain config, the trending feed, king of the hill |
| [`02-graduation-watch.ts`](examples/02-graduation-watch.ts) | Tokens closest to the $30k graduation threshold |
| [`03-token-deep-dive.ts`](examples/03-token-deep-dive.ts) | One token: detail, holders, trades, hourly candles |
| [`04-export-tokens.ts`](examples/04-export-tokens.ts) | Auto-paginate every token to CSV with exact decimals |
| [`05-resilient-polling.ts`](examples/05-resilient-polling.ts) | Incremental trade polling, retries, error classification |
| [`06-trade.ts`](examples/06-trade.ts) | Quote a buy and a sell, build the unsigned transactions, handle the approval |

```bash
pnpm build:examples
node build/examples/01-quickstart.js
node build/examples/04-export-tokens.js dog > tokens.csv
```

The same five exist in the Go, Python and Rust clients — see [`../README.md`](../README.md).

## Versioning

The SDK is versioned independently of the API. It sends `User-Agent: fyuz-sdk-typescript/<version>`,
exported as `USER_AGENT` / `VERSION`.
