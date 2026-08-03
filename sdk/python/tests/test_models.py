"""Model decoding: forward compatibility, precision, and null-vs-zero."""

from __future__ import annotations

import dataclasses
import json
import unittest
from datetime import datetime, timezone
from decimal import Decimal

import payloads
from stub_server import StubServer

from fyuz import (
    Claimable,
    FyuzClient,
    KingReign,
    Pot,
    RoundDetail,
    RoundReceipt,
    ShareEntry,
    Token,
    TokenDetail,
    Trade,
    from_unix,
    parse_datetime,
    to_decimal,
    wei_to_bnb,
)

# 18-decimal values that a float cannot hold exactly.
EXACT_TOKEN_AMOUNT = "123456789.123456789123456789"
MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935"


class ForwardCompatibilityTest(unittest.TestCase):
    def test_unknown_fields_are_ignored(self) -> None:
        payload = dict(
            payloads.TOKEN,
            brandNewField="whatever",
            anotherOne={"nested": [1, 2, 3]},
            thirdOne=None,
        )

        token = Token.from_dict(payload)

        self.assertEqual(token.token_symbol, "PEPE")
        self.assertFalse(hasattr(token, "brandNewField"))

    def test_missing_fields_fall_back_to_defaults(self) -> None:
        token = Token.from_dict({"tokenAddress": "0xabc"})

        self.assertEqual(token.token_address, "0xabc")
        self.assertEqual(token.token_name, "")
        self.assertEqual(token.id, 0)
        self.assertIsNone(token.user)
        self.assertIsNone(token.progress)

    def test_non_mapping_input_yields_defaults(self) -> None:
        self.assertEqual(Token.from_dict(None), Token())  # type: ignore[arg-type]

    def test_non_object_array_elements_are_skipped(self) -> None:
        detail = TokenDetail.from_dict({"trades": [payloads.TRADE, "junk", None], "tradesCount": 1})

        self.assertEqual(len(detail.trades), 1)

    def test_models_are_frozen(self) -> None:
        token = Token.from_dict(payloads.TOKEN)

        with self.assertRaises(dataclasses.FrozenInstanceError):
            token.token_symbol = "NOPE"  # type: ignore[misc]

    def test_models_compare_by_value(self) -> None:
        self.assertEqual(Token.from_dict(payloads.TOKEN), Token.from_dict(payloads.TOKEN))


class PrecisionTest(unittest.TestCase):
    """Decimal strings must survive the round trip byte for byte."""

    def setUp(self) -> None:
        self.stub = StubServer().start()
        self.addCleanup(self.stub.stop)
        self.client = FyuzClient(self.stub.base_url, backoff_initial=0.0, timeout=5.0)
        self.addCleanup(self.client.close)

    def test_token_amount_survives_a_full_round_trip(self) -> None:
        self.stub.add(
            "POST",
            "/trades",
            json_body=[dict(payloads.TRADE, tokenAmount=EXACT_TOKEN_AMOUNT)],
        )

        trade = self.client.get_token_trades("0x1")[0]

        self.assertIsInstance(trade.token_amount, str)
        self.assertEqual(trade.token_amount, EXACT_TOKEN_AMOUNT)
        self.assertEqual(to_decimal(trade.token_amount), Decimal(EXACT_TOKEN_AMOUNT))
        # ... and this is what would have happened had we parsed it as a float.
        self.assertNotEqual(repr(float(EXACT_TOKEN_AMOUNT)), EXACT_TOKEN_AMOUNT)

    def test_uint256_wei_survives_a_full_round_trip(self) -> None:
        self.stub.add(
            "GET",
            "/distributor/stats",
            json_body=dict(payloads.PAYOUT_STATS, totalPaidWei=MAX_UINT256),
        )

        stats = self.client.distributor.get_stats()

        self.assertIsInstance(stats.total_paid_wei, str)
        self.assertEqual(stats.total_paid_wei, MAX_UINT256)
        self.assertEqual(int(stats.total_paid_wei), int(MAX_UINT256))
        self.assertNotEqual(int(float(MAX_UINT256)), int(MAX_UINT256))

    def test_payout_amounts_stay_exact(self) -> None:
        self.stub.add("GET", "/distributor/rounds/6", json_body=payloads.ROUND_DETAIL)

        detail = self.client.distributor.get_round(6)
        total = sum(int(line.amount_wei) for line in detail.payouts)

        self.assertEqual(total, 1_125_000_000_000_000_000)
        self.assertEqual(wei_to_bnb(detail.payouts[0].amount_wei), Decimal("0.7"))

    def test_marketcap_string_is_not_widened(self) -> None:
        raw = json.loads(json.dumps(payloads.TOKEN))
        token = Token.from_dict(raw)

        self.assertIsInstance(token.marketcap, str)
        self.assertEqual(token.marketcap, "4472.899483094470000000")
        self.assertNotEqual(token.marketcap, str(float(token.marketcap)))


class NullIsNotZeroTest(unittest.TestCase):
    """`null` means unknown. Rendering it as 0 would be a correctness bug."""

    def test_pot(self) -> None:
        pot = Pot.from_dict(payloads.POT_UNKNOWN)

        self.assertIsNone(pot.pot_bnb)
        self.assertIsNone(pot.total_points)
        self.assertNotEqual(pot.pot_bnb, 0.0)

    def test_claimable(self) -> None:
        claimable = Claimable.from_dict({"address": "0xf0", "claimableWei": None})

        self.assertIsNone(claimable.claimable_wei)
        self.assertNotEqual(claimable.claimable_wei, "0")
        self.assertIsNone(wei_to_bnb(claimable.claimable_wei))

    def test_curve_holding(self) -> None:
        detail = TokenDetail.from_dict(payloads.TOKEN_DETAIL)

        self.assertIsNone(detail.curve_holding)

    def test_round_receipt_wei_fields(self) -> None:
        receipt = RoundReceipt.from_dict(
            {"roundId": 7, "timeStart": 1, "timeEnd": 2, "potWei": None, "winnerAmountWei": None}
        )

        self.assertEqual(receipt.round_id, 7)
        self.assertIsNone(receipt.pot_wei)
        self.assertIsNone(receipt.winner_amount_wei)
        self.assertIsNone(receipt.holder_count)

    def test_ongoing_reign_has_no_end(self) -> None:
        reign = KingReign.from_dict(payloads.KINGS_HISTORY[0])

        self.assertIsNone(reign.ended_at)
        self.assertTrue(reign.ongoing)


class RoundDetailShapeTest(unittest.TestCase):
    def test_receipt_fields_are_flattened_next_to_payouts(self) -> None:
        detail = RoundDetail.from_dict(payloads.ROUND_DETAIL)

        self.assertIsInstance(detail, RoundReceipt)
        self.assertEqual(detail.round_id, 6)
        self.assertEqual(detail.time_end, 1_753_003_600)
        self.assertEqual(detail.vrf_random, "77985133986447848905248117107615823884")
        self.assertEqual(len(detail.payouts), 2)

    def test_a_nested_round_key_would_not_match(self) -> None:
        """Guards against a generator that emits `{"round": {...}}`."""
        nested = {"round": payloads.ROUND_RECEIPT, "payouts": payloads.PAYOUT_LINES}

        detail = RoundDetail.from_dict(nested)

        self.assertEqual(detail.round_id, 0)  # nothing at the top level to read


class ConvenienceTest(unittest.TestCase):
    def test_trade_is_buy(self) -> None:
        self.assertTrue(Trade.from_dict(payloads.TRADE).is_buy)
        self.assertFalse(Trade.from_dict(dict(payloads.TRADE, type="sell")).is_buy)

    def test_token_graduated(self) -> None:
        self.assertFalse(Token.from_dict(payloads.TOKEN).graduated)
        self.assertTrue(Token.from_dict(dict(payloads.TOKEN, pairAddress="0xpair")).graduated)

    def test_share_fraction(self) -> None:
        entry = ShareEntry.from_dict({"address": "0xf0", "points": 1.0, "share": 2**31})

        self.assertAlmostEqual(entry.share_fraction, 0.5)


class HelpersTest(unittest.TestCase):
    def test_to_decimal(self) -> None:
        self.assertEqual(to_decimal("0.000004472899483094"), Decimal("0.000004472899483094"))
        self.assertIsNone(to_decimal(None))
        with self.assertRaises(ValueError):
            to_decimal("not a number")

    def test_to_decimal_rejects_what_decimal_would_wave_through(self) -> None:
        """NaN/Infinity/underscores parse in Decimal but are never valid money."""
        for bad in ("NaN", "nan", "-NaN", "sNaN", "Infinity", "-Infinity", "inf", "1_0", "1_000.5"):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                to_decimal(bad)
            with self.subTest(value=bad, helper="wei_to_bnb"), self.assertRaises(ValueError):
                wei_to_bnb(bad)

    def test_wei_to_bnb_is_exact_for_huge_values(self) -> None:
        self.assertEqual(wei_to_bnb("1250000000000000000"), Decimal("1.25"))
        self.assertEqual(wei_to_bnb("1"), Decimal("1E-18"))
        self.assertIsNone(wei_to_bnb(None))

        exact = wei_to_bnb(MAX_UINT256)
        self.assertEqual(
            str(exact),
            "115792089237316195423570985008687907853269984665640564039457.584007913129639935",
        )
        # Every digit is still there, unlike a plain division under the default
        # 28-digit decimal context (which is exactly the trap this helper avoids).
        self.assertEqual("".join(str(exact).split(".")), MAX_UINT256)
        self.assertNotEqual(str(Decimal(MAX_UINT256) / Decimal(10) ** 18), str(exact))

    def test_parse_datetime(self) -> None:
        expected = datetime(2026, 7, 28, 12, 0, 0, tzinfo=timezone.utc)

        self.assertEqual(parse_datetime("2026-07-28T12:00:00Z"), expected)
        self.assertEqual(parse_datetime("2026-07-28T12:00:00"), expected)
        self.assertEqual(parse_datetime("2026-07-28 12:00:00+00:00"), expected)
        self.assertEqual(parse_datetime("2026-07-28T13:00:00+01:00"), expected)
        self.assertEqual(parse_datetime("2026-07-28T12:00:00+0000"), expected)
        self.assertEqual(
            parse_datetime("2026-07-28T12:00:00.123456789Z"),
            expected.replace(microsecond=123456),
        )
        self.assertIsNone(parse_datetime(None))
        with self.assertRaises(ValueError):
            parse_datetime("yesterday")

    def test_parse_datetime_on_a_real_token(self) -> None:
        token = Token.from_dict(payloads.TOKEN)

        self.assertEqual(
            parse_datetime(token.created_at),
            datetime(2026, 7, 28, 12, 0, 0, tzinfo=timezone.utc),
        )
        self.assertIsNone(parse_datetime(token.launched_at))  # never graduated

    def test_from_unix(self) -> None:
        trade = Trade.from_dict(payloads.TRADE)

        self.assertEqual(
            from_unix(trade.date), datetime(2025, 7, 21, 8, 20, 0, tzinfo=timezone.utc)
        )
        self.assertIsNone(from_unix(None))


if __name__ == "__main__":
    unittest.main()
