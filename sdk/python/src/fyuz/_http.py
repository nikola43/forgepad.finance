"""Stdlib-only HTTP transport with retry, backoff and typed errors.

This is deliberately built on :mod:`urllib.request` so that installing the SDK
pulls in nothing at all. It is internal API: everything a caller needs is
exposed through :class:`fyuz.FyuzClient`.

Retry policy
------------

* ``429`` and ``5xx`` are retried with exponential backoff and **full jitter**
  (``sleep = uniform(0, min(cap, initial * 2**attempt))``).
* A ``Retry-After`` header, when present and parseable, raises the computed
  backoff — it can lengthen the wait but never shorten it, so ``Retry-After: 0``
  cannot turn the retry budget into a hot loop. It is capped at
  :data:`MAX_RETRY_AFTER` so a hostile header cannot pin a thread for hours.
* Transport failures — DNS, refused connections, resets, timeouts — are retried
  on the same schedule. They are indistinguishable from a 5xx as far as the
  caller is concerned.
* No other 4xx is *ever* retried.
"""

from __future__ import annotations

import http.client
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Dict, Mapping, Optional

from ._version import __version__
from .errors import (
    FyuzAPIError,
    FyuzConnectionError,
    FyuzDecodeError,
    FyuzError,
    FyuzNotFoundError,
    FyuzRateLimitError,
)

DEFAULT_BASE_URL = "https://api.fyuz.fun"
"""Production base URL for the Fyuz public API."""

DEFAULT_TIMEOUT = 30.0
"""Default per-request timeout, in seconds."""

DEFAULT_MAX_RETRIES = 3
"""Default number of retries after the first attempt. ``0`` disables retrying."""

DEFAULT_BACKOFF_INITIAL = 0.25
"""Base of the exponential backoff, in seconds.

Matches the TypeScript, Go and Rust SDKs, so the four behave identically against
the same rate limiter.
"""

DEFAULT_BACKOFF_MAX = 8.0
"""Ceiling for a single computed backoff, in seconds.

Matches the TypeScript, Go and Rust SDKs.
"""

MAX_RETRY_AFTER = 60.0
"""Ceiling applied to a server-supplied ``Retry-After``, in seconds."""

USER_AGENT = f"fyuz-sdk-python/{__version__}"
"""Value sent in the ``User-Agent`` header."""

_MAX_ERROR_BODY = 2048

_MAX_BACKOFF_SHIFT = 64
"""Ceiling on the exponent, so ``2.0 ** attempt`` can never overflow."""


def encode_path_segment(value: Any) -> str:
    """Percent-encode a value for use as a single path segment."""
    return urllib.parse.quote(str(value), safe="")


def encode_query(params: Mapping[str, Any]) -> str:
    """Encode query parameters, dropping ``None`` and lower-casing booleans.

    Booleans become ``true``/``false`` (what the backend's deserializer
    expects), not Python's ``True``/``False``.
    """
    pairs = []
    for key, value in params.items():
        if value is None:
            continue
        if isinstance(value, bool):
            pairs.append((key, "true" if value else "false"))
        else:
            pairs.append((key, str(value)))
    return urllib.parse.urlencode(pairs, quote_via=urllib.parse.quote)


def parse_retry_after(value: Optional[str]) -> Optional[float]:
    """Parse a ``Retry-After`` header into seconds.

    Handles both forms allowed by RFC 7231: a delta in seconds and an
    HTTP-date. Returns ``None`` when the header is absent or unparseable, and
    never returns a negative delay.
    """
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return max(0.0, float(text))
    except ValueError:
        pass
    try:
        when = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())


class Transport:
    """Performs HTTP requests against the Fyuz API and decodes JSON bodies.

    Internal; see :class:`fyuz.FyuzClient` for the public surface.
    """

    def __init__(
        self,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_initial: float = DEFAULT_BACKOFF_INITIAL,
        backoff_max: float = DEFAULT_BACKOFF_MAX,
        user_agent: Optional[str] = None,
        opener: Optional[urllib.request.OpenerDirector] = None,
    ) -> None:
        normalized = str(base_url).rstrip("/")
        parts = urllib.parse.urlsplit(normalized)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValueError(f"base_url must be an absolute http(s) URL, got {base_url!r}")
        if timeout <= 0:
            raise ValueError(f"timeout must be positive, got {timeout!r}")
        if max_retries < 0:
            raise ValueError(f"max_retries must be >= 0, got {max_retries!r}")
        if backoff_initial < 0 or backoff_max < 0:
            raise ValueError("backoff values must be >= 0")

        self.base_url = normalized
        self.timeout = float(timeout)
        self.max_retries = int(max_retries)
        self.backoff_initial = float(backoff_initial)
        self.backoff_max = float(backoff_max)
        self.user_agent = user_agent or USER_AGENT
        self._opener = opener if opener is not None else urllib.request.build_opener()
        self._closed = False
        # Swappable seams, so tests never actually sleep and backoff is
        # deterministic when it needs to be.
        self._sleep: Callable[[float], None] = time.sleep
        self._random: Callable[[], float] = random.random

    def close(self) -> None:
        """Release the underlying opener. Further requests raise."""
        self._closed = True

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Mapping[str, Any]] = None,
        json_body: Optional[Mapping[str, Any]] = None,
    ) -> Any:
        """Send one request, retrying per the policy, and return decoded JSON.

        Args:
            method: HTTP method, e.g. ``"GET"``.
            path: Path beginning with ``/``; path segments must already be
                percent-encoded.
            params: Query parameters. ``None`` values are dropped.
            json_body: Object to send as a JSON request body.

        Returns:
            The decoded JSON value, or ``None`` for an empty body.

        Raises:
            FyuzRateLimitError: 429 after retries are exhausted.
            FyuzNotFoundError: 404.
            FyuzAPIError: any other non-2xx status.
            FyuzConnectionError: transport failure after retries are exhausted.
            FyuzDecodeError: the body was not valid JSON.
            FyuzError: the client has been closed.
        """
        if self._closed:
            raise FyuzError("client is closed")

        url = self.base_url + path
        query = encode_query(params or {})
        if query:
            url = f"{url}?{query}"

        headers: Dict[str, str] = {
            "Accept": "application/json",
            "User-Agent": self.user_agent,
        }
        data: Optional[bytes] = None
        if json_body is not None:
            data = json.dumps(json_body, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"

        attempt = 0
        while True:
            request = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with self._opener.open(request, timeout=self.timeout) as response:
                    return self._decode(response.read())
            except urllib.error.HTTPError as exc:
                error = self._api_error(exc)
                retryable = error.status == 429 or 500 <= error.status <= 599
                if not retryable or attempt >= self.max_retries:
                    raise error from None
                delay = self._delay(attempt, error.retry_after)
            except (OSError, http.client.HTTPException) as exc:
                # urllib.error.URLError, socket.timeout and ConnectionError are
                # all OSError subclasses; BadStatusLine and friends are not.
                if attempt >= self.max_retries:
                    raise FyuzConnectionError(f"{method} {url} failed: {exc}") from exc
                delay = self._delay(attempt, None)

            self._sleep(delay)
            attempt += 1

    def _delay(self, attempt: int, retry_after: Optional[float]) -> float:
        """Compute the wait before the next attempt (full jitter).

        A ``Retry-After`` header can only *lengthen* the wait. Taking it
        verbatim would let ``Retry-After: 0`` — which a proxy in front of a rate
        limiter will happily emit — spend the whole retry budget in a hot loop
        with no sleep at all.
        """
        # 2.0 ** attempt raises OverflowError past 1023, and OverflowError is
        # not a FyuzError. The shift is clamped instead: by then the doubling
        # has been pinned to `backoff_max` for a few thousand years anyway.
        cap = min(self.backoff_max, self.backoff_initial * 2.0 ** min(attempt, _MAX_BACKOFF_SHIFT))
        backoff = self._random() * cap
        if retry_after is not None:
            return min(max(retry_after, backoff), MAX_RETRY_AFTER)
        return backoff

    @staticmethod
    def _decode(raw: bytes) -> Any:
        """Decode a successful response body."""
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise FyuzDecodeError(f"response body was not valid JSON: {exc}") from exc

    @staticmethod
    def _api_error(exc: urllib.error.HTTPError) -> FyuzAPIError:
        """Turn an :class:`urllib.error.HTTPError` into a typed SDK error.

        Parses the API's ``{"error": "..."}`` envelope; falls back to the HTTP
        reason phrase when the body is empty or not JSON.
        """
        status = int(exc.code)
        try:
            raw = exc.read(_MAX_ERROR_BODY)
        except Exception:  # pragma: no cover - body already consumed/closed
            raw = b""
        body = raw.decode("utf-8", errors="replace") if raw else None

        message = ""
        if body:
            try:
                parsed = json.loads(body)
            except ValueError:
                parsed = None
            if isinstance(parsed, dict):
                candidate = parsed.get("error") or parsed.get("message")
                if isinstance(candidate, str):
                    message = candidate
            if not message:
                message = body.strip()[:200]
        if not message:
            message = exc.reason if isinstance(exc.reason, str) else str(exc.reason)
        if not message:
            message = "request failed"

        # Retry-After is not a 429-only header: a 503 from a draining load
        # balancer or a service in maintenance carries it just as often.
        retry_after = parse_retry_after(exc.headers.get("Retry-After") if exc.headers else None)

        if status == 429:
            return FyuzRateLimitError(status, message, body=body, retry_after=retry_after)
        if status == 404:
            return FyuzNotFoundError(status, message, body=body, retry_after=retry_after)
        return FyuzAPIError(status, message, body=body, retry_after=retry_after)
