"""Conformance tests driven by ../../shared/test-vectors.

The same fixtures back the TypeScript, Go and Rust suites, so a change to the
wire contract fails all four at once instead of letting the clients drift
apart.
"""

from __future__ import annotations

import copy
import json
import re
import unittest
from pathlib import Path
from typing import Any, Dict

from stub_server import StubServer

from fyuz import (
    FyuzAPIError,
    FyuzClient,
    FyuzNotFoundError,
    FyuzRateLimitError,
    Token,
)

VECTOR_DIR = Path(__file__).resolve().parents[2] / "shared" / "test-vectors"

MAX_RETRIES = 2


def load_vector(name: str) -> Dict[str, Any]:
    with (VECTOR_DIR / name).open(encoding="utf-8") as handle:
        data: Dict[str, Any] = json.load(handle)
    return data


def to_snake(name: str) -> str:
    """Wire name to model attribute, matching the client's own conversion."""
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


class ConformanceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.stub = StubServer().start()
        self.addCleanup(self.stub.stop)
        self.client = FyuzClient(
            self.stub.base_url,
            backoff_initial=0.0,
            timeout=5.0,
            max_retries=MAX_RETRIES,
        )
        self.addCleanup(self.client.close)


class TokenVectorTest(ConformanceTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.vector = load_vector("token.json")
        self.expect = self.vector["expect"]

    def _fetch_token(self) -> Token:
        self.stub.add("GET", "/tokens", json_body=self.vector["wire"])
        page = self.client.list_tokens()
        self.assertEqual(page.token_count, self.expect["scalars"]["tokenCount"])
        self.assertEqual(len(page.token_list), 1)
        return page.token_list[0]

    def test_decimals_survive_exactly(self) -> None:
        """A decimal the server sent arrives byte-identical.

        Every value in the fixture is one a float-parsing client corrupts, so a
        regression here is a real precision bug rather than a formatting nit.
        """
        exact = self.expect["exact_strings"]
        self.assertTrue(exact, "fixture has no exact_strings; test would pass vacuously")

        token = self._fetch_token()

        for wire_name, expected in exact.items():
            attribute = to_snake(wire_name)
            with self.subTest(field=wire_name):
                value = getattr(token, attribute)
                self.assertIsInstance(
                    value,
                    str,
                    f"{wire_name} is {type(value).__name__}, want str — "
                    "decimals must not be parsed into a number",
                )
                self.assertEqual(value, expected["value"], expected["why"])

    def test_float_parsing_would_corrupt_these(self) -> None:
        """The fixture is only meaningful if these values really are float-unsafe.

        Without this, someone could weaken the vectors to values that survive a
        double and the test above would keep passing while protecting nothing.
        Only the whole-number vectors are checked, because ``int(float(v)) !=
        int(v)`` is an exact statement about lost digits with no formatting
        ambiguity in it.
        """
        corrupted = [
            wire_name
            for wire_name, expected in self.expect["exact_strings"].items()
            if expected["value"].isdigit()
            and int(float(expected["value"])) != int(expected["value"])
        ]
        self.assertTrue(
            corrupted,
            "no integer vector in exact_strings loses digits through float — "
            "the fixture proves nothing",
        )

    def test_null_is_not_zero(self) -> None:
        """null means unknown, never zero and never the empty string.

        A null ``pair_address`` in particular means the token is still on the
        bonding curve and no DEX pool exists to look up.
        """
        nullable = self.expect["must_be_null"]
        self.assertTrue(nullable["fields"], "fixture has no must_be_null fields")

        token = self._fetch_token()

        for wire_name in nullable["fields"]:
            attribute = to_snake(wire_name)
            with self.subTest(field=wire_name):
                self.assertIsNone(getattr(token, attribute), nullable["why"])

    def test_scalars_round_trip(self) -> None:
        token = self._fetch_token()
        scalars = self.expect["scalars"]

        self.assertEqual(token.id, scalars["id"])
        self.assertEqual(token.pool_type, scalars["poolType"])
        self.assertEqual(token.replies, scalars["replies"])


class TradeSideVectorTest(unittest.TestCase):
    def test_casing_is_passed_through_and_folds_on_compare(self) -> None:
        """Both halves of the trade-side contract.

        The API sends ``"buy"``/``"sell"`` from ``/trades/recent`` and
        ``"BUY"``/``"SELL"`` from the token detail endpoint. The value is passed
        through untouched, so a caller has to fold the case itself.
        """
        vector = load_vector("trade-side.json")
        cases = vector["cases"]
        self.assertTrue(cases, "fixture has no cases; test would pass vacuously")

        for case in cases:
            with self.subTest(wire=case["wire"]):
                # A fresh stub per case. The stub keeps its last queued response
                # sticky, so a shared one would answer the second case with the
                # first case's payload.
                stub = StubServer().start()
                self.addCleanup(stub.stop)
                client = FyuzClient(stub.base_url, backoff_initial=0.0, timeout=5.0)
                self.addCleanup(client.close)

                body = copy.deepcopy(vector["wire_template"])
                body["trades"][0]["type"] = case["wire"]
                stub.add("GET", "/trades/recent", json_body=body)

                feed = client.get_recent_trades()

                self.assertEqual(len(feed.trades), 1)
                trade = feed.trades[0]
                self.assertEqual(
                    trade.type,
                    case["wire"],
                    "the SDK must not rewrite what the server sent",
                )
                self.assertEqual(trade.type.lower(), case["side"])


class ErrorVectorTest(unittest.TestCase):
    def test_error_classification_and_retries(self) -> None:
        """Each status maps to the documented error, and only retryable ones retry."""
        cases = load_vector("http-errors.json")["cases"]
        self.assertTrue(cases, "fixture has no cases; test would pass vacuously")

        for case in cases:
            with self.subTest(case=case["name"]):
                self._check_case(case)

    def _check_case(self, case: Dict[str, Any]) -> None:
        # A fresh stub per case: sharing one would let a response queued for an
        # earlier case leak into the next and shift every assertion by one.
        stub = StubServer().start()
        self.addCleanup(stub.stop)
        client = FyuzClient(
            stub.base_url, backoff_initial=0.0, timeout=5.0, max_retries=MAX_RETRIES
        )
        self.addCleanup(client.close)

        attempts = MAX_RETRIES + 1 if case["retryable"] else 1
        # One spare, so an over-fetching client shows up in the request count
        # rather than in the status it happened to receive.
        for _ in range(attempts + 1):
            stub.add("GET", "/health", status=case["status"], raw_body=case["body"])

        with self.assertRaises(FyuzAPIError) as caught:
            client.health()

        error = caught.exception
        self.assertEqual(error.status, case["status"])

        if case["classification"] == "not_found":
            self.assertIsInstance(error, FyuzNotFoundError)
        elif case["classification"] == "rate_limited":
            self.assertIsInstance(error, FyuzRateLimitError)
        else:
            self.assertNotIsInstance(error, (FyuzNotFoundError, FyuzRateLimitError))

        if case["message"] is not None:
            self.assertEqual(error.message, case["message"])
        else:
            # A body the SDK cannot parse still has to yield something readable.
            self.assertTrue(error.message.strip())

        self.assertEqual(
            len(stub.requests_for("GET", "/health")),
            attempts,
            f"retryable={case['retryable']}",
        )


if __name__ == "__main__":
    unittest.main()
