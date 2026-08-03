"""Trading: calldata encoding, quotes, slippage and revert classification.

The encoding half is driven by ``../../shared/test-vectors/trade-calldata.json``,
whose expected hex came out of ``cast calldata``. Four hand-written ABI encoders
agreeing with foundry is the only reason to trust any of them.
"""

from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fyuz import (
    FyuzClient,
    FyuzContractRevertError,
    FyuzTokenGraduatedError,
    format_units,
    parse_units,
    revert_error,
)
from fyuz.abi import (
    SELECTOR_ALLOWANCE,
    SELECTOR_APPROVE,
    SELECTOR_BALANCE_OF,
    SELECTOR_GET_FIRST_BUY_FEE,
    SELECTOR_GET_MAX_SELLABLE_ETH,
    SELECTOR_GET_SWAP_OUTPUT,
    SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS,
    SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS,
    SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH,
    SELECTOR_TOKEN_POOLS,
    address_word,
    normalize_address,
    parse_amount,
    uint256_word,
)

VECTOR_DIR = Path(__file__).resolve().parents[2] / "shared" / "test-vectors"

CALLDATA = json.loads((VECTOR_DIR / "trade-calldata.json").read_text(encoding="utf-8"))
TRADE_ERRORS = json.loads((VECTOR_DIR / "trade-errors.json").read_text(encoding="utf-8"))

TOKEN = CALLDATA["fixture_args"]["token"]
DEADLINE = CALLDATA["fixture_args"]["deadline"]

CHAIN_PAYLOAD = {
    "chains": [
        {
            "name": "BNB Smart Chain",
            "chainId": 56,
            "network": "bsc",
            "contractAddress": "0x33A98BeF6496684a8daC83734D9CEB0CEFC7019c",
            "currency": "BNB",
            "explorerUrl": "https://bscscan.com",
        }
    ]
}


def fixture(name: str) -> Dict[str, Any]:
    for case in CALLDATA["cases"]:
        if case["name"] == name:
            return case
    raise AssertionError(f"fixture {name!r} missing from trade-calldata.json")


def word(value: int) -> str:
    return uint256_word(value)


def swap_output_result(amount_out: int, impact_bps: int) -> str:
    return "0x" + word(amount_out) + word(impact_bps)


def token_pools_result(launched: bool) -> str:
    """tokenPools return data — eight words, with ``launched`` last."""
    return "0x" + word(0) * 7 + word(1 if launched else 0)


class _Handler(BaseHTTPRequestHandler):
    """Serves ``/config`` over REST and ``/rpc`` over JSON-RPC, on one server."""

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path.startswith("/config"):
            self._send(200, CHAIN_PAYLOAD)
        else:
            self._send(404, {"error": f"no stub for {self.path}"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        call = payload["params"][0]
        stubs = self.server.stubs  # type: ignore[attr-defined]
        self.server.calls.append((call["to"], call["data"]))  # type: ignore[attr-defined]

        selector = call["data"][:10].lower()
        if selector in stubs["reverts"]:
            self._send(
                200,
                {
                    "jsonrpc": "2.0",
                    "id": payload["id"],
                    "error": {
                        "code": 3,
                        "message": "execution reverted",
                        "data": stubs["reverts"][selector],
                    },
                },
            )
            return
        self._send(
            200,
            {
                "jsonrpc": "2.0",
                "id": payload["id"],
                "result": stubs["results"].get(selector, "0x"),
            },
        )

    def _send(self, status: int, body: Any) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, format: str, *args: Any) -> None:
        """Silence the default stderr access log."""


class ChainStubTestCase(unittest.TestCase):
    """Base case that starts a combined REST + JSON-RPC stub."""

    def start_stub(
        self,
        results: Optional[Dict[str, str]] = None,
        reverts: Optional[Dict[str, str]] = None,
    ) -> FyuzClient:
        server = HTTPServer(("127.0.0.1", 0), _Handler)
        server.stubs = {"results": results or {}, "reverts": reverts or {}}  # type: ignore[attr-defined]
        server.calls = []  # type: ignore[attr-defined]
        self.server = server

        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2.0)
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)

        host, port = server.server_address[:2]
        base = f"http://{host}:{port}"
        client = FyuzClient(base, backoff_initial=0.0, timeout=5.0, rpc_url=f"{base}/rpc")
        self.addCleanup(client.close)
        return client

    def calls_with(self, selector: str) -> List[Tuple[str, str]]:
        return [c for c in self.server.calls if c[1].lower().startswith(selector)]


class CalldataVectorTest(ChainStubTestCase):
    def test_buy_exact_bnb(self) -> None:
        case = fixture("buy_exact_bnb")
        min_out = int(case["args"]["minAmountOut"])
        buy_amount = int(case["args"]["buyAmount"])

        client = self.start_stub(
            {
                # amount_out is exactly the fixture's minAmountOut, so an explicit
                # limit reproduces the golden calldata with no rounding in the way.
                SELECTOR_GET_SWAP_OUTPUT: swap_output_result(min_out, 120),
                SELECTOR_GET_FIRST_BUY_FEE: "0x" + word(0),
            }
        )

        built = client.trade.build_buy(
            TOKEN, buy_amount, limit_wei=min_out, deadline=DEADLINE
        )

        self.assertEqual(built.transaction.data, case["calldata"])
        self.assertEqual(built.transaction.to, CALLDATA["contract"]["bsc"])
        self.assertEqual(built.transaction.chain_id, CALLDATA["contract"]["chainId"])
        self.assertEqual(built.transaction.value, buy_amount, "the fee is zero here")

    def test_sell_exact_tokens(self) -> None:
        case = fixture("sell_exact_tokens")
        min_out = int(case["args"]["minAmountOut"])
        sell_amount = int(case["args"]["sellAmount"])

        client = self.start_stub(
            {SELECTOR_GET_SWAP_OUTPUT: swap_output_result(min_out, 90)}
        )
        built = client.trade.build_sell(
            TOKEN, sell_amount, limit_wei=min_out, deadline=DEADLINE
        )

        self.assertEqual(built.transaction.data, case["calldata"])
        self.assertEqual(built.transaction.value, 0, "selling is not payable")

    def test_buy_exact_tokens(self) -> None:
        case = fixture("buy_exact_tokens")
        max_in = int(case["args"]["maxAmountIn"])
        wanted = int(case["args"]["buyAmount"])

        client = self.start_stub(
            {
                SELECTOR_GET_SWAP_OUTPUT: swap_output_result(max_in, 0),
                SELECTOR_GET_FIRST_BUY_FEE: "0x" + word(0),
            }
        )
        built = client.trade.build_buy_exact_tokens(
            TOKEN, wanted, limit_wei=max_in, deadline=DEADLINE
        )

        self.assertEqual(built.transaction.data, case["calldata"])

    def test_approve(self) -> None:
        client = self.start_stub()

        exact = fixture("approve_exact")
        approve = client.trade.build_approve(TOKEN, amount_wei=int(exact["args"]["amount"]))
        self.assertEqual(approve.data, exact["calldata"])
        self.assertEqual(approve.to, TOKEN, "approve targets the token, not the curve")

        unlimited = fixture("approve_unlimited")
        self.assertEqual(
            client.trade.build_approve(TOKEN, unlimited=True).data, unlimited["calldata"]
        )

    def test_quotes_and_reads(self) -> None:
        client = self.start_stub(
            {
                SELECTOR_GET_SWAP_OUTPUT: swap_output_result(1, 1),
                SELECTOR_GET_FIRST_BUY_FEE: "0x" + word(0),
                SELECTOR_ALLOWANCE: "0x" + word(42),
                SELECTOR_TOKEN_POOLS: token_pools_result(False),
            }
        )

        client.trade.quote_buy(TOKEN, int(fixture("quote_buy")["args"]["amountIn"]))
        client.trade.quote_sell(TOKEN, int(fixture("quote_sell")["args"]["amountIn"]))

        quote_calls = self.calls_with(SELECTOR_GET_SWAP_OUTPUT)
        self.assertEqual(quote_calls[0][1], fixture("quote_buy")["calldata"])
        self.assertEqual(quote_calls[1][1], fixture("quote_sell")["calldata"])

        owner = fixture("allowance")["args"]["owner"]
        self.assertEqual(client.trade.allowance(TOKEN, owner), 42)
        self.assertEqual(
            self.calls_with(SELECTOR_ALLOWANCE)[0][1], fixture("allowance")["calldata"]
        )

        self.assertFalse(client.trade.is_graduated(TOKEN))
        self.assertEqual(
            self.calls_with(SELECTOR_TOKEN_POOLS)[0][1], fixture("token_pools")["calldata"]
        )

    def test_selectors_match_the_fixture(self) -> None:
        """Catches a mistyped constant, which would send a transaction elsewhere."""
        expected = CALLDATA["selectors"]
        self.assertEqual(
            expected["swapExactETHForTokens(address,uint256,uint256,uint256)"],
            SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS,
        )
        self.assertEqual(
            expected["swapETHForExactTokens(address,uint256,uint256,uint256)"],
            SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS,
        )
        self.assertEqual(
            expected["swapExactTokensForETH(address,uint256,uint256,uint256)"],
            SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH,
        )
        self.assertEqual(expected["getSwapOutput(address,uint256,bool)"], SELECTOR_GET_SWAP_OUTPUT)
        self.assertEqual(expected["getFirstBuyFee(address)"], SELECTOR_GET_FIRST_BUY_FEE)
        self.assertEqual(expected["getMaxSellableETH(address)"], SELECTOR_GET_MAX_SELLABLE_ETH)
        self.assertEqual(expected["tokenPools(address)"], SELECTOR_TOKEN_POOLS)
        self.assertEqual(expected["approve(address,uint256)"], SELECTOR_APPROVE)
        self.assertEqual(expected["allowance(address,address)"], SELECTOR_ALLOWANCE)
        self.assertEqual(expected["balanceOf(address)"], SELECTOR_BALANCE_OF)

    def test_mixed_case_address_encodes_lowercased(self) -> None:
        casing = CALLDATA["address_casing"]
        self.assertEqual(address_word(casing["mixed_case_input"]), casing["encoded_word"])


class QuoteTest(ChainStubTestCase):
    def test_first_buy_fee_lands_on_value_not_on_the_amount_swapped(self) -> None:
        client = self.start_stub(
            {
                SELECTOR_GET_SWAP_OUTPUT: swap_output_result(1000, 250),
                SELECTOR_GET_FIRST_BUY_FEE: "0x" + word(7_000_000_000_000_000),
            }
        )
        quote = client.trade.quote_buy(TOKEN, parse_units("0.5"))

        self.assertEqual(quote.amount_in_wei, 500_000_000_000_000_000)
        self.assertEqual(quote.first_buy_fee_wei, 7_000_000_000_000_000)
        self.assertEqual(quote.value_wei, 507_000_000_000_000_000)
        self.assertEqual(quote.amount_out_wei, 1000)
        self.assertEqual(quote.price_impact_bps, 250)

    def test_refuses_a_graduated_token(self) -> None:
        client = self.start_stub(
            reverts={SELECTOR_GET_SWAP_OUTPUT: TRADE_ERRORS["graduated_selector"]}
        )

        with self.assertRaises(FyuzTokenGraduatedError) as caught:
            client.trade.build_buy(TOKEN, parse_units("0.5"), slippage_bps=100)

        self.assertEqual(caught.exception.kind, "graduated")
        self.assertEqual(caught.exception.token_address, TOKEN)
        self.assertIn("graduated", str(caught.exception))


class SlippageTest(ChainStubTestCase):
    def test_lowers_min_amount_out_on_a_buy(self) -> None:
        client = self.start_stub(
            {
                SELECTOR_GET_SWAP_OUTPUT: swap_output_result(1_000_000, 100),
                SELECTOR_GET_FIRST_BUY_FEE: "0x" + word(0),
            }
        )
        built = client.trade.build_buy(TOKEN, parse_units("1"), slippage_bps=100)
        self.assertEqual(built.limit_wei, 990_000)

    def test_raises_max_amount_in_on_an_exact_tokens_buy(self) -> None:
        client = self.start_stub(
            {
                SELECTOR_GET_SWAP_OUTPUT: swap_output_result(1_000_000, 0),
                SELECTOR_GET_FIRST_BUY_FEE: "0x" + word(0),
            }
        )
        built = client.trade.build_buy_exact_tokens(TOKEN, 5000, slippage_bps=250)
        self.assertEqual(built.limit_wei, 1_025_000)

    def test_refuses_to_pick_a_tolerance(self) -> None:
        client = self.start_stub(
            {
                SELECTOR_GET_SWAP_OUTPUT: swap_output_result(1000, 0),
                SELECTOR_GET_FIRST_BUY_FEE: "0x" + word(0),
            }
        )
        with self.assertRaises(ValueError) as caught:
            client.trade.build_buy(TOKEN, parse_units("1"))
        self.assertIn("slippage protection is required", str(caught.exception))

    def test_rejects_both_forms_at_once(self) -> None:
        client = self.start_stub(
            {
                SELECTOR_GET_SWAP_OUTPUT: swap_output_result(1000, 0),
                SELECTOR_GET_FIRST_BUY_FEE: "0x" + word(0),
            }
        )
        with self.assertRaises(ValueError) as caught:
            client.trade.build_buy(TOKEN, parse_units("1"), slippage_bps=100, limit_wei=900)
        self.assertIn("not both", str(caught.exception))


class RevertClassificationTest(unittest.TestCase):
    def test_decode_cases_match_the_shared_table(self) -> None:
        for case in TRADE_ERRORS["decode_cases"]:
            with self.subTest(case=case["name"]):
                error = revert_error(case["revert_data"], "getSwapOutput(0x…)")

                self.assertIsInstance(error, FyuzContractRevertError)
                self.assertEqual(error.kind, case["expect"]["surfaced_as"])
                if "error" in case["expect"]:
                    self.assertEqual(error.error_name, case["expect"]["error"])
                if "message" in case["expect"]:
                    self.assertIn(case["expect"]["message"], str(error))
                if "message_contains" in case["expect"]:
                    self.assertIn(case["expect"]["message_contains"], str(error))

    def test_every_revertible_selector_is_recognised(self) -> None:
        for entry in TRADE_ERRORS["revertible"]:
            with self.subTest(error=entry["error"]):
                error = revert_error(entry["selector"], "call")
                self.assertEqual(error.kind, entry["surfaced_as"])
                self.assertEqual(error.error_name, entry["error"])
                if entry["surfaced_as"] != "graduated":
                    # The graduated case is its own subclass and is never retryable.
                    self.assertEqual(error.retryable, entry["retryable"])


class UnitConversionTest(unittest.TestCase):
    def test_round_trip_without_touching_a_float(self) -> None:
        cases = [
            ("0.5", 500_000_000_000_000_000),
            ("1", 1_000_000_000_000_000_000),
            ("0.000000000000000001", 1),
            # 0.1 + 0.2 in binary floating point is the classic wrong answer;
            # this path never converts to a float, so it is not.
            ("0.30000000000000004", 300_000_000_000_000_040),
        ]
        for decimal, wei in cases:
            with self.subTest(decimal=decimal):
                self.assertEqual(parse_units(decimal), wei)
                self.assertEqual(format_units(wei), decimal)

    def test_rejects_more_decimal_places_than_the_token_carries(self) -> None:
        with self.assertRaises(ValueError) as caught:
            parse_units("1.0000000000000000001")
        self.assertIn("more than the 18", str(caught.exception))

    def test_rejects_a_decimal_string_where_wei_was_expected(self) -> None:
        with self.assertRaises(ValueError) as caught:
            parse_amount("amount_wei", "0.5")
        self.assertIn("parse_units", str(caught.exception))

    def test_rejects_a_short_address(self) -> None:
        with self.assertRaises(ValueError):
            normalize_address("token", "0xdead")


if __name__ == "__main__":
    unittest.main()
