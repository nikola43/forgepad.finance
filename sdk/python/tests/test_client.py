"""End-to-end coverage of every endpoint the client exposes."""

from __future__ import annotations

import unittest

import payloads
from stub_server import StubServer

from fyuz import (
    Candle,
    ChainConfig,
    Claimable,
    DiscoverToken,
    FyuzClient,
    HealthStatus,
    KingReign,
    LeaderboardEntry,
    Portfolio,
    Pot,
    RecentTrades,
    ReferralLeaderEntry,
    Rewards,
    RoundDetail,
    RoundReceipt,
    Season,
    Shares,
    TierInfo,
    Token,
    TokenAnalytics,
    TokenDetail,
    TokenPage,
    TopHolderEntry,
    TopTrader,
    Trade,
    UserProfile,
    WalletStats,
)


class ClientTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.stub = StubServer().start()
        self.addCleanup(self.stub.stop)
        self.client = FyuzClient(self.stub.base_url, backoff_initial=0.0, timeout=5.0)
        self.addCleanup(self.client.close)


class SystemTest(ClientTestCase):
    def test_health(self) -> None:
        self.stub.add("GET", "/health", json_body={"status": "ok"})

        result = self.client.health()

        self.assertIsInstance(result, HealthStatus)
        self.assertEqual(result.status, "ok")

    def test_get_config(self) -> None:
        self.stub.add(
            "GET", "/config", json_body={"chains": [{"name": "BNB Smart Chain", "chainId": 56}]}
        )

        config = self.client.get_config()

        self.assertIsInstance(config, ChainConfig)
        self.assertEqual(len(config.chains), 1)
        self.assertEqual(config.chains[0].name, "BNB Smart Chain")
        self.assertEqual(config.chains[0].chain_id, 56)


class MarketDataTest(ClientTestCase):
    def test_discover_maps_filters_to_query(self) -> None:
        self.stub.add("GET", "/discover", json_body=[payloads.DISCOVER_TOKEN])

        tokens = self.client.discover(
            tab="trending",
            network="bsc",
            min_marketcap=1000.5,
            min_volume=250,
            min_holders=10,
            max_age_secs=3600,
            status="bonding",
            limit=25,
        )

        request = self.stub.last_request()
        self.assertEqual(request.param("tab"), "trending")
        self.assertEqual(request.param("network"), "bsc")
        self.assertEqual(request.param("minMarketcap"), "1000.5")
        self.assertEqual(request.param("minVolume"), "250")
        self.assertEqual(request.param("minHolders"), "10")
        self.assertEqual(request.param("maxAgeSecs"), "3600")
        self.assertEqual(request.param("status"), "bonding")
        self.assertEqual(request.param("limit"), "25")

        self.assertEqual(len(tokens), 1)
        token = tokens[0]
        self.assertIsInstance(token, DiscoverToken)
        self.assertEqual(token.symbol, "PEPE")
        self.assertEqual(token.holders, 412)
        self.assertAlmostEqual(token.graduation_pct, 14.909664943648233)
        self.assertFalse(token.launched)

    def test_list_tokens(self) -> None:
        self.stub.add(
            "GET",
            "/tokens",
            json_body={"tokenList": [payloads.TOKEN], "tokenCount": 137},
        )

        page = self.client.list_tokens(order_type="marketcap", order_flag="desc", page_number=2)

        self.assertIsInstance(page, TokenPage)
        self.assertEqual(page.token_count, 137)
        token = page.token_list[0]
        self.assertIsInstance(token, Token)
        self.assertEqual(token.token_symbol, "PEPE")
        self.assertEqual(token.network, "bsc")
        # Decimal strings stay strings.
        self.assertIsInstance(token.marketcap, str)
        self.assertEqual(token.marketcap, "4472.899483094470000000")
        self.assertIsNone(token.pair_address)  # still on the curve
        self.assertTrue(token.user is not None and token.user.username == "satoshi")
        self.assertEqual(self.stub.last_request().param("orderFlag"), "desc")

    def test_get_king(self) -> None:
        graduated = dict(payloads.TOKEN, pairAddress="0xpair", launchedAt="2026-07-30T09:15:00Z")
        # The endpoint answers with a {"king": ...} envelope, not a bare Token.
        self.stub.add("GET", "/tokens/king", json_body={"king": graduated})

        king = self.client.get_king()

        self.assertIsInstance(king, Token)
        assert king is not None
        self.assertTrue(king.graduated)
        self.assertEqual(king.pair_address, "0xpair")
        self.assertEqual(king.token_symbol, "PEPE")

    def test_get_king_when_the_hill_is_empty(self) -> None:
        self.stub.add("GET", "/tokens/king", json_body={"king": None})

        self.assertIsNone(self.client.get_king())

    def test_a_bare_token_body_is_not_mistaken_for_a_king(self) -> None:
        """Guards against unwrapping the envelope by parsing the whole body."""
        self.stub.add("GET", "/tokens/king", json_body=payloads.TOKEN)

        # No "king" key: the answer is None, never a blank Token full of "".
        self.assertIsNone(self.client.get_king())

    def test_get_token_detail(self) -> None:
        self.stub.add(
            "GET",
            "/tokens/bsc/0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
            json_body=payloads.TOKEN_DETAIL,
        )

        detail = self.client.get_token(
            "bsc", "0x23a84ba5bf7bf3236491fa2b5a9807a274337135", page_number=1, page_size=50
        )

        self.assertIsInstance(detail, TokenDetail)
        self.assertEqual(detail.trades_count, 2)
        self.assertEqual(len(detail.trades), 1)
        self.assertEqual(len(detail.holders_details), 1)
        self.assertEqual(detail.holders_details[0].token_amount, "1000000.000000000000000000")
        # null curveHolding means UNKNOWN, not zero.
        self.assertIsNone(detail.curve_holding)
        self.assertEqual(self.stub.last_request().param("pageSize"), "50")


class TradesTest(ClientTestCase):
    def test_get_recent_trades(self) -> None:
        self.stub.add(
            "GET",
            "/trades/recent",
            json_body={"trades": [payloads.TRADE], "tokens": [payloads.TOKEN]},
        )

        feed = self.client.get_recent_trades(latest_trade_id=99, latest_token_id=7)

        self.assertIsInstance(feed, RecentTrades)
        self.assertEqual(len(feed.trades), 1)
        self.assertEqual(len(feed.tokens), 1)
        self.assertTrue(feed.trades[0].is_buy)
        self.assertEqual(feed.trades[0].eth_amount, "0.150000000000000000")
        request = self.stub.last_request()
        self.assertEqual(request.param("latestTradeId"), "99")
        self.assertEqual(request.param("latestTokenId"), "7")

    def test_get_token_trades(self) -> None:
        self.stub.add("POST", "/trades", json_body=[payloads.TRADE])

        trades = self.client.get_token_trades("0x23a8", limit=10, offset=20)

        self.assertEqual(len(trades), 1)
        self.assertIsInstance(trades[0], Trade)
        request = self.stub.last_request()
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.json(), {"tokenAddress": "0x23a8"})
        self.assertEqual(request.param("offset"), "20")

    def test_get_chart_data(self) -> None:
        self.stub.add("GET", "/trades/getChartData", json_body=[payloads.CANDLE])

        candles = self.client.get_chart_data(
            "0x23a8", "5", 1_753_000_000, 1_753_086_400, first=1, dex="pancake", count_back=300
        )

        self.assertEqual(len(candles), 1)
        self.assertIsInstance(candles[0], Candle)
        self.assertEqual(candles[0].time, 1_753_000_000)
        self.assertAlmostEqual(candles[0].close, 4.7e-05)
        request = self.stub.last_request()
        # `from`/`to` are Python keywords, hence from_ts/to_ts on the method.
        self.assertEqual(request.param("from"), "1753000000")
        self.assertEqual(request.param("to"), "1753086400")
        self.assertEqual(request.param("interval"), "5")
        self.assertEqual(request.param("countBack"), "300")
        self.assertEqual(request.param("dex"), "pancake")


class AnalyticsAndWalletTest(ClientTestCase):
    def test_get_token_analytics(self) -> None:
        self.stub.add("GET", "/analytics/token/bsc/0x23a8", json_body=payloads.TOKEN_ANALYTICS)

        analytics = self.client.get_token_analytics("bsc", "0x23a8")

        self.assertIsInstance(analytics, TokenAnalytics)
        self.assertEqual(analytics.holder_count, 412)
        self.assertTrue(analytics.bundle_flag)
        self.assertEqual(analytics.bundle_buyers, 3)

    def test_get_top_traders(self) -> None:
        self.stub.add("GET", "/analytics/top-traders/bsc/0x23a8", json_body=[payloads.TOP_TRADER])

        traders = self.client.get_top_traders("bsc", "0x23a8")

        self.assertEqual(len(traders), 1)
        self.assertIsInstance(traders[0], TopTrader)
        self.assertTrue(traders[0].is_creator)
        self.assertAlmostEqual(traders[0].total_pnl_usd, 1820.5)

    def test_get_wallet(self) -> None:
        self.stub.add("GET", "/wallet/0xf00d", json_body=payloads.WALLET_STATS)

        wallet = self.client.get_wallet("0xf00d")

        self.assertIsInstance(wallet, WalletStats)
        self.assertEqual(wallet.tokens_traded, 12)
        self.assertAlmostEqual(wallet.win_rate, 0.58)

    def test_get_portfolio(self) -> None:
        self.stub.add("GET", "/portfolio/0xf00d", json_body=payloads.PORTFOLIO)

        portfolio = self.client.get_portfolio("0xf00d")

        self.assertIsInstance(portfolio, Portfolio)
        self.assertEqual(len(portfolio.positions), 1)
        self.assertEqual(portfolio.positions[0].symbol, "PEPE")
        self.assertAlmostEqual(portfolio.roi_pct, 41.2)


class LeaderboardTest(ClientTestCase):
    def test_get_user_leaderboard(self) -> None:
        self.stub.add("GET", "/users/leaderboard", json_body=[payloads.LEADERBOARD_ENTRY])

        rows = self.client.get_user_leaderboard(limit=250)

        self.assertEqual(len(rows), 1)
        entry = rows[0]
        self.assertIsInstance(entry, LeaderboardEntry)
        self.assertEqual(entry.rank, 1)
        # points is the payout number; pointsTotal >= points is display only.
        self.assertAlmostEqual(entry.points, 1284.5)
        self.assertAlmostEqual(entry.points_total, 1394.5)
        self.assertAlmostEqual(entry.reward_eth, 0.0421)
        self.assertEqual(self.stub.last_request().param("limit"), "250")

    def test_get_user_profile(self) -> None:
        self.stub.add("GET", "/users/profile/0xf00d", json_body=payloads.USER_PROFILE)

        profile = self.client.get_user_profile("0xf00d")

        self.assertIsInstance(profile, UserProfile)
        self.assertTrue(profile.user is not None and profile.user.username == "satoshi")
        self.assertEqual(len(profile.holdings), 1)
        self.assertEqual(len(profile.chats), 1)
        self.assertIsNone(profile.chats[0].reply_address)
        self.assertEqual(len(profile.created_tokens), 1)
        self.assertEqual(profile.referral_count, 4)

    def test_get_top_holders(self) -> None:
        self.stub.add("GET", "/users/top/3", json_body=[payloads.TOP_HOLDER])

        holders = self.client.get_top_holders(
            3, from_ts=1_750_000_000, to_ts=1_753_000_000, network="bsc"
        )

        self.assertEqual(len(holders), 1)
        self.assertIsInstance(holders[0], TopHolderEntry)
        request = self.stub.last_request()
        self.assertEqual(request.path, "/users/top/3")
        self.assertEqual(request.param("from"), "1750000000")
        self.assertEqual(request.param("to"), "1753000000")
        self.assertEqual(request.param("network"), "bsc")

    def test_get_kings_history(self) -> None:
        self.stub.add("GET", "/kings/history", json_body=payloads.KINGS_HISTORY)

        reigns = self.client.get_kings_history()

        self.assertEqual(len(reigns), 2)
        self.assertIsInstance(reigns[0], KingReign)
        self.assertTrue(reigns[0].ongoing)
        self.assertIsNone(reigns[0].ended_at)
        self.assertEqual(reigns[1].ended_at, 1_753_003_600)

    def test_get_season(self) -> None:
        self.stub.add("GET", "/season", json_body=payloads.SEASON)

        season = self.client.get_season()

        self.assertIsInstance(season, Season)
        self.assertEqual(season.name, "Season 1")
        self.assertEqual(len(season.leaderboard), 2)
        self.assertEqual([e.rank for e in season.leaderboard], [1, 2])

    def test_get_referral_leaderboard(self) -> None:
        self.stub.add("GET", "/referrals/leaderboard", json_body=[payloads.REFERRAL_ENTRY])

        rows = self.client.get_referral_leaderboard(limit=10)

        self.assertEqual(len(rows), 1)
        self.assertIsInstance(rows[0], ReferralLeaderEntry)
        self.assertEqual(rows[0].referral_count, 9)
        self.assertEqual(self.stub.last_request().param("limit"), "10")

    def test_get_tier(self) -> None:
        self.stub.add("GET", "/tier/0xf00d", json_body=payloads.TIER)

        tier = self.client.get_tier("0xf00d")

        self.assertIsInstance(tier, TierInfo)
        self.assertEqual(tier.tier, "Silver")
        self.assertEqual(tier.next_tier, "Gold")
        self.assertAlmostEqual(tier.next_threshold_usd or 0.0, 1000.0)

    def test_get_tier_at_diamond_has_no_next_tier(self) -> None:
        self.stub.add("GET", "/tier/0xdia", json_body=payloads.TIER_DIAMOND)

        tier = self.client.get_tier("0xdia")

        self.assertEqual(tier.tier, "Diamond")
        self.assertIsNone(tier.next_tier)
        self.assertIsNone(tier.next_threshold_usd)
        self.assertAlmostEqual(tier.progress_pct, 100.0)

    def test_get_rewards(self) -> None:
        self.stub.add("GET", "/rewards/0xf00d", json_body=payloads.REWARDS)

        rewards = self.client.get_rewards("0xf00d")

        self.assertIsInstance(rewards, Rewards)
        self.assertEqual(rewards.current_streak, 4)
        self.assertEqual(len(rewards.quests), 1)
        self.assertEqual(len(rewards.achievements), 1)
        self.assertTrue(rewards.quests[0].completed)
        self.assertFalse(rewards.achievements[0].earned)


class DistributorTest(ClientTestCase):
    def test_get_stats(self) -> None:
        self.stub.add("GET", "/distributor/stats", json_body=payloads.PAYOUT_STATS)

        stats = self.client.distributor.get_stats()

        self.assertEqual(stats.total_paid_wei, "1250000000000000000")
        self.assertIsInstance(stats.total_paid_wei, str)
        self.assertEqual(stats.rounds_settled, 6)
        self.assertEqual(stats.last_round_at, 1_753_003_600)

    def test_get_stats_before_any_round_settles(self) -> None:
        self.stub.add(
            "GET",
            "/distributor/stats",
            json_body={
                "totalPaidWei": "0",
                "roundsSettled": 0,
                "uniqueRecipients": 0,
                "largestPayoutWei": "0",
                "lastRoundAt": None,
            },
        )

        stats = self.client.distributor.get_stats()

        self.assertEqual(stats.total_paid_wei, "0")
        self.assertIsNone(stats.last_round_at)

    def test_get_pot_null_fields_are_unknown_not_zero(self) -> None:
        self.stub.add("GET", "/distributor/pot", json_body=payloads.POT_UNKNOWN)

        pot = self.client.distributor.get_pot()

        self.assertIsInstance(pot, Pot)
        self.assertIsNone(pot.pot_bnb)
        self.assertIsNone(pot.total_points)
        self.assertNotEqual(pot.pot_bnb, 0)
        self.assertEqual(pot.round_end, 1_753_090_000)
        self.assertAlmostEqual(pot.distribute_bps, 9000.0)

    def test_get_pot_populated(self) -> None:
        self.stub.add("GET", "/distributor/pot", json_body=payloads.POT)

        pot = self.client.distributor.get_pot()

        self.assertAlmostEqual(pot.pot_bnb or 0.0, 3.14159)
        self.assertAlmostEqual(pot.total_points or 0.0, 98765.4)
        self.assertAlmostEqual(pot.points_per_usd, 1.0)

    def test_get_shares(self) -> None:
        self.stub.add("GET", "/distributor/shares", json_body=payloads.SHARES)

        shares = self.client.distributor.get_shares(
            from_ts=1_753_000_000, to_ts=1_753_086_400, limit=50
        )

        self.assertIsInstance(shares, Shares)
        self.assertEqual(shares.from_ts, 1_753_000_000)
        self.assertEqual(shares.to_ts, 1_753_086_400)
        self.assertEqual(len(shares.holders), 2)
        self.assertEqual(shares.holders[0].share, 2_576_980_377)
        self.assertAlmostEqual(shares.holders[0].share_fraction, 0.6, places=6)
        self.assertTrue(shares.packed.startswith("0x"))
        request = self.stub.last_request()
        self.assertEqual(request.param("from"), "1753000000")
        self.assertEqual(request.param("to"), "1753086400")
        self.assertEqual(request.param("limit"), "50")

    def test_list_rounds(self) -> None:
        self.stub.add("GET", "/distributor/rounds", json_body=[payloads.ROUND_RECEIPT])

        rounds = self.client.distributor.list_rounds(limit=10, offset=5)

        self.assertEqual(len(rounds), 1)
        receipt = rounds[0]
        self.assertIsInstance(receipt, RoundReceipt)
        self.assertEqual(receipt.round_id, 6)
        self.assertEqual(receipt.pot_wei, "1250000000000000000")
        self.assertEqual(receipt.vrf_random, "77985133986447848905248117107615823884")
        request = self.stub.last_request()
        self.assertEqual(request.param("limit"), "10")
        self.assertEqual(request.param("offset"), "5")

    def test_list_rounds_with_unindexed_settlement(self) -> None:
        pending = dict(
            payloads.ROUND_RECEIPT,
            txHash=None,
            potWei=None,
            distributedWei=None,
            winnerAddress=None,
            winnerAmountWei=None,
            holderCount=None,
            vrfRandom=None,
            distributedAt=None,
        )
        self.stub.add("GET", "/distributor/rounds", json_body=[pending])

        receipt = self.client.distributor.list_rounds()[0]

        self.assertIsNone(receipt.pot_wei)
        self.assertIsNone(receipt.distributed_wei)
        self.assertIsNone(receipt.winner_amount_wei)
        self.assertIsNone(receipt.holder_count)
        self.assertIsNone(receipt.distributed_at)

    def test_get_round_detail_is_flattened(self) -> None:
        self.stub.add("GET", "/distributor/rounds/6", json_body=payloads.ROUND_DETAIL)

        detail = self.client.distributor.get_round(6)

        self.assertIsInstance(detail, RoundDetail)
        self.assertIsInstance(detail, RoundReceipt)
        # Receipt fields sit at the top level, next to payouts.
        self.assertEqual(detail.round_id, 6)
        self.assertEqual(detail.pot_wei, "1250000000000000000")
        self.assertEqual(detail.holder_count, 2)
        self.assertEqual(len(detail.payouts), 2)
        self.assertEqual(detail.payouts[0].amount_wei, "700000000000000000")
        self.assertEqual(detail.payouts[0].round_id, 6)

    def test_get_payouts(self) -> None:
        self.stub.add("GET", "/distributor/payouts/0xf00d", json_body=payloads.ADDRESS_PAYOUTS)

        payouts = self.client.distributor.get_payouts("0xf00d")

        self.assertEqual(payouts.total_wei, "700000000000000000")
        self.assertEqual(payouts.rounds_paid, 1)
        self.assertEqual(len(payouts.payouts), 1)

    def test_get_claimable(self) -> None:
        self.stub.add("GET", "/distributor/claimable/0xf00d", json_body=payloads.CLAIMABLE)

        claimable = self.client.distributor.get_claimable("0xf00d")

        self.assertIsInstance(claimable, Claimable)
        self.assertEqual(claimable.claimable_wei, "40000000000000000")
        self.assertEqual(claimable.distributor_address, "0xd15721b0")

    def test_get_claimable_unknown_is_none(self) -> None:
        self.stub.add(
            "GET",
            "/distributor/claimable/0xf00d",
            json_body={
                "address": "0xf00d",
                "claimableWei": None,
                "distributorAddress": None,
            },
        )

        claimable = self.client.distributor.get_claimable("0xf00d")

        self.assertIsNone(claimable.claimable_wei)
        self.assertIsNone(claimable.distributor_address)


class EndpointCoverageTest(ClientTestCase):
    """Every documented endpoint is reachable and hits the right method+path."""

    def test_all_28_endpoints(self) -> None:
        calls = [
            ("GET", "/health", {}, lambda c: c.health()),
            ("GET", "/config", {}, lambda c: c.get_config()),
            ("GET", "/discover", [], lambda c: c.discover()),
            ("GET", "/tokens", {"tokenList": [], "tokenCount": 0}, lambda c: c.list_tokens()),
            ("GET", "/tokens/king", {}, lambda c: c.get_king()),
            ("GET", "/tokens/bsc/0x1", {}, lambda c: c.get_token("bsc", "0x1")),
            ("GET", "/trades/recent", {}, lambda c: c.get_recent_trades()),
            ("POST", "/trades", [], lambda c: c.get_token_trades("0x1")),
            ("GET", "/trades/getChartData", [], lambda c: c.get_chart_data("0x1", "5", 0, 1)),
            ("GET", "/analytics/token/bsc/0x1", {}, lambda c: c.get_token_analytics("bsc", "0x1")),
            (
                "GET",
                "/analytics/top-traders/bsc/0x1",
                [],
                lambda c: c.get_top_traders("bsc", "0x1"),
            ),
            ("GET", "/wallet/0x1", {}, lambda c: c.get_wallet("0x1")),
            ("GET", "/portfolio/0x1", {}, lambda c: c.get_portfolio("0x1")),
            ("GET", "/users/leaderboard", [], lambda c: c.get_user_leaderboard()),
            ("GET", "/users/profile/0x1", {}, lambda c: c.get_user_profile("0x1")),
            ("GET", "/users/top/5", [], lambda c: c.get_top_holders(5)),
            ("GET", "/kings/history", [], lambda c: c.get_kings_history()),
            ("GET", "/season", {}, lambda c: c.get_season()),
            ("GET", "/referrals/leaderboard", [], lambda c: c.get_referral_leaderboard()),
            ("GET", "/tier/0x1", {}, lambda c: c.get_tier("0x1")),
            ("GET", "/rewards/0x1", {}, lambda c: c.get_rewards("0x1")),
            ("GET", "/distributor/stats", {}, lambda c: c.distributor.get_stats()),
            ("GET", "/distributor/pot", {}, lambda c: c.distributor.get_pot()),
            ("GET", "/distributor/shares", {}, lambda c: c.distributor.get_shares()),
            ("GET", "/distributor/rounds", [], lambda c: c.distributor.list_rounds()),
            ("GET", "/distributor/rounds/6", {}, lambda c: c.distributor.get_round(6)),
            ("GET", "/distributor/payouts/0x1", {}, lambda c: c.distributor.get_payouts("0x1")),
            ("GET", "/distributor/claimable/0x1", {}, lambda c: c.distributor.get_claimable("0x1")),
        ]
        self.assertEqual(len(calls), 28)

        for method, path, body, _call in calls:
            self.stub.add(method, path, json_body=body)

        for method, path, _body, call in calls:
            with self.subTest(endpoint=f"{method} {path}"):
                call(self.client)
                request = self.stub.last_request()
                self.assertEqual(request.method, method)
                self.assertEqual(request.path, path)


if __name__ == "__main__":
    unittest.main()
