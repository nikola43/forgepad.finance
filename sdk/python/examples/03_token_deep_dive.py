"""Everything the API knows about one token.

    python examples/03_token_deep_dive.py [address] [network]

With no address, the current king of the hill is used.
"""

from __future__ import annotations

import sys
import time
from datetime import datetime, timezone

from fyuz import FyuzClient


def main() -> int:
    address = sys.argv[1] if len(sys.argv) > 1 else None
    network = sys.argv[2] if len(sys.argv) > 2 else "bsc"

    with FyuzClient() as fyuz:
        if address is None:
            king = fyuz.get_king()
            if king is None:
                print("no king right now — pass a token address explicitly", file=sys.stderr)
                return 1
            address = king.token_address
            print(f"no address given, using the king: {king.token_symbol}\n")

        detail = fyuz.get_token(network, address, page_size=10)
        token = detail.token_details

        creator = (token.user.username if token.user else None) or token.creator_address

        print(f"{token.token_name} ({token.token_symbol})")
        print(f"  address        {token.token_address}")
        print(f"  creator        {creator}")
        print(f"  created        {token.created_at}")
        print()

        # Exact decimal strings, printed verbatim on purpose: float() would
        # round the last digits off a market cap or a price.
        print(f"  market cap     {token.marketcap}")
        print(f"  price          {token.price}")
        print(f"  volume         {token.volume}")
        print(f"  liquidity      {token.liquidity or 'unknown'}")
        print()

        if token.pair_address is None:
            progress = f"{token.progress:.1f}" if token.progress is not None else "?"
            print(f"  status         on the bonding curve, {progress}% to graduation")
        else:
            print(f"  status         graduated — pair {token.pair_address}")
        print(f"  trades         {detail.trades_count}")
        print()

        print(f"top holders ({len(detail.holders_details)} shown)")
        for holder in detail.holders_details[:10]:
            who = (holder.user.username if holder.user else None) or holder.holder_address
            print(f"  {who[:24]:<24} {holder.token_amount}")
        print()

        print("recent trades")
        for trade in detail.trades[:10]:
            when = datetime.fromtimestamp(trade.date, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            print(f"  {when}  {trade.type:<4}  {trade.token_amount:>28} @ {trade.token_price}")
        print()

        # Hourly candles for the last day. Candle values are pre-aggregated
        # analytics, so unlike the fields above they legitimately are floats.
        to_ts = int(time.time())
        candles = fyuz.get_chart_data(address, "60", to_ts - 24 * 3600, to_ts)

        print(f"hourly candles, last 24h ({len(candles)} returned)")
        for candle in candles[-8:]:
            hour = datetime.fromtimestamp(candle.time, timezone.utc).strftime("%H:%M")
            print(
                f"  {hour}  o {candle.open:.6g}  h {candle.high:.6g}"
                f"  l {candle.low:.6g}  c {candle.close:.6g}  vol {candle.volume:.0f}"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
