use std::sync::Arc;

use alloy::primitives::{keccak256, Address, Bytes, U256};
use alloy::providers::{Provider, ProviderBuilder, WsConnect};
use alloy::rpc::types::{Filter, Log};
use futures::StreamExt;

use bigdecimal::BigDecimal;
use diesel::prelude::*;
use diesel_async::RunQueryDsl;
use serde_json::json;
use std::str::FromStr;

use crate::config::chains::ChainConfig;
use crate::models::enums::TradeType;
use crate::models::indexing::{IndexingState, NewIndexingState};
use crate::models::request::TokenCreationRequest;
use crate::schema::{holders, indexing_state, token_creation_requests, tokens, trades, users};
use crate::{AppState, WsEvent};

/// Score decay function matching the Node.js implementation:
/// f(x) = 1 / (1 + 0.0000001*x^2 + 0.000006*x^3 + 0.00000006*x^4)
/// where x = time_delta_ms * 100 / 1800
fn score_decay(time_delta_ms: f64) -> f64 {
    let x = time_delta_ms * 100.0 / 1800.0;
    let x2 = x * x;
    let x3 = x2 * x;
    let x4 = x3 * x;
    1.0 / (1.0 + 0.0000001 * x2 + 0.000006 * x3 + 0.00000006 * x4)
}

/// Start the blockchain event listener for a given chain.
/// Catches up from last indexed block, then subscribes to new events.
pub async fn start_listener(state: Arc<AppState>, chain: ChainConfig) {
    tracing::info!(
        "Starting blockchain listener for {} (chain_id: {})",
        chain.name,
        chain.chain_id
    );

    let mut conn = match state.db.get().await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to get DB connection for listener: {e}");
            return;
        }
    };

    let idx_state: Option<IndexingState> = indexing_state::table
        .filter(indexing_state::network.eq(&chain.network))
        .first(&mut conn)
        .await
        .optional()
        .unwrap_or(None);

    let mut last_block = match idx_state {
        Some(s) => s.last_block as u64,
        None => {
            let new_state = NewIndexingState {
                network: chain.network.clone(),
                last_block: 0,
            };
            diesel::insert_into(indexing_state::table)
                .values(&new_state)
                .execute(&mut conn)
                .await
                .ok();
            0
        }
    };

    tracing::info!("Chain {} last indexed block: {}", chain.network, last_block);

    let contract_address: Address = chain
        .contract_address
        .parse()
        .expect("Invalid contract address");

    // For WebSocket provider
    let ws_url = chain.ws_url.as_ref().expect("ws_url is required");
    let ws = WsConnect::new(ws_url.as_str());
    let ws_provider = ProviderBuilder::new()
        .connect_ws(ws)
        .await
        .expect("Failed to create WS provider");

    // let abi_functions: Vec<alloy::json_abi::Function> =
    //     serde_json::from_value(chain.abi.clone()).expect("Failed to parse ABI");

    let current_block = match ws_provider.get_block_number().await {
        Ok(b) => b,
        Err(e) => {
            tracing::error!("Failed to get current block: {e}");
            return;
        }
    };

    // Handle chain reset or large gap: skip to current block
    // This handles Anvil restarts (last > current) and forked chains with huge gaps
    let gap = if last_block > current_block {
        last_block - current_block
    } else {
        current_block - last_block
    };
    if last_block > current_block || gap > 100_000 {
        tracing::warn!(
            "Chain {} last indexed block ({}) vs current block ({}), gap={}, skipping to current",
            chain.network, last_block, current_block, gap
        );
        last_block = current_block;
        let _ = update_last_block(&state, &chain.network, current_block as i64).await;
    }

    const CHUNK_SIZE: u64 = 50_000;

    while last_block < current_block {
        let end = (last_block + CHUNK_SIZE).min(current_block);
        tracing::info!("Catching up blocks {} to {}", last_block, end);

        let filter = Filter::new()
            .address(contract_address)
            .from_block(alloy::rpc::types::BlockNumberOrTag::Number(last_block))
            .to_block(alloy::rpc::types::BlockNumberOrTag::Number(end));

        match ws_provider.get_logs(&filter).await {
            Ok(logs) => {
                for log in logs {
                    if let Err(e) = process_log(&state, &chain, &log).await {
                        tracing::error!("Error processing log: {e}");
                    }
                }
            }
            Err(e) => {
                tracing::error!("Error fetching logs: {e}");
            }
        }

        last_block = end + 1;
        let _ = update_last_block(&state, &chain.network, last_block as i64).await;
    }

    tracing::info!(
        "Caught up to block {}, now subscribing to new blocks",
        current_block
    );

    let state_clone = state.clone();
    let chain_clone = chain.clone();

    tokio::spawn(async move {
        let stream = ws_provider
            .subscribe_blocks()
            .await
            .expect("Failed to subscribe to blocks");

        let mut stream = stream.into_stream();

        while let Some(block) = stream.next().await {
            let block_num = block.number;
            tracing::debug!("New block: {}", block_num);

            let filter = Filter::new()
                .address(contract_address)
                .from_block(alloy::rpc::types::BlockNumberOrTag::Number(block_num))
                .to_block(alloy::rpc::types::BlockNumberOrTag::Number(block_num));

            if let Ok(logs) = ws_provider.get_logs(&filter).await {
                for log in logs {
                    if let Err(e) = process_log(&state_clone, &chain_clone, &log).await {
                        tracing::error!("Error processing log: {e}");
                    }
                }
            }

            let _ = update_last_block(&state_clone, &chain_clone.network, block_num as i64).await;
        }
    });
}

async fn process_log(state: &AppState, chain: &ChainConfig, log: &Log) -> anyhow::Result<()> {
    if log.topics().is_empty() {
        return Ok(());
    }

    let topic = &log.topics()[0];
    let data = log.data().clone();

    let token_created_sig = keccak256(b"TokenCreated(address,uint256,uint256,uint32,uint256)");
    let buy_tokens_sig = keccak256(b"BuyTokens(address,address,uint256,uint256,uint256,uint256,uint256,uint256)");
    let sell_tokens_sig = keccak256(b"SellTokens(address,address,uint256,uint256,uint256,uint256,uint256,uint256)");

    if *topic == token_created_sig {
        process_token_created_log(state, chain, &data.data).await?;
    } else if *topic == buy_tokens_sig {
        let tx_hash = log.transaction_hash.map(|h| format!("{h:#x}")).unwrap_or_default();
        process_swap_log(state, chain, &data.data, true, &tx_hash).await?;
    } else if *topic == sell_tokens_sig {
        let tx_hash = log.transaction_hash.map(|h| format!("{h:#x}")).unwrap_or_default();
        process_swap_log(state, chain, &data.data, false, &tx_hash).await?;
    }

    Ok(())
}

async fn process_token_created_log(
    state: &AppState,
    chain: &ChainConfig,
    data: &Bytes,
) -> anyhow::Result<()> {
    // TokenCreated(address token, uint256 tokenPrice, uint256 ethPriceUSD, uint32 sig, uint256 date)
    // data layout: [0..32] address, [32..64] tokenPrice, [64..96] ethPriceUSD, [96..128] sig, [128..160] date
    if data.len() < 160 {
        anyhow::bail!("Invalid TokenCreated data length");
    }

    let token_address = format!("0x{}", hex::encode(&data[12..32]));
    // String-parse (not u64::try_from) so a large price never silently truncates to 0.
    let token_price = U256::from_be_slice(&data[32..64]).to_string().parse::<f64>().unwrap_or(0.0) / 1e18;
    let request_id = u64::try_from(U256::from_be_slice(&data[96..128])).unwrap_or(0) as i32;
    let timestamp = u64::try_from(U256::from_be_slice(&data[128..160])).unwrap_or(0) as i64;

    let eth_price = fetch_eth_price(chain).await.unwrap_or(2040.0);

    process_token_created(
        state,
        chain,
        request_id,
        &token_address,
        token_price,
        eth_price,
        timestamp,
    )
    .await?;

    tracing::info!("Processed TokenCreated: {} at {}", token_address, timestamp);
    Ok(())
}

async fn process_swap_log(
    state: &AppState,
    chain: &ChainConfig,
    data: &Bytes,
    is_buy: bool,
    tx_hash: &str,
) -> anyhow::Result<()> {
    // BuyTokens/SellTokens(address user, address token, uint256 ethAmount, uint256 tokenAmount,
    //                       uint256 tokenPrice, uint256 ethPriceUSD, uint256 marketCap, uint256 date)
    // data layout: [0..32] user, [32..64] token, [64..96] ethAmount, [96..128] tokenAmount,
    //              [128..160] tokenPrice, [160..192] ethPriceUSD, [192..224] marketCap, [224..256] date
    if data.len() < 256 {
        anyhow::bail!("Invalid swap data length");
    }

    let swapper_address = format!("0x{}", hex::encode(&data[12..32]));
    let token_address = format!("0x{}", hex::encode(&data[44..64]));
    let eth_amount = U256::from_be_slice(&data[64..96]).to_string().parse::<f64>().unwrap_or(0.0) / 1e18;
    let token_amount = U256::from_be_slice(&data[96..128]).to_string().parse::<f64>().unwrap_or(0.0) / 1e18;
    // Use the contract's own authoritative values from the event: spot price after
    // the trade, ETH/USD, and virtual market cap. These are fee-independent and need
    // no extra RPC call, so the chart price/market cap stay correct regardless of the
    // configured buy/sell fee.
    let token_price = U256::from_be_slice(&data[128..160]).to_string().parse::<f64>().unwrap_or(0.0) / 1e18;
    let event_eth_price = U256::from_be_slice(&data[160..192]).to_string().parse::<f64>().unwrap_or(0.0) / 1e18;
    let marketcap = U256::from_be_slice(&data[192..224]).to_string().parse::<f64>().unwrap_or(0.0) / 1e18;

    let timestamp = u64::try_from(U256::from_be_slice(&data[224..256])).unwrap_or(0) as i64;
    if timestamp == 0 {
        return Ok(()); // skip invalid events
    }

    let eth_price = if event_eth_price > 0.0 {
        event_eth_price
    } else {
        fetch_eth_price(chain).await.unwrap_or(2040.0)
    };

    process_swap(
        state,
        chain,
        &token_address,
        &swapper_address,
        is_buy,
        eth_amount,
        token_amount,
        token_price,
        eth_price,
        marketcap,
        tx_hash,
        timestamp,
    )
    .await?;

    tracing::debug!(
        "Processed {}: {} swapped {} ETH for {} tokens",
        if is_buy { "Buy" } else { "Sell" },
        swapper_address,
        eth_amount,
        token_amount
    );
    Ok(())
}

async fn fetch_eth_price(chain: &ChainConfig) -> Option<f64> {
    // Read ETH price from Forgepad contract's getETHPriceByUSD() (uses Chainlink on-chain)
    let rpc_url = std::env::var("ETH_RPC_URL")
        .unwrap_or_else(|_| chain.rpc_url.clone());
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .post(&rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{
                "to": chain.contract_address,
                "data": "0xa6c9d2ec" // getETHPriceByUSD() selector
            }, "latest"],
            "id": 1
        }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let hex = resp.get("result")?.as_str()?;
    let price_wei = u128::from_str_radix(hex.trim_start_matches("0x"), 16).ok()?;
    Some(price_wei as f64 / 1e18)
}

/// Process a token creation event from the blockchain.
/// Called when a TokenCreated event is received.
pub async fn process_token_created(
    state: &AppState,
    chain: &ChainConfig,
    request_id: i32,
    token_address: &str,
    _token_price: f64,
    eth_price_usd: f64,
    _timestamp: i64,
) -> anyhow::Result<()> {
    let mut conn = state.db.get().await.map_err(|e| anyhow::anyhow!("{e}"))?;

    // Find the pending request
    let request: TokenCreationRequest = token_creation_requests::table
        .find(request_id)
        .first(&mut conn)
        .await?;

    let body = &request.body;

    // Find or create the creator user
    let creator_address = request.creator_address.clone();
    let creator: crate::models::user::User = users::table
        .filter(users::address.eq(&creator_address))
        .first(&mut conn)
        .await?;

    let initial_price = chain.virtual_eth_amount / chain.virtual_token_amount;
    let marketcap = initial_price * chain.total_supply * eth_price_usd;

    // Create token record
    let new_token = crate::models::token::NewToken {
        token_address: token_address.to_string(),
        name: body["tokenName"].as_str().unwrap_or("").to_string(),
        symbol: body["tokenSymbol"].as_str().unwrap_or("").to_string(),
        description: body
            .get("tokenDescription")
            .and_then(|v| v.as_str())
            .map(String::from),
        image: body
            .get("tokenImage")
            .and_then(|v| v.as_str())
            .map(String::from),
        banner: body
            .get("tokenBanner")
            .and_then(|v| v.as_str())
            .map(String::from),
        creator_id: creator.id,
        network: chain.network.clone(),
        marketcap: BigDecimal::from_str(&marketcap.to_string()).unwrap_or_default(),
        price: BigDecimal::from_str(&initial_price.to_string()).unwrap_or_default(),
        eth_price: BigDecimal::from_str(&eth_price_usd.to_string()).unwrap_or_default(),
        volume: BigDecimal::from(0),
        score: BigDecimal::from(0),
        virtual_eth_amount: BigDecimal::from_str(&chain.virtual_eth_amount.to_string())
            .unwrap_or_default(),
        virtual_token_amount: BigDecimal::from_str(&chain.virtual_token_amount.to_string())
            .unwrap_or_default(),
        pair_address: None,
        pool_type: crate::models::enums::PoolType::V2,
        category: crate::models::enums::TokenCategory::Normal,
        web_link: body
            .get("webLink")
            .and_then(|v| v.as_str())
            .map(String::from),
        telegram_link: body
            .get("telegramLink")
            .and_then(|v| v.as_str())
            .map(String::from),
        twitter_link: body
            .get("twitterLink")
            .and_then(|v| v.as_str())
            .map(String::from),
    };

    diesel::insert_into(tokens::table)
        .values(&new_token)
        .on_conflict(tokens::token_address)
        .do_update()
        .set(&new_token)
        .execute(&mut conn)
        .await?;

    // Delete the processed request
    diesel::delete(token_creation_requests::table.find(request_id))
        .execute(&mut conn)
        .await?;

    // Emit WebSocket event
    let _ = state.ws_tx.send(WsEvent::Deployed {
        token: json!({
            "tokenAddress": token_address,
            "tokenName": body["tokenName"],
            "tokenSymbol": body["tokenSymbol"],
            "tokenImage": body.get("tokenImage"),
            "price": initial_price.to_string(),
            "marketcap": marketcap.to_string(),
            "network": chain.network,
        }),
    });

    tracing::info!("Token created: {token_address} on {}", chain.network);
    Ok(())
}

/// Process a buy/sell event from the blockchain.
pub async fn process_swap(
    state: &AppState,
    chain: &ChainConfig,
    token_address: &str,
    swapper_address: &str,
    is_buy: bool,
    eth_amount: f64,
    token_amount: f64,
    token_price: f64,
    eth_price_usd: f64,
    marketcap_usd: f64,
    tx_hash: &str,
    timestamp: i64,
) -> anyhow::Result<()> {
    let mut conn = state.db.get().await.map_err(|e| anyhow::anyhow!("{e}"))?;

    // Find the token
    let token: crate::models::token::Token = tokens::table
        .filter(tokens::token_address.eq(token_address))
        .first(&mut conn)
        .await?;

    // Find or create swapper user
    let swapper: crate::models::user::User = match users::table
        .filter(users::address.eq(swapper_address))
        .first(&mut conn)
        .await
    {
        Ok(u) => u,
        Err(diesel::result::Error::NotFound) => {
            let new_user = crate::models::user::NewUser {
                address: swapper_address,
                username: None,
                avatar: None,
                bio: None,
            };
            diesel::insert_into(users::table)
                .values(&new_user)
                .returning(users::all_columns)
                .get_result(&mut conn)
                .await?
        }
        Err(e) => return Err(e.into()),
    };

    // Calculate new virtual reserves
    let old_veth: f64 = token.virtual_eth_amount.to_string().parse().unwrap_or(0.0);
    let old_vtoken: f64 = token
        .virtual_token_amount
        .to_string()
        .parse()
        .unwrap_or(0.0);

    // Token side carries no fee, so the token reserve delta is exact.
    let new_vtoken = if is_buy {
        old_vtoken - token_amount
    } else {
        old_vtoken + token_amount
    };
    // Trust the contract's authoritative spot price and derive the ETH reserve from
    // it (fee-independent) instead of reconstructing gross ETH from a hardcoded fee.
    let new_price = token_price;
    let new_veth = if new_price > 0.0 && new_vtoken > 0.0 {
        new_price * new_vtoken
    } else if is_buy {
        old_veth + eth_amount
    } else {
        old_veth
    };
    let new_marketcap = if marketcap_usd > 0.0 {
        marketcap_usd
    } else {
        new_price * chain.total_supply * eth_price_usd
    };

    // Score decay calculation
    let old_score: f64 = token.score.to_string().parse().unwrap_or(0.0);
    let time_diff = timestamp as f64 - token.updated_at.timestamp_millis() as f64 / 1000.0;
    let volume_usd = token_amount * token_price * eth_price_usd;
    let new_score = score_decay(time_diff) * old_score + volume_usd;

    let old_volume: f64 = token.volume.to_string().parse().unwrap_or(0.0);

    // Update token
    diesel::update(tokens::table.find(token.id))
        .set((
            tokens::virtual_eth_amount
                .eq(BigDecimal::from_str(&new_veth.to_string()).unwrap_or_default()),
            tokens::virtual_token_amount
                .eq(BigDecimal::from_str(&new_vtoken.to_string()).unwrap_or_default()),
            tokens::price.eq(BigDecimal::from_str(&new_price.to_string()).unwrap_or_default()),
            tokens::marketcap
                .eq(BigDecimal::from_str(&new_marketcap.to_string()).unwrap_or_default()),
            tokens::eth_price
                .eq(BigDecimal::from_str(&eth_price_usd.to_string()).unwrap_or_default()),
            tokens::score.eq(BigDecimal::from_str(&new_score.to_string()).unwrap_or_default()),
            tokens::volume
                .eq(BigDecimal::from_str(&(old_volume + volume_usd).to_string())
                    .unwrap_or_default()),
        ))
        .execute(&mut conn)
        .await?;

    // Create trade record
    let trade_type = if is_buy {
        TradeType::Buy
    } else {
        TradeType::Sell
    };

    let new_trade = crate::models::trade::NewTrade {
        token_id: token.id,
        swapper_id: swapper.id,
        trade_type,
        eth_amount: BigDecimal::from_str(&eth_amount.to_string()).unwrap_or_default(),
        token_amount: BigDecimal::from_str(&token_amount.to_string()).unwrap_or_default(),
        token_price: BigDecimal::from_str(&token_price.to_string()).unwrap_or_default(),
        eth_price: BigDecimal::from_str(&eth_price_usd.to_string()).unwrap_or_default(),
        tx_hash: tx_hash.to_string(),
        traded_at: timestamp,
    };

    diesel::insert_into(trades::table)
        .values(&new_trade)
        .execute(&mut conn)
        .await?;

    // Update or create holder record
    let holder_exists: Option<crate::models::holder::Holder> = holders::table
        .filter(
            holders::token_id
                .eq(token.id)
                .and(holders::user_id.eq(swapper.id)),
        )
        .first(&mut conn)
        .await
        .optional()?;

    match holder_exists {
        Some(holder) => {
            let old_amount: f64 = holder.amount.to_string().parse().unwrap_or(0.0);
            let new_amount = if is_buy {
                old_amount + token_amount
            } else {
                (old_amount - token_amount).max(0.0)
            };
            diesel::update(holders::table.find(holder.id))
                .set(
                    holders::amount
                        .eq(BigDecimal::from_str(&new_amount.to_string()).unwrap_or_default()),
                )
                .execute(&mut conn)
                .await?;
        }
        None if is_buy => {
            let new_holder = crate::models::holder::NewHolder {
                token_id: token.id,
                user_id: swapper.id,
                amount: BigDecimal::from_str(&token_amount.to_string()).unwrap_or_default(),
            };
            diesel::insert_into(holders::table)
                .values(&new_holder)
                .execute(&mut conn)
                .await?;
        }
        _ => {}
    }

    // Emit WebSocket event
    let _ = state.ws_tx.send(WsEvent::Trade {
        token_address: token_address.to_string(),
        date: timestamp,
        token_price: new_price.to_string(),
        volume: volume_usd.to_string(),
    });

    Ok(())
}

/// Process a token launched event (graduated to DEX).
pub async fn process_token_launched(
    state: &AppState,
    token_address: &str,
    pair_address: &str,
    timestamp: i64,
) -> anyhow::Result<()> {
    let mut conn = state.db.get().await.map_err(|e| anyhow::anyhow!("{e}"))?;

    diesel::update(tokens::table.filter(tokens::token_address.eq(token_address)))
        .set((
            tokens::launched_at.eq(chrono::DateTime::from_timestamp(timestamp, 0)),
            tokens::pair_address.eq(Some(pair_address)),
        ))
        .execute(&mut conn)
        .await?;

    tracing::info!("Token launched to DEX: {token_address} -> pair {pair_address}");
    Ok(())
}

/// Update the last indexed block for a chain.
pub async fn update_last_block(state: &AppState, network: &str, block: i64) -> anyhow::Result<()> {
    let mut conn = state.db.get().await.map_err(|e| anyhow::anyhow!("{e}"))?;

    diesel::update(indexing_state::table.filter(indexing_state::network.eq(network)))
        .set(indexing_state::last_block.eq(block))
        .execute(&mut conn)
        .await?;

    Ok(())
}
