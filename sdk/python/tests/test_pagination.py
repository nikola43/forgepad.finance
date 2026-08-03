"""Auto-pagination over /tokens."""

from __future__ import annotations

import unittest
from typing import Any, Dict, List

import payloads
from stub_server import StubServer

from fyuz import FyuzClient, Token


def page(symbols: List[str], total: int) -> Dict[str, Any]:
    """Build a /tokens page carrying one token per symbol."""
    return {
        "tokenList": [dict(payloads.TOKEN, tokenSymbol=s) for s in symbols],
        "tokenCount": total,
    }


class IterTokensTest(unittest.TestCase):
    def setUp(self) -> None:
        self.stub = StubServer().start()
        self.addCleanup(self.stub.stop)
        self.client = FyuzClient(self.stub.base_url, backoff_initial=0.0, timeout=5.0)
        self.addCleanup(self.client.close)

    def test_walks_every_page_and_stops_at_token_count(self) -> None:
        self.stub.add("GET", "/tokens", json_body=page(["A", "B"], 5))
        self.stub.add("GET", "/tokens", json_body=page(["C", "D"], 5))
        self.stub.add("GET", "/tokens", json_body=page(["E"], 5))
        # A fourth page is available but must never be requested.
        self.stub.add("GET", "/tokens", json_body=page(["F"], 5))

        symbols = [t.token_symbol for t in self.client.iter_tokens(page_size=2)]

        self.assertEqual(symbols, ["A", "B", "C", "D", "E"])
        requests = self.stub.requests_for("GET", "/tokens")
        self.assertEqual(len(requests), 3)
        self.assertEqual([r.param("pageNumber") for r in requests], ["1", "2", "3"])
        self.assertEqual([r.param("pageSize") for r in requests], ["2", "2", "2"])

    def test_yields_typed_tokens(self) -> None:
        self.stub.add("GET", "/tokens", json_body=page(["A"], 1))

        tokens = list(self.client.iter_tokens())

        self.assertIsInstance(tokens[0], Token)
        self.assertEqual(tokens[0].marketcap, "4472.899483094470000000")

    def test_stops_on_an_empty_page_even_if_count_lies(self) -> None:
        self.stub.add("GET", "/tokens", json_body=page(["A"], 9_999_999))
        self.stub.add("GET", "/tokens", json_body=page([], 9_999_999))

        symbols = [t.token_symbol for t in self.client.iter_tokens(page_size=1)]

        self.assertEqual(symbols, ["A"])
        self.assertEqual(len(self.stub.requests_for("GET", "/tokens")), 2)

    def test_a_missing_token_count_does_not_truncate_after_one_page(self) -> None:
        """`tokenCount` defaults to 0; trusting that would lose every later page."""
        without_count = {
            "tokenList": [dict(payloads.TOKEN, tokenSymbol=s) for s in ("A", "B", "C")]
        }
        self.stub.add("GET", "/tokens", json_body=without_count)
        self.stub.add(
            "GET",
            "/tokens",
            json_body={"tokenList": [dict(payloads.TOKEN, tokenSymbol=s) for s in ("D", "E")]},
        )
        self.stub.add("GET", "/tokens", json_body={"tokenList": []})

        symbols = [t.token_symbol for t in self.client.iter_tokens(page_size=3)]

        self.assertEqual(symbols, ["A", "B", "C", "D", "E"])
        self.assertEqual(len(self.stub.requests_for("GET", "/tokens")), 3)

    def test_is_lazy_so_breaking_early_stops_requesting(self) -> None:
        self.stub.add("GET", "/tokens", json_body=page(["A", "B"], 100))

        for token in self.client.iter_tokens(page_size=2):
            if token.token_symbol == "A":
                break

        self.assertEqual(len(self.stub.requests_for("GET", "/tokens")), 1)

    def test_forwards_filters_and_start_page(self) -> None:
        self.stub.add("GET", "/tokens", json_body=page(["A"], 1))

        list(
            self.client.iter_tokens(
                order_type="marketcap",
                order_flag="desc",
                search_word="pepe",
                network="bsc",
                style="pixel",
                include_nsfw=True,
                page_size=10,
                start_page=3,
            )
        )

        request = self.stub.last_request()
        self.assertEqual(request.param("orderType"), "marketcap")
        self.assertEqual(request.param("orderFlag"), "desc")
        self.assertEqual(request.param("searchWord"), "pepe")
        self.assertEqual(request.param("network"), "bsc")
        self.assertEqual(request.param("style"), "pixel")
        self.assertEqual(request.param("includeNsfw"), "true")
        self.assertEqual(request.param("pageNumber"), "3")
        self.assertEqual(request.param("pageSize"), "10")

    def test_empty_result_set(self) -> None:
        self.stub.add("GET", "/tokens", json_body=page([], 0))

        self.assertEqual(list(self.client.iter_tokens()), [])

    def test_rejects_nonsense_paging_arguments(self) -> None:
        with self.assertRaises(ValueError):
            list(self.client.iter_tokens(page_size=0))
        with self.assertRaises(ValueError):
            list(self.client.iter_tokens(start_page=0))


if __name__ == "__main__":
    unittest.main()
