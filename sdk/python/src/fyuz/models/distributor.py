"""Distributor models — the on-chain leaderboard fee distribution.

Two invariants matter more here than anywhere else in the SDK:

* **Every ``*_wei`` field is a ``str``**, an exact uint256 decimal with no
  fractional part. ``total_paid_wei`` and ``amount_wei`` routinely exceed the
  range a ``float`` represents exactly, so they are never widened to a number.
  ``vrf_random`` is likewise a decimal string, not hex and not a number.
* **``None`` is not ``0``.** A null ``pot_bnb``, ``total_points``,
  ``claimable_wei`` or round wei field means *unknown* — the RPC was
  unreachable, or the settlement has not been indexed yet. Rendering it as
  ``0`` is a correctness bug, so those fields are ``Optional``.

Use :func:`fyuz.to_decimal` or :func:`fyuz.wei_to_bnb` when you need arithmetic
on a wei string; both go through :class:`decimal.Decimal` and stay exact.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple

from .._convert import (
    as_mapping,
    opt_float,
    opt_int,
    opt_str,
    req_float,
    req_int,
    req_str,
    tuple_of,
)

__all__ = [
    "PayoutStats",
    "Pot",
    "ShareEntry",
    "Shares",
    "RoundReceipt",
    "PayoutLine",
    "RoundDetail",
    "AddressPayouts",
    "Claimable",
]


@dataclass(frozen=True)
class PayoutStats:
    """Response of ``GET /distributor/stats`` — lifetime payback totals.

    Attributes:
        total_paid_wei: Everything ever paid out (pro-rata plus lottery), exact
            wei as a decimal string. ``"0"`` when nothing has settled.
        rounds_settled: Number of settled rounds.
        unique_recipients: Distinct addresses ever paid.
        largest_payout_wei: Biggest single payout, exact wei decimal string.
            ``"0"`` when nothing has settled.
        last_round_at: Settlement time of the last round, UNIX seconds.
            ``None`` when nothing has settled.
    """

    total_paid_wei: str = "0"
    rounds_settled: int = 0
    unique_recipients: int = 0
    largest_payout_wei: str = "0"
    last_round_at: Optional[int] = None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> PayoutStats:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            total_paid_wei=req_str(d, "totalPaidWei", "0"),
            rounds_settled=req_int(d, "roundsSettled"),
            unique_recipients=req_int(d, "uniqueRecipients"),
            largest_payout_wei=req_str(d, "largestPayoutWei", "0"),
            last_round_at=opt_int(d, "lastRoundAt"),
        )


@dataclass(frozen=True)
class Pot:
    """Response of ``GET /distributor/pot`` — the live undistributed pot.

    Attributes:
        pot_bnb: Live BNB balance of the Distributor. ``None`` when no
            Distributor is configured or the RPC is unreachable — hide the
            figure, do **not** render ``0``.
        distribute_bps: Basis points paid pro-rata by points; the remainder
            goes to the VRF winner.
        round_end: Next round close, UNIX seconds, read from the contract's own
            schedule.
        total_points: Points across the whole payout set — the denominator of
            every share. ``None`` when it could not be computed.
        points_per_usd: Points credited per $1 of volume. Buys and sells score
            alike.
    """

    pot_bnb: Optional[float] = None
    distribute_bps: float = 0.0
    round_end: int = 0
    total_points: Optional[float] = None
    points_per_usd: float = 0.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Pot:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            pot_bnb=opt_float(d, "potBnb"),
            distribute_bps=req_float(d, "distributeBps"),
            round_end=req_int(d, "roundEnd"),
            total_points=opt_float(d, "totalPoints"),
            points_per_usd=req_float(d, "pointsPerUsd"),
        )


@dataclass(frozen=True)
class ShareEntry:
    """One holder's committed share of the next round.

    Attributes:
        address: Holder wallet.
        points: Points accrued in the window.
        share: The holder's fraction of ``2**32`` — the on-chain share unit,
            ``0``-``4294967295``.
    """

    address: str = ""
    points: float = 0.0
    share: int = 0

    @property
    def share_fraction(self) -> float:
        """``share`` as a 0-1 fraction of the pro-rata pot."""
        return self.share / 4294967296.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ShareEntry:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            address=req_str(d, "address"),
            points=req_float(d, "points"),
            share=req_int(d, "share"),
        )


@dataclass(frozen=True)
class Shares:
    """Response of ``GET /distributor/shares``.

    Attributes:
        from_ts: Window start, UNIX seconds (``from`` on the wire — renamed
            because ``from`` is a Python keyword).
        to_ts: Window end, UNIX seconds (``to`` on the wire).
        total_points: Points across the returned holder set.
        holders: Highest points first, capped at 100 (the contract's
            ``MAX_HOLDERS``).
        packed: Calldata for ``Distributor.postShares``: 24-byte entries of a
            20-byte address followed by the big-endian ``uint32`` share,
            ``0x``-prefixed hex.
    """

    from_ts: int = 0
    to_ts: int = 0
    total_points: float = 0.0
    holders: Tuple[ShareEntry, ...] = ()
    packed: str = "0x"

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Shares:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            from_ts=req_int(d, "from"),
            to_ts=req_int(d, "to"),
            total_points=req_float(d, "totalPoints"),
            holders=tuple_of(d, "holders", ShareEntry.from_dict),
            packed=req_str(d, "packed", "0x"),
        )


@dataclass(frozen=True)
class PayoutLine:
    """One recipient's line in a round.

    Attributes:
        round_id: Round this payout belongs to.
        address: Recipient wallet.
        share: The recipient's fraction of ``2**32``, exactly as committed
            on-chain.
        amount_wei: Exact wei paid, decimal string.
        username: Display name, or ``None``.
        avatar: Avatar URL, or ``None``.
    """

    round_id: int = 0
    address: str = ""
    share: int = 0
    amount_wei: str = "0"
    username: Optional[str] = None
    avatar: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> PayoutLine:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            round_id=req_int(d, "roundId"),
            address=req_str(d, "address"),
            share=req_int(d, "share"),
            amount_wei=req_str(d, "amountWei", "0"),
            username=opt_str(d, "username"),
            avatar=opt_str(d, "avatar"),
        )


@dataclass(frozen=True)
class RoundReceipt:
    """A settled distribution round, from ``GET /distributor/rounds``.

    Null wei fields mean the on-chain settlement has not been indexed yet — not
    zero.

    Attributes:
        round_id: On-chain round id.
        time_start: Window start, UNIX seconds.
        time_end: Window end, UNIX seconds; becomes the start of the next
            leaderboard window.
        tx_hash: Settlement transaction hash, or ``None``.
        pot_wei: Whole amount that left the contract (pro-rata plus lottery),
            exact wei decimal string, or ``None`` when not yet indexed.
        distributed_wei: Pro-rata portion only, exact wei decimal string, or
            ``None``.
        winner_address: VRF-picked lottery winner, or ``None``.
        winner_amount_wei: Lottery amount, exact wei decimal string, or ``None``.
        holder_count: Number of paid holders, or ``None``.
        vrf_random: The VRF word that selected the winner, as a **decimal**
            string (not hex, not a number). Published so the draw can be
            checked against the coordinator's own fulfilment.
        distributed_at: Settlement time, UNIX seconds, or ``None``.
    """

    round_id: int = 0
    time_start: int = 0
    time_end: int = 0
    tx_hash: Optional[str] = None
    pot_wei: Optional[str] = None
    distributed_wei: Optional[str] = None
    winner_address: Optional[str] = None
    winner_amount_wei: Optional[str] = None
    holder_count: Optional[int] = None
    vrf_random: Optional[str] = None
    distributed_at: Optional[int] = None

    @classmethod
    def _receipt_fields(cls, d: Mapping[str, Any]) -> Mapping[str, Any]:
        """Shared field mapping, reused by the flattened :class:`RoundDetail`."""
        return {
            "round_id": req_int(d, "roundId"),
            "time_start": req_int(d, "timeStart"),
            "time_end": req_int(d, "timeEnd"),
            "tx_hash": opt_str(d, "txHash"),
            "pot_wei": opt_str(d, "potWei"),
            "distributed_wei": opt_str(d, "distributedWei"),
            "winner_address": opt_str(d, "winnerAddress"),
            "winner_amount_wei": opt_str(d, "winnerAmountWei"),
            "holder_count": opt_int(d, "holderCount"),
            "vrf_random": opt_str(d, "vrfRandom"),
            "distributed_at": opt_int(d, "distributedAt"),
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> RoundReceipt:
        """Build from a decoded JSON object, ignoring unknown fields."""
        return cls(**cls._receipt_fields(as_mapping(data)))


@dataclass(frozen=True)
class RoundDetail(RoundReceipt):
    """Response of ``GET /distributor/rounds/{id}``.

    The receipt fields are **flattened** into the top level of the JSON object
    alongside ``payouts`` — there is no nested ``round`` key on the wire, which
    is why this subclasses :class:`RoundReceipt` rather than wrapping it.

    Attributes:
        payouts: Recipients of this round, richest first.
    """

    payouts: Tuple[PayoutLine, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> RoundDetail:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            payouts=tuple_of(d, "payouts", PayoutLine.from_dict),
            **cls._receipt_fields(d),
        )


@dataclass(frozen=True)
class AddressPayouts:
    """Response of ``GET /distributor/payouts/{address}``.

    Attributes:
        address: Wallet address, lower-cased by the server.
        total_wei: Lifetime wei received across every settled round, summed
            exactly (not in floating point), as a decimal string.
        rounds_paid: Number of rounds this address was paid in.
        payouts: Individual lines, newest round first.
    """

    address: str = ""
    total_wei: str = "0"
    rounds_paid: int = 0
    payouts: Tuple[PayoutLine, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> AddressPayouts:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            address=req_str(d, "address"),
            total_wei=req_str(d, "totalWei", "0"),
            rounds_paid=req_int(d, "roundsPaid"),
            payouts=tuple_of(d, "payouts", PayoutLine.from_dict),
        )


@dataclass(frozen=True)
class Claimable:
    """Response of ``GET /distributor/claimable/{address}``.

    Wei owed to an address from payout pushes the contract could not complete
    (contract wallets, reverting receivers). Withdrawable by calling
    ``claim()`` on the Distributor — the wallet signs, this API only reads.

    Attributes:
        address: Wallet address, lower-cased by the server.
        claimable_wei: Exact wei, decimal string. ``None`` when the RPC is
            unreachable or no Distributor is configured — hide the banner
            rather than telling the user nothing is owed.
        distributor_address: Where to send the ``claim()``. ``None`` when
            unconfigured.
    """

    address: str = ""
    claimable_wei: Optional[str] = None
    distributor_address: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Claimable:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            address=req_str(d, "address"),
            claimable_wei=opt_str(d, "claimableWei"),
            distributor_address=opt_str(d, "distributorAddress"),
        )
