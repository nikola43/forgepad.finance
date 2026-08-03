"""A JSON-RPC client just large enough to read the bonding curve.

``eth_call`` against a view function is an HTTP POST with a JSON body. That is
the whole requirement, so this is one small module rather than a dependency on
web3.py.
"""

from __future__ import annotations

import itertools
import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Tuple

from ._version import __version__
from .errors import FyuzConnectionError, FyuzRPCError

__all__ = ["DEFAULT_RPC_TIMEOUT", "CallResult", "RPCClient"]

#: Default per-call timeout for RPC requests, in seconds.
DEFAULT_RPC_TIMEOUT = 15.0

_HEX_RUN = re.compile(r"0x[0-9a-fA-F]{8,}")


@dataclass(frozen=True)
class CallResult:
    """The outcome of an ``eth_call``: return data, or revert data.

    Reverts are extremely common here — quoting a graduated token reverts by
    design — so they are a return value rather than an exception. The caller
    decides what a revert means and builds the error with the right context.
    """

    ok: bool
    data: str = ""
    revert: str = ""


class RPCClient:
    """Minimal JSON-RPC transport."""

    def __init__(
        self,
        url: str,
        *,
        timeout: float = DEFAULT_RPC_TIMEOUT,
        headers: Optional[Mapping[str, str]] = None,
        opener: Optional[urllib.request.OpenerDirector] = None,
    ) -> None:
        self.url = url
        self._timeout = timeout
        self._headers = dict(headers or {})
        self._opener = opener or urllib.request.build_opener()
        self._ids = itertools.count(1)

    def request(self, method: str, params: List[Any]) -> Any:
        """Invoke a JSON-RPC method and return its ``result``.

        Raises:
            FyuzRPCError: The node returned an error object, a non-2xx status, or
                a body that was not a JSON-RPC response.
            FyuzConnectionError: The request never produced a response.
        """
        payload = json.dumps(
            {"jsonrpc": "2.0", "id": next(self._ids), "method": method, "params": params}
        ).encode("utf-8")

        request = urllib.request.Request(
            self.url,
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "User-Agent": f"fyuz-sdk-python/{__version__}",
                **self._headers,
            },
        )

        try:
            with self._opener.open(request, timeout=self._timeout) as response:
                body = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:  # noqa: PERF203 - distinct handling
            text = exc.read().decode("utf-8", errors="replace")
            raise FyuzRPCError(
                f"RPC {method} returned HTTP {exc.code}: {text[:256]}", method=method
            ) from exc
        except (urllib.error.URLError, OSError) as exc:
            raise FyuzConnectionError(f"RPC {method} could not reach {self.url}: {exc}") from exc

        try:
            decoded = json.loads(body)
        except json.JSONDecodeError as exc:
            raise FyuzRPCError(
                f"RPC {method} returned a body that is not JSON: {body[:256]}", method=method
            ) from exc

        if not isinstance(decoded, dict):
            raise FyuzRPCError(f"RPC {method} returned {type(decoded).__name__}", method=method)

        error = decoded.get("error")
        if error is not None:
            message = error.get("message") if isinstance(error, dict) else str(error)
            raise FyuzRPCError(
                f"RPC {method} failed: {message or 'unknown error'}",
                method=method,
                code=error.get("code") if isinstance(error, dict) else None,
                data=error.get("data") if isinstance(error, dict) else None,
            )

        return decoded.get("result")

    def call(
        self,
        to: str,
        data: str,
        *,
        from_address: Optional[str] = None,
        block: str = "latest",
    ) -> CallResult:
        """Run ``eth_call``, separating a revert from a transport failure."""
        message: Dict[str, str] = {"to": to, "data": data}
        if from_address is not None:
            message["from"] = from_address

        try:
            result = self.request("eth_call", [message, block])
        except FyuzRPCError as exc:
            revert, found = _extract_revert_data(exc)
            if found:
                return CallResult(ok=False, revert=revert)
            raise
        return CallResult(ok=True, data=result if isinstance(result, str) else "0x")

    def call_or_raise(self, to: str, data: str, context: str) -> str:
        """Run ``eth_call`` and raise on revert, for calls that should never revert."""
        from .revert import revert_error  # Imported here to avoid a cycle.

        result = self.call(to, data)
        if not result.ok:
            raise revert_error(result.revert, context)
        return result.data


def _extract_revert_data(error: FyuzRPCError) -> Tuple[str, bool]:
    """Dig the revert payload out of a node error.

    Every provider spells this differently: geth puts the hex straight in
    ``error.data``, others nest it as ``error.data["data"]``, and some drop it
    into the message text and nothing else. All three are tried, in decreasing
    order of how much they can be trusted, before falling back to ``"0x"`` —
    which says "it reverted, and this node would not tell us why".
    """
    payload = error.data
    if isinstance(payload, str) and payload.startswith("0x"):
        return payload, True
    if isinstance(payload, Mapping):
        nested = payload.get("data")
        if isinstance(nested, str) and nested.startswith("0x"):
            return nested, True

    match = _HEX_RUN.search(str(error))
    if match is not None:
        return match.group(0), True
    if "revert" in str(error).lower():
        return "0x", True
    return "", False
