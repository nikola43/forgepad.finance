"""The synchronous Fyuz API client."""

from __future__ import annotations

import types
import urllib.request
from typing import Any, Dict, Iterator, List, Optional, Type

from ._convert import expect_object, opt_model, parse_array, parse_object
from ._http import (
    DEFAULT_BACKOFF_INITIAL,
    DEFAULT_BACKOFF_MAX,
    DEFAULT_BASE_URL,
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT,
    Transport,
    encode_path_segment,
)
from .distributor import DistributorAPI
from .models import (
    Candle,
    ChainConfig,
    DiscoverToken,
    HealthStatus,
    KingReign,
    LeaderboardEntry,
    Portfolio,
    RecentTrades,
    ReferralLeaderEntry,
    Rewards,
    Season,
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
from .trade import TradeAPI

__all__ = ["FyuzClient"]


class FyuzClient:
    """Client for the Fyuz public REST API.

    Every endpoint is unauthenticated and read-only. The client is safe to keep
    around for the lifetime of a process; it holds no connection state beyond a
    :mod:`urllib` opener.

    Args:
        base_url: API root. Defaults to ``https://api.fyuz.fun``.
        timeout: Per-request timeout in seconds. Defaults to 30.
        max_retries: Retries after the first attempt for 429/5xx/transport
            failures. ``0`` disables retrying. Defaults to 3.
        backoff_initial: Base of the exponential backoff, in seconds.
        backoff_max: Ceiling for a single computed backoff, in seconds.
        user_agent: Overrides the default ``fyuz-sdk-python/<version>``.
        opener: A pre-built :class:`urllib.request.OpenerDirector`, for proxy
            or custom-TLS setups.

    Example::

        from fyuz import FyuzClient

        with FyuzClient() as fyuz:
            for token in fyuz.discover(tab="trending", limit=10):
                # marketcap is a float here; on Token it is a decimal string
                print(token.symbol, token.marketcap, token.graduation_pct)

            detail = fyuz.get_token("bsc", "0x23a8...7135")
            print(detail.token_details.price)  # exact decimal string

    Raises:
        ValueError: if ``base_url``, ``timeout`` or the retry knobs are invalid.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_initial: float = DEFAULT_BACKOFF_INITIAL,
        backoff_max: float = DEFAULT_BACKOFF_MAX,
        user_agent: Optional[str] = None,
        opener: Optional[urllib.request.OpenerDirector] = None,
        rpc_url: Optional[str] = None,
        rpc_timeout: Optional[float] = None,
        rpc_headers: Optional[Dict[str, str]] = None,
    ) -> None:
        self._transport = Transport(
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
            backoff_initial=backoff_initial,
            backoff_max=backoff_max,
            user_agent=user_agent,
            opener=opener,
        )
        self.distributor = DistributorAPI(self._transport)
        """Distributor endpoints, grouped: ``client.distributor.get_pot()``."""

        self.trade = TradeAPI(
            self._transport,
            rpc_url=rpc_url,
            rpc_timeout=rpc_timeout,
            rpc_headers=rpc_headers,
        )
        """Bonding-curve trading: quotes and unsigned transactions.

        Builds transactions only — it never handles a key. ``rpc_url`` defaults
        to whatever ``GET /config`` publishes for the chain; that endpoint
        belongs to the API operator and is shared by every caller, so pass your
        own for anything in production.
        """

    @property
    def base_url(self) -> str:
        """The API root this client talks to."""
        return self._transport.base_url

    def close(self) -> None:
        """Release resources. Calls after this raise :class:`fyuz.FyuzError`."""
        self._transport.close()

    def __enter__(self) -> FyuzClient:
        """Enter a ``with`` block; returns ``self``."""
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[types.TracebackType],
    ) -> None:
        """Close the client on the way out of a ``with`` block."""
        self.close()

    def __repr__(self) -> str:
        """Developer-friendly representation."""
        return f"FyuzClient(base_url={self._transport.base_url!r})"

    # ------------------------------------------------------------------
    # System
    # ------------------------------------------------------------------

    def health(self) -> HealthStatus:
        """Liveness probe.

        Returns:
            The service status, ``"ok"`` when up.
        """
        return parse_object(self._transport.request("GET", "/health"), HealthStatus.from_dict)

    def get_config(self) -> ChainConfig:
        """Supported chains and their EVM chain ids.

        Returns:
            The chain configuration the frontend runs against.
        """
        return parse_object(self._transport.request("GET", "/config"), ChainConfig.from_dict)

    # ------------------------------------------------------------------
    # Market data
    # ------------------------------------------------------------------

    def discover(
        self,
        *,
        tab: Optional[str] = None,
        network: Optional[str] = None,
        min_marketcap: Optional[float] = None,
        min_volume: Optional[float] = None,
        min_holders: Optional[int] = None,
        max_age_secs: Optional[int] = None,
        status: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[DiscoverToken]:
        """Discovery feed — one dense row per token.

        The highest-signal single endpoint and the recommended entry point for
        indexers: market cap, 24h volume, buy/sell counts, holder count, price
        change and graduation progress in one call.

        Args:
            tab: Preset ordering — ``"trending"``, ``"new"``, ``"gainers"`` or
                ``"graduating"``.
            network: Chain slug, currently always ``"bsc"``.
            min_marketcap: Minimum USD market cap.
            min_volume: Minimum 24h USD volume.
            min_holders: Minimum holder count.
            max_age_secs: Only tokens created within this many seconds.
            status: ``"bonding"`` (still on the curve) or ``"graduated"``.
            limit: Rows to return. Server default 50.

        Returns:
            Matching tokens in the order the server ranked them.

        Example::

            fresh = fyuz.discover(tab="new", status="bonding", max_age_secs=3600)
        """
        params = {
            "tab": tab,
            "network": network,
            "minMarketcap": min_marketcap,
            "minVolume": min_volume,
            "minHolders": min_holders,
            "maxAgeSecs": max_age_secs,
            "status": status,
            "limit": limit,
        }
        payload = self._transport.request("GET", "/discover", params=params)
        return parse_array(payload, DiscoverToken.from_dict)

    def list_tokens(
        self,
        *,
        order_type: Optional[str] = None,
        order_flag: Optional[str] = None,
        search_word: Optional[str] = None,
        network: Optional[str] = None,
        style: Optional[str] = None,
        include_nsfw: Optional[bool] = None,
        page_number: Optional[int] = None,
        page_size: Optional[int] = None,
    ) -> TokenPage:
        """One page of the token list, with the full token record.

        Args:
            order_type: Field to sort by, e.g. ``"marketcap"``, ``"createdAt"``,
                ``"score"``.
            order_flag: ``"asc"`` or ``"desc"``.
            search_word: Free-text match on name, symbol or address.
            network: Chain slug.
            style: Exact-match filter on generated image style (``"all"`` = no
                filter).
            include_nsfw: Include tokens flagged NSFW.
            page_number: 1-based page. Server default 1.
            page_size: Rows per page. Server default 20.

        Returns:
            The page plus ``token_count``, the total number of matching rows.

        See Also:
            :meth:`iter_tokens` walks every page for you.
        """
        payload = self._transport.request(
            "GET",
            "/tokens",
            params=self._token_filters(
                order_type=order_type,
                order_flag=order_flag,
                search_word=search_word,
                network=network,
                style=style,
                include_nsfw=include_nsfw,
                page_number=page_number,
                page_size=page_size,
            ),
        )
        return parse_object(payload, TokenPage.from_dict)

    def iter_tokens(
        self,
        *,
        order_type: Optional[str] = None,
        order_flag: Optional[str] = None,
        search_word: Optional[str] = None,
        network: Optional[str] = None,
        style: Optional[str] = None,
        include_nsfw: Optional[bool] = None,
        page_size: int = 100,
        start_page: int = 1,
    ) -> Iterator[Token]:
        """Iterate every token matching a filter, walking pages lazily.

        Pages are fetched on demand, so breaking out of the loop early stops
        the requests. Iteration ends when ``token_count`` has been reached or a
        page comes back empty. A page that reports no ``token_count`` at all is
        treated as unbounded — paging then runs until an empty page, rather
        than silently truncating after the first one.

        Args:
            order_type: Field to sort by.
            order_flag: ``"asc"`` or ``"desc"``.
            search_word: Free-text match on name, symbol or address.
            network: Chain slug.
            style: Image-style filter.
            include_nsfw: Include tokens flagged NSFW.
            page_size: Rows per request. Larger pages mean fewer round trips.
            start_page: 1-based page to start from.

        Yields:
            Every matching :class:`~fyuz.Token`, in server order.

        Example::

            graduated = [t for t in fyuz.iter_tokens(order_type="marketcap")
                         if t.graduated]
        """
        if page_size < 1:
            raise ValueError(f"page_size must be >= 1, got {page_size!r}")
        if start_page < 1:
            raise ValueError(f"start_page must be >= 1, got {start_page!r}")

        page_number = start_page
        seen = 0
        while True:
            page = self.list_tokens(
                order_type=order_type,
                order_flag=order_flag,
                search_word=search_word,
                network=network,
                style=style,
                include_nsfw=include_nsfw,
                page_number=page_number,
                page_size=page_size,
            )
            if not page.token_list:
                return
            yield from page.token_list
            seen += len(page.token_list)
            # `token_count` falls back to 0 when the key is missing (the rule
            # every model here follows). Trusting that 0 would stop iteration
            # dead on the first non-empty page and silently lose every later
            # row, so an absent count means "keep going until a page is empty"
            # — a genuinely empty result set has already returned above.
            if page.token_count > 0 and seen >= page.token_count:
                return
            page_number += 1

    def get_king(self) -> Optional[Token]:
        """The current king of the hill.

        King of the Hill is a bonding-curve race: a token leaves the hill the
        moment it graduates, so the crown can be vacant.

        Returns:
            The leading token right now, or ``None`` when no token is on the
            hill. The endpoint answers with a ``{"king": ...}`` envelope; this
            unwraps it.

        Example::

            king = fyuz.get_king()
            if king is not None:
                print(king.token_symbol, king.marketcap)
        """
        payload = expect_object(self._transport.request("GET", "/tokens/king"))
        return opt_model(payload, "king", Token.from_dict)

    def get_token(
        self,
        network: str,
        token_address: str,
        *,
        page_number: Optional[int] = None,
        page_size: Optional[int] = None,
    ) -> TokenDetail:
        """Full token record plus recent trades and holder distribution.

        Args:
            network: Chain slug, e.g. ``"bsc"``.
            token_address: ERC-20 contract address.
            page_number: 1-based page of the embedded trade list.
            page_size: Trades per page.

        Returns:
            The token detail. ``curve_holding`` is ``None`` when the on-chain
            read failed — that means *unknown*, not zero.

        Raises:
            FyuzNotFoundError: no such token on that network.
        """
        path = f"/tokens/{encode_path_segment(network)}/{encode_path_segment(token_address)}"
        payload = self._transport.request(
            "GET", path, params={"pageNumber": page_number, "pageSize": page_size}
        )
        return parse_object(payload, TokenDetail.from_dict)

    # ------------------------------------------------------------------
    # Trades
    # ------------------------------------------------------------------

    def get_recent_trades(
        self,
        *,
        latest_trade_id: Optional[int] = None,
        latest_token_id: Optional[int] = None,
    ) -> RecentTrades:
        """Platform-wide trade feed, with the tokens those trades reference.

        Args:
            latest_trade_id: Return only trades with an id greater than this.
                Pass the highest id you already hold to poll incrementally.
            latest_token_id: Same idea for the token records.

        Returns:
            Trades and tokens.
        """
        payload = self._transport.request(
            "GET",
            "/trades/recent",
            params={"latestTradeId": latest_trade_id, "latestTokenId": latest_token_id},
        )
        return parse_object(payload, RecentTrades.from_dict)

    def get_token_trades(
        self,
        token_address: str,
        *,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> List[Trade]:
        """Trade history for a single token, newest first.

        This is a ``POST`` only because the token address travels in the body;
        it is unauthenticated, read-only and safe to poll.

        Args:
            token_address: ERC-20 contract address.
            limit: Rows to return. Server default 50.
            offset: Rows to skip. Server default 0.

        Returns:
            The token's trades.
        """
        payload = self._transport.request(
            "POST",
            "/trades",
            params={"limit": limit, "offset": offset},
            json_body={"tokenAddress": token_address},
        )
        return parse_array(payload, Trade.from_dict)

    def get_chart_data(
        self,
        token_address: str,
        interval: str,
        from_ts: int,
        to_ts: int,
        *,
        first: Optional[int] = None,
        dex: Optional[str] = None,
        count_back: Optional[int] = None,
    ) -> List[Candle]:
        """OHLCV candles, shaped for TradingView-style charting libraries.

        Args:
            token_address: ERC-20 contract address.
            interval: Candle width, e.g. ``"1"``, ``"5"``, ``"60"``, ``"1D"``
                (minutes unless suffixed).
            from_ts: Range start, UNIX seconds (``from`` on the wire).
            to_ts: Range end, UNIX seconds (``to`` on the wire).
            first: Whether this is the first request of a chart session.
            dex: Restrict to a specific DEX source.
            count_back: Number of candles to return ending at ``to_ts``.

        Returns:
            Candles, oldest first.

        Example::

            import time
            now = int(time.time())
            candles = fyuz.get_chart_data("0x23a8...7135", "5", now - 86400, now)
        """
        payload = self._transport.request(
            "GET",
            "/trades/getChartData",
            params={
                "tokenAddress": token_address,
                "interval": interval,
                "from": from_ts,
                "to": to_ts,
                "first": first,
                "dex": dex,
                "countBack": count_back,
            },
        )
        return parse_array(payload, Candle.from_dict)

    # ------------------------------------------------------------------
    # Analytics
    # ------------------------------------------------------------------

    def get_token_analytics(self, network: str, address: str) -> TokenAnalytics:
        """Holder concentration, buy/sell split and bundle-buyer detection.

        Args:
            network: Chain slug.
            address: ERC-20 contract address.

        Returns:
            Analytics for the token.

        Raises:
            FyuzNotFoundError: no such token on that network.
        """
        path = f"/analytics/token/{encode_path_segment(network)}/{encode_path_segment(address)}"
        return parse_object(self._transport.request("GET", path), TokenAnalytics.from_dict)

    def get_top_traders(self, network: str, address: str) -> List[TopTrader]:
        """Top traders of a token, ranked by total PnL, creator flagged.

        Args:
            network: Chain slug.
            address: ERC-20 contract address.

        Returns:
            Traders, best PnL first.
        """
        path = (
            f"/analytics/top-traders/{encode_path_segment(network)}/{encode_path_segment(address)}"
        )
        return parse_array(self._transport.request("GET", path), TopTrader.from_dict)

    # ------------------------------------------------------------------
    # Wallets
    # ------------------------------------------------------------------

    def get_wallet(self, address: str) -> WalletStats:
        """Average-cost PnL rolled up across every token a wallet has traded.

        Args:
            address: Wallet address.

        Returns:
            Wallet statistics including win rate, volume and holding value.
        """
        path = f"/wallet/{encode_path_segment(address)}"
        return parse_object(self._transport.request("GET", path), WalletStats.from_dict)

    def get_portfolio(self, address: str) -> Portfolio:
        """Current holdings and live PnL for an address.

        Args:
            address: Wallet address.

        Returns:
            Positions plus totals. An address with no trades returns zeroed
            totals and an empty ``positions`` tuple rather than a 404.
        """
        path = f"/portfolio/{encode_path_segment(address)}"
        return parse_object(self._transport.request("GET", path), Portfolio.from_dict)

    # ------------------------------------------------------------------
    # Leaderboards
    # ------------------------------------------------------------------

    def get_user_leaderboard(self, *, limit: Optional[int] = None) -> List[LeaderboardEntry]:
        """Global points leaderboard for the current round window.

        The board resets after every Distributor payout: only activity since
        the last settled round counts. ``rank`` is server-assigned — do not
        re-sort.

        Args:
            limit: Rows to return, clamped server-side to 1-500. Default 100.

        Returns:
            Ranked users, highest projected points first.
        """
        payload = self._transport.request("GET", "/users/leaderboard", params={"limit": limit})
        return parse_array(payload, LeaderboardEntry.from_dict)

    def get_user_profile(self, address: str) -> UserProfile:
        """Public profile: identity, holdings, comments and launched tokens.

        Args:
            address: Wallet address.

        Returns:
            The profile.

        Raises:
            FyuzNotFoundError: the address has no profile.
        """
        path = f"/users/profile/{encode_path_segment(address)}"
        return parse_object(self._transport.request("GET", path), UserProfile.from_dict)

    def get_top_holders(
        self,
        count: int,
        *,
        from_ts: Optional[int] = None,
        to_ts: Optional[int] = None,
        network: Optional[str] = None,
    ) -> List[TopHolderEntry]:
        """Top wallets by USD trading volume over a window.

        Args:
            count: Rows to return.
            from_ts: Window start, UNIX seconds (``from`` on the wire).
                Defaults to 0 server-side.
            to_ts: Window end, UNIX seconds (``to`` on the wire). Defaults to
                unbounded.
            network: Only count volume on this chain.

        Returns:
            Wallets, highest volume first.
        """
        path = f"/users/top/{encode_path_segment(count)}"
        payload = self._transport.request(
            "GET", path, params={"from": from_ts, "to": to_ts, "network": network}
        )
        return parse_array(payload, TopHolderEntry.from_dict)

    def get_kings_history(self) -> List[KingReign]:
        """Past king-of-the-hill reigns, most recent first (max 100).

        Returns:
            Reigns. ``ended_at`` is ``None`` for the reign still running.
        """
        payload = self._transport.request("GET", "/kings/history")
        return parse_array(payload, KingReign.from_dict)

    def get_season(self) -> Season:
        """Current season window, prize pot and standings.

        Returns:
            Season metadata plus the top 50 with positive points.
        """
        return parse_object(self._transport.request("GET", "/season"), Season.from_dict)

    def get_referral_leaderboard(self, *, limit: Optional[int] = None) -> List[ReferralLeaderEntry]:
        """Referral leaderboard. Only ACTIVE referrals count.

        Args:
            limit: Rows to return, clamped server-side to 1-500. Default 100.

        Returns:
            Top referrers, most active referrals first.
        """
        payload = self._transport.request("GET", "/referrals/leaderboard", params={"limit": limit})
        return parse_array(payload, ReferralLeaderEntry.from_dict)

    def get_tier(self, address: str) -> TierInfo:
        """Display-only trader tier derived from lifetime USD volume.

        Args:
            address: Wallet address.

        Returns:
            Tier and progress toward the next one.
        """
        path = f"/tier/{encode_path_segment(address)}"
        return parse_object(self._transport.request("GET", path), TierInfo.from_dict)

    def get_rewards(self, address: str) -> Rewards:
        """Rewards ledger: streaks, points, quests and achievements.

        Read-only: rewards are granted automatically by the indexer as they are
        earned, so there is no claim step.

        Args:
            address: Wallet address.

        Returns:
            The rewards ledger.
        """
        path = f"/rewards/{encode_path_segment(address)}"
        return parse_object(self._transport.request("GET", path), Rewards.from_dict)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @staticmethod
    def _token_filters(
        *,
        order_type: Optional[str],
        order_flag: Optional[str],
        search_word: Optional[str],
        network: Optional[str],
        style: Optional[str],
        include_nsfw: Optional[bool],
        page_number: Optional[int],
        page_size: Optional[int],
    ) -> Dict[str, Any]:
        """Build the ``/tokens`` query string, shared by list and iterate."""
        return {
            "orderType": order_type,
            "orderFlag": order_flag,
            "searchWord": search_word,
            "network": network,
            "style": style,
            "includeNsfw": include_nsfw,
            "pageNumber": page_number,
            "pageSize": page_size,
        }
