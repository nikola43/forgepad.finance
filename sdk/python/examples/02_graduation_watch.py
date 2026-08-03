"""Graduation watch — which tokens are closest to leaving the bonding curve.

    python examples/02_graduation_watch.py

A Fyuz token trades on an internal bonding curve until it reaches a $30,000
market cap, then graduates into a PancakeSwap V2 pair. Until that happens there
is no DEX pool anywhere: ``pair_address`` is None and no aggregator has a price.
This API is the only source, which is what makes the pre-graduation window worth
watching.
"""

from __future__ import annotations

from fyuz import FyuzClient

#: Market cap at which a token graduates, in USD.
GRADUATION_TARGET_USD = 30_000


def bar(percent: float, width: int = 24) -> str:
    """A fixed-width progress bar."""
    filled = max(0, min(width, round(percent / 100 * width)))
    return f"[{'█' * filled}{'·' * (width - filled)}]"


def main() -> None:
    with FyuzClient() as fyuz:
        candidates = fyuz.discover(tab="graduating", status="bonding", min_holders=10, limit=25)

        if not candidates:
            print("nothing close to graduation right now")
            return

        # graduation_pct is what the server computed; recomputing it from market
        # cap here would only introduce a second, disagreeing number.
        ranked = sorted(candidates, key=lambda t: t.graduation_pct, reverse=True)

        print(f"{len(ranked)} tokens on the curve, closest first\n")
        for token in ranked:
            remaining = max(0.0, GRADUATION_TARGET_USD - token.marketcap)
            print(
                f"{token.symbol[:10]:<10} "
                f"{bar(token.graduation_pct)} "
                f"{token.graduation_pct:>6.1f}% "
                f"{f'${remaining:,.0f} to go':>18} "
                f"{f'{token.holders} holders':>14}"
            )

        leader = ranked[0]
        print(f"\nwatching the top candidate: {leader.symbol}")

        detail = fyuz.get_token(leader.network, leader.token_address, page_size=1)
        token = detail.token_details

        # These are decimal strings and stay strings. curve_holding is None when
        # the on-chain read failed — that means *unknown*, and printing 0 would
        # tell the reader something false.
        print(f"  market cap     {token.marketcap} USD (exact)")
        print(f"  price          {token.price} USD (exact)")
        print(f"  curve holding  {detail.curve_holding or 'unknown — on-chain read failed'}")
        print(
            "  pair address   "
            + (token.pair_address or "none — still on the curve, no DEX pool exists")
        )


if __name__ == "__main__":
    main()
