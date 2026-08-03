//! Tail the trade feed indefinitely without falling over.
//!
//! ```text
//! cargo run --example resilient_polling
//! ```
//!
//! Three things make this survivable in production:
//!
//! 1. `latest_trade_id` — ask only for what is new. The server returns trades
//!    with an id greater than the one you pass, so poll cost stays flat instead
//!    of growing with the token's history.
//! 2. The client's own retries — 429s, 5xx and transport failures are retried
//!    with exponential backoff and full jitter, honouring `Retry-After`. The API
//!    allows 120 requests/minute per IP; at one poll every 5s this uses 12.
//! 3. Errors matched on [`Error`](fyuz::Error) variants rather than by string.
//!    A rate limit that survived the retry budget means back off harder; a 404
//!    means the resource is gone and retrying will never help.
//!
//! Ctrl-C to stop.

use std::collections::HashMap;
use std::time::Duration;

use fyuz::models::TradeSide;
use fyuz::{Error, FyuzClient, RecentTradesParams};

const POLL_INTERVAL: Duration = Duration::from_secs(5);

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = FyuzClient::builder()
        .timeout(Duration::from_secs(10))
        .max_retries(5)
        .retry_base_delay(Duration::from_millis(500))
        .max_retry_delay(Duration::from_secs(30))
        // Identify yourself. If the API ever needs to contact a heavy consumer,
        // this is the only thing it has to go on.
        .user_agent("fyuz-example-poller/1.0 (ops@example.com)")
        .build()?;

    // Start from the current tip rather than replaying history.
    let mut latest_trade_id = client
        .get_recent_trades(&RecentTradesParams::new())
        .await?
        .trades
        .first()
        .map(|trade| trade.id)
        .unwrap_or(0);

    println!(
        "polling from trade id {latest_trade_id}, every {}s",
        POLL_INTERVAL.as_secs()
    );

    let mut consecutive_failures = 0u32;

    loop {
        // Bound to a local: a temporary built inside `select!` would be dropped
        // while the future still borrows it.
        let params = RecentTradesParams::new().latest_trade_id(latest_trade_id);

        let feed = tokio::select! {
            result = client.get_recent_trades(&params) => match result {
                Ok(feed) => feed,
                Err(error) => {
                    consecutive_failures += 1;
                    tokio::time::sleep(backoff_for(&error, consecutive_failures)).await;
                    continue;
                }
            },
            _ = tokio::signal::ctrl_c() => {
                println!("\nstopping…");
                return Ok(());
            }
        };
        consecutive_failures = 0;

        // The response carries the token records the trades reference, so a feed
        // consumer never has to fan out to /tokens per trade.
        let symbols: HashMap<&str, &str> = feed
            .tokens
            .iter()
            .map(|token| (token.token_address.as_str(), token.token_symbol.as_str()))
            .collect();

        // Oldest first, so downstream sees them in the order they happened.
        for trade in feed.trades.iter().rev() {
            let symbol = symbols
                .get(trade.token_address.as_str())
                .copied()
                .unwrap_or(trade.token_symbol.as_str());
            let side = match trade.trade_side {
                TradeSide::Buy => "buy",
                TradeSide::Sell => "sell",
                TradeSide::Other(ref raw) => raw,
            };
            println!(
                "{}  {:<4}  {:<10.10}  {:>26} tokens for {} BNB",
                hhmmss(trade.date),
                side,
                symbol,
                trade.token_amount,
                trade.eth_amount
            );
            latest_trade_id = latest_trade_id.max(trade.id);
        }

        tokio::select! {
            _ = tokio::time::sleep(POLL_INTERVAL) => {}
            _ = tokio::signal::ctrl_c() => {
                println!("\nstopping…");
                return Ok(());
            }
        }
    }
}

/// Decide how long to wait after a failure, and say why.
fn backoff_for(error: &Error, consecutive_failures: u32) -> Duration {
    match error {
        // The client already exhausted its retries on this one, so the answer is
        // not another immediate retry — it is polling less often.
        Error::RateLimited { retry_after, .. } => {
            let wait = retry_after.unwrap_or(Duration::from_secs(60));
            eprintln!(
                "rate limited past the retry budget; backing off {}s",
                wait.as_secs()
            );
            wait
        }

        // 404 is a statement about the resource, not the connection. Retrying
        // the same request cannot fix it.
        Error::Api {
            status: 404,
            message,
        } => {
            eprintln!("gone: {message}");
            POLL_INTERVAL
        }

        Error::Api { status, message } => {
            eprintln!("HTTP {status}: {message}");
            POLL_INTERVAL * 2
        }

        // Transport failure: DNS, connection refused, TLS, timeout.
        other => {
            let wait = (POLL_INTERVAL * 2u32.pow(consecutive_failures.min(4)))
                .min(Duration::from_secs(60));
            eprintln!("transport error: {other} — retrying in {}s", wait.as_secs());
            wait
        }
    }
}

/// UTC `HH:MM:SS` for a UNIX timestamp, without pulling in a date crate.
fn hhmmss(unix_seconds: i64) -> String {
    let secs_into_day = unix_seconds.rem_euclid(86_400);
    format!(
        "{:02}:{:02}:{:02}",
        secs_into_day / 3600,
        (secs_into_day % 3600) / 60,
        secs_into_day % 60
    )
}
