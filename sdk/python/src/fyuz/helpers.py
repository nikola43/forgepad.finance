"""Opt-in conversion helpers for the SDK's string and timestamp fields.

The wire models never convert anything for you: decimal strings stay strings
and UNIX timestamps stay integers. These helpers exist for when you *do* want a
richer type, and every one of them is exact — :class:`~decimal.Decimal`
arithmetic, never ``float``.

Example::

    from fyuz import FyuzClient, to_decimal, wei_to_bnb

    with FyuzClient() as fyuz:
        king = fyuz.get_king()
        if king is not None:
            mcap = to_decimal(king.marketcap)      # Decimal, exact

        stats = fyuz.distributor.get_stats()
        paid = wei_to_bnb(stats.total_paid_wei)    # Decimal BNB, exact
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
from typing import Optional

__all__ = ["to_decimal", "wei_to_bnb", "parse_datetime", "from_unix"]

_WEI_PER_BNB_EXPONENT = 18

_RFC3339 = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})"
    r"[Tt ](?P<time>\d{2}:\d{2}:\d{2})"
    r"(?P<frac>\.\d+)?"
    r"(?P<tz>[Zz]|[+-]\d{2}:?\d{2})?$"
)


def to_decimal(value: Optional[str]) -> Optional[Decimal]:
    """Parse a decimal string field into an exact :class:`~decimal.Decimal`.

    Args:
        value: A decimal string such as ``Token.marketcap`` or
            ``PayoutLine.amount_wei``. ``None`` passes through.

    Returns:
        The exact value, or ``None`` when ``value`` was ``None``.

    Raises:
        ValueError: if the string is not a finite decimal number. ``Decimal``
            itself accepts ``"NaN"``, ``"Infinity"`` and PEP-515 underscores
            (``"1_0"`` -> ``10``); none of those is ever a valid amount here,
            and a ``Decimal("NaN")`` would go on to answer *every* later
            comparison with ``False`` instead of failing loudly.
    """
    if value is None:
        return None
    try:
        text = value.strip()
    except AttributeError as exc:
        raise ValueError(f"not a decimal string: {value!r}") from exc
    if "_" in text:
        raise ValueError(f"not a decimal string: {value!r}")
    try:
        parsed = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"not a decimal string: {value!r}") from exc
    if not parsed.is_finite():
        raise ValueError(f"not a finite decimal string: {value!r}")
    return parsed


def wei_to_bnb(value: Optional[str]) -> Optional[Decimal]:
    """Convert a wei decimal string to BNB, without losing a single digit.

    Args:
        value: A ``*_wei`` field, e.g. ``PayoutStats.total_paid_wei``. ``None``
            passes through (``None`` means *unknown*, never zero).

    Returns:
        The amount in BNB as an exact :class:`~decimal.Decimal`, or ``None``.

    Raises:
        ValueError: if the string is not a finite decimal number.
    """
    amount = to_decimal(value)
    if amount is None:
        return None
    digits = len(amount.as_tuple().digits)
    with localcontext() as ctx:
        # Enough precision that the shift can never round.
        ctx.prec = max(digits + _WEI_PER_BNB_EXPONENT + 1, 28)
        return amount.scaleb(-_WEI_PER_BNB_EXPONENT)


def parse_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse an RFC-3339 timestamp field into a :class:`~datetime.datetime`.

    Used for the string timestamps — ``Token.created_at``, ``updated_at``,
    ``launched_at``, ``creation_time`` and ``ChatMessage.date``. Every other
    timestamp in this API is an ``int`` of UNIX seconds; use :func:`from_unix`
    for those.

    Values without a zone offset are assumed UTC, which is what the backend
    serialises.

    Args:
        value: An RFC-3339 string. ``None`` passes through.

    Returns:
        A timezone-aware datetime, or ``None``.

    Raises:
        ValueError: if the string is not an RFC-3339 timestamp.
    """
    if value is None:
        return None
    match = _RFC3339.match(value.strip())
    if match is None:
        raise ValueError(f"not an RFC-3339 timestamp: {value!r}")

    frac = match.group("frac") or ""
    if frac:
        # datetime.fromisoformat only accepts 3 or 6 fractional digits on 3.9.
        frac = "." + (frac[1:] + "000000")[:6]
    tz = match.group("tz") or ""
    if tz in ("Z", "z"):
        tz = "+00:00"
    elif tz and ":" not in tz:
        tz = f"{tz[:3]}:{tz[3:]}"

    parsed = datetime.fromisoformat(f"{match.group('date')}T{match.group('time')}{frac}{tz}")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def from_unix(seconds: Optional[int]) -> Optional[datetime]:
    """Convert a UNIX-seconds field into a timezone-aware UTC datetime.

    Args:
        seconds: A UNIX-seconds field such as ``Trade.date``,
            ``KingReign.started_at`` or ``RoundReceipt.time_end``. ``None``
            passes through — for nullable fields ``None`` means *unknown*.

    Returns:
        A timezone-aware UTC datetime, or ``None``.
    """
    if seconds is None:
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc)
