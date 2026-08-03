/**
 * A long-running consumer: poll the trade feed forever without falling over.
 *
 *   pnpm build:examples && node build/examples/05-resilient-polling.js
 *
 * Three things make this survivable in production:
 *
 *  1. `latestTradeId` — ask only for what is new. The server returns trades with
 *     a higher id than the one you pass, so the poll cost stays flat instead of
 *     growing with the token's history.
 *  2. The client's own retries — 429s, 5xx and transport failures are retried
 *     with exponential backoff and full jitter, honouring `Retry-After`. The
 *     API allows 120 requests/minute per IP; at one poll every 5s this uses 12.
 *  3. Errors handled by class, not by string matching. A rate limit that
 *     survives the retry budget means back off harder; a 404 means the resource
 *     is gone and retrying will never help.
 *
 * Ctrl-C to stop.
 */

import {
  FyuzApiError,
  FyuzClient,
  FyuzConnectionError,
  FyuzNotFoundError,
  FyuzRateLimitError,
  FyuzTimeoutError,
} from '../src/index.js';

const POLL_INTERVAL_MS = 5_000;

const client = new FyuzClient({
  timeoutMs: 10_000,
  maxRetries: 5,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 30_000,
  // Identify yourself. If the API ever needs to contact a heavy consumer, this
  // is the only thing it has to go on.
  userAgent: 'fyuz-example-poller/1.0 (ops@example.com)',
});

let running = true;
process.on('SIGINT', () => {
  console.log('\nstopping…');
  running = false;
});

// Start from the current tip rather than replaying history.
let latestTradeId = (await client.getRecentTrades()).trades[0]?.id ?? 0;
console.log(`polling from trade id ${latestTradeId}, every ${POLL_INTERVAL_MS / 1000}s`);

let consecutiveFailures = 0;

while (running) {
  try {
    const { trades, tokens } = await client.getRecentTrades({ latestTradeId });

    // The response carries the token records the trades reference, so a feed
    // consumer never has to fan out to /tokens per trade.
    const symbols = new Map(tokens.map((token) => [token.tokenAddress, token.tokenSymbol]));

    // Oldest first, so downstream sees them in the order they happened.
    for (const trade of [...trades].reverse()) {
      const symbol = symbols.get(trade.tokenAddress) ?? trade.tokenSymbol;
      const when = new Date(trade.date * 1000).toISOString().slice(11, 19);
      console.log(
        `${when}  ${trade.type.padEnd(4)}  ${symbol.padEnd(10)}  ` +
          `${trade.tokenAmount.padStart(26)} tokens for ${trade.ethAmount} BNB`,
      );
      latestTradeId = Math.max(latestTradeId, trade.id);
    }

    consecutiveFailures = 0;
    await sleep(POLL_INTERVAL_MS);
  } catch (error) {
    consecutiveFailures += 1;
    await sleep(handle(error, consecutiveFailures));
  }
}

/** Decide how long to wait after a failure, and say why. */
function handle(error: unknown, failures: number): number {
  if (error instanceof FyuzRateLimitError) {
    // The client already exhausted its retries on this one, so the answer is
    // not another immediate retry — it is polling less often.
    const wait = (error.retryAfterSeconds ?? 60) * 1000;
    console.error(`rate limited past the retry budget; backing off ${wait / 1000}s`);
    return wait;
  }

  if (error instanceof FyuzNotFoundError) {
    // 404 is a statement about the resource, not the connection. Retrying the
    // same request cannot fix it.
    console.error(`gone: ${error.message}`);
    return POLL_INTERVAL_MS;
  }

  if (error instanceof FyuzTimeoutError || error instanceof FyuzConnectionError) {
    const wait = Math.min(60_000, POLL_INTERVAL_MS * 2 ** Math.min(failures, 4));
    console.error(`${error.name}: ${error.message} — retrying in ${wait / 1000}s`);
    return wait;
  }

  if (error instanceof FyuzApiError) {
    console.error(`HTTP ${error.status} from ${error.url}: ${error.message}`);
    return POLL_INTERVAL_MS * 2;
  }

  // Not ours — a bug in this file, most likely. Let it be loud.
  throw error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
