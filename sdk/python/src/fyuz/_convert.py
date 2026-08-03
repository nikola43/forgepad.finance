"""JSON -> Python conversion helpers shared by the response models.

Two rules drive everything in this module:

1. **Decimal strings stay strings.** Token amounts, wei values and market caps
   arrive as decimal strings precisely because they do not survive a round trip
   through a 64-bit float. Nothing here ever parses one into ``float``.
2. **Unknown and missing fields never crash.** The Fyuz API adds fields over
   time; an SDK that raises on an unrecognised key is worse than useless. Field
   readers are total — they fall back to a documented default instead of
   raising. Only the whole-response shape checks (:func:`expect_object`,
   :func:`expect_array`) raise, because a list where an object was promised is
   a real protocol error rather than a new field.
"""

from __future__ import annotations

from collections.abc import Mapping as _Mapping
from typing import Any, Callable, List, Mapping, Optional, Tuple, TypeVar

from .errors import FyuzDecodeError

T = TypeVar("T")

__all__ = [
    "as_mapping",
    "opt_str",
    "req_str",
    "opt_int",
    "req_int",
    "opt_float",
    "req_float",
    "opt_bool",
    "req_bool",
    "opt_model",
    "tuple_of",
    "expect_object",
    "expect_array",
    "parse_object",
    "parse_array",
]


def as_mapping(value: Any) -> Mapping[str, Any]:
    """Return ``value`` when it is a mapping, otherwise an empty mapping."""
    return value if isinstance(value, _Mapping) else {}


def opt_str(data: Mapping[str, Any], key: str) -> Optional[str]:
    """Read a nullable string field, preserving the exact characters sent."""
    value = data.get(key)
    if isinstance(value, str):
        return value
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        # Defensive only: string fields in this API are never floats on the
        # wire. repr() keeps the shortest round-trippable form.
        return repr(value)
    return None


def req_str(data: Mapping[str, Any], key: str, default: str = "") -> str:
    """Read a non-nullable string field, falling back to ``default``."""
    value = opt_str(data, key)
    return default if value is None else value


def opt_int(data: Mapping[str, Any], key: str) -> Optional[int]:
    """Read a nullable integer field."""
    value = data.get(key)
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value, 10)
        except ValueError:
            try:
                return int(float(value))
            except ValueError:
                return None
    return None


def req_int(data: Mapping[str, Any], key: str, default: int = 0) -> int:
    """Read a non-nullable integer field, falling back to ``default``."""
    value = opt_int(data, key)
    return default if value is None else value


def opt_float(data: Mapping[str, Any], key: str) -> Optional[float]:
    """Read a nullable float field.

    Only ever used for fields the API documents as ``number`` — aggregates such
    as USD volume and points. Never used for decimal strings.
    """
    value = data.get(key)
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def req_float(data: Mapping[str, Any], key: str, default: float = 0.0) -> float:
    """Read a non-nullable float field, falling back to ``default``."""
    value = opt_float(data, key)
    return default if value is None else value


def opt_bool(data: Mapping[str, Any], key: str) -> Optional[bool]:
    """Read a nullable boolean field."""
    value = data.get(key)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered == "true":
            return True
        if lowered == "false":
            return False
    return None


def req_bool(data: Mapping[str, Any], key: str, default: bool = False) -> bool:
    """Read a non-nullable boolean field, falling back to ``default``."""
    value = opt_bool(data, key)
    return default if value is None else value


def opt_model(
    data: Mapping[str, Any],
    key: str,
    factory: Callable[[Mapping[str, Any]], T],
) -> Optional[T]:
    """Read a nested object field, returning ``None`` when absent or null."""
    value = data.get(key)
    if isinstance(value, _Mapping):
        return factory(value)
    return None


def req_model(
    data: Mapping[str, Any],
    key: str,
    factory: Callable[[Mapping[str, Any]], T],
) -> T:
    """Read a nested object field the API always sends.

    A missing, null or non-object value yields the model built from an empty
    mapping — the same "missing key becomes the zero value" rule the scalar
    readers follow, so a non-nullable nested model never forces callers into a
    ``None`` check for a field that is always present.
    """
    value = data.get(key)
    if isinstance(value, _Mapping):
        return factory(value)
    return factory({})


def tuple_of(
    data: Mapping[str, Any],
    key: str,
    factory: Callable[[Mapping[str, Any]], T],
) -> Tuple[T, ...]:
    """Read an array-of-objects field into an immutable tuple.

    A missing, null or non-array value yields an empty tuple; non-object
    elements are skipped.
    """
    value = data.get(key)
    if not isinstance(value, list):
        return ()
    return tuple(factory(item) for item in value if isinstance(item, _Mapping))


def expect_object(payload: Any) -> Mapping[str, Any]:
    """Assert that a decoded response body is a JSON object.

    Raises:
        FyuzDecodeError: if it is anything else.
    """
    if isinstance(payload, _Mapping):
        return payload
    raise FyuzDecodeError(
        f"expected a JSON object in the response body, got {type(payload).__name__}"
    )


def expect_array(payload: Any) -> List[Any]:
    """Assert that a decoded response body is a JSON array.

    Raises:
        FyuzDecodeError: if it is anything else.
    """
    if isinstance(payload, list):
        return payload
    raise FyuzDecodeError(
        f"expected a JSON array in the response body, got {type(payload).__name__}"
    )


def parse_object(payload: Any, factory: Callable[[Mapping[str, Any]], T]) -> T:
    """Decode a whole response body into a single model."""
    return factory(expect_object(payload))


def parse_array(payload: Any, factory: Callable[[Mapping[str, Any]], T]) -> List[T]:
    """Decode a whole response body into a list of models.

    Raises:
        FyuzDecodeError: if the body is not an array, or an element is not an
            object.
    """
    items = expect_array(payload)
    out: List[T] = []
    for index, item in enumerate(items):
        if not isinstance(item, _Mapping):
            raise FyuzDecodeError(
                f"expected a JSON object at index {index} of the response array, "
                f"got {type(item).__name__}"
            )
        out.append(factory(item))
    return out
