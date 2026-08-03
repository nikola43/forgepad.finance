//! Trades and OHLCV candles.

use serde::{Deserialize, Deserializer};

use super::token::Token;

/// Side of a trade.
///
/// Deserialisation is tolerant: a value the API adds later lands in
/// [`TradeSide::Other`] instead of failing the whole response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TradeSide {
    /// Bought the token (BNB in, tokens out).
    Buy,
    /// Sold the token (tokens in, BNB out).
    Sell,
    /// A side this SDK version does not know about, kept verbatim.
    Other(String),
}

impl TradeSide {
    /// The wire representation of this side.
    pub fn as_str(&self) -> &str {
        match self {
            TradeSide::Buy => "buy",
            TradeSide::Sell => "sell",
            TradeSide::Other(s) => s,
        }
    }
}

impl std::fmt::Display for TradeSide {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for TradeSide {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "buy" => TradeSide::Buy,
            "sell" => TradeSide::Sell,
            _ => TradeSide::Other(raw),
        })
    }
}

/// A single swap against the bonding curve or the graduated pair.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trade {
    /// Internal row id. Pass the highest one you have seen as `latest_trade_id`
    /// to [`RecentTradesParams`](crate::RecentTradesParams) to poll incrementally.
    pub id: i64,
    /// Token name.
    pub token_name: String,
    /// Token ticker.
    pub token_symbol: String,
    /// Token contract address.
    pub token_address: String,
    /// Token image URL.
    #[serde(default)]
    pub token_image: Option<String>,
    /// Wallet that made the trade.
    pub swapper_address: String,
    /// Trader's display name, when set.
    #[serde(default)]
    pub swapper_username: Option<String>,
    /// Trader's avatar URL, when set.
    #[serde(default)]
    pub swapper_avatar: Option<String>,
    /// Buy or sell.
    #[serde(rename = "type")]
    pub trade_side: TradeSide,
    /// BNB amount. Decimal string — do not parse as `f64`.
    pub eth_amount: String,
    /// Token amount. Decimal string — do not parse as `f64`.
    pub token_amount: String,
    /// Chain slug.
    pub network: String,
    /// Trade time, UNIX **seconds**.
    pub date: i64,
    /// Transaction hash.
    pub tx_hash: String,
    /// Token price in USD at trade time. Decimal string.
    pub token_price: String,
    /// BNB price in USD at trade time. Decimal string.
    pub eth_price: String,
}

/// Response of `GET /trades/recent`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentTrades {
    /// Platform-wide trades, newest first.
    pub trades: Vec<Trade>,
    /// The tokens referenced by [`trades`](Self::trades), so a poller does not
    /// have to fetch them one at a time.
    pub tokens: Vec<Token>,
}

/// One OHLCV candle.
///
/// These are already-aggregated chart numbers and are floats on the wire.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candle {
    /// Candle open time, UNIX **seconds**.
    pub time: i64,
    /// Open price.
    pub open: f64,
    /// High price.
    pub high: f64,
    /// Low price.
    pub low: f64,
    /// Close price.
    pub close: f64,
    /// Volume over the candle.
    pub volume: f64,
}
