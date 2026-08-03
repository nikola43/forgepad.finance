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

from typing import Optional

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
