"""Transport behaviour: retries, backoff, error envelopes and encoding."""

from __future__ import annotations

import socket
import unittest
from typing import List

from stub_server import StubServer

from fyuz import (
    FyuzAPIError,
    FyuzClient,
    FyuzConnectionError,
    FyuzDecodeError,
    FyuzError,
    FyuzNotFoundError,
    FyuzRateLimitError,
    __version__,
)
from fyuz._http import Transport, encode_query, parse_retry_after

RATE_LIMIT_BODY = {"error": "Too many requests"}


def free_port() -> int:
    """Return a port number nothing is listening on."""
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = int(sock.getsockname()[1])
    sock.close()
    return port


class TransportTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self.stub = StubServer().start()
        self.addCleanup(self.stub.stop)
        # backoff_initial=0 keeps the retry tests instant; the jitter maths is
        # asserted separately with a patched RNG.
        self.client = FyuzClient(self.stub.base_url, backoff_initial=0.0, timeout=5.0)
        self.addCleanup(self.client.close)

    def record_sleeps(self) -> List[float]:
        """Swap the transport's sleep for a recorder and return the log."""
        delays: List[float] = []
        self.client._transport._sleep = delays.append  # type: ignore[assignment]
        return delays


class RequestBasicsTest(TransportTestBase):
    def test_get_decodes_json_and_sends_sdk_headers(self) -> None:
        self.stub.add("GET", "/health", json_body={"status": "ok"})

        self.assertEqual(self.client.health().status, "ok")

        request = self.stub.last_request()
        self.assertEqual(request.headers["user-agent"], f"fyuz-sdk-python/{__version__}")
        self.assertEqual(request.headers["accept"], "application/json")

    def test_custom_user_agent(self) -> None:
        client = FyuzClient(self.stub.base_url, user_agent="acme-indexer/2.0")
        self.addCleanup(client.close)
        self.stub.add("GET", "/health", json_body={"status": "ok"})

        client.health()

        self.assertEqual(self.stub.last_request().headers["user-agent"], "acme-indexer/2.0")

    def test_query_params_drop_none_and_lowercase_bools(self) -> None:
        self.stub.add("GET", "/tokens", json_body={"tokenList": [], "tokenCount": 0})

        self.client.list_tokens(include_nsfw=False, search_word="doge coin", page_size=25)

        request = self.stub.last_request()
        self.assertEqual(request.param("includeNsfw"), "false")
        self.assertEqual(request.param("searchWord"), "doge coin")
        self.assertEqual(request.param("pageSize"), "25")
        self.assertNotIn("orderType", request.query)
        self.assertNotIn("network", request.query)

    def test_path_segments_are_percent_encoded(self) -> None:
        weird = "0xAA/../bb cc"
        self.stub.add("GET", "/wallet/0xAA%2F..%2Fbb%20cc", json_body={"address": weird})

        stats = self.client.get_wallet(weird)

        # The slashes stayed inside the segment instead of traversing the path.
        self.assertEqual(self.stub.last_request().path, "/wallet/0xAA%2F..%2Fbb%20cc")
        self.assertEqual(stats.address, weird)

    def test_post_carries_json_body(self) -> None:
        self.stub.add("POST", "/trades", json_body=[])

        self.client.get_token_trades("0xabc", limit=10)

        request = self.stub.last_request()
        self.assertEqual(request.json(), {"tokenAddress": "0xabc"})
        self.assertEqual(request.headers["content-type"], "application/json")
        self.assertEqual(request.param("limit"), "10")

    def test_empty_body_where_object_expected_raises_decode_error(self) -> None:
        self.stub.add("GET", "/health", status=200)

        with self.assertRaises(FyuzDecodeError):
            self.client.health()

    def test_malformed_json_raises_decode_error(self) -> None:
        self.stub.add("GET", "/health", raw_body="{not json")

        with self.assertRaises(FyuzDecodeError):
            self.client.health()

    def test_array_where_object_expected_raises_decode_error(self) -> None:
        self.stub.add("GET", "/season", json_body=[])

        with self.assertRaises(FyuzDecodeError):
            self.client.get_season()


class RetryTest(TransportTestBase):
    def test_retries_429_then_succeeds(self) -> None:
        self.stub.add("GET", "/health", status=429, json_body=RATE_LIMIT_BODY)
        self.stub.add("GET", "/health", json_body={"status": "ok"})

        self.assertEqual(self.client.health().status, "ok")
        self.assertEqual(len(self.stub.requests_for("GET", "/health")), 2)

    def test_retries_500_then_succeeds(self) -> None:
        self.stub.add("GET", "/health", status=503, json_body={"error": "upstream down"})
        self.stub.add("GET", "/health", json_body={"status": "ok"})

        self.assertEqual(self.client.health().status, "ok")
        self.assertEqual(len(self.stub.requests_for("GET", "/health")), 2)

    def test_rate_limit_error_raised_once_retries_are_exhausted(self) -> None:
        self.stub.add("GET", "/health", status=429, json_body=RATE_LIMIT_BODY)

        with self.assertRaises(FyuzRateLimitError) as caught:
            self.client.health()

        error = caught.exception
        self.assertEqual(error.status, 429)
        self.assertEqual(error.message, "Too many requests")
        self.assertIsInstance(error, FyuzAPIError)
        # 1 initial attempt + 3 retries
        self.assertEqual(len(self.stub.requests_for("GET", "/health")), 4)

    def test_max_retries_zero_disables_retrying(self) -> None:
        client = FyuzClient(self.stub.base_url, max_retries=0, backoff_initial=0.0)
        self.addCleanup(client.close)
        self.stub.add("GET", "/health", status=429, json_body=RATE_LIMIT_BODY)

        with self.assertRaises(FyuzRateLimitError):
            client.health()

        self.assertEqual(len(self.stub.requests_for("GET", "/health")), 1)

    def test_404_is_never_retried(self) -> None:
        self.stub.add(
            "GET", "/users/profile/0xdead", status=404, json_body={"error": "User not found"}
        )

        with self.assertRaises(FyuzNotFoundError) as caught:
            self.client.get_user_profile("0xdead")

        self.assertEqual(caught.exception.status, 404)
        self.assertEqual(caught.exception.message, "User not found")
        self.assertEqual(len(self.stub.requests_for("GET", "/users/profile/0xdead")), 1)

    def test_400_is_never_retried(self) -> None:
        self.stub.add(
            "GET", "/distributor/shares", status=400, json_body={"error": "to must be after from"}
        )

        with self.assertRaises(FyuzAPIError) as caught:
            self.client.distributor.get_shares(from_ts=200, to_ts=100)

        self.assertEqual(caught.exception.status, 400)
        self.assertEqual(caught.exception.message, "to must be after from")
        self.assertNotIsInstance(caught.exception, FyuzRateLimitError)
        self.assertEqual(len(self.stub.requests_for("GET", "/distributor/shares")), 1)

    def test_non_json_error_body_falls_back_to_text(self) -> None:
        self.stub.add("GET", "/health", status=502, raw_body="<html>bad gateway</html>")
        client = FyuzClient(self.stub.base_url, max_retries=0)
        self.addCleanup(client.close)

        with self.assertRaises(FyuzAPIError) as caught:
            client.health()

        self.assertEqual(caught.exception.status, 502)
        self.assertIn("bad gateway", caught.exception.message)
        self.assertEqual(caught.exception.body, "<html>bad gateway</html>")

    def test_retry_after_header_is_honoured(self) -> None:
        delays = self.record_sleeps()
        self.stub.add(
            "GET", "/health", status=429, json_body=RATE_LIMIT_BODY, headers={"Retry-After": "2"}
        )
        self.stub.add("GET", "/health", json_body={"status": "ok"})

        self.client.health()

        self.assertEqual(delays, [2.0])

    def test_retry_after_is_honoured_on_a_503_too(self) -> None:
        """Retry-After is not a 429-only header; a draining LB sends it on 503."""
        delays = self.record_sleeps()
        self.stub.add(
            "GET",
            "/health",
            status=503,
            json_body={"error": "maintenance"},
            headers={"Retry-After": "5"},
        )
        self.stub.add("GET", "/health", json_body={"status": "ok"})

        self.client.health()

        self.assertEqual(delays, [5.0])

    def test_retry_after_is_exposed_on_every_api_error(self) -> None:
        self.stub.add(
            "GET",
            "/health",
            status=503,
            json_body={"error": "maintenance"},
            headers={"Retry-After": "7"},
        )
        client = FyuzClient(self.stub.base_url, max_retries=0)
        self.addCleanup(client.close)

        with self.assertRaises(FyuzAPIError) as caught:
            client.health()

        self.assertEqual(caught.exception.status, 503)
        self.assertEqual(caught.exception.retry_after, 7.0)

    def test_absurd_retry_after_is_capped(self) -> None:
        delays = self.record_sleeps()
        self.stub.add(
            "GET",
            "/health",
            status=429,
            json_body=RATE_LIMIT_BODY,
            headers={"Retry-After": "99999"},
        )
        self.stub.add("GET", "/health", json_body={"status": "ok"})

        self.client.health()

        self.assertEqual(delays, [60.0])

    def test_zero_retry_after_does_not_disable_the_backoff(self) -> None:
        """``Retry-After: 0`` must not turn the retry budget into a hot loop.

        A proxy in front of a rate limiter emits it readily. Taken verbatim it
        spends every remaining attempt with no sleep at all, hammering the
        limiter that just asked the client to stop.
        """
        client = FyuzClient(self.stub.base_url, backoff_initial=1.0, backoff_max=4.0, max_retries=1)
        self.addCleanup(client.close)
        delays: List[float] = []
        client._transport._sleep = delays.append  # type: ignore[assignment]
        client._transport._random = lambda: 1.0  # type: ignore[assignment]
        self.stub.add(
            "GET",
            "/health",
            status=429,
            json_body=RATE_LIMIT_BODY,
            headers={"Retry-After": "0"},
        )
        self.stub.add("GET", "/health", json_body={"status": "ok"})

        client.health()

        # The header can only lengthen the wait, so the computed backoff stands.
        self.assertEqual(delays, [1.0])

    def test_backoff_is_exponential_with_full_jitter(self) -> None:
        client = FyuzClient(self.stub.base_url, backoff_initial=1.0, backoff_max=4.0, max_retries=3)
        self.addCleanup(client.close)
        delays: List[float] = []
        client._transport._sleep = delays.append  # type: ignore[assignment]
        client._transport._random = lambda: 1.0  # type: ignore[assignment]
        self.stub.add("GET", "/health", status=500, json_body={"error": "boom"})

        with self.assertRaises(FyuzAPIError):
            client.health()

        # Full jitter draws uniformly in [0, cap]; rand()==1.0 pins it to cap.
        self.assertEqual(delays, [1.0, 2.0, 4.0])

        client._transport._random = lambda: 0.0  # type: ignore[assignment]
        delays.clear()
        with self.assertRaises(FyuzAPIError):
            client.health()
        self.assertEqual(delays, [0.0, 0.0, 0.0])

    def test_connection_failures_are_retried_then_wrapped(self) -> None:
        client = FyuzClient(f"http://127.0.0.1:{free_port()}", backoff_initial=0.0, max_retries=2)
        self.addCleanup(client.close)
        delays: List[float] = []
        client._transport._sleep = delays.append  # type: ignore[assignment]

        with self.assertRaises(FyuzConnectionError):
            client.health()

        self.assertEqual(len(delays), 2)


class TransportUnitTest(unittest.TestCase):
    def test_base_url_must_be_absolute_http(self) -> None:
        for bad in ("", "ftp://example.com", "api.fyuz.fun", "/relative"):
            with self.subTest(base_url=bad), self.assertRaises(ValueError):
                FyuzClient(bad)

    def test_invalid_knobs_rejected(self) -> None:
        with self.assertRaises(ValueError):
            FyuzClient(timeout=0)
        with self.assertRaises(ValueError):
            FyuzClient(max_retries=-1)

    def test_base_url_trailing_slash_is_normalised(self) -> None:
        self.assertEqual(FyuzClient("https://api.fyuz.fun/").base_url, "https://api.fyuz.fun")

    def test_closed_client_refuses_requests(self) -> None:
        client = FyuzClient("https://api.fyuz.fun")
        client.close()

        with self.assertRaises(FyuzError):
            client.health()

    def test_context_manager_closes(self) -> None:
        with FyuzClient("https://api.fyuz.fun") as client:
            self.assertIsInstance(client, FyuzClient)

        with self.assertRaises(FyuzError):
            client.health()

    def test_encode_query(self) -> None:
        self.assertEqual(
            encode_query({"a": None, "b": True, "c": False, "d": 1, "e": "x y"}),
            "b=true&c=false&d=1&e=x%20y",
        )

    def test_parse_retry_after(self) -> None:
        self.assertEqual(parse_retry_after("5"), 5.0)
        self.assertEqual(parse_retry_after("  0 "), 0.0)
        self.assertEqual(parse_retry_after("-3"), 0.0)
        self.assertIsNone(parse_retry_after(None))
        self.assertIsNone(parse_retry_after("soon"))
        # An HTTP-date in the past clamps to zero rather than going negative.
        self.assertEqual(parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT"), 0.0)

    def test_delay_prefers_retry_after_over_jitter(self) -> None:
        transport = Transport(base_url="https://api.fyuz.fun", backoff_initial=1.0)
        transport._random = lambda: 1.0  # type: ignore[assignment]

        self.assertEqual(transport._delay(0, 7.5), 7.5)
        self.assertEqual(transport._delay(5, None), transport.backoff_max)

    def test_absurd_attempt_counts_do_not_overflow(self) -> None:
        """2.0 ** attempt raises OverflowError past 1023 — and that is no FyuzError."""
        transport = Transport(base_url="https://api.fyuz.fun", backoff_initial=1.0)
        transport._random = lambda: 1.0  # type: ignore[assignment]

        for attempt in (63, 64, 1023, 1024, 100_000):
            with self.subTest(attempt=attempt):
                self.assertEqual(transport._delay(attempt, None), transport.backoff_max)

    def test_a_zero_backoff_stays_zero_at_any_attempt(self) -> None:
        transport = Transport(base_url="https://api.fyuz.fun", backoff_initial=0.0)
        transport._random = lambda: 1.0  # type: ignore[assignment]

        self.assertEqual(transport._delay(3, None), 0.0)
        self.assertEqual(transport._delay(5000, None), 0.0)


if __name__ == "__main__":
    unittest.main()
