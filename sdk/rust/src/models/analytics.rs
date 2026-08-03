//! Token analytics, wallet performance and portfolios.
//!
//! Everything in this module is a server-side aggregate and arrives as JSON
//! numbers, so `f64` is the faithful model here — unlike balances, which stay
//! decimal strings.

use serde::Deserialize;

/// Holder concentration and flow analytics for one token.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenAnalytics {
    /// Token contract address.
    pub token_address: String,
    /// Chain slug.
    pub network: String,
    /// Number of addresses with a positive balance.
    pub holder_count: i64,
    /// Share of supply held by the top 10 holders.
    pub top10_pct: f64,
    /// Share of supply held by the creator.
    pub creator_pct: f64,
    /// Lifetime buy count.
    pub buys: i64,
    /// Lifetime sell count.
    pub sells: i64,
    /// Lifetime USD volume.
    pub volume_usd: f64,
    /// Progress toward the $30,000 graduation target, 0-100.
    pub graduation_pct: f64,
    /// `true` once graduated to a DEX pair.
    pub launched: bool,
    /// Addresses that bought in the launch block.
    pub bundle_buyers: i64,
    /// `true` when the launch-block buying pattern looks like a bundle.
    pub bundle_flag: bool,
}

/// One of a token's most profitable traders.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopTrader {
    /// Wallet address.
    pub address: String,
    /// Display name, when set.
    #[serde(default)]
    pub username: Option<String>,
    /// Avatar URL, when set.
    #[serde(default)]
    pub avatar: Option<String>,
    /// Realised PnL in USD.
    pub realized_pnl_usd: f64,
    /// Unrealised PnL in USD on the still-held position.
    pub unrealized_pnl_usd: f64,
    /// Realised plus unrealised PnL in USD.
    pub total_pnl_usd: f64,
    /// USD volume traded in this token.
    pub volume_usd: f64,
    /// `true` when this wallet launched the token.
    pub is_creator: bool,
}

/// Average-cost performance for a wallet, rolled up across every token traded.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletStats {
    /// Wallet address.
    pub address: String,
    /// Display name, when set.
    #[serde(default)]
    pub username: Option<String>,
    /// Avatar URL, when set.
    #[serde(default)]
    pub avatar: Option<String>,
    /// Lifetime USD volume.
    pub volume_usd: f64,
    /// Realised PnL in USD.
    pub realized_pnl_usd: f64,
    /// Unrealised PnL in USD.
    pub unrealized_pnl_usd: f64,
    /// Realised plus unrealised PnL in USD.
    pub total_pnl_usd: f64,
    /// Return on invested capital, percent.
    pub roi_pct: f64,
    /// Share of traded tokens that are net profitable, 0-1.
    pub win_rate: f64,
    /// Distinct tokens traded.
    pub tokens_traded: i64,
    /// Lifetime trade count.
    pub trade_count: i64,
    /// USD value of everything still held.
    pub holding_value_usd: f64,
}

/// One token still held by an address.
///
/// Average-cost basis. Dust positions (balance <= 1e-6) are omitted by the
/// server.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioPosition {
    /// Token contract address.
    pub token_address: String,
    /// Token name.
    pub name: String,
    /// Token ticker.
    pub symbol: String,
    /// Token image URL.
    #[serde(default)]
    pub image: Option<String>,
    /// Chain slug.
    pub network: String,
    /// Net tokens held (buys minus sells), in whole tokens.
    pub balance: f64,
    /// Current token price in USD.
    pub current_price_usd: f64,
    /// Current position value in USD.
    pub value_usd: f64,
    /// Cost basis of the position in USD.
    pub cost_usd: f64,
    /// Average buy price in USD.
    pub avg_buy_price_usd: f64,
    /// Unrealised PnL in USD.
    pub unrealized_pnl_usd: f64,
    /// Unrealised PnL, percent of cost.
    pub unrealized_pnl_pct: f64,
    /// Realised PnL in USD on this token.
    pub realized_pnl_usd: f64,
}

/// Live average-cost PnL for an address.
///
/// An address with no trades returns zeroed totals and an empty
/// [`positions`](Self::positions) array rather than a 404.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Portfolio {
    /// Wallet address.
    pub address: String,
    /// USD value of everything held.
    pub total_value_usd: f64,
    /// USD cost basis of everything held.
    pub total_cost_usd: f64,
    /// Unrealised PnL in USD.
    pub unrealized_pnl_usd: f64,
    /// Realised PnL in USD.
    pub realized_pnl_usd: f64,
    /// Realised plus unrealised PnL in USD.
    pub total_pnl_usd: f64,
    /// Return on invested capital, percent.
    pub roi_pct: f64,
    /// Open positions, highest value first.
    pub positions: Vec<PortfolioPosition>,
}
