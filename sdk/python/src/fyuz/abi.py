"""The smallest ABI codec that covers this contract, and nothing more.

Every argument the Fyuz swap entrypoints take is a static 32-byte word —
``address``, ``uint256``, ``bool`` — and so is every value they return. That
makes encoding a selector followed by left-padded words, and decoding a walk
over fixed offsets. No dynamic types, no head/tail split, no ABI library.

Selectors are **pinned constants**, not computed. Deriving one needs keccak-256,
which the standard library does not provide: ``hashlib.sha3_256`` is the FIPS
variant and produces a different digest from Ethereum's Keccak-256. The values
below came from ``cast sig`` and are asserted against
``shared/test-vectors/trade-calldata.json``, so a typo fails the test suite
rather than sending a transaction to the wrong function.
"""

from __future__ import annotations

import re
from typing import Union

__all__ = [
    "SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS",
    "SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS",
    "SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH",
    "SELECTOR_GET_SWAP_OUTPUT",
    "SELECTOR_GET_FIRST_BUY_FEE",
    "SELECTOR_GET_MAX_SELLABLE_ETH",
    "SELECTOR_TOKEN_POOLS",
    "SELECTOR_APPROVE",
    "SELECTOR_ALLOWANCE",
    "SELECTOR_BALANCE_OF",
    "UINT256_MAX",
    "normalize_address",
    "parse_amount",
    "parse_units",
    "format_units",
    "uint256_word",
    "address_word",
    "bool_word",
    "encode_call",
    "decode_uint256_at",
    "decode_bool_at",
    "decode_address_at",
]

#: ``swapExactETHForTokens(address,uint256,uint256,uint256)``
SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS = "0x6bf05b01"
#: ``swapETHForExactTokens(address,uint256,uint256,uint256)``
SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS = "0x0541a872"
#: ``swapExactTokensForETH(address,uint256,uint256,uint256)``
SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH = "0xeacad12a"
#: ``getSwapOutput(address,uint256,bool)``
SELECTOR_GET_SWAP_OUTPUT = "0x908235cc"
#: ``getFirstBuyFee(address)``
SELECTOR_GET_FIRST_BUY_FEE = "0xb3cd4902"
#: ``getMaxSellableETH(address)``
SELECTOR_GET_MAX_SELLABLE_ETH = "0x82bfb367"
#: ``tokenPools(address)``
SELECTOR_TOKEN_POOLS = "0xc3d2c3c1"
#: ``approve(address,uint256)``
SELECTOR_APPROVE = "0x095ea7b3"
#: ``allowance(address,address)``
SELECTOR_ALLOWANCE = "0xdd62ed3e"
#: ``balanceOf(address)``
SELECTOR_BALANCE_OF = "0x70a08231"

#: ``2**256 - 1``, the unlimited-approval amount.
UINT256_MAX = (1 << 256) - 1

_ADDRESS_PATTERN = re.compile(r"^0x[0-9a-fA-F]{40}$")
_DIGITS_PATTERN = re.compile(r"^\d+$")
_DECIMAL_PATTERN = re.compile(r"^\d+(\.\d+)?$")


def normalize_address(name: str, value: str) -> str:
    """Validate an EVM address and return it lower-cased.

    EIP-55 checksums are accepted but not verified: confirming one needs
    keccak-256, and the encoded word is identical either way. What is checked is
    the part that can actually corrupt a transaction — that the value is 20 hex
    bytes and not, say, a token symbol or a truncated paste.

    Raises:
        ValueError: The value is not a 0x-prefixed 20-byte address.
    """
    if not isinstance(value, str) or not _ADDRESS_PATTERN.match(value):
        raise ValueError(f"{name} must be a 0x-prefixed 20-byte address, got {value!r}")
    return value.lower()


def parse_amount(name: str, value: Union[str, int]) -> int:
    """Parse a base-10 amount in the smallest unit (wei).

    Deliberately refuses anything with a decimal point. A caller passing
    ``"0.5"`` means BNB, not wei, and silently reading that as 0 would build a
    transaction that buys nothing — see :func:`parse_units` for the conversion.

    Raises:
        ValueError: The value is not a whole non-negative amount below 2**256.
    """
    if isinstance(value, bool):  # bool is an int subclass; never a valid amount.
        raise ValueError(f"{name} must be an integer amount, got a bool")
    if isinstance(value, int):
        parsed = value
    else:
        if not _DIGITS_PATTERN.match(value):
            hint = (
                " — decimal input looks like whole units, convert it with parse_units() first"
                if "." in value
                else ""
            )
            raise ValueError(
                f"{name} must be a whole amount in wei as a base-10 string, got {value!r}{hint}"
            )
        parsed = int(value)

    if parsed < 0:
        raise ValueError(f"{name} must not be negative")
    if parsed > UINT256_MAX:
        raise ValueError(f"{name} exceeds uint256")
    return parsed


def parse_units(value: str, decimals: int = 18) -> int:
    """Convert whole units to the smallest unit — ``"0.5"`` BNB to ``500000000000000000``.

    String in, ``int`` out, with no float anywhere in between: ``float("0.1") *
    1e18`` gives ``100000000000000000`` on a good day and ``99999999999999998``
    on a bad one.

    Raises:
        ValueError: The value is not a decimal string, or carries more decimal
            places than the token has.
    """
    if not isinstance(value, str) or not _DECIMAL_PATTERN.match(value):
        raise ValueError(f"amount must be a non-negative decimal string, got {value!r}")

    if decimals < 0:
        raise ValueError(f"decimals must not be negative, got {decimals}")

    whole, _, fraction = value.partition(".")
    if len(fraction) > decimals:
        raise ValueError(
            f"amount {value!r} has {len(fraction)} decimal places, more than the {decimals} "
            "this token carries — the extra digits would be silently truncated"
        )

    # Annotated because `10**decimals` widens to Any for a non-literal exponent,
    # which would leak out through the return type.
    multiplier: int = 10**decimals
    return int(whole or "0") * multiplier + int(fraction.ljust(decimals, "0") or "0")


def format_units(value: Union[str, int], decimals: int = 18) -> str:
    """Convert the smallest unit back to whole units, exactly.

    Inverse of :func:`parse_units`.
    """
    amount = parse_amount("value", value)
    whole, remainder = divmod(amount, 10**decimals)
    fraction = str(remainder).rjust(decimals, "0").rstrip("0")
    return f"{whole}.{fraction}" if fraction else str(whole)


def uint256_word(value: int) -> str:
    """Encode a ``uint256`` as one 64-character word."""
    return format(value, "064x")


def address_word(address: str) -> str:
    """Encode an ``address`` as one word: 12 zero bytes then the 20 address bytes."""
    return address[2:].lower().rjust(64, "0")


def bool_word(value: bool) -> str:
    """Encode a ``bool`` as one 64-character word."""
    return uint256_word(1 if value else 0)


def encode_call(selector: str, *words: str) -> str:
    """Join a selector and its words into 0x-prefixed calldata."""
    return selector + "".join(words)


def _hex_body(data: str) -> str:
    """Strip ``0x`` and reject anything that is not whole bytes of hex."""
    body = data[2:] if data[:2].lower() == "0x" else data
    if len(body) % 2 != 0:
        raise ValueError(f"expected whole bytes of hex, got {data!r}")
    if body and not re.fullmatch(r"[0-9a-fA-F]+", body):
        raise ValueError(f"expected hex data, got {data!r}")
    return body


def decode_uint256_at(data: str, index: int) -> int:
    """Read the ``index``-th 32-byte word of a return payload as a ``uint256``.

    Raises on a short payload rather than returning ``0``. A truncated response
    and a genuine zero are very different answers to "how many tokens do I get",
    and only one of them should let a transaction get built.
    """
    body = _hex_body(data)
    start = index * 64
    if len(body) < start + 64:
        raise ValueError(f"response has {len(body) // 64} words, expected at least {index + 1}")
    return int(body[start : start + 64], 16)


def decode_bool_at(data: str, index: int) -> bool:
    """Read the ``index``-th word as a ``bool``. Any non-zero word is ``True``."""
    return decode_uint256_at(data, index) != 0


def decode_address_at(data: str, index: int) -> str:
    """Read the ``index``-th word as an ``address``, lower-cased."""
    return "0x" + uint256_word(decode_uint256_at(data, index))[24:]
