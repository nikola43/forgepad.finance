//! Export every token matching a filter to CSV, one page at a time.
//!
//! ```text
//! cargo run --example export_tokens -- [search_word] > tokens.csv
//! ```
//!
//! [`TokenPager`](fyuz::TokenPager) walks the paginated `/tokens` endpoint
//! lazily: pages are fetched as the loop consumes them, so memory stays flat
//! regardless of how many tokens match.
//!
//! The decimal columns are written straight through as the strings the API sent.
//! Parsing them into an `f64` on the way past would corrupt exactly the values a
//! downstream analyst cares about.

use std::io::{self, BufWriter, Write};

use fyuz::{FyuzClient, ListTokensParams, SortDirection};

const COLUMNS: &str =
    "tokenAddress,tokenSymbol,tokenName,network,marketcap,price,volume,liquidity,pairAddress,createdAt";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = FyuzClient::new()?;
    let search_word = std::env::args().nth(1);

    let mut params = ListTokensParams::new()
        .order_type("marketcap")
        .order_flag(SortDirection::Desc)
        .page_size(100);
    if let Some(word) = &search_word {
        params = params.search_word(word.clone());
    }

    let stdout = io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    writeln!(out, "{COLUMNS}")?;

    let mut pager = client.token_pages(&params);
    let mut exported = 0usize;

    while let Some(page) = pager.next_page().await? {
        for token in &page {
            let row = [
                token.token_address.as_str(),
                token.token_symbol.as_str(),
                token.token_name.as_str(),
                token.network.as_str(),
                token.marketcap.as_str(),
                token.price.as_str(),
                token.volume.as_str(),
                // `None` is not `0`: an unknown liquidity is left empty rather
                // than invented.
                token.liquidity.as_deref().unwrap_or(""),
                token.pair_address.as_deref().unwrap_or(""),
                token.created_at.as_str(),
            ];
            let escaped: Vec<String> = row.iter().map(|field| escape_csv(field)).collect();
            writeln!(out, "{}", escaped.join(","))?;
        }

        exported += page.len();
        out.flush()?;
        eprintln!("… {exported} rows");
    }

    match pager.total_count() {
        Some(total) => eprintln!("done — {exported} of {total} rows"),
        None => eprintln!("done — {exported} rows"),
    }
    Ok(())
}

fn escape_csv(field: &str) -> String {
    if field.contains([',', '"', '\n']) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}
