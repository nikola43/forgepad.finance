"""Turning revert data into something a caller can act on.

A reverted ``eth_call`` comes back as a bare 4-byte selector — ``0xcfa6d878``
and nothing else. The mapping from that to "the token graduated, trade the DEX
pair" exists nowhere on-chain and is not in the ABI the API serves, so the table
below is it. It mirrors ``shared/test-vectors/trade-errors.json``, which the
test suite asserts against.
"""

from __future__ import annotations

from typing import Dict, NamedTuple, Optional

from .errors import FyuzContractRevertError, FyuzTokenGraduatedError

__all__ = [
    "SELECTOR_ALREADY_LAUNCHED",
    "revert_selector",
    "revert_error",
]

#: ``AlreadyLaunched()`` — the graduated-token revert.
SELECTOR_ALREADY_LAUNCHED = "0xcfa6d878"

_SELECTOR_ERROR_STRING = "0x08c379a0"  # Error(string)
_SELECTOR_PANIC = "0x4e487b71"  # Panic(uint256)


class _Entry(NamedTuple):
    error_name: str
    kind: str
    message: str
    retryable: bool


_REVERTS: Dict[str, _Entry] = {
    SELECTOR_ALREADY_LAUNCHED: _Entry(
        "AlreadyLaunched()",
        "graduated",
        "The token graduated: the bonding curve is closed and every swap entrypoint "
        "reverts. Trade the DEX pair instead.",
        False,
    ),
    "0x9c8787c0": _Entry(
        "PoolDoesNotExist()",
        "no_pool",
        "No bonding curve exists for this token on this chain — check the address "
        "and the network.",
        False,
    ),
    "0x8199f5f3": _Entry(
        "SlippageExceeded()",
        "slippage",
        "The price moved past minAmountOut before the transaction landed. Re-quote "
        "and retry, or widen the slippage tolerance.",
        True,
    ),
    "0x2b32713d": _Entry(
        "SwapExpired()",
        "expired",
        "The deadline passed before the transaction was mined. Rebuild with a later deadline.",
        True,
    ),
    "0xe96d2afe": _Entry(
        "MaxPriceImpactExceeded()",
        "price_impact",
        "The trade would move the curve further than the contract allows. Split it "
        "into smaller trades.",
        False,
    ),
    "0x9bca8aec": _Entry(
        "SellAmountTooLarge()",
        "sell_too_large",
        "The sell exceeds MAX_SELL_PERCENT of the virtual token reserve. Sell less, "
        "or in several transactions.",
        False,
    ),
    "0x1985c735": _Entry(
        "InsufficientEthValue()",
        "insufficient_value",
        "msg.value was below buyAmount + getFirstBuyFee(token). The fee is not "
        "optional and is not deducted from buyAmount.",
        False,
    ),
    "0xe4455cae": _Entry(
        "InsufficientTokenBalance()",
        "insufficient_balance",
        "The wallet does not hold enough of the token to cover this sell.",
        False,
    ),
    "0xf8b3bb61": _Entry(
        "InsufficientInput()",
        "insufficient_input",
        "The input amount rounds down to zero output on the curve. Trade a larger amount.",
        False,
    ),
    "0xbb55fd27": _Entry(
        "InsufficientLiquidity()",
        "insufficient_liquidity",
        "The curve does not hold enough of the other side to fill this trade.",
        False,
    ),
    "0x1f2a2005": _Entry(
        "ZeroAmount()",
        "zero_amount",
        "The amount must be greater than zero.",
        False,
    ),
    "0x1087e109": _Entry(
        "StalePriceFeed()",
        "stale_feed",
        "The BNB/USD feed is stale or unavailable, so the contract cannot price this call.",
        True,
    ),
    "0xd93c0665": _Entry(
        "EnforcedPause()",
        "paused",
        "Trading is paused on the contract.",
        True,
    ),
}


def revert_selector(data: Optional[str]) -> Optional[str]:
    """The first four bytes of some revert data, lower-cased, or ``None``."""
    if not isinstance(data, str):
        return None
    body = data[2:] if data[:2].lower() == "0x" else data
    if len(body) < 8:
        return None
    return "0x" + body[:8].lower()


def _decode_revert_string(data: str) -> Optional[str]:
    """The reason out of an ``Error(string)`` payload, when that is what this is."""
    body = data[2:] if data[:2].lower() == "0x" else data
    # selector + offset word + length word, then the bytes themselves.
    if len(body) < 8 + 128:
        return None
    try:
        length = int(body[72:136], 16)
        raw = bytes.fromhex(body[136 : 136 + length * 2])
    except ValueError:
        return None
    if len(raw) < length:
        return None
    return raw.decode("utf-8", errors="replace")


def revert_error(data: Optional[str], context: str) -> FyuzContractRevertError:
    """Classify revert data into a typed error.

    An unrecognised selector is reported verbatim rather than swallowed — a later
    contract version will add errors this table does not know about, and having
    ``0xdeadbeef`` in the message is at least something to search for.
    """
    raw = data if isinstance(data, str) else "0x"
    selector = revert_selector(raw)

    if selector is None:
        return FyuzContractRevertError(
            f"{context} reverted, and the node returned no revert data. Some providers "
            "strip it; retry against a node that preserves it to learn why.",
            kind="unknown",
            data=raw,
        )

    if selector == _SELECTOR_ERROR_STRING:
        reason = _decode_revert_string(raw) or "Error(string) with an undecodable reason"
        return FyuzContractRevertError(
            f"{context} reverted: {reason}",
            kind="revert_string",
            error_name="Error(string)",
            selector=selector,
            data=raw,
        )

    if selector == _SELECTOR_PANIC:
        return FyuzContractRevertError(
            f"{context} hit a Solidity panic — that is a contract bug, not a bad argument.",
            kind="unknown",
            error_name="Panic(uint256)",
            selector=selector,
            data=raw,
        )

    entry = _REVERTS.get(selector)
    if entry is None:
        return FyuzContractRevertError(
            f"{context} reverted with the unrecognised selector {selector}. This SDK "
            "version does not know that error; check the contract for a newer one.",
            kind="unknown",
            selector=selector,
            data=raw,
        )

    if entry.kind == "graduated":
        return FyuzTokenGraduatedError(token_address="", data=raw)

    return FyuzContractRevertError(
        f"{context} reverted: {entry.message}",
        kind=entry.kind,
        error_name=entry.error_name,
        selector=selector,
        data=raw,
        retryable=entry.retryable,
    )
