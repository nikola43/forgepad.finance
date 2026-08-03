//! Optional query parameters, one struct per endpoint that takes them.
//!
//! Every struct implements [`Default`] and has chainable setters, so only the
//! parameters you care about appear at the call site:
//!
//! ```
//! use fyuz::{DiscoverParams, DiscoverTab, TokenStatus};
//!
//! let params = DiscoverParams::new()
//!     .tab(DiscoverTab::Graduating)
//!     .status(TokenStatus::Bonding)
//!     .min_holders(25)
//!     .limit(100);
//! # let _ = params;
//! ```
//!
//! Parameters left unset are simply not sent, and the server applies its own
//! documented default.

use crate::client::QueryPairs;

/// Turns a parameter struct into query-string pairs.
pub(crate) trait ToQuery {
    fn to_query(&self) -> QueryPairs;
}

/// Push `name=value` when `value` is set.
fn push<T: ToString>(pairs: &mut QueryPairs, name: &'static str, value: &Option<T>) {
    if let Some(value) = value {
        pairs.push((name, value.to_string()));
    }
}

/// Preset ordering for the discovery feed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoverTab {
    /// Highest recent activity first.
    Trending,
    /// Newest launches first.
    New,
    /// Largest 24h price gains first.
    Gainers,
    /// Closest to the $30,000 graduation threshold first.
    Graduating,
}

impl DiscoverTab {
    /// The wire value.
    pub fn as_str(self) -> &'static str {
        match self {
            DiscoverTab::Trending => "trending",
            DiscoverTab::New => "new",
            DiscoverTab::Gainers => "gainers",
            DiscoverTab::Graduating => "graduating",
        }
    }
}

impl std::fmt::Display for DiscoverTab {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Bonding-curve lifecycle filter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenStatus {
    /// Still on the bonding curve — no DEX pool exists yet.
    Bonding,
    /// Graduated into a PancakeSwap pair.
    Graduated,
}

impl TokenStatus {
    /// The wire value.
    pub fn as_str(self) -> &'static str {
        match self {
            TokenStatus::Bonding => "bonding",
            TokenStatus::Graduated => "graduated",
        }
    }
}

impl std::fmt::Display for TokenStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Sort direction for [`ListTokensParams::order_flag`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortDirection {
    /// Ascending.
    Asc,
    /// Descending.
    Desc,
}

impl SortDirection {
    /// The wire value.
    pub fn as_str(self) -> &'static str {
        match self {
            SortDirection::Asc => "asc",
            SortDirection::Desc => "desc",
        }
    }
}

impl std::fmt::Display for SortDirection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Filters for [`FyuzClient::discover`](crate::FyuzClient::discover).
#[derive(Debug, Clone, Default)]
pub struct DiscoverParams {
    /// Preset ordering.
    pub tab: Option<DiscoverTab>,
    /// Chain slug, e.g. `"bsc"`.
    pub network: Option<String>,
    /// Minimum USD market cap.
    pub min_marketcap: Option<f64>,
    /// Minimum USD 24h volume.
    pub min_volume: Option<f64>,
    /// Minimum holder count.
    pub min_holders: Option<i64>,
    /// Only tokens created within this many seconds.
    pub max_age_secs: Option<i64>,
    /// Bonding-curve lifecycle filter.
    pub status: Option<TokenStatus>,
    /// Rows to return. Server default 50.
    pub limit: Option<i64>,
}

impl DiscoverParams {
    /// No filters.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the preset ordering.
    pub fn tab(mut self, tab: DiscoverTab) -> Self {
        self.tab = Some(tab);
        self
    }

    /// Restrict to one chain.
    pub fn network(mut self, network: impl Into<String>) -> Self {
        self.network = Some(network.into());
        self
    }

    /// Set the minimum USD market cap.
    pub fn min_marketcap(mut self, min_marketcap: f64) -> Self {
        self.min_marketcap = Some(min_marketcap);
        self
    }

    /// Set the minimum USD 24h volume.
    pub fn min_volume(mut self, min_volume: f64) -> Self {
        self.min_volume = Some(min_volume);
        self
    }

    /// Set the minimum holder count.
    pub fn min_holders(mut self, min_holders: i64) -> Self {
        self.min_holders = Some(min_holders);
        self
    }

    /// Only return tokens created within this many seconds.
    pub fn max_age_secs(mut self, max_age_secs: i64) -> Self {
        self.max_age_secs = Some(max_age_secs);
        self
    }

    /// Filter by bonding-curve lifecycle.
    pub fn status(mut self, status: TokenStatus) -> Self {
        self.status = Some(status);
        self
    }

    /// Set the row limit.
    pub fn limit(mut self, limit: i64) -> Self {
        self.limit = Some(limit);
        self
    }
}

impl ToQuery for DiscoverParams {
    fn to_query(&self) -> QueryPairs {
        let mut pairs = QueryPairs::new();
        push(&mut pairs, "tab", &self.tab.map(|t| t.as_str()));
        push(&mut pairs, "network", &self.network);
        push(&mut pairs, "minMarketcap", &self.min_marketcap);
        push(&mut pairs, "minVolume", &self.min_volume);
        push(&mut pairs, "minHolders", &self.min_holders);
        push(&mut pairs, "maxAgeSecs", &self.max_age_secs);
        push(&mut pairs, "status", &self.status.map(|s| s.as_str()));
        push(&mut pairs, "limit", &self.limit);
        pairs
    }
}

/// Filters, sorting and paging for
/// [`FyuzClient::list_tokens`](crate::FyuzClient::list_tokens).
#[derive(Debug, Clone, Default)]
pub struct ListTokensParams {
    /// Field to sort by, e.g. `marketcap`, `createdAt`, `score`.
    pub order_type: Option<String>,
    /// Sort direction.
    pub order_flag: Option<SortDirection>,
    /// Free-text match on name, symbol or address.
    pub search_word: Option<String>,
    /// Chain slug.
    pub network: Option<String>,
    /// Exact-match filter on generated image style (`all` = no filter).
    pub style: Option<String>,
    /// Include tokens flagged NSFW.
    pub include_nsfw: Option<bool>,
    /// 1-based page number. Server default 1.
    pub page_number: Option<i64>,
    /// Rows per page. Server default 20.
    pub page_size: Option<i64>,
}

impl ListTokensParams {
    /// No filters.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sort by this field.
    pub fn order_type(mut self, order_type: impl Into<String>) -> Self {
        self.order_type = Some(order_type.into());
        self
    }

    /// Sort in this direction.
    pub fn order_flag(mut self, order_flag: SortDirection) -> Self {
        self.order_flag = Some(order_flag);
        self
    }

    /// Free-text search on name, symbol or address.
    pub fn search_word(mut self, search_word: impl Into<String>) -> Self {
        self.search_word = Some(search_word.into());
        self
    }

    /// Restrict to one chain.
    pub fn network(mut self, network: impl Into<String>) -> Self {
        self.network = Some(network.into());
        self
    }

    /// Filter by generated image style.
    pub fn style(mut self, style: impl Into<String>) -> Self {
        self.style = Some(style.into());
        self
    }

    /// Include NSFW-flagged tokens.
    pub fn include_nsfw(mut self, include_nsfw: bool) -> Self {
        self.include_nsfw = Some(include_nsfw);
        self
    }

    /// Request a specific 1-based page.
    pub fn page_number(mut self, page_number: i64) -> Self {
        self.page_number = Some(page_number);
        self
    }

    /// Set the page size.
    pub fn page_size(mut self, page_size: i64) -> Self {
        self.page_size = Some(page_size);
        self
    }
}

impl ToQuery for ListTokensParams {
    fn to_query(&self) -> QueryPairs {
        let mut pairs = QueryPairs::new();
        push(&mut pairs, "orderType", &self.order_type);
        push(&mut pairs, "orderFlag", &self.order_flag.map(|f| f.as_str()));
        push(&mut pairs, "searchWord", &self.search_word);
        push(&mut pairs, "network", &self.network);
        push(&mut pairs, "style", &self.style);
        push(&mut pairs, "includeNsfw", &self.include_nsfw);
        push(&mut pairs, "pageNumber", &self.page_number);
        push(&mut pairs, "pageSize", &self.page_size);
        pairs
    }
}

/// Paging of the trade list embedded in
/// [`FyuzClient::get_token`](crate::FyuzClient::get_token).
#[derive(Debug, Clone, Default)]
pub struct TokenDetailParams {
    /// 1-based page number for the embedded trades. Server default 1.
    pub page_number: Option<i64>,
    /// Rows per page. Server default 20.
    pub page_size: Option<i64>,
}

impl TokenDetailParams {
    /// Server defaults.
    pub fn new() -> Self {
        Self::default()
    }

    /// Request a specific 1-based page of trades.
    pub fn page_number(mut self, page_number: i64) -> Self {
        self.page_number = Some(page_number);
        self
    }

    /// Set the trade page size.
    pub fn page_size(mut self, page_size: i64) -> Self {
        self.page_size = Some(page_size);
        self
    }
}

impl ToQuery for TokenDetailParams {
    fn to_query(&self) -> QueryPairs {
        let mut pairs = QueryPairs::new();
        push(&mut pairs, "pageNumber", &self.page_number);
        push(&mut pairs, "pageSize", &self.page_size);
        pairs
    }
}

/// Incremental polling cursor for
/// [`FyuzClient::get_recent_trades`](crate::FyuzClient::get_recent_trades).
#[derive(Debug, Clone, Default)]
pub struct RecentTradesParams {
    /// Return only trades with an id greater than this.
    pub latest_trade_id: Option<i64>,
    /// Return only tokens with an id greater than this.
    pub latest_token_id: Option<i64>,
}

impl RecentTradesParams {
    /// No cursor — the newest page.
    pub fn new() -> Self {
        Self::default()
    }

    /// Only trades newer than this id.
    pub fn latest_trade_id(mut self, latest_trade_id: i64) -> Self {
        self.latest_trade_id = Some(latest_trade_id);
        self
    }

    /// Only tokens newer than this id.
    pub fn latest_token_id(mut self, latest_token_id: i64) -> Self {
        self.latest_token_id = Some(latest_token_id);
        self
    }
}

impl ToQuery for RecentTradesParams {
    fn to_query(&self) -> QueryPairs {
        let mut pairs = QueryPairs::new();
        push(&mut pairs, "latestTradeId", &self.latest_trade_id);
        push(&mut pairs, "latestTokenId", &self.latest_token_id);
        pairs
    }
}

/// Paging for
/// [`FyuzClient::get_token_trades`](crate::FyuzClient::get_token_trades).
#[derive(Debug, Clone, Default)]
pub struct TokenTradesParams {
    /// Rows to return. Server default 50.
    pub limit: Option<i64>,
    /// Rows to skip. Server default 0.
    pub offset: Option<i64>,
}

impl TokenTradesParams {
    /// Server defaults.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the row limit.
    pub fn limit(mut self, limit: i64) -> Self {
        self.limit = Some(limit);
        self
    }

    /// Set the row offset.
    pub fn offset(mut self, offset: i64) -> Self {
        self.offset = Some(offset);
        self
    }
}

impl ToQuery for TokenTradesParams {
    fn to_query(&self) -> QueryPairs {
        let mut pairs = QueryPairs::new();
        push(&mut pairs, "limit", &self.limit);
        push(&mut pairs, "offset", &self.offset);
        pairs
    }
}

/// Arguments for
/// [`FyuzClient::get_chart_data`](crate::FyuzClient::get_chart_data).
///
/// `token_address`, `interval`, `from` and `to` are required by the API, so they
/// are constructor arguments rather than setters.
#[derive(Debug, Clone)]
pub struct ChartDataParams {
    /// Token contract address.
    pub token_address: String,
    /// Candle width, e.g. `1`, `5`, `15`, `60`, `1D` (minutes unless suffixed).
    pub interval: String,
    /// Range start, UNIX seconds.
    pub from: i64,
    /// Range end, UNIX seconds.
    pub to: i64,
    /// Whether this is the first page of a chart load.
    pub first: Option<i64>,
    /// DEX to read candles from, once the token has graduated.
    pub dex: Option<String>,
    /// Number of candles to return ending at [`to`](Self::to).
    pub count_back: Option<i64>,
}

impl ChartDataParams {
    /// The four required arguments.
    pub fn new(token_address: impl Into<String>, interval: impl Into<String>, from: i64, to: i64) -> Self {
        Self {
            token_address: token_address.into(),
            interval: interval.into(),
            from,
            to,
            first: None,
            dex: None,
            count_back: None,
        }
    }

    /// Mark this as the first page of a chart load.
    pub fn first(mut self, first: i64) -> Self {
        self.first = Some(first);
        self
    }

    /// Read candles from a specific DEX.
    pub fn dex(mut self, dex: impl Into<String>) -> Self {
        self.dex = Some(dex.into());
        self
    }

    /// Return this many candles ending at [`to`](Self::to).
    pub fn count_back(mut self, count_back: i64) -> Self {
        self.count_back = Some(count_back);
        self
    }
}

impl ToQuery for ChartDataParams {
    fn to_query(&self) -> QueryPairs {
        let mut pairs: QueryPairs = vec![
            ("tokenAddress", self.token_address.clone()),
            ("interval", self.interval.clone()),
            ("from", self.from.to_string()),
            ("to", self.to.to_string()),
        ];
        push(&mut pairs, "first", &self.first);
        push(&mut pairs, "dex", &self.dex);
        push(&mut pairs, "countBack", &self.count_back);
        pairs
    }
}

/// Window and chain filter for
/// [`FyuzClient::get_top_holders`](crate::FyuzClient::get_top_holders).
#[derive(Debug, Clone, Default)]
pub struct TopHoldersParams {
    /// Window start, UNIX seconds. Server default 0.
    pub from: Option<i64>,
    /// Window end, UNIX seconds. Defaults to unbounded.
    pub to: Option<i64>,
    /// Only count volume on this chain.
    pub network: Option<String>,
}

impl TopHoldersParams {
    /// All time, all chains.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the window start, UNIX seconds.
    pub fn from(mut self, from: i64) -> Self {
        self.from = Some(from);
        self
    }

    /// Set the window end, UNIX seconds.
    pub fn to(mut self, to: i64) -> Self {
        self.to = Some(to);
        self
    }

    /// Restrict to one chain.
    pub fn network(mut self, network: impl Into<String>) -> Self {
        self.network = Some(network.into());
        self
    }
}

impl ToQuery for TopHoldersParams {
    fn to_query(&self) -> QueryPairs {
        let mut pairs = QueryPairs::new();
        push(&mut pairs, "from", &self.from);
        push(&mut pairs, "to", &self.to);
        push(&mut pairs, "network", &self.network);
        pairs
    }
}

/// Window and size for
/// [`Distributor::get_shares`](crate::Distributor::get_shares).
#[derive(Debug, Clone, Default)]
pub struct SharesParams {
    /// Window start, UNIX seconds. Defaults to the end of the last paid round.
    pub from: Option<i64>,
    /// Window end, UNIX seconds. Defaults to now. Must be after
    /// [`from`](Self::from) or the API answers 400.
    pub to: Option<i64>,
    /// Max holders, top-N by points. Clamped by the server to 1-100 (the
    /// contract's `MAX_HOLDERS`). Server default 100.
    pub limit: Option<i64>,
}

impl SharesParams {
    /// Server defaults: the live window, 100 holders.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the window start, UNIX seconds.
    pub fn from(mut self, from: i64) -> Self {
        self.from = Some(from);
        self
    }

    /// Set the window end, UNIX seconds.
    pub fn to(mut self, to: i64) -> Self {
        self.to = Some(to);
        self
    }

    /// Set the holder limit.
    pub fn limit(mut self, limit: i64) -> Self {
        self.limit = Some(limit);
        self
    }
}

impl ToQuery for SharesParams {
    fn to_query(&self) -> QueryPairs {
        let mut pairs = QueryPairs::new();
        push(&mut pairs, "from", &self.from);
        push(&mut pairs, "to", &self.to);
        push(&mut pairs, "limit", &self.limit);
        pairs
    }
}

/// Paging for [`Distributor::list_rounds`](crate::Distributor::list_rounds).
#[derive(Debug, Clone, Default)]
pub struct RoundsParams {
    /// Rows to return. Clamped by the server to 1-100. Server default 25.
    pub limit: Option<i64>,
    /// Rows to skip. Server default 0.
    pub offset: Option<i64>,
}

impl RoundsParams {
    /// Server defaults: the 25 most recent rounds.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the row limit.
    pub fn limit(mut self, limit: i64) -> Self {
        self.limit = Some(limit);
        self
    }

    /// Set the row offset.
    pub fn offset(mut self, offset: i64) -> Self {
        self.offset = Some(offset);
        self
    }
}

impl ToQuery for RoundsParams {
    fn to_query(&self) -> QueryPairs {
        let mut pairs = QueryPairs::new();
        push(&mut pairs, "limit", &self.limit);
        push(&mut pairs, "offset", &self.offset);
        pairs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omits_unset_parameters() {
        let pairs = DiscoverParams::new().limit(5).to_query();
        assert_eq!(pairs, vec![("limit", "5".to_string())]);
    }

    #[test]
    fn encodes_enums_with_their_wire_values() {
        let pairs = DiscoverParams::new()
            .tab(DiscoverTab::Graduating)
            .status(TokenStatus::Bonding)
            .to_query();
        assert_eq!(
            pairs,
            vec![
                ("tab", "graduating".to_string()),
                ("status", "bonding".to_string())
            ]
        );
    }

    #[test]
    fn always_sends_the_required_chart_parameters() {
        let pairs = ChartDataParams::new("0xabc", "5", 1, 2).to_query();
        assert_eq!(
            pairs,
            vec![
                ("tokenAddress", "0xabc".to_string()),
                ("interval", "5".to_string()),
                ("from", "1".to_string()),
                ("to", "2".to_string()),
            ]
        );
    }
}
