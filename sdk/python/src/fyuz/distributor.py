"""The ``client.distributor`` namespace — on-chain leaderboard fee distribution.

Fyuz streams a 0.3% leaderboard fee into a Distributor contract. Every round it
pays 90% of the pot pro-rata by points and hands the remainder to a
Chainlink-VRF-picked winner. These endpoints expose that ledger.

Every ``*_wei`` value returned here is an exact decimal **string**. Do not parse
one into a ``float`` — the values exceed the range a float represents exactly.
:func:`fyuz.to_decimal` and :func:`fyuz.wei_to_bnb` convert losslessly.
"""

from __future__ import annotations

from typing import List, Optional

from ._convert import parse_array, parse_object
from ._http import Transport, encode_path_segment
from .models import (
    AddressPayouts,
    Claimable,
    PayoutStats,
    Pot,
    RoundDetail,
    RoundReceipt,
    Shares,
)

__all__ = ["DistributorAPI"]


class DistributorAPI:
    """Distributor endpoints, reached through :attr:`fyuz.FyuzClient.distributor`.

    Example::

        with FyuzClient() as fyuz:
            pot = fyuz.distributor.get_pot()
            if pot.pot_bnb is None:
                print("pot unknown right now")   # NOT the same as 0
            else:
                print(f"{pot.pot_bnb} BNB up for grabs")
    """

    def __init__(self, transport: Transport) -> None:
        """Bind the namespace to a client's transport. Constructed by the client."""
        self._transport = transport

    def get_stats(self) -> PayoutStats:
        """Lifetime payback totals.

        Returns:
            Totals distributed and round count. ``total_paid_wei`` and
            ``largest_payout_wei`` are exact wei decimal strings.
        """
        payload = self._transport.request("GET", "/distributor/stats")
        return parse_object(payload, PayoutStats.from_dict)

    def get_pot(self) -> Pot:
        """The live undistributed pot and the round parameters.

        Returns:
            Pot size and schedule. ``pot_bnb`` and ``total_points`` are ``None``
            when unknown (RPC unreachable or no Distributor configured) — hide
            the figure rather than showing ``0``.
        """
        payload = self._transport.request("GET", "/distributor/pot")
        return parse_object(payload, Pot.from_dict)

    def get_shares(
        self,
        *,
        from_ts: Optional[int] = None,
        to_ts: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> Shares:
        """The share allocation the round-runner will post on-chain.

        Args:
            from_ts: Window start, UNIX seconds (``from`` on the wire).
                Defaults to the end of the last paid round.
            to_ts: Window end, UNIX seconds (``to`` on the wire). Defaults to
                now. Must be after ``from_ts`` or the server answers 400.
            limit: Max holders, top-N by points. Clamped server-side to 1-100
                (the contract's ``MAX_HOLDERS``). Default 100.

        Returns:
            Per-address shares plus ``packed``, the exact calldata for
            ``Distributor.postShares``.

        Raises:
            FyuzAPIError: 400 when ``to_ts`` is not after ``from_ts``.
        """
        payload = self._transport.request(
            "GET",
            "/distributor/shares",
            params={"from": from_ts, "to": to_ts, "limit": limit},
        )
        return parse_object(payload, Shares.from_dict)

    def list_rounds(
        self, *, limit: Optional[int] = None, offset: Optional[int] = None
    ) -> List[RoundReceipt]:
        """The public payout ledger, newest round first.

        Args:
            limit: Rows to return, clamped server-side to 1-100. Default 25.
            offset: Rows to skip. Default 0.

        Returns:
            Round receipts. Null wei fields mean the settlement has not been
            indexed yet, not that zero was paid.
        """
        payload = self._transport.request(
            "GET", "/distributor/rounds", params={"limit": limit, "offset": offset}
        )
        return parse_array(payload, RoundReceipt.from_dict)

    def get_round(self, round_id: int) -> RoundDetail:
        """One round's full receipt, including every recipient line.

        Args:
            round_id: On-chain round id.

        Returns:
            The receipt fields (flattened at the top level of the JSON) plus
            ``payouts``, richest first.

        Raises:
            FyuzNotFoundError: no such round.
        """
        path = f"/distributor/rounds/{encode_path_segment(round_id)}"
        return parse_object(self._transport.request("GET", path), RoundDetail.from_dict)

    def get_payouts(self, address: str) -> AddressPayouts:
        """Every payout a single wallet has received.

        Args:
            address: Wallet address.

        Returns:
            Lifetime total (exact wei string) and the individual lines, newest
            round first.
        """
        path = f"/distributor/payouts/{encode_path_segment(address)}"
        return parse_object(self._transport.request("GET", path), AddressPayouts.from_dict)

    def get_claimable(self, address: str) -> Claimable:
        """Wei owed to an address from payout pushes the contract could not complete.

        Withdrawn by calling ``claim()`` on the Distributor — the wallet signs,
        this API only reads.

        Args:
            address: Wallet address.

        Returns:
            The pending amount. ``claimable_wei`` is ``None`` when unknown —
            hide the banner rather than saying nothing is owed.
        """
        path = f"/distributor/claimable/{encode_path_segment(address)}"
        return parse_object(self._transport.request("GET", path), Claimable.from_dict)
