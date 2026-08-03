//! Live smoke test against the production API.
//! Run with: cargo run --example live_smoke
use fyuz::{DiscoverParams, FyuzClient, ListTokensParams};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let c = FyuzClient::new()?;
    println!("health: {:?}", c.health().await?);

    let d = c
        .discover(&DiscoverParams { limit: Some(2), ..Default::default() })
        .await?;
    println!("discover: {} rows; first: {} mcap {}", d.len(), d[0].symbol, d[0].marketcap);

    let t = c
        .list_tokens(&ListTokensParams { page_size: Some(2), ..Default::default() })
        .await?;
    println!(
        "listTokens: count={} marketcap={:?} (String)",
        t.token_count, t.token_list[0].marketcap
    );
    Ok(())
}
