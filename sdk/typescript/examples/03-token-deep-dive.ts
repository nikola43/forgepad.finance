/**
 * Everything the API knows about one token.
 *
 *   pnpm build:examples && node build/examples/03-token-deep-dive.js [address] [network]
 *
 * With no address, the current king of the hill is used.
 */

import { FyuzClient } from '../src/index.js';

const client = new FyuzClient();

const [addressArg, networkArg = 'bsc'] = process.argv.slice(2);

let address = addressArg;
if (address === undefined) {
  const king = await client.getKing();
  if (king === null) {
    console.error('no king right now — pass a token address explicitly');
    process.exit(1);
  }
  address = king.tokenAddress;
  console.log(`no address given, using the king: ${king.tokenSymbol}\n`);
}

const detail = await client.getToken(networkArg, address, { pageSize: 10 });
const token = detail.tokenDetails;

console.log(`${token.tokenName} (${token.tokenSymbol})`);
console.log(`  address        ${token.tokenAddress}`);
console.log(`  creator        ${token.user.username ?? token.creatorAddress}`);
console.log(`  created        ${token.createdAt}`);
console.log();

// Exact decimal strings. Printed verbatim on purpose: passing them through
// Number() would round the last digits off a market cap or a price.
console.log('  market cap     ' + token.marketcap);
console.log('  price          ' + token.price);
console.log('  volume         ' + token.volume);
console.log('  liquidity      ' + (token.liquidity ?? 'unknown'));
console.log();

console.log(
  token.pairAddress === null
    ? `  status         on the bonding curve, ${token.progress?.toFixed(1) ?? '?'}% to graduation`
    : `  status         graduated — pair ${token.pairAddress}`,
);
console.log(`  trades         ${detail.tradesCount}`);
console.log();

console.log(`top holders (${detail.holdersDetails.length} shown)`);
for (const holder of detail.holdersDetails.slice(0, 10)) {
  const who = holder.user.username ?? holder.holderAddress;
  console.log(`  ${who.slice(0, 24).padEnd(24)} ${holder.tokenAmount}`);
}
console.log();

console.log('recent trades');
for (const trade of detail.trades.slice(0, 10)) {
  const when = new Date(trade.date * 1000).toISOString().replace('T', ' ').slice(0, 19);
  console.log(
    `  ${when}  ${trade.type.padEnd(4)}  ${trade.tokenAmount.padStart(28)} @ ${trade.tokenPrice}`,
  );
}
console.log();

// Hourly candles for the last day. Candle values are pre-aggregated analytics,
// so unlike the fields above they legitimately arrive as numbers.
const to = Math.floor(Date.now() / 1000);
const from = to - 24 * 60 * 60;
const candles = await client.getChartData({ tokenAddress: address, interval: '60', from, to });

console.log(`hourly candles, last 24h (${candles.length} returned)`);
for (const candle of candles.slice(-8)) {
  const hour = new Date(candle.time * 1000).toISOString().slice(11, 16);
  console.log(
    `  ${hour}  o ${candle.open.toPrecision(6)}  h ${candle.high.toPrecision(6)}` +
      `  l ${candle.low.toPrecision(6)}  c ${candle.close.toPrecision(6)}  vol ${candle.volume.toFixed(0)}`,
  );
}
