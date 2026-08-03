//! Quote and build bonding-curve trades.
//!
//! ```text
//! cargo run --example trade -- [token] [wallet]
//! ```
//!
//! **This example signs nothing and sends nothing.** It prints the unsigned
//! transactions, which is the whole surface this crate offers: you hand
//! `{ to, data, value }` to `alloy`, `ethers-rs`, a hardware signer or a
//! multisig, and that library owns the key. Nothing here can move funds.

use fyuz::{
    format_units, parse_units, BuyParams, FyuzClient, SellParams, UnsignedTransaction, U256,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let token_arg = args.next();
    let wallet = args.next();

    // The endpoint `/config` publishes belongs to the API operator and is shared
    // by every caller. Point this at your own node for anything real.
    let rpc = std::env::var("BSC_RPC_URL")
        .unwrap_or_else(|_| "https://bsc-dataseed.bnbchain.org".to_string());
    let client = FyuzClient::builder().rpc_url(rpc).build()?;

    let chain = client.trade().chain("bsc").await?;
    println!("chain      {} ({})", chain.name, chain.chain_id);
    println!(
        "contract   {}\n",
        chain.contract_address.as_deref().unwrap_or("unknown")
    );
    let currency = chain.currency.clone().unwrap_or_else(|| "BNB".to_string());

    let token = match token_arg {
        Some(token) => token,
        None => match client.get_king().await? {
            None => {
                eprintln!("no king right now — pass a token address explicitly");
                std::process::exit(1);
            }
            Some(king) => {
                println!(
                    "using the king: {} ({})\n",
                    king.token_symbol, king.token_address
                );
                king.token_address
            }
        },
    };

    // ------------------------------------------------------------------ buying

    let spend = parse_units("0.01", 18)?; // 0.01 BNB, in wei

    let quote = match client.trade().quote_buy("bsc", &token, spend).await {
        Ok(quote) => quote,
        // The SDK refuses rather than letting you pay gas to learn this on-chain.
        Err(error) if error.is_graduated() => {
            println!("buy refused: {error}");
            return Ok(());
        }
        Err(error) => return Err(error.into()),
    };

    println!("buy quote");
    println!(
        "  spending       {} {currency}",
        format_units(quote.amount_in_wei, 18)
    );
    println!(
        "  first-buy fee  {} {currency}",
        format_units(quote.first_buy_fee_wei, 18)
    );
    println!(
        "  msg.value      {} {currency}  <- includes the fee",
        format_units(quote.value_wei, 18)
    );
    println!(
        "  tokens out     {}",
        format_units(quote.amount_out_wei, 18)
    );
    println!(
        "  price impact   {:.2}%\n",
        quote.price_impact_bps as f64 / 100.0
    );

    // `slippage_bps` is required. There is no default, because the right
    // tolerance depends on the trade and a wrong one costs you money.
    let mut buy = BuyParams::new(&token, spend)
        .slippage_bps(100)
        .deadline_seconds(120);
    if let Some(wallet) = &wallet {
        buy = buy.from(wallet.clone());
    }
    let built = client.trade().build_buy(&buy).await?;

    println!("buy transaction (unsigned)");
    print_transaction(&built.transaction);
    println!(
        "  minAmountOut   {} tokens",
        format_units(built.limit_wei, 18)
    );
    // Printed as a raw unix second: the crate carries no date dependency, and an
    // example is a poor reason to add one.
    println!("  deadline       {} (unix)\n", built.deadline);

    // ----------------------------------------------------------------- selling

    let sell_amount = parse_units("1000", 18)?;
    let sell_quote = client
        .trade()
        .quote_sell("bsc", &token, sell_amount)
        .await?;

    println!("sell quote");
    println!(
        "  selling        {} tokens",
        format_units(sell_quote.amount_in_wei, 18)
    );
    println!(
        "  {currency} out         {}  <- net of fees",
        format_units(sell_quote.amount_out_wei, 18)
    );
    println!(
        "  price impact   {:.2}%\n",
        sell_quote.price_impact_bps as f64 / 100.0
    );

    // Selling needs an ERC-20 approval first: the contract pulls the tokens with
    // `transferFrom`, so without one the swap reverts inside the token.
    if let Some(wallet) = &wallet {
        let allowance = client.trade().allowance("bsc", &token, wallet).await?;
        println!("current allowance {} tokens", format_units(allowance, 18));

        if allowance < sell_amount {
            let approve = client
                .trade()
                .build_approve("bsc", &token, sell_amount)
                .await?;
            println!("\napprove transaction (unsigned) — send this before the sell");
            print_transaction(&approve);
            println!();
        }
    }

    let mut sell = SellParams::new(&token, sell_amount).slippage_bps(150);
    if let Some(wallet) = &wallet {
        sell = sell.from(wallet.clone());
    }
    let built_sell = client.trade().build_sell(&sell).await?;

    println!("sell transaction (unsigned)");
    print_transaction(&built_sell.transaction);
    println!(
        "  minAmountOut   {} {currency}\n",
        format_units(built_sell.limit_wei, 18)
    );
    println!("Nothing above was signed or broadcast. Hand these to your wallet to execute.");

    Ok(())
}

fn print_transaction(transaction: &UnsignedTransaction) {
    let data: String = transaction.data.chars().take(74).collect();
    println!("  chainId        {}", transaction.chain_id);
    println!("  to             {}", transaction.to);
    println!(
        "  value          {}",
        if transaction.value == U256::ZERO {
            "0".to_string()
        } else {
            transaction.value.to_string()
        }
    );
    println!("  data           {data}…");
}
