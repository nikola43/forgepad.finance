//! Which tokens are closest to leaving the bonding curve.
//!
//! ```text
//! cargo run --example graduation_watch
//! ```
//!
//! A Fyuz token trades on an internal bonding curve until it reaches a $30,000
//! market cap, then graduates into a PancakeSwap V2 pair. Until that happens
//! there is no DEX pool anywhere: `pair_address` is `None` and no aggregator has
//! a price. This API is the only source, which is what makes the pre-graduation
//! window worth watching.

use fyuz::{DiscoverParams, DiscoverTab, FyuzClient, TokenDetailParams, TokenStatus};

/// Market cap at which a token graduates, in USD.
const GRADUATION_TARGET_USD: f64 = 30_000.0;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = FyuzClient::new()?;

    let mut candidates = client
        .discover(
            &DiscoverParams::new()
                .tab(DiscoverTab::Graduating)
                .status(TokenStatus::Bonding)
                .min_holders(10)
                .limit(25),
        )
        .await?;

    if candidates.is_empty() {
        println!("nothing close to graduation right now");
        return Ok(());
    }

    // `graduation_pct` is what the server computed; recomputing it from market
    // cap here would only introduce a second, disagreeing number.
    candidates.sort_by(|a, b| {
        b.graduation_pct
            .partial_cmp(&a.graduation_pct)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    println!("{} tokens on the curve, closest first\n", candidates.len());
    for token in &candidates {
        let remaining = (GRADUATION_TARGET_USD - token.marketcap).max(0.0);
        println!(
            "{:<10.10} {} {:>6.1}% {:>18} {:>14}",
            token.symbol,
            bar(token.graduation_pct),
            token.graduation_pct,
            format!("${remaining:.0} to go"),
            format!("{} holders", token.holders),
        );
    }

    let leader = &candidates[0];
    println!("\nwatching the top candidate: {}", leader.symbol);

    let detail = client
        .get_token(
            &leader.network,
            &leader.token_address,
            &TokenDetailParams::new().page_size(1),
        )
        .await?;

    // These are exact decimal strings and stay strings. `curve_holding` is
    // `None` when the on-chain read failed — that means *unknown*, and printing
    // 0 would tell the reader something false.
    println!(
        "  market cap     {} USD (exact)",
        detail.token_details.marketcap
    );
    println!(
        "  price          {} USD (exact)",
        detail.token_details.price
    );
    println!(
        "  curve holding  {}",
        detail
            .curve_holding
            .as_deref()
            .unwrap_or("unknown — on-chain read failed")
    );
    println!(
        "  pair address   {}",
        detail
            .token_details
            .pair_address
            .as_deref()
            .unwrap_or("none — still on the curve, no DEX pool exists")
    );

    Ok(())
}

/// A fixed-width progress bar.
fn bar(percent: f64) -> String {
    const WIDTH: usize = 24;
    let filled =
        ((percent / 100.0 * WIDTH as f64).round() as isize).clamp(0, WIDTH as isize) as usize;
    format!("[{}{}]", "█".repeat(filled), "·".repeat(WIDTH - filled))
}
