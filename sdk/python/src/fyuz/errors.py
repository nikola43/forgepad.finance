"""Typed exceptions raised by the Fyuz SDK.

Every failure the SDK can produce derives from :class:`FyuzError`, so a caller
that wants a single catch-all can write::

    from fyuz import FyuzError

    try:
        token = client.get_king()
    except FyuzError as exc:
        log.warning("fyuz call failed: %s", exc)

Callers that care about rate limiting specifically should catch
:class:`FyuzRateLimitError` *before* :class:`FyuzAPIError`, since it is a
subclass of it.
"""

from __future__ import annotations

from typing import Any, Optional

__all__ = [
    "FyuzError",
    "FyuzAPIError",
    "FyuzRateLimitError",
    "FyuzNotFoundError",
    "FyuzConnectionError",
    "FyuzDecodeError",
]


class FyuzError(Exception):
    """Base class for every error raised by this SDK."""


class FyuzAPIError(FyuzError):
    """The API answered with a non-2xx status.

    Args:
        status: HTTP status code returned by the server.
        message: Human-readable message. Parsed out of the API's
            ``{"error": "..."}`` envelope when present, otherwise the HTTP
            reason phrase.
        body: The raw (possibly truncated) response body, for debugging.
        retry_after: Seconds requested by the server's ``Retry-After`` header.
            Not a 429-only header: a load balancer draining or a service in
            maintenance sends it with a ``503`` just as often.

    Attributes:
        status: HTTP status code.
        message: Server-supplied message.
        body: Raw response body, or ``None`` when the body was empty.
        retry_after: Seconds from the ``Retry-After`` header, or ``None`` when
            the header was absent or unparseable.
    """

    def __init__(
        self,
        status: int,
        message: str,
        *,
        body: Optional[str] = None,
        retry_after: Optional[float] = None,
    ) -> None:
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.message = message
        self.body = body
        self.retry_after = retry_after


class FyuzRateLimitError(FyuzAPIError):
    """HTTP 429 — the per-IP rate limit (120 requests/minute) was exceeded.

    Raised only once the configured retries have been exhausted; the client
    retries 429s automatically with exponential backoff before giving up.

    Attributes:
        retry_after: Seconds requested by the server's ``Retry-After`` header,
            or ``None`` when the header was absent or unparseable. Inherited
            from :class:`FyuzAPIError`, which carries it for every status.
    """

    def __init__(
        self,
        status: int = 429,
        message: str = "Too many requests",
        *,
        body: Optional[str] = None,
        retry_after: Optional[float] = None,
    ) -> None:
        super().__init__(status, message, body=body, retry_after=retry_after)


class FyuzNotFoundError(FyuzAPIError):
    """HTTP 404 — the token, round or profile does not exist.

    Never retried: a 404 from this API is a definitive answer.
    """


class FyuzConnectionError(FyuzError):
    """The request never produced an HTTP response.

    Covers DNS failures, refused connections, TLS errors and timeouts. Raised
    after the configured retries have been exhausted.
    """


class FyuzDecodeError(FyuzError):
    """The response was not the JSON shape this SDK expects."""


class FyuzRPCError(FyuzError):
    """A JSON-RPC node returned an error, or something that was not a JSON-RPC response.

    Attributes:
        method: The method that failed, e.g. ``"eth_call"``.
        code: JSON-RPC error code, when the node sent a well-formed error object.
        data: The node's ``error.data``, untouched. For a reverted ``eth_call``
            this is where the revert payload lives — on the providers that put it
            there, hence keeping the raw value rather than a parsed one.
    """

    def __init__(
        self,
        message: str,
        *,
        method: str,
        code: Optional[int] = None,
        data: Any = None,
    ) -> None:
        super().__init__(message)
        self.method = method
        self.code = code
        self.data = data


class FyuzContractRevertError(FyuzError):
    """The contract rejected the call.

    Raised from a simulated ``eth_call``, so it costs nothing — this is the
    failure you want, rather than paying gas to discover the same thing on-chain.

    Attributes:
        kind: Classification from the shared revert table, e.g. ``"slippage"``.
        error_name: Solidity signature, e.g. ``"SlippageExceeded()"``, or ``None``
            when the selector was not recognised.
        selector: The 4-byte selector, when the revert carried one.
        data: Raw revert data, kept so an unrecognised revert is still diagnosable.
        retryable: Whether re-quoting and retrying could plausibly succeed.
    """

    def __init__(
        self,
        message: str,
        *,
        kind: str,
        data: str,
        error_name: Optional[str] = None,
        selector: Optional[str] = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.error_name = error_name
        self.selector = selector
        self.data = data
        self.retryable = retryable


class FyuzTokenGraduatedError(FyuzContractRevertError):
    """The token left the bonding curve and trades on a DEX pair now.

    Every swap entrypoint reverts with ``AlreadyLaunched()`` for such a token, so
    the SDK refuses to build the transaction rather than let you pay gas to find
    out.

    Attributes:
        token_address: The token that graduated.
        pair_address: Its DEX pair, when the read API knows it.
    """

    def __init__(
        self,
        *,
        token_address: str,
        pair_address: Optional[str] = None,
        data: str = "0xcfa6d878",
    ) -> None:
        subject = token_address or "the token"
        where = (
            "Trade its DEX pair instead."
            if pair_address is None
            else f"Trade the DEX pair {pair_address} instead."
        )
        super().__init__(
            f"{subject} has graduated: the bonding curve is closed and every swap "
            f"reverts. {where}",
            kind="graduated",
            error_name="AlreadyLaunched()",
            selector="0xcfa6d878",
            data=data,
        )
        self.token_address = token_address
        self.pair_address = pair_address
