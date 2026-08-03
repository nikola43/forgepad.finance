//! Market data: service metadata, tokens, trades, candles and analytics.

use serde_json::json;

use crate::client::{seg, FyuzClient, QueryPairs};
use crate::error::Result;
use crate::models::{
    Candle, ChainConfig, DiscoverToken, HealthStatus, KingResponse, RecentTrades, Token,
    TokenAnalytics, TokenDetail, TokenPage, TopTrader, Trade,
};
use crate::pagination::TokenPager;
use crate::params::{
    ChartDataParams, DiscoverParams, ListTokensParams, RecentTradesParams, ToQuery,
    TokenDetailParams, TokenTradesParams,
};

impl FyuzClient {
    /// `GET /health` — liveness probe.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// assert_eq!(client.health().await?.status, "ok");
    /// # Ok(())
    /// # }
    /// ```
    pub async fn health(&self) -> Result<HealthStatus> {
        self.get_json("/health", QueryPairs::new()).await
    }

    /// `GET /config` — the chains this deployment serves.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// for chain in client.get_config().await?.chains {
    ///     println!("{} (chain id {})", chain.name, chain.chain_id);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_config(&self) -> Result<ChainConfig> {
        self.get_json("/config", QueryPairs::new()).await
    }

    /// `GET /discover` — the discovery feed, and the best single endpoint for
    /// bulk market-data ingestion.
    ///
    /// One row per token with market cap, 24h volume, buy/sell counts, holder
    /// count, price change and graduation progress.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// use fyuz::{DiscoverParams, DiscoverTab};
    ///
    /// let client = fyuz::FyuzClient::new()?;
    /// let almost_there = client
    ///     .discover(&DiscoverParams::new().tab(DiscoverTab::Graduating).limit(20))
    ///     .await?;
    ///
    /// for token in &almost_there {
    ///     println!("{:<8} {:>6.2}% of the way to a PancakeSwap pair", token.symbol, token.graduation_pct);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn discover(&self, params: &DiscoverParams) -> Result<Vec<DiscoverToken>> {
        self.get_json("/discover", params.to_query()).await
    }

    /// `GET /tokens` — one page of the token list.
    ///
    /// Use [`token_pages`](Self::token_pages) to walk every page instead of
    /// paging by hand.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// use fyuz::{ListTokensParams, SortDirection};
    ///
    /// let client = fyuz::FyuzClient::new()?;
    /// let page = client
    ///     .list_tokens(
    ///         &ListTokensParams::new()
    ///             .order_type("marketcap")
    ///             .order_flag(SortDirection::Desc)
    ///             .page_size(50),
    ///     )
    ///     .await?;
    ///
    /// println!("{} of {} tokens", page.token_list.len(), page.token_count);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn list_tokens(&self, params: &ListTokensParams) -> Result<TokenPage> {
        self.get_json("/tokens", params.to_query()).await
    }

    /// Walk every page of `GET /tokens`.
    ///
    /// The returned [`TokenPager`] issues one request per page and stops when
    /// the server's `tokenCount` is covered.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// use fyuz::ListTokensParams;
    ///
    /// let client = fyuz::FyuzClient::new()?;
    /// let mut pager = client.token_pages(&ListTokensParams::new().page_size(100));
    ///
    /// while let Some(token) = pager.next_token().await? {
    ///     println!("{} {}", token.token_symbol, token.marketcap);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub fn token_pages(&self, params: &ListTokensParams) -> TokenPager {
        TokenPager::new(self.clone(), params.clone())
    }

    /// `GET /tokens/king` — the current king of the hill: the
    /// highest-market-cap token still on the bonding curve.
    ///
    /// `None` means the hill is empty, which is a real state rather than an
    /// error: a token leaves the moment it graduates, so between a graduation
    /// and the next launch there is no king.
    ///
    /// The API wraps the token in a `{"king": …}` envelope; it is unwrapped
    /// here.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// match client.get_king().await? {
    ///     Some(king) => println!("{} at ${}", king.token_name, king.marketcap),
    ///     None => println!("no king right now"),
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_king(&self) -> Result<Option<Token>> {
        let body: KingResponse = self.get_json("/tokens/king", QueryPairs::new()).await?;
        Ok(body.king)
    }

    /// `GET /tokens/{network}/{tokenAddress}` — full token record plus recent
    /// trades, holders, 15-minute price and 1-day liquidity.
    ///
    /// `curve_holding` is `None` when the on-chain read failed. That means
    /// **unknown**, not zero — do not render it as `0`.
    ///
    /// Answers `404` for an unknown token; check with
    /// [`Error::is_not_found`](crate::Error::is_not_found).
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// use fyuz::TokenDetailParams;
    ///
    /// let client = fyuz::FyuzClient::new()?;
    /// let detail = client
    ///     .get_token("bsc", "0x23a84ba5bf7bf3236491fa2b5a9807a274337135", &TokenDetailParams::new())
    ///     .await?;
    ///
    /// let graduated = detail.token_details.pair_address.is_some();
    /// println!("graduated: {graduated}, {} trades", detail.trades_count);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_token(
        &self,
        network: &str,
        token_address: &str,
        params: &TokenDetailParams,
    ) -> Result<TokenDetail> {
        self.get_json(
            &format!("/tokens/{}/{}", seg(network), seg(token_address)),
            params.to_query(),
        )
            .await
    }

    /// `GET /trades/recent` — the platform-wide trade feed.
    ///
    /// Pass the highest [`Trade::id`] you have already seen as
    /// [`RecentTradesParams::latest_trade_id`] to poll incrementally.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// use fyuz::RecentTradesParams;
    ///
    /// let client = fyuz::FyuzClient::new()?;
    /// let mut cursor = 0i64;
    ///
    /// let feed = client
    ///     .get_recent_trades(&RecentTradesParams::new().latest_trade_id(cursor))
    ///     .await?;
    ///
    /// if let Some(newest) = feed.trades.first() {
    ///     cursor = newest.id;
    /// }
    /// # let _ = cursor;
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_recent_trades(&self, params: &RecentTradesParams) -> Result<RecentTrades> {
        self.get_json("/trades/recent", params.to_query()).await
    }

    /// `POST /trades` — one token's trade history, newest first.
    ///
    /// This is a `POST` only because the token address travels in the body; it
    /// is a read, it changes nothing, and it needs no authentication.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// use fyuz::TokenTradesParams;
    ///
    /// let client = fyuz::FyuzClient::new()?;
    /// let trades = client
    ///     .get_token_trades(
    ///         "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
    ///         &TokenTradesParams::new().limit(100),
    ///     )
    ///     .await?;
    ///
    /// for trade in &trades {
    ///     // eth_amount is a decimal string: keep it as one.
    ///     println!("{} {} BNB", trade.trade_side, trade.eth_amount);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_token_trades(
        &self,
        token_address: &str,
        params: &TokenTradesParams,
    ) -> Result<Vec<Trade>> {
        self.post_json(
            "/trades",
            params.to_query(),
            json!({ "tokenAddress": token_address }),
        )
        .await
    }

    /// `GET /trades/getChartData` — OHLCV candles, shaped for TradingView-style
    /// charting libraries.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// use fyuz::ChartDataParams;
    ///
    /// let client = fyuz::FyuzClient::new()?;
    /// let candles = client
    ///     .get_chart_data(&ChartDataParams::new(
    ///         "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
    ///         "5",
    ///         1_750_000_000,
    ///         1_750_086_400,
    ///     ))
    ///     .await?;
    ///
    /// println!("{} candles", candles.len());
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_chart_data(&self, params: &ChartDataParams) -> Result<Vec<Candle>> {
        self.get_json("/trades/getChartData", params.to_query()).await
    }

    /// `GET /analytics/token/{network}/{address}` — holder concentration,
    /// buy/sell split, volume, graduation progress and bundle-buyer detection.
    ///
    /// Answers `404` for an unknown token.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let a = client
    ///     .get_token_analytics("bsc", "0x23a84ba5bf7bf3236491fa2b5a9807a274337135")
    ///     .await?;
    ///
    /// if a.bundle_flag {
    ///     println!("{} addresses bought in the launch block", a.bundle_buyers);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_token_analytics(
        &self,
        network: &str,
        address: &str,
    ) -> Result<TokenAnalytics> {
        self.get_json(
            &format!("/analytics/token/{}/{}", seg(network), seg(address)),
            QueryPairs::new(),
        )
        .await
    }

    /// `GET /analytics/top-traders/{network}/{address}` — a token's most
    /// profitable traders, with the creator flagged.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let traders = client
    ///     .get_top_traders("bsc", "0x23a84ba5bf7bf3236491fa2b5a9807a274337135")
    ///     .await?;
    ///
    /// for t in traders.iter().take(5) {
    ///     println!("{} {:+.2} USD", t.address, t.total_pnl_usd);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_top_traders(&self, network: &str, address: &str) -> Result<Vec<TopTrader>> {
        self.get_json(
            &format!("/analytics/top-traders/{}/{}", seg(network), seg(address)),
            QueryPairs::new(),
        )
        .await
    }
}
