"""Quickstart — is the API up, what chain is it on, what is trending.

    python examples/01_quickstart.py

Every endpoint used here is unauthenticated.
"""

from __future__ import annotations

from fyuz import FyuzClient


def usd(value: float) -> str:
    """Format a discovery figure.

    Discovery numbers are pre-aggregated analytics and arrive as floats, so
    formatting them this way is safe. The same is *not* true of
    ``Token.marketcap`` from ``/tokens``, which is an exact decimal string —
    see 04_export_tokens.py.
    """
    return f"${value:,.0f}"


def main() -> None:
    with FyuzClient() as fyuz:
        health = fyuz.health()
        config = fyuz.get_config()

        print(f"api        {health.status}")
        chains = ", ".join(f"{c.name} ({c.chain_id})" for c in config.chains)
        print(f"chains     {chains}")
        print()

        print("symbol       market cap        24h vol    holders    24h %    to graduation")
        print("─" * 78)

        for token in fyuz.discover(tab="trending", limit=10):
            progress = "graduated" if token.launched else f"{token.graduation_pct:.1f}%"
            print(
                f"{token.symbol[:10]:<10} "
                f"{usd(token.marketcap):>14} "
                f"{usd(token.volume24h):>13} "
                f"{token.holders:>9} "
                f"{token.price_change24h:>+7.1f}% "
                f"{progress:>16}"
            )

        # The king of the hill is the biggest token *still on the curve*. It is
        # None in the window between one token graduating and the next taking
        # the lead — a real state, not an error.
        king = fyuz.get_king()
        print()
        if king is None:
            print("king       nobody on the hill right now")
        else:
            print(f"king       {king.token_symbol} at {king.marketcap} USD market cap")


if __name__ == "__main__":
    main()
