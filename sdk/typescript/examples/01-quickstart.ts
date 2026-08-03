/**
 * Quickstart — is the API up, what chain is it on, what is trending.
 *
 *   pnpm build:examples && node build/examples/01-quickstart.js
 *
 * Every endpoint used here is unauthenticated.
 */

import { FyuzClient } from '../src/index.js';

const client = new FyuzClient();

const health = await client.health();
const config = await client.getConfig();

console.log(`api        ${health.status}`);
console.log(`chains     ${config.chains.map((c) => `${c.name} (${c.chainId})`).join(', ')}`);
console.log();

const trending = await client.discover({ tab: 'trending', limit: 10 });

console.log('symbol       market cap        24h vol    holders    24h %    to graduation');
console.log('─'.repeat(78));

for (const token of trending) {
  console.log(
    [
      token.symbol.slice(0, 10).padEnd(10),
      usd(token.marketcap).padStart(14),
      usd(token.volume24h).padStart(13),
      String(token.holders).padStart(9),
      pct(token.priceChange24h).padStart(8),
      (token.launched ? 'graduated' : `${token.graduationPct.toFixed(1)}%`).padStart(16),
    ].join(' '),
  );
}

// The king of the hill is the biggest token *still on the curve*. It is null in
// the window between one token graduating and the next one taking the lead —
// that is a real state, not an error.
const king = await client.getKing();
console.log();
console.log(
  king === null
    ? 'king       nobody on the hill right now'
    : `king       ${king.tokenSymbol} at ${king.marketcap} USD market cap`,
);

/**
 * Discovery figures are pre-aggregated analytics and arrive as numbers, so
 * formatting them as floats is safe here.
 *
 * The same is *not* true of `Token.marketcap` from `/tokens`, which is an exact
 * decimal string. See 04-export-tokens.ts.
 */
function usd(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function pct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}
