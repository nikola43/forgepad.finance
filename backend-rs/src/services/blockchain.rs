use std::sync::Arc;

use alloy::primitives::{keccak256, Address, Bytes, U256};
use alloy::providers::{Provider, ProviderBuilder, WsConnect};
use alloy::rpc::types::{Filter, Log};
use futures::StreamExt;

use bigdecimal::BigDecimal;
use diesel::prelude::*;
use diesel_async::scoped_futures::ScopedFutureExt;
use diesel_async::{AsyncConnection, RunQueryDsl};
use serde_json::json;
use std::str::FromStr;

use crate::config::chains::ChainConfig;
use crate::models::enums::TradeType;
use crate::models::indexing::{IndexingState, NewIndexingState};
use crate::models::request::TokenCreationRequest;
use crate::schema::{holders, indexing_state, kings, token_creation_requests, tokens, trades, users};
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
/// Supervised: any RPC failure tears the provider down and retries with capped
/// exponential backoff, so a transient outage no longer silently kills indexing.
/// The cursor (`last_block`) is only advanced once a block range has been fully
/// fetched AND processed, so transient RPC errors never skip a block containing
/// a trade.
///
/// Transport is split: an HTTP provider (public RPC) fetches all logs and the
/// chain head, because the public RPC supports full-size `getLogs` chunks and the
/// only WSS endpoint available (Alchemy free tier) caps `eth_getLogs` at a
/// 10-block range. On top of that, a WebSocket `newHeads` subscription (Alchemy)
/// provides low-latency nudges so we react at ~block time (0.2s) instead of
/// waiting for the poll interval. Both the WS nudge and a poll-interval backstop
/// drive a single, serialized catch-up loop — never two concurrent processors —
/// so a log is never processed twice from the overlap. DB writes are idempotent
/// as a second line of defence (trades unique on (tx_hash, log_index); tokens
/// upserted; the creation-request row deleted after use).
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

    // Optional Distributor address per chain. Reads from:
    //   1. <NETWORK>_DISTRIBUTOR_ADDRESS env var (e.g. BSC_DISTRIBUTOR_ADDRESS)
    //   2. DISTRIBUTOR_ADDRESS env var (global fallback)
    //   3. None → feature off, indexing proceeds exactly as before.
    let net_upper = chain.network.to_uppercase();
    let distributor_address: Option<Address> = std::env::var(format!("{net_upper}_DISTRIBUTOR_ADDRESS"))
        .or_else(|_| std::env::var("DISTRIBUTOR_ADDRESS"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .and_then(|s| match s.trim().parse::<Address>() {
            Ok(a) => Some(a),
            Err(e) => {
                tracing::error!("Invalid DISTRIBUTOR_ADDRESS for {}: {e}; reset listener disabled", chain.network);
                None
            }
        });
    match distributor_address {
        Some(d) => tracing::info!("Distributor reset listener enabled for {d:#x}"),
        None => tracing::info!("No DISTRIBUTOR_ADDRESS set; leaderboard reset listener disabled"),
    }

    let mut backoff = 1u64;
    loop {
        match run_listener_once(&state, &chain, contract_address, distributor_address).await {
            Ok(()) => {
                tracing::warn!("Listener loop for {} ended; restarting", chain.network);
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

/// Poll-interval backstop. The WS `newHeads` subscription is the low-latency
/// path; this bounds how long indexing can stall if the WS goes silent, and
/// keeps working when no WS is available at all.
const POLL_INTERVAL_MS: u64 = 1000;

/// Aborts a spawned task when dropped, so a WS subscription task never leaks
/// across supervisor reconnects (each `run_listener_once` gets a fresh one).
struct AbortOnDrop(tokio::task::JoinHandle<()>);
impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// One connect → catch-up → (WS nudge + poll) cycle. Returns Err on any HTTP RPC
/// failure so the supervisor can reconnect; the cursor is never advanced past an
/// unprocessed block. The WS subscription is best-effort: if it can't connect or
/// drops, indexing degrades to poll-only rather than stalling.
async fn run_listener_once(
    state: &Arc<AppState>,
    chain: &ChainConfig,
    contract_address: Address,
    distributor_address: Option<Address>,
) -> anyhow::Result<()> {
    // Server-side indexing RPC. This must support large `eth_getLogs` ranges
    // (BSC public dataseed nodes cap the range — typically ~5k blocks — and
    // QuikNode/Alchemy free tiers cap at a few blocks, so point ETH_RPC_URL at a
    // provider with a generous getLogs limit), so it is deliberately separate
    // from `chain.rpc_url` — the
    // browser-facing endpoint exposed via /config, which only needs to be
    // reachable + CORS-enabled from browsers. Matches the eth_call helpers, which
    // already prefer ETH_RPC_URL.
    let net_upper = chain.network.to_uppercase();
    let indexer_rpc = std::env::var(format!("{net_upper}_RPC_URL"))
        .or_else(|_| std::env::var("ETH_RPC_URL".to_string()))
        .unwrap_or_else(|_| chain.rpc_url.clone());
    let url = indexer_rpc
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid indexer rpc {indexer_rpc}: {e}"))?;
    let provider = ProviderBuilder::new().connect_http(url);

    let head = provider
        .get_block_number()
        .await
        .map_err(|e| anyhow::anyhow!("get_block_number: {e}"))?;

    // Seed a fresh cursor at the chain's configured start_block, or — when it's 0
    // (forward-only: no historical backfill) — at the current head, so the indexer
    // just watches new blocks. This survives an indexing_state wipe without trying
    // an archive backfill the RPC may not support.
    let mut last_block = load_last_block(state, &chain.network, chain.start_block, head).await?;
    tracing::info!("Chain {} resuming from block {}", chain.network, last_block);

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
    last_block = catch_up(state, chain, &provider, contract_address, distributor_address, last_block).await?;
    tracing::info!("Chain {} caught up to {}, watching for new blocks", chain.network, last_block);

    // WS `newHeads` subscription → sends a nudge on the channel per block. The
    // task only signals; it never touches the cursor or processes logs, so the
    // single consumer below stays the only place catch_up runs (dedup by design).
    // `_ws_guard` aborts the task when this function returns.
    let (wake_tx, mut wake_rx) = tokio::sync::mpsc::channel::<()>(8);
    let _ws_guard = chain.ws_url.clone().filter(|u| !u.is_empty()).map(|ws_url| {
        let wake_tx = wake_tx.clone();
        let network = chain.network.clone();
        AbortOnDrop(tokio::spawn(async move {
            match ProviderBuilder::new().connect_ws(WsConnect::new(ws_url)).await {
                Ok(ws_provider) => match ws_provider.subscribe_blocks().await {
                    Ok(sub) => {
                        tracing::info!("Chain {network} WS newHeads subscription active");
                        let mut stream = sub.into_stream();
                        while stream.next().await.is_some() {
                            // Best-effort, coalescing nudge: a full channel already
                            // has a pending wake, so dropping this one is fine.
                            let _ = wake_tx.try_send(());
                        }
                        tracing::warn!("Chain {network} WS block stream ended; poll backstop continues");
                    }
                    Err(e) => tracing::warn!("Chain {network} subscribe_blocks failed: {e}; poll-only"),
                },
                Err(e) => tracing::warn!("Chain {network} WS connect failed: {e}; poll-only"),
            }
        }))
    });
    // Keep one sender alive here so `wake_rx.recv()` stays pending (rather than
    // returning None and busy-looping) even if the WS task exits.
    let _wake_keepalive = wake_tx;

    // Single serialized consumer: either a WS nudge or the poll tick wakes it,
    // then it drains up to the current head. catch_up is a no-op when nothing is
    // new and advances the persisted cursor chunk-by-chunk otherwise.
    let mut ticker = tokio::time::interval(std::time::Duration::from_millis(POLL_INTERVAL_MS));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = wake_rx.recv() => {}   // low-latency WS path (~block time)
            _ = ticker.tick() => {}    // poll backstop
        }
        let head = provider
            .get_block_number()
            .await
            .map_err(|e| anyhow::anyhow!("get_block_number: {e}"))?;
        if head > last_block {
            last_block = catch_up(state, chain, &provider, contract_address, distributor_address, last_block).await?;
        }
    }
}

/// Fetch + process logs from `last_block` up to the current head in chunks,
/// advancing the persisted cursor only after each chunk fully succeeds.
async fn catch_up<P: Provider>(
    state: &Arc<AppState>,
    chain: &ChainConfig,
    provider: &P,
    contract_address: Address,
    distributor_address: Option<Address>,
    mut last_block: u64,
) -> anyhow::Result<u64> {
    // Chunk size bounded by the RPC's getLogs range cap. Archive nodes handle
    // 50k; some providers cap lower — override with INDEXER_CHUNK_SIZE.
    let chunk_size: u64 = std::env::var("INDEXER_CHUNK_SIZE")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(50_000);
    // Confirmation depth: index only up to head - N so a near-head reorg is
    // resolved BEFORE we index those blocks (a reorged-out trade would otherwise
    // corrupt reserves/holder balances permanently). Prod-safe default; the
    // localnet fork sets INDEXER_CONFIRMATIONS=0 for immediate indexing.
    let confirmations: u64 = std::env::var("INDEXER_CONFIRMATIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(12);
    let head = provider
        .get_block_number()
        .await
        .map_err(|e| anyhow::anyhow!("get_block_number: {e}"))?
        .saturating_sub(confirmations);

    // Cursor semantics (consistent with the subscribe loop): `last_block` is the
    // highest FULLY-PROCESSED block; the next block to fetch is `last_block + 1`.
    while last_block < head {
        let from = last_block + 1;
        let end = (from + chunk_size - 1).min(head);
        tracing::info!("Chain {} catching up blocks {} to {}", chain.network, from, end);

        let filter = Filter::new()
            .from_block(alloy::rpc::types::BlockNumberOrTag::Number(from))
            .to_block(alloy::rpc::types::BlockNumberOrTag::Number(end));
        // Watch the Fyuz contract, plus the Distributor when configured, in one
        // getLogs so the reset event is indexed on the same cursor-safe path.
        let filter = match distributor_address {
            Some(d) => filter.address(vec![contract_address, d]),
            None => filter.address(contract_address),
        };

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

/// Load the persisted indexing cursor for a network, seeding it on first run.
///
/// The seed is INDEXER_START_BLOCK (default 0). On a chain with existing history
/// this matters: BNB Smart Chain is ~110M blocks deep, so seeding 0 makes the
/// indexer try to backfill the entire chain from genesis in 50k-block getLogs
/// chunks — it never reaches the head and just hammers the RPC until it is rate
/// limited. Nothing before the Fyuz deployment can contain our events anyway, so
/// set this to the deployment block (or the fork block on a localnet).
///
/// Only used when there is no existing cursor; a real cursor always wins, so this
/// cannot rewind a running indexer.
async fn load_last_block(
    state: &AppState,
    network: &str,
    chain_start_block: u64,
    head: u64,
) -> anyhow::Result<u64> {
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
            // Seed at this chain's configured deployment block so backfill covers
            // all history. When start_block is 0 (forward-only, e.g. archive-gated
            // RPCs like publicnode's free tier), seed at head and just watch new
            // blocks instead of attempting a backfill the RPC would reject.
            let start_block: i64 = if chain_start_block > 0 {
                chain_start_block as i64
            } else {
                head as i64
            };
            tracing::info!(
                "Chain {} has no indexing cursor; seeding at block {}",
                network,
                start_block
            );
            let new_state = NewIndexingState {
                network: network.to_string(),
                last_block: start_block,
            };
            diesel::insert_into(indexing_state::table)
                .values(&new_state)
                .execute(&mut conn)
                .await
                .ok();
            Ok(start_block.max(0) as u64)
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
    let token_launched_sig = keccak256(b"TokenLaunched(address,uint256)");
    // Distributor payout: RoundDistributed(uint256 indexed roundId, address indexed
    // winner, uint256 winnerAmount, uint256 distributedAmount, uint256 holderCount).
    let round_distributed_sig = keccak256(b"RoundDistributed(uint256,address,uint256,uint256,uint256)");

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
    } else if *topic == token_launched_sig {
        // TokenLaunched(address token, uint256 date) — both non-indexed, in data.
        let d = &data.data;
        if d.len() >= 64 {
            let token_address = format!("0x{}", hex::encode(&d[12..32])).to_lowercase();
            let timestamp = U256::from_be_slice(&d[32..64]).to::<u64>() as i64;
            // ponytail: event has no pair address; launched_at is what gates
            // king/discover/rewards. Backfill pair via factory lookup if needed.
            process_token_launched(state, &token_address, "", timestamp).await?;
        }
    } else if *topic == round_distributed_sig {
        // A payout round settled on-chain. Record it so the leaderboard epoch
        // advances (points/leaderboard reset to the new window). Idempotent.
        process_round_distributed_log(state, chain, log).await?;
    }

    Ok(())
}

/// Handle a Distributor `RoundDistributed` event: record the paid round so the
/// leaderboard scoring window rolls forward (this is what "resets" the
/// leaderboard and points after every payout). The event only carries the
/// roundId in its topics, so the round's [timeStart, timeEnd] window is read back
/// from the contract's `rounds(roundId)` getter. Fully idempotent —
/// ON CONFLICT DO NOTHING means a reorg/replay of the same log is a no-op.
async fn process_round_distributed_log(
    state: &AppState,
    chain: &ChainConfig,
    log: &Log,
) -> anyhow::Result<()> {
    use diesel::sql_types::{BigInt, Nullable, Text};
    use diesel_async::RunQueryDsl;

    let topics = log.topics();
    // topics: [sig, roundId, winner]. roundId is the indexed uint256 in topics[1].
    let Some(round_topic) = topics.get(1) else {
        tracing::warn!("RoundDistributed log missing roundId topic; skipping");
        return Ok(());
    };
    let round_id = U256::from_be_slice(round_topic.as_slice());
    let round_id_i64 = i64::try_from(round_id).unwrap_or(0);
    if round_id_i64 <= 0 {
        tracing::warn!("RoundDistributed with non-positive roundId {round_id}; skipping");
        return Ok(());
    }

    let distributor = log.inner.address;
    let tx_hash = log.transaction_hash.map(|h| format!("{h:#x}"));

    // Read the round window from the contract. rounds(uint256) returns
    // (uint8 status, uint64 timeStart, uint64 timeEnd, bool hasRandom, ...): the
    // two windows are static words 1 and 2 of the ABI-encoded response.
    let (time_start, time_end) = match fetch_round_window(chain, distributor, round_id).await {
        Some(w) => w,
        None => {
            tracing::warn!(
                "RoundDistributed {round_id_i64}: could not read round window from {distributor:#x}; skipping record"
            );
            return Ok(());
        }
    };
    if time_end <= time_start {
        tracing::warn!(
            "RoundDistributed {round_id_i64}: invalid window [{time_start}, {time_end}]; skipping"
        );
        return Ok(());
    }

    let mut conn = state.db.get().await.map_err(|e| anyhow::anyhow!("{e}"))?;
    let inserted = diesel::sql_query(
        "INSERT INTO distributor_rounds (round_id, time_start, time_end, tx_hash) \
         VALUES ($1, $2, $3, $4) ON CONFLICT (round_id) DO NOTHING",
    )
    .bind::<BigInt, _>(round_id_i64)
    .bind::<BigInt, _>(time_start)
    .bind::<BigInt, _>(time_end)
    .bind::<Nullable<Text>, _>(tx_hash)
    .execute(&mut conn)
    .await?;

    if inserted > 0 {
        tracing::info!(
            "Distributor round {round_id_i64} recorded (window {time_start}..{time_end}); leaderboard reset"
        );
    } else {
        tracing::debug!("Distributor round {round_id_i64} already recorded; no-op");
    }
    Ok(())
}

/// Read [timeStart, timeEnd] for a round via `rounds(uint256)`. Returns None on
/// any RPC/parse failure so the caller can skip rather than record a bad window.
async fn fetch_round_window(
    chain: &ChainConfig,
    distributor: Address,
    round_id: U256,
) -> Option<(i64, i64)> {
    // rounds(uint256) selector = keccak("rounds(uint256)")[..4].
    let selector = &keccak256(b"rounds(uint256)")[..4];
    let mut call_data = Vec::with_capacity(4 + 32);
    call_data.extend_from_slice(selector);
    call_data.extend_from_slice(&round_id.to_be_bytes::<32>());
    let data = format!("0x{}", hex::encode(&call_data));

    let rpc_url = chain.rpc_url.clone();
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .post(&rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_call",
            "params": [{ "to": format!("{distributor:#x}"), "data": data }, "latest"],
            "id": 1
        }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let hex = resp.get("result")?.as_str()?;
    let trimmed = hex.trim_start_matches("0x");
    // Static head: word0 status, word1 timeStart, word2 timeEnd, ... Need at least
    // 3 words (192 bytes = 384 hex chars) to read both windows.
    if trimmed.len() < 384 {
        return None;
    }
    let time_start = i64::from_str_radix(&trimmed[64..128], 16).ok()?;
    let time_end = i64::from_str_radix(&trimmed[128..192], 16).ok()?;
    Some((time_start, time_end))
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
    // The event carries the contract's own ethPriceUSD — use it. Falling back to a
    // hardcoded $2040 ETH price is wrong on BSC (BNB ≈ $565) and inflates the
    // creation-time marketcap ~3.6x; a live RPC read is the next-best source, and
    // 0 (self-heals on the first trade) is better than a fabricated number.
    let event_eth_price =
        U256::from_be_slice(&data[64..96]).to_string().parse::<f64>().unwrap_or(0.0) / 1e18;
    let request_id = u64::try_from(U256::from_be_slice(&data[96..128])).unwrap_or(0) as i32;
    let timestamp = u64::try_from(U256::from_be_slice(&data[128..160])).unwrap_or(0) as i64;

    let eth_price = if event_eth_price > 0.0 {
        event_eth_price
    } else {
        fetch_eth_price(chain).await.unwrap_or(0.0)
    };
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

/// Fetch the poolType from the on-chain Fyuz contract via tokenPools().
/// The TokenCreated event does not emit poolType, so we must read it from
/// contract state to store it accurately in the backend.
async fn fetch_pool_type(chain: &ChainConfig, token_address: &str) -> Option<crate::models::enums::PoolType> {
    // tokenPools(address) selector = 0xc3d2c3c1 (keccak("tokenPools(address)")[..4]).
    // Returns a struct with 8 fields: ethReserve, tokenReserve, virtualEthReserve,
    // virtualTokenReserve, token, owner, poolType, launched.
    // poolType is the 7th field → word index 6 → byte offset 192 → hex chars 384..448.
    let call_data = format!(
        "0xc3d2c3c1000000000000000000000000{}",
        token_address.strip_prefix("0x").unwrap_or(token_address)
    );
    let rpc_url = chain.rpc_url.clone();
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
    // ABI-encoded struct: 32 bytes (64 hex chars) per field. poolType is the 7th
    // field → word index 6 → hex chars 384..448. Need at least 7 words present.
    let trimmed = hex.trim_start_matches("0x");
    // All 8 fields are static, so the response is exactly 8 words = 512 hex chars.
    // `launched` is the last one, so anything shorter means we can't read it.
    if trimmed.len() < 512 {
        return None;
    }
    let pool_type_hex = &trimmed[384..448]; // word 6 = poolType
    let pt = u8::from_str_radix(pool_type_hex, 16).ok()?;
    // Direct-launch tokens report poolType=3 like V4, but they never had a bonding
    // curve: they are launched from birth with zero virtual reserves. Test the word
    // for zero directly — a full 256-bit reserve does not fit in u128, and parsing
    // it would fail into a wrong answer rather than an obvious one.
    let no_virtual_curve = trimmed[128..192].bytes().all(|b| b == b'0'); // word 2
    let launched_hex = &trimmed[448..512]; // word 7 = launched (bool)
    let launched = u8::from_str_radix(launched_hex, 16).unwrap_or(0) != 0;
    match pt {
        1 => Some(crate::models::enums::PoolType::V2),
        2 => Some(crate::models::enums::PoolType::V3),
        3 if launched && no_virtual_curve => Some(crate::models::enums::PoolType::Direct),
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
    // Read the native-token (BNB on BSC) price from the Fyuz contract's
    // getETHPriceByUSD() (reads the Chainlink feed on-chain; on BSC that feed
    // slot is wired to BNB/USD, so this returns BNB/USD despite the ETH naming).
    let rpc_url = chain.rpc_url.clone();
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
    let rpc_url = chain.rpc_url.clone();
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

    // The staging request (POST /tokens) is unauthenticated and its `sig` (the PK)
    // is guessable, so an attacker could deploy their own token quoting a VICTIM's
    // pending sig to bind the victim's name/image to the attacker's token and
    // consume (brick) the victim's request. Defend by requiring the on-chain tx
    // SENDER to match the request's claimed creator: a hijacker's deploy is sent
    // from the attacker's address, which won't match, so we skip WITHOUT consuming
    // the request — the real creator's later deploy still matches and succeeds.
    // If the sender lookup fails (RPC blip) we fall back to trusting the claimed
    // creator rather than bricking a legitimate launch.
    let claimed = request.creator_address.to_lowercase();
    let creator_address = match fetch_tx_sender(chain, tx_hash).await {
        Some(sender) if sender.eq_ignore_ascii_case(&claimed) => claimed,
        Some(sender) => {
            tracing::warn!(
                "TokenCreated sig {request_id}: on-chain sender {sender} != claimed creator {claimed}; \
                 skipping (possible hijack) and leaving the request for its real creator"
            );
            return Ok(());
        }
        None => {
            tracing::warn!(
                "Could not fetch tx sender for {tx_hash}; trusting claimed creator {claimed}"
            );
            claimed
        }
    };

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
        image_style: body
            .get("imageStyle")
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

    // A brand-new token can immediately be the highest-marketcap token on the
    // curve (e.g. the very first launch) — seed the reign now.
    reconcile_king(state).await;

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
    // Formerly used to fabricate a marketcap from chain.total_supply when the
    // event carried none; that fabrication was removed (see new_marketcap_bd).
    _chain: &ChainConfig,
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

    // Find the token. A swap for a token we don't have a row for (e.g. its
    // TokenCreated was missed, or it was deployed outside our staged flow) must
    // NOT hard-error: that Err propagates up to the indexer supervisor and
    // wedges the whole chain into an infinite reconnect loop, halting ALL trade
    // indexing. Skip this one event instead and keep indexing.
    let token: crate::models::token::Token = match tokens::table
        .filter(tokens::token_address.eq(token_address))
        .first(&mut conn)
        .await
        .optional()?
    {
        Some(t) => t,
        None => {
            tracing::warn!("Swap for unknown token {token_address}; skipping event");
            return Ok(());
        }
    };

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
    // The event's marketCap is the contract's authoritative getTokenVirtualMarketCap.
    // It reads 0 only when the price feed is unusable (e.g. a stale Chainlink round).
    // In that case DON'T fabricate one from a fallback native price — the old code
    // used a hardcoded $2040 ETH fallback on BSC (BNB ≈ $565), inflating marketcap
    // ~3.6x and pushing tokens to a false ~100% graduation progress. Keep the last
    // good marketcap until a trade arrives with a valid price.
    let new_marketcap_bd = if marketcap_usd > 0.0 {
        BigDecimal::from_str(&marketcap_usd.to_string()).unwrap_or_default()
    } else {
        token.marketcap.clone()
    };

    // Score decay calculation
    let old_score: f64 = token.score.to_string().parse().unwrap_or(0.0);
    let time_diff = timestamp as f64 - token.updated_at.timestamp_millis() as f64 / 1000.0;
    let volume_usd = token_amount * token_price * eth_price_usd;
    let new_score = score_decay(time_diff) * old_score + volume_usd;

    let old_volume: f64 = token.volume.to_string().parse().unwrap_or(0.0);

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
        // Exact token amount (wei-derived), reused below for the holder balance
        // so balances never round-trip through lossy f64.
        token_amount: token_amount_bd.clone(),
        token_price: token_price_bd.clone(),
        eth_price: eth_price_bd.clone(),
        tx_hash: tx_hash.to_string(),
        traded_at: timestamp,
        log_index,
    };

    // Owned copies for the transaction closure (async move captures by value).
    let token_id = token.id;
    let swapper_id = swapper.id;
    let price_for_update = token_price_bd.clone();
    let eth_price_for_update = eth_price_bd.clone();
    let score_bd = BigDecimal::from_str(&new_score.to_string()).unwrap_or_default();
    let volume_bd =
        BigDecimal::from_str(&(old_volume + volume_usd).to_string()).unwrap_or_default();
    let holder_delta = token_amount_bd; // exact

    // Apply the whole trade atomically. The idempotent insert, the token
    // aggregate update, and the holder balance must commit together — otherwise
    // a crash between them permanently loses reserves/volume/holder deltas while
    // the (tx_hash, log_index) idempotency guard blocks re-application on replay.
    // A duplicate log inserts nothing and leaves every aggregate untouched.
    let applied: bool = conn
        .transaction::<bool, diesel::result::Error, _>(|conn| {
            async move {
                let inserted = diesel::insert_into(trades::table)
                    .values(&new_trade)
                    .on_conflict((trades::tx_hash, trades::log_index))
                    .do_nothing()
                    .execute(conn)
                    .await?;
                if inserted == 0 {
                    return Ok(false);
                }

                diesel::update(tokens::table.find(token_id))
                    .set((
                        tokens::virtual_eth_amount.eq(&new_veth_bd),
                        tokens::virtual_token_amount.eq(&new_vtoken_bd),
                        tokens::price.eq(&price_for_update),
                        tokens::marketcap.eq(&new_marketcap_bd),
                        tokens::eth_price.eq(&eth_price_for_update),
                        tokens::score.eq(&score_bd),
                        tokens::volume.eq(&volume_bd),
                    ))
                    .execute(conn)
                    .await?;

                // Holder balance in exact BigDecimal (no f64 round-trip).
                let holder_exists: Option<crate::models::holder::Holder> = holders::table
                    .filter(holders::token_id.eq(token_id).and(holders::user_id.eq(swapper_id)))
                    .first(conn)
                    .await
                    .optional()?;
                match holder_exists {
                    Some(holder) => {
                        let mut new_amount = if is_buy {
                            &holder.amount + &holder_delta
                        } else {
                            &holder.amount - &holder_delta
                        };
                        if new_amount < BigDecimal::from(0) {
                            new_amount = BigDecimal::from(0);
                        }
                        diesel::update(holders::table.find(holder.id))
                            .set(holders::amount.eq(new_amount))
                            .execute(conn)
                            .await?;
                    }
                    None if is_buy => {
                        diesel::insert_into(holders::table)
                            .values(crate::models::holder::NewHolder {
                                token_id,
                                user_id: swapper_id,
                                amount: holder_delta.clone(),
                            })
                            .execute(conn)
                            .await?;
                    }
                    _ => {}
                }
                Ok(true)
            }
            .scope_boxed()
        })
        .await?;

    if !applied {
        tracing::debug!(
            "Duplicate swap log skipped: tx={} log_index={}",
            tx_hash,
            log_index
        );
        return Ok(());
    }

    // Emit WebSocket event
    let _ = state.ws_tx.send(WsEvent::Trade {
        token_address: token_address.to_string(),
        date: timestamp,
        token_price: new_price_bd.to_string(),
        volume: volume_usd.to_string(),
    });

    // A trade moved this token's marketcap — the crown may have changed hands.
    reconcile_king(state).await;

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

    // The TokenLaunched event carries no pair address; callers pass "" when it
    // is unknown, and we keep the column NULL rather than storing "".
    if pair_address.is_empty() {
        diesel::update(tokens::table.filter(tokens::token_address.eq(token_address)))
            .set(tokens::launched_at.eq(chrono::DateTime::from_timestamp(timestamp, 0)))
            .execute(&mut conn)
            .await?;
    } else {
        diesel::update(tokens::table.filter(tokens::token_address.eq(token_address)))
            .set((
                tokens::launched_at.eq(chrono::DateTime::from_timestamp(timestamp, 0)),
                tokens::pair_address.eq(Some(pair_address)),
            ))
            .execute(&mut conn)
            .await?;
    }

    tracing::info!("Token launched to DEX: {token_address} -> pair {pair_address}");

    // The graduated token just left the hill — hand the crown to the next
    // highest token still on the curve.
    reconcile_king(state).await;

    Ok(())
}

/// Record King-of-the-Hill reign changes into the `kings` table (powers the
/// Hall of Champions history). Best-effort: reign bookkeeping must never block
/// or fail trade/graduation indexing, so errors are logged and swallowed.
pub async fn reconcile_king(state: &AppState) {
    if let Err(e) = reconcile_king_inner(state).await {
        tracing::warn!("king reconcile failed: {e}");
    }
}

async fn reconcile_king_inner(state: &AppState) -> anyhow::Result<()> {
    let mut conn = state.db.get().await.map_err(|e| anyhow::anyhow!("{e}"))?;

    // Current king: highest marketcap, normal category, still on the bonding
    // curve (graduated tokens leave the hill). Mirrors GET /tokens/king.
    let king_id: Option<i32> = tokens::table
        .filter(tokens::category.eq(crate::models::enums::TokenCategory::Normal))
        .filter(tokens::launched_at.is_null())
        .order(tokens::marketcap.desc())
        .select(tokens::id)
        .first(&mut conn)
        .await
        .optional()?;

    let now = chrono::Utc::now();

    match king_id {
        Some(kid) => {
            // Does the current king already hold an open reign?
            let has_open: bool = kings::table
                .filter(kings::ended_at.is_null().and(kings::token_id.eq(kid)))
                .select(kings::id)
                .first::<i32>(&mut conn)
                .await
                .optional()?
                .is_some();

            // Close every other open reign (crown changed hands).
            diesel::update(
                kings::table.filter(kings::ended_at.is_null().and(kings::token_id.ne(kid))),
            )
            .set(kings::ended_at.eq(now))
            .execute(&mut conn)
            .await?;

            // Open a reign for the new king if it doesn't have one yet.
            if !has_open {
                diesel::insert_into(kings::table)
                    .values((kings::token_id.eq(kid), kings::started_at.eq(now)))
                    .execute(&mut conn)
                    .await?;
            }
        }
        None => {
            // No eligible token — close any lingering open reign.
            diesel::update(kings::table.filter(kings::ended_at.is_null()))
                .set(kings::ended_at.eq(now))
                .execute(&mut conn)
                .await?;
        }
    }

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
