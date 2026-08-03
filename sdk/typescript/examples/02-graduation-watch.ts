/**
 * Graduation watch — which tokens are closest to leaving the bonding curve.
 *
 *   pnpm build:examples && node build/examples/02-graduation-watch.js
 *
 * A Fyuz token trades on an internal bonding curve until it reaches a $30,000
 * market cap, then graduates into a PancakeSwap V2 pair. Until that happens
 * there is no DEX pool anywhere: `pairAddress` is null and no aggregator has a
 * price. This API is the only source, which is exactly what makes the
 * pre-graduation window worth watching.
 */

import { FyuzClient, type DiscoverToken } from '../src/index.js';

/** Market cap at which a token graduates, in USD. */
const GRADUATION_TARGET_USD = 30_000;

const client = new FyuzClient();

const candidates = await client.discover({
  tab: 'graduating',
  status: 'bonding',
  minHolders: 10,
  limit: 25,
});

if (candidates.length === 0) {
  console.log('nothing close to graduation right now');
  process.exit(0);
}

// `graduationPct` is what the server computed; recomputing from market cap here
// would only introduce a second, disagreeing number.
const sorted = [...candidates].sort((a, b) => b.graduationPct - a.graduationPct);

console.log(`${sorted.length} tokens on the curve, closest first\n`);

for (const token of sorted) {
  const remaining = Math.max(0, GRADUATION_TARGET_USD - token.marketcap);
  console.log(
    [
      token.symbol.slice(0, 10).padEnd(10),
      bar(token.graduationPct),
      `${token.graduationPct.toFixed(1)}%`.padStart(7),
      `$${Math.round(remaining).toLocaleString('en-US')} to go`.padStart(18),
      `${token.holders} holders`.padStart(14),
    ].join(' '),
  );
}

console.log();
console.log(`watching the top candidate: ${sorted[0]?.symbol}`);

const leader = sorted[0] as DiscoverToken;
const detail = await client.getToken(leader.network, leader.tokenAddress, { pageSize: 1 });

// Both of these are decimal strings and stay strings. `curveHolding` is null
// when the on-chain read failed — that means *unknown*, and printing 0 would
// tell the reader something false.
console.log(`  market cap     ${detail.tokenDetails.marketcap} USD (exact)`);
console.log(`  price          ${detail.tokenDetails.price} USD (exact)`);
console.log(`  curve holding  ${detail.curveHolding ?? 'unknown — on-chain read failed'}`);
console.log(
  `  pair address   ${detail.tokenDetails.pairAddress ?? 'none — still on the curve, no DEX pool exists'}`,
);

/** A 24-cell progress bar. */
function bar(percent: number): string {
  const width = 24;
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return `[${'█'.repeat(filled)}${'·'.repeat(width - filled)}]`;
}
