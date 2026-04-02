use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candle {
    pub time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

/// Parse interval string like "5m", "1d", "1w" into seconds.
pub fn parse_resolution(interval: &str) -> i64 {
    let re = regex_lite::Regex::new(r"^(\d*)(\D+)$").unwrap();
    let caps = match re.captures(interval) {
        Some(c) => c,
        None => return 60, // default 1 minute
    };

    let num: i64 = caps
        .get(1)
        .and_then(|m| m.as_str().parse().ok())
        .unwrap_or(1);

    let unit_secs = match caps.get(2).map(|m| m.as_str()) {
        Some("s") => 1,
        Some("m") => 60,
        Some("h") => 3600,
        Some("d") | Some("D") => 86400,
        Some("w") | Some("W") => 604800,
        Some("month" | "M") => 2592000,
        Some("y" | "Y") => 31536000,
        _ => 60,
    };

    num * unit_secs
}

/// Build OHLCV candles from raw trades.
pub fn build_candles(
    trades: &[(i64, f64, f64, f64)], // (timestamp, token_price, eth_price, token_amount)
    resolution: i64,
    initial_price: f64,
) -> Vec<Candle> {
    if trades.is_empty() {
        return vec![];
    }

    let mut candles: Vec<Candle> = Vec::new();
    let mut current_bucket = trades[0].0 / resolution * resolution;
    let mut open = initial_price;
    let mut high = open;
    let mut low = open;
    let mut close = open;
    let mut volume = 0.0;

    for &(ts, token_price, eth_price, token_amount) in trades {
        let bucket = ts / resolution * resolution;

        if bucket != current_bucket {
            // Emit the completed candle
            candles.push(Candle {
                time: current_bucket * 1000, // milliseconds for frontend
                open,
                high,
                low,
                close,
                volume,
            });

            // Fill gap candles if needed
            let mut gap_bucket = current_bucket + resolution;
            while gap_bucket < bucket {
                candles.push(Candle {
                    time: gap_bucket * 1000,
                    open: close,
                    high: close,
                    low: close,
                    close,
                    volume: 0.0,
                });
                gap_bucket += resolution;
            }

            // Start new candle
            current_bucket = bucket;
            open = close;
            high = token_price;
            low = token_price;
            volume = 0.0;
        }

        let price = token_price;
        if price > high {
            high = price;
        }
        if price < low {
            low = price;
        }
        close = price;
        volume += token_amount * token_price * eth_price;
    }

    // Emit last candle
    candles.push(Candle {
        time: current_bucket * 1000,
        open,
        high,
        low,
        close,
        volume,
    });

    candles
}

/// Fetch candles from DEX subgraph for launched tokens.
pub async fn fetch_dex_candles(
    client: &Client,
    pair_address: &str,
    resolution: i64,
    from: i64,
    to: i64,
) -> anyhow::Result<Vec<Candle>> {
    // Subgraph query for Uniswap V2/V3 swaps
    let query = format!(
        r#"{{
            swaps(
                where: {{ pair: "{pair_address}", timestamp_gte: {from}, timestamp_lte: {to} }}
                orderBy: timestamp
                orderDirection: asc
                first: 1000
            ) {{
                timestamp
                amount0In
                amount0Out
                amount1In
                amount1Out
                amountUSD
            }}
        }}"#
    );

    // For now, return empty - subgraph URL is chain-specific
    let _ = (client, query, resolution);
    Ok(vec![])
}
