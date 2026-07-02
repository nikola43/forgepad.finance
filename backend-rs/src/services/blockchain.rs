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
///
/// Supervised: any connection/RPC failure tears the provider down and retries
/// with capped exponential backoff, so a dropped WebSocket no longer silently
/// kills indexing. The cursor (`last_block`) is only advanced once a block range
/// has been fully fetched AND processed, so transient RPC errors never skip a
/// block containing a trade.
pub async fn start_listener(state: Arc<AppState>, chain: ChainConfig) {
    tracing::info!(
        "Starting blockchain listener for {} (chain_id: {})",
        chain.name,
        chain.chain_id
    );

    let contract_address: Address = match chain.contract_address.parse() {
        Ok(a) => a,
        Err(e) => {
            tracing::error!("Invalid contract address for {}: {e}", chain.network);
            return;
        }
    };

    let ws_url = match chain.ws_url.clone() {
        Some(u) => u,
        None => {
            tracing::error!("ws_url required for chain {}", chain.network);
            return;
        }
    };

    let mut backoff = 1u64;
    loop {
        match run_listener_once(&state, &chain, contract_address, &ws_url).await {
            Ok(()) => {
                tracing::warn!(
                    "Listener stream for {} ended cleanly; reconnecting",
                    chain.network
                );
                // Don't reset to 1s — a provider that accepts the subscription then
                // immediately closes it would otherwise become a ~1 req/s storm.
                backoff = 5;
            }
            Err(e) => {
                tracing::error!(
                    "Listener for {} failed: {e}; retrying in {}s",
                    chain.network,
                    backoff
                );
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(backoff)).await;
        backoff = (backoff * 2).min(30);
    }
}

/// One connect → catch-up → subscribe cycle. Returns Err on any connection/RPC
/// failure so the supervisor can reconnect; the cursor is never advanced past an
/// unprocessed block.
async fn run_listener_once(
    state: &Arc<AppState>,
    chain: &ChainConfig,
    contract_address: Address,
    ws_url: &str,
) -> anyhow::Result<()> {
    let ws = WsConnect::new(ws_url);
    let provider = ProviderBuilder::new()
        .connect_ws(ws)
        .await
        .map_err(|e| anyhow::anyhow!("WS connect: {e}"))?;

    let mut last_block = load_last_block(state, &chain.network).await?;
    tracing::info!("Chain {} resuming from block {}", chain.network, last_block);

    let head = provider
        .get_block_number()
        .await
        .map_err(|e| anyhow::anyhow!("get_block_number: {e}"))?;

    // Only skip forward on an actual chain reset (cursor ahead of head, e.g. an
    // anvil restart). A large *backward* gap is real history and is backfilled in
    // chunks by catch_up — never silently skipped (that would drop trades).
    if last_block > head {
        tracing::warn!(
            "Chain {} cursor {} ahead of head {} (reset?); resetting to head",
            chain.network, last_block, head
        );
        last_block = head;
        update_last_block(state, &chain.network, head as i64).await.ok();
    } else if head - last_block > 100_000 {
        tracing::warn!(
            "Chain {} is {} blocks behind head {}; backfilling in chunks",
            chain.network, head - last_block, head
        );
    }

    // Catch up to head, cursor-safe.
    last_block = catch_up(state, chain, &provider, contract_address, last_block).await?;

    // Blocks may have been mined during catch-up; backfill that gap before
    // subscribing so nothing between the initial snapshot and the subscription
    // is dropped.
    let head2 = provider
        .get_block_number()
        .await
        .map_err(|e| anyhow::anyhow!("get_block_number: {e}"))?;
    if head2 > last_block {
        last_block = catch_up(state, chain, &provider, contract_address, last_block).await?;
    }

    tracing::info!("Chain {} caught up to {}, subscribing", chain.network, last_block);

    let sub = provider
        .subscribe_blocks()
        .await
        .map_err(|e| anyhow::anyhow!("subscribe_blocks: {e}"))?;
    let mut stream = sub.into_stream();

    while let Some(block) = stream.next().await {
        let block_num = block.number;
        if block_num <= last_block {
            continue; // already indexed (reorg replay / duplicate notification)
        }

        // Process the whole range (last_block, block_num] so no block is skipped
        // even if block notifications arrive non-contiguously.
        let from = last_block + 1;
        let filter = Filter::new()
            .address(contract_address)
            .from_block(alloy::rpc::types::BlockNumberOrTag::Number(from))
            .to_block(alloy::rpc::types::BlockNumberOrTag::Number(block_num));

        let logs = provider
            .get_logs(&filter)
            .await
            .map_err(|e| anyhow::anyhow!("get_logs {from}-{block_num}: {e}"))?;
        for log in logs {
            process_log(state, chain, &log)
                .await
                .map_err(|e| anyhow::anyhow!("process_log at block {block_num}: {e}"))?;
        }

        // Only now advance the cursor.
        last_block = block_num;
        update_last_block(state, &chain.network, block_num as i64).await.ok();
    }

    Ok(())
}

/// Fetch + process logs from `last_block` up to the current head in chunks,
/// advancing the persisted cursor only after each chunk fully succeeds.
async fn catch_up<P: Provider>(
    state: &Arc<AppState>,
    chain: &ChainConfig,
    provider: &P,
    contract_address: Address,
    mut last_block: u64,
) -> anyhow::Result<u64> {
    const CHUNK_SIZE: u64 = 50_000;
    let head = provider
        .get_block_number()
        .await
        .map_err(|e| anyhow::anyhow!("get_block_number: {e}"))?;

    // Cursor semantics (consistent with the subscribe loop): `last_block` is the
    // highest FULLY-PROCESSED block; the next block to fetch is `last_block + 1`.
    while last_block < head {
        let from = last_block + 1;
        let end = (from + CHUNK_SIZE - 1).min(head);
        tracing::info!("Chain {} catching up blocks {} to {}", chain.network, from, end);

        let filter = Filter::new()
            .address(contract_address)
            .from_block(alloy::rpc::types::BlockNumberOrTag::Number(from))
            .to_block(alloy::rpc::types::BlockNumberOrTag::Number(end));

        let logs = provider
            .get_logs(&filter)
            .await
            .map_err(|e| anyhow::anyhow!("catch_up get_logs {from}-{end}: {e}"))?;
        for log in logs {
            process_log(state, chain, &log)
                .await
                .map_err(|e| anyhow::anyhow!("catch_up process_log: {e}"))?;
        }

        // Advance only after the whole chunk was fetched AND processed.
        last_block = end;
        update_last_block(state, &chain.network, last_block as i64).await.ok();
    }

    Ok(last_block)
}

/// Load the persisted indexing cursor for a network, inserting a zero row if absent.
async fn load_last_block(state: &AppState, network: &str) -> anyhow::Result<u64> {
    let mut conn = state.db.get().await.map_err(|e| anyhow::anyhow!("{e}"))?;
    let idx_state: Option<IndexingState> = indexing_state::table
        .filter(indexing_state::network.eq(network))
        .first(&mut conn)
        .await
        .optional()
        .unwrap_or(None);

    match idx_state {
        Some(s) => Ok(s.last_block.max(0) as u64),
        None => {
            let new_state = NewIndexingState {
                network: network.to_string(),
                last_block: 0,
            };
            diesel::insert_into(indexing_state::table)
                .values(&new_state)
                .execute(&mut conn)
                .await
                .ok();
            Ok(0)
        }
    }
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

    // log index within its block — used together with tx_hash as the trade's
    // idempotency key so replays/reorgs cannot double-count.
    let log_index = log.log_index.unwrap_or(0) as i64;

    if *topic == token_created_sig {
        let tx_hash = log.transaction_hash.map(|h| format!("{h:#x}")).unwrap_or_default();
        process_token_created_log(state, chain, &data.data, &tx_hash).await?;
    } else if *topic == buy_tokens_sig {
        let tx_hash = log.transaction_hash.map(|h| format!("{h:#x}")).unwrap_or_default();
        process_swap_log(state, chain, &data.data, true, &tx_hash, log_index).await?;
    } else if *topic == sell_tokens_sig {
        let tx_hash = log.transaction_hash.map(|h| format!("{h:#x}")).unwrap_or_default();
        process_swap_log(state, chain, &data.data, false, &tx_hash, log_index).await?;
    }

    Ok(())
}

async fn process_token_created_log(
    state: &AppState,
    chain: &ChainConfig,
    data: &Bytes,
    tx_hash: &str,
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
    let pool_type = fetch_pool_type(chain, &token_address).await.unwrap_or(crate::models::enums::PoolType::V2);

    process_token_created(
        state,
        chain,
        request_id,
        &token_address,
        token_price,
        eth_price,
        timestamp,
        tx_hash,
        pool_type,
    )
    .await?;

    tracing::info!("Processed TokenCreated: {} at {}", token_address, timestamp);
    Ok(())
}

/// Fetch the poolType from the on-chain Arrowpad contract via tokenPools().
/// The TokenCreated event does not emit poolType, so we must read it from
/// contract state to store it accurately in the backend.
async fn fetch_pool_type(chain: &ChainConfig, token_address: &str) -> Option<crate::models::enums::PoolType> {
    // tokenPools(address) selector = 0x1e4c668a
    // Returns a struct with 8 fields: ethReserve, tokenReserve, virtualEthReserve,
    // virtualTokenReserve, token, owner, poolType, launched.
    // poolType is the 7th field (offset 160 bytes in the ABI-encoded return).
    let call_data = format!(
        "0x1e4c668a000000000000000000000000{}",
        token_address.strip_prefix("0x").unwrap_or(token_address)
    );
    let rpc_url = std::env::var("ETH_RPC_URL").unwrap_or_else(|_| chain.rpc_url.clone());
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .post(&rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{
                "to": chain.contract_address,
                "data": call_data
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
    // ABI-encoded struct: 32 bytes each for 8 fields. poolType is the 7th field
    // at offset 192 bytes (6 * 32 = 192) from the data start.
    let trimmed = hex.trim_start_matches("0x");
    if trimmed.len() < 256 {
        return None;
    }
    let pool_type_hex = &trimmed[192..256]; // bytes 192..224 = 7th field
    let pt = u8::from_str_radix(pool_type_hex, 16).ok()?;
    match pt {
        1 => Some(crate::models::enums::PoolType::V2),
        2 => Some(crate::models::enums::PoolType::V3),
        3 => Some(crate::models::enums::PoolType::V4),
        _ => Some(crate::models::enums::PoolType::V2),
    }
}

async fn process_swap_log(
    state: &AppState,
    chain: &ChainConfig,
    data: &Bytes,
    is_buy: bool,
    tx_hash: &str,
    log_index: i64,
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

    // Precise amounts straight from wei (no lossy f64 hop) — these are the stored,
    // money-critical trade values that drive leaderboard rewards.
    let eth_amount_bd = wei_to_bd(&data[64..96]);
    let token_amount_bd = wei_to_bd(&data[96..128]);
    let token_price_bd = wei_to_bd(&data[128..160]);
    let event_eth_price_bd = wei_to_bd(&data[160..192]);

    let timestamp = u64::try_from(U256::from_be_slice(&data[224..256])).unwrap_or(0) as i64;
    if timestamp == 0 {
        return Ok(()); // skip invalid events
    }

    let (eth_price, eth_price_bd) = if event_eth_price > 0.0 {
        (event_eth_price, event_eth_price_bd)
    } else {
        let fallback = fetch_eth_price(chain).await.unwrap_or(2040.0);
        (fallback, BigDecimal::from_str(&fallback.to_string()).unwrap_or_default())
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
        log_index,
        eth_amount_bd,
        token_amount_bd,
        token_price_bd,
        eth_price_bd,
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
    // Read ETH price from Arrowpad contract's getETHPriceByUSD() (uses Chainlink on-chain)
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

/// Fetch the `from` (sender) of a transaction by hash. Used to authenticate the
/// on-chain creator of a token rather than trusting the unauthenticated staging
/// request. Returns None on any RPC/parse failure (caller falls back gracefully).
async fn fetch_tx_sender(chain: &ChainConfig, tx_hash: &str) -> Option<String> {
    let rpc_url = std::env::var("ETH_RPC_URL").unwrap_or_else(|_| chain.rpc_url.clone());
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .post(&rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_getTransactionByHash",
            "params": [tx_hash],
            "id": 1
        }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    resp.get("result")?.get("from")?.as_str().map(|s| s.to_lowercase())
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
    tx_hash: &str,
    pool_type: crate::models::enums::PoolType,
) -> anyhow::Result<()> {
    let mut conn = state.db.get().await.map_err(|e| anyhow::anyhow!("{e}"))?;

    // Find the pending request. Idempotent: if it was already processed (row
    // deleted), a re-delivered TokenCreated log is a no-op rather than an error
    // that would wedge the whole listener into an infinite reconnect loop.
    let request: TokenCreationRequest = match token_creation_requests::table
        .find(request_id)
        .first(&mut conn)
        .await
        .optional()?
    {
        Some(r) => r,
        None => {
            tracing::debug!("TokenCreated request {request_id} already processed; skipping");
            return Ok(());
        }
    };

    let body = &request.body;

    // The staging request (POST /tokens) is unauthenticated and carries a
    // client-claimed creator_address, so it cannot be trusted for attribution.
    // Authenticate the creator against the actual on-chain transaction sender.
    // Fall back to the claimed address only if the RPC lookup fails.
    let mut creator_address = request.creator_address.to_lowercase();
    match fetch_tx_sender(chain, tx_hash).await {
        Some(sender) => {
            if !sender.eq_ignore_ascii_case(&creator_address) {
                tracing::warn!(
                    "TokenCreated creator mismatch (request claimed {}, on-chain sender {}); using on-chain sender",
                    creator_address,
                    sender
                );
                creator_address = sender.to_lowercase();
            }
        }
        None => tracing::warn!(
            "Could not fetch tx sender for {}; trusting claimed creator {}",
            tx_hash,
            creator_address
        ),
    }

    // Find or create the creator user (the on-chain deployer may not have a row).
    let creator: crate::models::user::User = match users::table
        .filter(users::address.eq(&creator_address))
        .first(&mut conn)
        .await
        .optional()?
    {
        Some(u) => u,
        None => {
            let new_user = crate::models::user::NewUser {
                address: &creator_address,
                username: None,
                avatar: None,
                bio: None,
            };
            diesel::insert_into(users::table)
                .values(&new_user)
                .get_result(&mut conn)
                .await?
        }
    };

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
        pool_type,
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

/// Convert a 32-byte big-endian U256 wei value to a BigDecimal in whole units
/// (÷ 1e18) with no lossy f64 intermediate. A wei amount like 5e16 exceeds f64's
/// exact integer range, so this preserves full precision for stored trade values.
fn wei_to_bd(bytes: &[u8]) -> BigDecimal {
    let wei = U256::from_be_slice(bytes).to_string();
    BigDecimal::from_str(&wei).unwrap_or_default()
        / BigDecimal::from_str("1000000000000000000").unwrap()
}

/// Process a buy/sell event from the blockchain.
pub async fn process_swap(
    state: &AppState,
    chain: &ChainConfig,
    token_address: &str,
    swapper_address: &str,
    is_buy: bool,
    _eth_amount: f64,
    token_amount: f64,
    token_price: f64,
    eth_price_usd: f64,
    marketcap_usd: f64,
    tx_hash: &str,
    timestamp: i64,
    log_index: i64,
    // Precise wei-derived amounts for the stored trade row (reward-critical).
    eth_amount_bd: BigDecimal,
    token_amount_bd: BigDecimal,
    token_price_bd: BigDecimal,
    eth_price_bd: BigDecimal,
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

    // Use BigDecimal directly for reserve tracking so precision is never lost
    // through an f64 round-trip. Over many trades, f64 drift causes the
    // off-chain virtual reserves to diverge from the on-chain reality, which
    // corrupts the frontend price/market cap display.
    let old_veth_bd = token.virtual_eth_amount.clone();
    let old_vtoken_bd = token.virtual_token_amount.clone();

    // Token side carries no fee, so the token reserve delta is exact.
    let new_vtoken_bd = if is_buy {
        old_vtoken_bd - &token_amount_bd
    } else {
        old_vtoken_bd + &token_amount_bd
    };
    // Trust the contract's authoritative spot price and derive the ETH reserve from
    // it (fee-independent) instead of reconstructing gross ETH from a hardcoded fee.
    let new_price_bd = &token_price_bd;
    let new_veth_bd = if new_price_bd > &BigDecimal::from(0) && new_vtoken_bd > BigDecimal::from(0)
    {
        new_price_bd * &new_vtoken_bd
    } else if is_buy {
        old_veth_bd + &eth_amount_bd
    } else {
        old_veth_bd
    };
    let new_marketcap_bd = if marketcap_usd > 0.0 {
        BigDecimal::from_str(&marketcap_usd.to_string()).unwrap_or_default()
    } else {
        new_price_bd
            * BigDecimal::from_str(&chain.total_supply.to_string()).unwrap_or_default()
            * &eth_price_bd
    };

    // Score decay calculation
    let old_score: f64 = token.score.to_string().parse().unwrap_or(0.0);
    let time_diff = timestamp as f64 - token.updated_at.timestamp_millis() as f64 / 1000.0;
    let volume_usd = token_amount * token_price * eth_price_usd;
    let new_score = score_decay(time_diff) * old_score + volume_usd;

    let old_volume: f64 = token.volume.to_string().parse().unwrap_or(0.0);

    // Idempotent trade insert FIRST. (tx_hash, log_index) is unique, so a
    // re-delivered log (reconnect reprocess / reorg replay) inserts nothing and we
    // bail out BEFORE touching any aggregate — otherwise volume/score/reserves and
    // holder balances would double-count on every duplicate.
    let trade_type = if is_buy {
        TradeType::Buy
    } else {
        TradeType::Sell
    };

    let new_trade = crate::models::trade::NewTrade {
        token_id: token.id,
        swapper_id: swapper.id,
        trade_type,
        eth_amount: eth_amount_bd,
        token_amount: token_amount_bd,
        token_price: token_price_bd.clone(),
        eth_price: eth_price_bd.clone(),
        tx_hash: tx_hash.to_string(),
        traded_at: timestamp,
        log_index,
    };

    let inserted = diesel::insert_into(trades::table)
        .values(&new_trade)
        .on_conflict((trades::tx_hash, trades::log_index))
        .do_nothing()
        .execute(&mut conn)
        .await?;

    if inserted == 0 {
        tracing::debug!(
            "Duplicate swap log skipped: tx={} log_index={}",
            tx_hash,
            log_index
        );
        return Ok(());
    }

    // Genuinely new trade — now safe to apply aggregates exactly once.
    diesel::update(tokens::table.find(token.id))
        .set((
            tokens::virtual_eth_amount.eq(&new_veth_bd),
            tokens::virtual_token_amount.eq(&new_vtoken_bd),
            tokens::price.eq(&new_price_bd),
            tokens::marketcap.eq(&new_marketcap_bd),
            tokens::eth_price.eq(&eth_price_bd),
            tokens::score.eq(BigDecimal::from_str(&new_score.to_string()).unwrap_or_default()),
            tokens::volume
                .eq(BigDecimal::from_str(&(old_volume + volume_usd).to_string())
                    .unwrap_or_default()),
        ))
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
        token_price: new_price_bd.to_string(),
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

#[cfg(test)]
mod money_tests {
    use super::*;

    #[test]
    fn wei_to_bd_is_exact() {
        // 0.05 ETH = 5e16 wei — exceeds f64's exact-integer range, so the old
        // f64 path could drift; BigDecimal must be exact.
        let bytes = U256::from(50_000_000_000_000_000u128).to_be_bytes::<32>();
        assert_eq!(
            wei_to_bd(&bytes).normalized(),
            BigDecimal::from_str("0.05").unwrap().normalized()
        );
        // 1 wei preserved to 18 dp.
        let one = U256::from(1u8).to_be_bytes::<32>();
        assert_eq!(
            wei_to_bd(&one).normalized(),
            BigDecimal::from_str("0.000000000000000001").unwrap().normalized()
        );
        // Large value keeps every significant digit.
        let big = U256::from_str("123456789123456789123456789").unwrap().to_be_bytes::<32>();
        assert_eq!(
            wei_to_bd(&big).normalized(),
            BigDecimal::from_str("123456789.123456789123456789").unwrap().normalized()
        );
    }
}
