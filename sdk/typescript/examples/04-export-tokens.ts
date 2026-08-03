/**
 * Export every token matching a filter to CSV, one row at a time.
 *
 *   pnpm build:examples && node build/examples/04-export-tokens.js [searchWord] > tokens.csv
 *
 * `iterateTokens` walks the paginated `/tokens` endpoint lazily: pages are
 * fetched as the loop consumes them, and breaking out stops the requests. That
 * keeps memory flat regardless of how many tokens match.
 *
 * The decimal columns are written straight through as the strings the API sent.
 * Routing them via Number() first would corrupt exactly the values a downstream
 * analyst cares about — see the header comment on `writeRow`.
 */

import { FyuzClient } from '../src/index.js';

const client = new FyuzClient();
const searchWord = process.argv[2];

const COLUMNS = [
  'tokenAddress',
  'tokenSymbol',
  'tokenName',
  'network',
  'marketcap',
  'price',
  'volume',
  'liquidity',
  'pairAddress',
  'createdAt',
] as const;

process.stdout.write(COLUMNS.join(',') + '\n');

let exported = 0;

for await (const token of client.iterateTokens({
  ...(searchWord === undefined ? {} : { searchWord }),
  orderType: 'marketcap',
  orderFlag: 'desc',
  pageSize: 100,
})) {
  writeRow([
    token.tokenAddress,
    token.tokenSymbol,
    token.tokenName,
    token.network,
    token.marketcap,
    token.price,
    token.volume,
    // null is not 0: an unknown liquidity is left empty rather than invented.
    token.liquidity ?? '',
    token.pairAddress ?? '',
    token.createdAt,
  ]);

  exported += 1;
  if (exported % 500 === 0) console.error(`… ${exported} rows`);
}

console.error(`done — ${exported} rows`);

/**
 * Write one CSV row.
 *
 * `marketcap`, `price`, `volume` and `liquidity` arrive as decimal strings and
 * are emitted unchanged. Spreadsheets will still coerce them on open, but the
 * file itself holds the exact figure, which is the part this program controls.
 */
function writeRow(values: readonly string[]): void {
  process.stdout.write(values.map(escapeCsv).join(',') + '\n');
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
