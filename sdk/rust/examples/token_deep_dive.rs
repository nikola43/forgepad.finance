//! Everything the API knows about one token.
//!
//! ```text
//! cargo run --example token_deep_dive -- [address] [network]
//! ```
//!
//! With no address, the current king of the hill is used.

use std::time::{SystemTime, UNIX_EPOCH};

use fyuz::models::TradeSide;
use fyuz::{ChartDataParams, FyuzClient, TokenDetailParams};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = FyuzClient::new()?;

    let mut args = std::env::args().skip(1);
    let mut address = args.next();
    let network = args.next().unwrap_or_else(|| "bsc".to_string());

    if address.is_none() {
        match client.get_king().await? {
            None => {
                eprintln!("no king right now — pass a token address explicitly");
                std::process::exit(1);
            }
            Some(king) => {
                println!("no address given, using the king: {}\n", king.token_symbol);
                address = Some(king.token_address);
            }
        }
    }
    let address = address.expect("address resolved above");

    let detail = client
        .get_token(&network, &address, &TokenDetailParams::new().page_size(10))
        .await?;
    let token = &detail.token_details;

    println!("{} ({})", token.token_name, token.token_symbol);
    println!("  address        {}", token.token_address);
    println!(
        "  creator        {}",
        token
            .user
            .username
            .as_deref()
            .unwrap_or(&token.creator_address)
    );
    println!("  created        {}\n", token.created_at);

    // Exact decimal strings, printed verbatim on purpose: parsing them into an
    // f64 would round the last digits off a market cap or a price.
    println!("  market cap     {}", token.marketcap);
    println!("  price          {}", token.price);
    println!("  volume         {}", token.volume);
    println!(
        "  liquidity      {}\n",
        token.liquidity.as_deref().unwrap_or("unknown")
    );

    match &token.pair_address {
        None => {
            let progress = token
                .progress
                .map(|p| format!("{p:.1}"))
                .unwrap_or_else(|| "?".to_string());
            println!("  status         on the bonding curve, {progress}% to graduation");
        }
        Some(pair) => println!("  status         graduated — pair {pair}"),
    }
    println!("  trades         {}\n", detail.trades_count);

    println!("top holders ({} shown)", detail.holders_details.len());
    for holder in detail.holders_details.iter().take(10) {
        let who = holder
            .user
            .username
            .as_deref()
            .unwrap_or(&holder.holder_address);
        println!("  {:<24.24} {}", who, holder.token_amount);
    }
    println!();

    println!("recent trades");
    for trade in detail.trades.iter().take(10) {
        // `TradeSide` folds the casing during deserialisation, so this matches
        // whether the endpoint sent "BUY" or "buy".
        let side = match trade.trade_side {
            TradeSide::Buy => "buy",
            TradeSide::Sell => "sell",
            TradeSide::Other(ref raw) => raw,
        };
        println!(
            "  {}  {:<4}  {:>28} @ {}",
            hhmmss(trade.date),
            side,
            trade.token_amount,
            trade.token_price
        );
    }
    println!();

    // Hourly candles for the last day. Candle values are pre-aggregated
    // analytics, so unlike the fields above they legitimately are f64.
    let to = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64;
    let candles = client
        .get_chart_data(&ChartDataParams::new(&address, "60", to - 24 * 3600, to))
        .await?;

    println!("hourly candles, last 24h ({} returned)", candles.len());
    for candle in candles.iter().rev().take(8).rev() {
        println!(
            "  {}  o {:.6e}  h {:.6e}  l {:.6e}  c {:.6e}  vol {:.0}",
            hhmmss(candle.time),
            candle.open,
            candle.high,
            candle.low,
            candle.close,
            candle.volume
        );
    }

    Ok(())
}

/// UTC `HH:MM:SS` for a UNIX timestamp.
///
/// Done by hand rather than by pulling in `chrono` — the crate itself has no
/// date dependency and an example is a poor reason to add one.
fn hhmmss(unix_seconds: i64) -> String {
    let secs_into_day = unix_seconds.rem_euclid(86_400);
    format!(
        "{:02}:{:02}:{:02}",
        secs_into_day / 3600,
        (secs_into_day % 3600) / 60,
        secs_into_day % 60
    )
}
