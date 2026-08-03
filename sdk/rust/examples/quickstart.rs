//! Is the API up, what chain is it on, what is trending.
//!
//! ```text
//! cargo run --example quickstart
//! ```
//!
//! Every endpoint used here is unauthenticated.

use fyuz::{DiscoverParams, DiscoverTab, FyuzClient};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = FyuzClient::new()?;

    let health = client.health().await?;
    let config = client.get_config().await?;

    let chains: Vec<String> = config
        .chains
        .iter()
        .map(|chain| format!("{} ({})", chain.name, chain.chain_id))
        .collect();

    println!("api        {}", health.status);
    println!("chains     {}\n", chains.join(", "));

    let trending = client
        .discover(&DiscoverParams::new().tab(DiscoverTab::Trending).limit(10))
        .await?;

    println!("symbol       market cap        24h vol    holders    24h %    to graduation");
    println!("{}", "─".repeat(78));

    for token in &trending {
        let progress = if token.launched {
            "graduated".to_string()
        } else {
            format!("{:.1}%", token.graduation_pct)
        };
        // Discovery figures are pre-aggregated analytics and arrive as f64, so
        // formatting them this way is safe. The same is *not* true of
        // `Token::marketcap` from `/tokens` — see the export_tokens example.
        println!(
            "{:<10.10} {:>14} {:>13} {:>9} {:>+7.1}% {:>16}",
            token.symbol,
            format!("${:.0}", token.marketcap),
            format!("${:.0}", token.volume24h),
            token.holders,
            token.price_change24h,
            progress,
        );
    }

    // The king of the hill is the biggest token *still on the curve*. It is
    // `None` in the window between one token graduating and the next taking the
    // lead — a real state, not an error.
    println!();
    match client.get_king().await? {
        None => println!("king       nobody on the hill right now"),
        Some(king) => println!(
            "king       {} at {} USD market cap",
            king.token_symbol, king.marketcap
        ),
    }

    Ok(())
}
