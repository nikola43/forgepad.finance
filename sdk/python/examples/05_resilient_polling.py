"""A long-running consumer: poll the trade feed forever without falling over.

    python examples/05_resilient_polling.py

Three things make this survivable in production:

1. ``latest_trade_id`` — ask only for what is new. The server returns trades
   with a higher id than the one you pass, so poll cost stays flat instead of
   growing with the token's history.
2. The client's own retries — 429s, 5xx and connection failures are retried with
   exponential backoff and full jitter, honouring ``Retry-After``. The API allows
   120 requests/minute per IP; at one poll every 5s this uses 12.
3. Errors handled by class, not by string matching. A rate limit that survived
   the retry budget means back off harder; a 404 means the resource is gone and
   retrying will never help.

Ctrl-C to stop.
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timezone

from fyuz import (
    FyuzAPIError,
    FyuzClient,
    FyuzConnectionError,
    FyuzNotFoundError,
    FyuzRateLimitError,
)

POLL_INTERVAL = 5.0


def backoff_for(error: Exception, consecutive_failures: int) -> float:
    """Decide how long to wait after a failure, and say why."""
    if isinstance(error, FyuzRateLimitError):
        # The client already exhausted its retries on this one, so the answer is
        # not another immediate retry — it is polling less often.
        wait = error.retry_after or 60.0
        print(f"rate limited past the retry budget; backing off {wait:.0f}s", file=sys.stderr)
        return wait

    if isinstance(error, FyuzNotFoundError):
        # 404 is a statement about the resource, not the connection. Retrying
        # the same request cannot fix it.
        print(f"gone: {error.message}", file=sys.stderr)
        return POLL_INTERVAL

    if isinstance(error, FyuzConnectionError):
        wait = min(60.0, POLL_INTERVAL * 2 ** min(consecutive_failures, 4))
        print(f"connection failed: {error} — retrying in {wait:.0f}s", file=sys.stderr)
        return wait

    if isinstance(error, FyuzAPIError):
        print(f"HTTP {error.status}: {error.message}", file=sys.stderr)
        return POLL_INTERVAL * 2

    raise error  # Not ours — a bug in this file, most likely. Let it be loud.


def main() -> None:
    with FyuzClient(
        timeout=10.0,
        max_retries=5,
        backoff_initial=0.5,
        backoff_max=30.0,
        # Identify yourself. If the API ever needs to contact a heavy consumer,
        # this is the only thing it has to go on.
        user_agent="fyuz-example-poller/1.0 (ops@example.com)",
    ) as fyuz:
        # Start from the current tip rather than replaying history.
        tip = fyuz.get_recent_trades().trades
        latest_trade_id = tip[0].id if tip else 0
        print(f"polling from trade id {latest_trade_id}, every {POLL_INTERVAL:.0f}s")

        consecutive_failures = 0

        while True:
            try:
                feed = fyuz.get_recent_trades(latest_trade_id=latest_trade_id)

                # The response carries the token records the trades reference,
                # so a feed consumer never has to fan out to /tokens per trade.
                symbols = {t.token_address: t.token_symbol for t in feed.tokens}

                # Oldest first, so downstream sees them in the order they happened.
                for trade in reversed(feed.trades):
                    symbol = symbols.get(trade.token_address, trade.token_symbol)
                    when = datetime.fromtimestamp(trade.date, timezone.utc).strftime("%H:%M:%S")
                    print(
                        f"{when}  {trade.type:<4}  {symbol:<10}  "
                        f"{trade.token_amount:>26} tokens for {trade.eth_amount} BNB"
                    )
                    latest_trade_id = max(latest_trade_id, trade.id)

                consecutive_failures = 0
                time.sleep(POLL_INTERVAL)
            except KeyboardInterrupt:
                print("\nstopping…")
                return
            except Exception as error:  # noqa: BLE001 - classified in backoff_for
                consecutive_failures += 1
                time.sleep(backoff_for(error, consecutive_failures))


if __name__ == "__main__":
    main()
