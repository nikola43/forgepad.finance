"""Export every token matching a filter to CSV, one row at a time.

    python examples/04_export_tokens.py [search_word] > tokens.csv

``iter_tokens`` walks the paginated ``/tokens`` endpoint lazily: pages are
fetched as the loop consumes them, and breaking out stops the requests. Memory
stays flat regardless of how many tokens match.

The decimal columns are written straight through as the strings the API sent.
``float()`` on the way past would corrupt exactly the values a downstream
analyst cares about; see ``running_total`` below for the way to do arithmetic on
them safely.
"""

from __future__ import annotations

import csv
import sys
from decimal import Decimal

from fyuz import FyuzClient, to_decimal

COLUMNS = [
    "tokenAddress",
    "tokenSymbol",
    "tokenName",
    "network",
    "marketcap",
    "price",
    "volume",
    "liquidity",
    "pairAddress",
    "createdAt",
]


def main() -> None:
    search_word = sys.argv[1] if len(sys.argv) > 1 else None

    writer = csv.writer(sys.stdout, lineterminator="\n")
    writer.writerow(COLUMNS)

    exported = 0
    # Decimal, not float: summing thousands of 18-decimal market caps in binary
    # floating point drifts by an amount that grows with the row count.
    running_total = Decimal(0)

    with FyuzClient() as fyuz:
        for token in fyuz.iter_tokens(
            search_word=search_word,
            order_type="marketcap",
            order_flag="desc",
            page_size=100,
        ):
            writer.writerow(
                [
                    token.token_address,
                    token.token_symbol,
                    token.token_name,
                    token.network,
                    token.marketcap,
                    token.price,
                    token.volume,
                    # None is not 0: an unknown liquidity is left empty rather
                    # than invented.
                    token.liquidity or "",
                    token.pair_address or "",
                    token.created_at,
                ]
            )

            marketcap = to_decimal(token.marketcap)
            if marketcap is not None:
                running_total += marketcap

            exported += 1
            if exported % 500 == 0:
                print(f"… {exported} rows", file=sys.stderr)

    print(f"done — {exported} rows, {running_total:,.2f} USD total market cap", file=sys.stderr)


if __name__ == "__main__":
    main()
