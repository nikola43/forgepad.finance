"""Quote and build bonding-curve trades.

    python examples/06_trade.py [token] [wallet]

**This example signs nothing and sends nothing.** It prints the unsigned
transactions, which is the whole surface ``fyuz-sdk`` offers: you hand
``{to, data, value}`` to web3.py, eth-account, a hardware signer or a multisig,
and that library owns the key. Nothing here can move funds.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

from fyuz import (
    FyuzClient,
    FyuzTokenGraduatedError,
    UnsignedTransaction,
    format_units,
    parse_units,
)


def print_transaction(tx: UnsignedTransaction) -> None:
    print(f"  chainId        {tx.chain_id}")
    print(f"  to             {tx.to}")
    print(f"  value          {tx.value}")
    print(f"  data           {tx.data[:74]}…")


def main() -> int:
    token = sys.argv[1] if len(sys.argv) > 1 else None
    wallet = sys.argv[2] if len(sys.argv) > 2 else None

    # The endpoint /config publishes belongs to the API operator and is shared by
    # every caller. Point this at your own node for anything real.
    rpc = os.environ.get("BSC_RPC_URL", "https://bsc-dataseed.bnbchain.org")

    with FyuzClient(rpc_url=rpc) as fyuz:
        chain = fyuz.trade.chain("bsc")
        print(f"chain      {chain.name} ({chain.chain_id})")
        print(f"contract   {chain.contract_address}\n")

        if token is None:
            king = fyuz.get_king()
            if king is None:
                print("no king right now — pass a token address explicitly", file=sys.stderr)
                return 1
            token = king.token_address
            print(f"using the king: {king.token_symbol} ({token})\n")

        # -- buying ---------------------------------------------------
        spend = parse_units("0.01")  # 0.01 BNB, in wei

        try:
            quote = fyuz.trade.quote_buy(token, spend)
        except FyuzTokenGraduatedError as exc:
            # The SDK refuses rather than letting you pay gas to learn this on-chain.
            print(f"buy refused: {exc}")
            return 0

        print("buy quote")
        print(f"  spending       {format_units(quote.amount_in_wei)} {chain.currency}")
        print(f"  first-buy fee  {format_units(quote.first_buy_fee_wei)} {chain.currency}")
        print(
            f"  msg.value      {format_units(quote.value_wei)} {chain.currency}"
            "  ← includes the fee"
        )
        print(f"  tokens out     {format_units(quote.amount_out_wei)}")
        print(f"  price impact   {quote.price_impact_bps / 100:.2f}%\n")

        # slippage_bps is required. There is no default, because the right
        # tolerance depends on the trade and a wrong one costs you money.
        built = fyuz.trade.build_buy(
            token,
            spend,
            slippage_bps=100,  # 1%
            deadline_seconds=120,
            from_address=wallet,
        )

        print("buy transaction (unsigned)")
        print_transaction(built.transaction)
        print(f"  minAmountOut   {format_units(built.limit_wei)} tokens")
        deadline = datetime.fromtimestamp(built.deadline, timezone.utc)
        print(f"  deadline       {deadline.isoformat()}\n")

        # -- selling --------------------------------------------------
        sell_amount = parse_units("1000")
        sell_quote = fyuz.trade.quote_sell(token, sell_amount)

        print("sell quote")
        print(f"  selling        {format_units(sell_quote.amount_in_wei)} tokens")
        print(
            f"  {chain.currency} out         "
            f"{format_units(sell_quote.amount_out_wei)}  ← net of fees"
        )
        print(f"  price impact   {sell_quote.price_impact_bps / 100:.2f}%\n")

        # Selling needs an ERC-20 approval first: the contract pulls the tokens
        # with transferFrom, so without one the swap reverts inside the token.
        if wallet is not None:
            allowance = fyuz.trade.allowance(token, wallet)
            print(f"current allowance {format_units(allowance)} tokens")
            if allowance < sell_amount:
                print("\napprove transaction (unsigned) — send this before the sell")
                print_transaction(
                    fyuz.trade.build_approve(token, amount_wei=sell_amount, from_address=wallet)
                )
                print()

        sell = fyuz.trade.build_sell(
            token, sell_amount, slippage_bps=150, from_address=wallet
        )

        print("sell transaction (unsigned)")
        print_transaction(sell.transaction)
        print(f"  minAmountOut   {format_units(sell.limit_wei)} {chain.currency}\n")
        print("Nothing above was signed or broadcast. Hand these to your wallet to execute.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
