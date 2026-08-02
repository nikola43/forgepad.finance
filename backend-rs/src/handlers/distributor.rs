// Distributor contract support: leaderboard shares for on-chain payout rounds.
//
// The Distributor contract (foundry/src/Distributor.sol) pays 90% of its pot
// pro-rata by leaderboard share and 10% to a VRF-picked winner. Chainlink
// Functions doesn't exist on BSC, so the round-runner (scripts/) fetches the
// packed shares from GET /shares here and posts them on-chain with the poster
// key. After distribute() confirms, it records the round via POST /rounds —
// the newest round's time_end becomes the start of the next leaderboard
// window, which is what "clears" the leaderboard after every payout.

use axum::extract::{Path, State};
use crate::errors::Query;
use axum::http::HeaderMap;
use axum::Json;
use diesel::prelude::QueryableByName;
use diesel::sql_types::{BigInt, Double, Nullable, Text};
use diesel::OptionalExtension;
use diesel_async::RunQueryDsl;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::errors::{AppError, AppResult};
use crate::AppState;

/// Start of the current scoring window: the end of the last paid round, or 0
/// if nothing has been distributed yet.
pub async fn epoch_start(state: &AppState) -> AppResult<i64> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    #[derive(QueryableByName)]
    struct E {
        #[diesel(sql_type = BigInt)]
        epoch: i64,
    }
    let e: E = diesel::sql_query(
        "SELECT COALESCE(MAX(time_end), 0) AS epoch FROM distributor_rounds",
    )
    .get_result(&mut conn)
    .await?;
    Ok(e.epoch)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharesQuery {
    /// Window start (unix seconds). Defaults to the end of the last paid round.
    pub from: Option<i64>,
    /// Window end (unix seconds). Defaults to now.
    pub to: Option<i64>,
    /// Max holders, top-N by points. Defaults to 100 (the distribution size).
    pub limit: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareEntry {
    pub address: String,
    pub points: f64,
    /// The holder's fraction of 2^32 — the on-chain share unit.
    pub share: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharesResponse {
    pub from: i64,
    pub to: i64,
    pub total_points: f64,
    pub holders: Vec<ShareEntry>,
    /// Calldata for Distributor.postShares: 24-byte entries, 20-byte address
    /// followed by the big-endian uint32 share. 0x-prefixed hex.
    pub packed: String,
}

// GET /distributor/shares
pub async fn get_shares(
    State(state): State<Arc<AppState>>,
    Query(params): Query<SharesQuery>,
) -> AppResult<Json<SharesResponse>> {
    let from = match params.from {
        Some(f) => f,
        None => epoch_start(&state).await?,
    };
    let to = params.to.unwrap_or_else(|| chrono::Utc::now().timestamp());
    if to <= from {
        return Err(AppError::BadRequest("`to` must be after `from`".to_string()));
    }
    // Hard-capped at the contract's MAX_HOLDERS: a bigger payload makes
    // postShares revert TooManyHolders, which through the CRE forwarder is a
    // silent no-round.
    let limit = params.limit.unwrap_or(100).clamp(1, 100);

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    #[derive(QueryableByName)]
    struct Row {
        #[diesel(sql_type = Text)]
        address: String,
        #[diesel(sql_type = Double)]
        points: f64,
    }

    // Canonical scoring — see handlers/points.rs. Time-weighted net position over
    // the window, plus grants capped at GRANT_CAP_RATIO x that, rounded to whole
    // points. This is the number that becomes a holder's share of the pot, so it
    // is deliberately the SAME expression the leaderboard displays.
    //
    // The `min_payout_points()` floor is doing two jobs. It is a dust filter — a
    // payout push costs ~13k gas (~$0.02), so paying a holder owed less than that
    // destroys value — and it is the lottery's anti-sybil price: the contract
    // draws its 10% winner uniformly from whoever is posted here, one ticket
    // each, so a ticket costs exactly what clearing this floor costs.
    //
    // `from`/`to` come from our own DB and the chain (never user input), and the
    // floor is a parsed f64, so inlining them is injection-safe.
    let floor = crate::handlers::points::min_payout_points();
    // Never time-weight against a 1970 window start — see clamp_window_start.
    let from = crate::handlers::points::clamp_window_start(&state, from).await?;
    let rows: Vec<Row> = diesel::sql_query(format!(
        "{with} \
         SELECT u.address, {points} AS points \
         FROM users u {joins} \
         WHERE {points} >= {floor} \
         ORDER BY points DESC, u.address ASC \
         LIMIT $1",
        with = crate::handlers::points::points_with(from, to),
        points = crate::handlers::points::points_expr(),
        joins = crate::handlers::points::POINTS_JOINS,
        floor = floor,
    ))
    .bind::<BigInt, _>(limit)
    .load(&mut conn)
    .await?;

    let total_points: f64 = rows.iter().map(|r| r.points).sum();

    let mut holders = Vec::with_capacity(rows.len());
    let mut packed = Vec::with_capacity(rows.len() * 24);
    for r in &rows {
        let addr = r.address.trim_start_matches("0x");
        let Ok(bytes) = hex::decode(addr) else { continue };
        if bytes.len() != 20 {
            continue;
        }
        // Floor of the fraction of 2^32; the sum over holders can never exceed
        // 2^32, so the contract can never over-distribute.
        let share = ((r.points / total_points) * 4294967296.0).floor() as u64;
        let share = share.min(u32::MAX as u64) as u32;
        packed.extend_from_slice(&bytes);
        packed.extend_from_slice(&share.to_be_bytes());
        holders.push(ShareEntry {
            address: r.address.clone(),
            points: r.points,
            share,
        });
    }

    Ok(Json(SharesResponse {
        from,
        to,
        total_points,
        holders,
        packed: format!("0x{}", hex::encode(packed)),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRoundBody {
    pub round_id: i64,
    pub time_start: i64,
    pub time_end: i64,
    pub tx_hash: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRoundResponse {
    pub success: bool,
    pub epoch_start: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PotResponse {
    /// Live BNB balance of the Distributor — the pot a round would pay from.
    ///
    /// `null` when DISTRIBUTOR_ADDRESS is unset or the RPC is unreachable, so the
    /// UI can hide the figure rather than render a made-up zero next to the word
    /// "pool". A pot that reads 0 during an RPC blip is worse than no pot at all.
    pub pot_bnb: Option<f64>,
    /// Share paid pro-rata by points; the remainder goes to the random winner.
    pub distribute_bps: f64,
    /// Unix seconds of the next round close, on the contract's own schedule.
    pub round_end: i64,
    /// Points across the whole payout set — the denominator of every share.
    /// Lets a client price a point without re-deriving the scoring rules.
    /// `null` when it could not be computed, so callers hide the estimate.
    pub total_points: Option<f64>,
    /// Points credited per $1 of volume traded. Buys and sells score alike.
    pub points_per_usd: f64,
}

/// GET /distributor/pot — the live pot, for the leaderboard's pool card.
///
/// Deliberately public and unauthenticated: it reports the contract's own
/// balance, which anyone can read off an explorer. Redis-cached for 60s inside
/// `distributor_pot_bnb`, so polling this does not hammer the RPC.
pub async fn get_pot(State(state): State<Arc<AppState>>) -> AppResult<Json<PotResponse>> {
    let now = chrono::Utc::now().timestamp();
    // Prefer the contract's own schedule over the mirrored constants — see
    // `distributor_next_round_at`. Falls back when the RPC is unreachable so the
    // card still renders a countdown rather than nothing.
    let round_end = crate::handlers::points::distributor_next_round_at(&state)
        .await
        .unwrap_or_else(|| crate::handlers::points::next_round_end(now));
    Ok(Json(PotResponse {
        pot_bnb: crate::handlers::points::distributor_pot_bnb(&state).await,
        distribute_bps: crate::handlers::points::DISTRIBUTE_BPS,
        round_end,
        total_points: crate::handlers::points::payout_total_points(&state).await,
        points_per_usd: crate::handlers::points::POINTS_PER_USD_VOLUME,
    }))
}

// ---------------------------------------------------------------------------
// Payout receipts.
//
// The platform's distinguishing claim is that it pays traders back 0.3% of every
// trade. A claim with no receipts is a marketing line, so these endpoints publish
// the evidence: every settled round, what it paid, to whom, and the VRF word that
// picked the lottery winner — all of it re-derivable from the chain by anyone who
// wants to check.
//
// Amounts are stored and served as exact WEI STRINGS. They are money, and a f64
// cannot hold 1e18-scale integers exactly; the frontend formats for display.
// ---------------------------------------------------------------------------

/// Wei values arrive from Postgres NUMERIC. `BigDecimal::to_string` on a value
/// that came back with a scale renders "123.000", which is not a uint256 — trim
/// to the integer part so the string is always valid wei.
fn wei_str(v: Option<bigdecimal::BigDecimal>) -> Option<String> {
    v.map(|d| d.with_scale(0).to_string())
}

#[derive(QueryableByName)]
struct RoundRow {
    #[diesel(sql_type = BigInt)]
    round_id: i64,
    #[diesel(sql_type = BigInt)]
    time_start: i64,
    #[diesel(sql_type = BigInt)]
    time_end: i64,
    #[diesel(sql_type = Nullable<Text>)]
    tx_hash: Option<String>,
    #[diesel(sql_type = Nullable<diesel::sql_types::Numeric>)]
    pot_wei: Option<bigdecimal::BigDecimal>,
    #[diesel(sql_type = Nullable<diesel::sql_types::Numeric>)]
    distributed_wei: Option<bigdecimal::BigDecimal>,
    #[diesel(sql_type = Nullable<Text>)]
    winner_address: Option<String>,
    #[diesel(sql_type = Nullable<diesel::sql_types::Numeric>)]
    winner_amount_wei: Option<bigdecimal::BigDecimal>,
    #[diesel(sql_type = Nullable<diesel::sql_types::Integer>)]
    holder_count: Option<i32>,
    #[diesel(sql_type = Nullable<diesel::sql_types::Numeric>)]
    vrf_random: Option<bigdecimal::BigDecimal>,
    #[diesel(sql_type = Nullable<BigInt>)]
    distributed_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundReceipt {
    pub round_id: i64,
    pub time_start: i64,
    pub time_end: i64,
    pub tx_hash: Option<String>,
    pub pot_wei: Option<String>,
    pub distributed_wei: Option<String>,
    pub winner_address: Option<String>,
    pub winner_amount_wei: Option<String>,
    pub holder_count: Option<i32>,
    /// The VRF word that selected the winner. Published so the draw can be
    /// checked against the coordinator's own fulfilment, not merely trusted.
    pub vrf_random: Option<String>,
    pub distributed_at: Option<i64>,
}

impl From<RoundRow> for RoundReceipt {
    fn from(r: RoundRow) -> Self {
        Self {
            round_id: r.round_id,
            time_start: r.time_start,
            time_end: r.time_end,
            tx_hash: r.tx_hash,
            pot_wei: wei_str(r.pot_wei),
            distributed_wei: wei_str(r.distributed_wei),
            winner_address: r.winner_address,
            winner_amount_wei: wei_str(r.winner_amount_wei),
            holder_count: r.holder_count,
            vrf_random: wei_str(r.vrf_random),
            distributed_at: r.distributed_at,
        }
    }
}

const ROUND_COLUMNS: &str = "round_id, time_start, time_end, tx_hash, pot_wei, \
     distributed_wei, winner_address, winner_amount_wei, holder_count, \
     vrf_random, distributed_at";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundsQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// GET /distributor/rounds — the public ledger of settled payout rounds.
pub async fn list_rounds(
    State(state): State<Arc<AppState>>,
    Query(params): Query<RoundsQuery>,
) -> AppResult<Json<Vec<RoundReceipt>>> {
    let limit = params.limit.unwrap_or(25).clamp(1, 100);
    let offset = params.offset.unwrap_or(0).max(0);

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let rows: Vec<RoundRow> = diesel::sql_query(format!(
        "SELECT {ROUND_COLUMNS} FROM distributor_rounds \
         ORDER BY round_id DESC LIMIT $1 OFFSET $2"
    ))
    .bind::<BigInt, _>(limit)
    .bind::<BigInt, _>(offset)
    .load(&mut conn)
    .await?;

    Ok(Json(rows.into_iter().map(RoundReceipt::from).collect()))
}

#[derive(QueryableByName)]
struct PayoutRow {
    #[diesel(sql_type = BigInt)]
    round_id: i64,
    #[diesel(sql_type = Text)]
    address: String,
    #[diesel(sql_type = BigInt)]
    share: i64,
    #[diesel(sql_type = diesel::sql_types::Numeric)]
    amount_wei: bigdecimal::BigDecimal,
    #[diesel(sql_type = Nullable<Text>)]
    username: Option<String>,
    #[diesel(sql_type = Nullable<Text>)]
    avatar: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayoutLine {
    pub round_id: i64,
    pub address: String,
    /// The recipient's fraction of 2^32, exactly as committed on-chain.
    pub share: i64,
    pub amount_wei: String,
    pub username: Option<String>,
    pub avatar: Option<String>,
}

impl From<PayoutRow> for PayoutLine {
    fn from(p: PayoutRow) -> Self {
        Self {
            round_id: p.round_id,
            address: p.address,
            share: p.share,
            amount_wei: p.amount_wei.with_scale(0).to_string(),
            username: p.username,
            avatar: p.avatar,
        }
    }
}

/// Recipients of a round, richest first, joined to profiles for display.
const PAYOUT_SELECT: &str = "SELECT p.round_id, p.address, p.share, p.amount_wei, \
        u.username, u.avatar \
     FROM distributor_payouts p \
     LEFT JOIN users u ON u.address = p.address ";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundDetail {
    #[serde(flatten)]
    pub round: RoundReceipt,
    pub payouts: Vec<PayoutLine>,
}

/// GET /distributor/rounds/:id — one round's full receipt.
pub async fn get_round(
    State(state): State<Arc<AppState>>,
    Path(round_id): Path<i64>,
) -> AppResult<Json<RoundDetail>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let row: Option<RoundRow> = diesel::sql_query(format!(
        "SELECT {ROUND_COLUMNS} FROM distributor_rounds WHERE round_id = $1"
    ))
    .bind::<BigInt, _>(round_id)
    .get_result(&mut conn)
    .await
    .optional()?;

    let Some(row) = row else {
        return Err(AppError::NotFound(format!("Round {round_id}")));
    };

    let payouts: Vec<PayoutRow> = diesel::sql_query(format!(
        "{PAYOUT_SELECT} WHERE p.round_id = $1 ORDER BY p.amount_wei DESC, p.address ASC"
    ))
    .bind::<BigInt, _>(round_id)
    .load(&mut conn)
    .await?;

    Ok(Json(RoundDetail {
        round: row.into(),
        payouts: payouts.into_iter().map(PayoutLine::from).collect(),
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressPayouts {
    pub address: String,
    /// Lifetime wei received across every settled round.
    pub total_wei: String,
    pub rounds_paid: i64,
    pub payouts: Vec<PayoutLine>,
}

/// GET /distributor/payouts/:address — one wallet's payout history.
///
/// The answer to "has this thing ever actually paid ME?", which nothing in the
/// product could previously answer.
pub async fn get_address_payouts(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<AddressPayouts>> {
    let address = address.trim().to_lowercase();
    if !address.starts_with("0x") || address.len() != 42 {
        return Err(AppError::BadRequest("Invalid address".to_string()));
    }

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let payouts: Vec<PayoutRow> = diesel::sql_query(format!(
        "{PAYOUT_SELECT} WHERE p.address = $1 ORDER BY p.round_id DESC"
    ))
    .bind::<Text, _>(&address)
    .load(&mut conn)
    .await?;

    // Summed in BigDecimal, never f64 — wei totals exceed f64's exact range.
    let total: bigdecimal::BigDecimal = payouts
        .iter()
        .map(|p| p.amount_wei.clone())
        .fold(bigdecimal::BigDecimal::from(0), |a, b| a + b);

    Ok(Json(AddressPayouts {
        address,
        total_wei: total.with_scale(0).to_string(),
        rounds_paid: payouts.len() as i64,
        payouts: payouts.into_iter().map(PayoutLine::from).collect(),
    }))
}

#[derive(QueryableByName)]
struct StatsRow {
    #[diesel(sql_type = Nullable<diesel::sql_types::Numeric>)]
    total_distributed_wei: Option<bigdecimal::BigDecimal>,
    #[diesel(sql_type = BigInt)]
    rounds_settled: i64,
    #[diesel(sql_type = Nullable<BigInt>)]
    last_round_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayoutStats {
    /// Everything ever paid out — pro-rata plus lottery. The headline number.
    pub total_paid_wei: String,
    pub rounds_settled: i64,
    pub unique_recipients: i64,
    pub largest_payout_wei: String,
    pub last_round_at: Option<i64>,
}

/// GET /distributor/stats — lifetime payback totals.
pub async fn get_stats(State(state): State<Arc<AppState>>) -> AppResult<Json<PayoutStats>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    // `pot_wei` (not `distributed_wei`) is the real total: the pot is the whole
    // amount that left the contract, i.e. the 90% pro-rata plus the 10% lottery.
    // Reporting only the pro-rata half would understate the payback.
    let s: StatsRow = diesel::sql_query(
        "SELECT SUM(pot_wei) AS total_distributed_wei, \
                COUNT(*)::bigint AS rounds_settled, \
                MAX(distributed_at) AS last_round_at \
         FROM distributor_rounds WHERE pot_wei IS NOT NULL",
    )
    .get_result(&mut conn)
    .await?;

    #[derive(QueryableByName)]
    struct P {
        #[diesel(sql_type = BigInt)]
        unique_recipients: i64,
        #[diesel(sql_type = Nullable<diesel::sql_types::Numeric>)]
        largest: Option<bigdecimal::BigDecimal>,
    }
    let p: P = diesel::sql_query(
        "SELECT COUNT(DISTINCT address)::bigint AS unique_recipients, \
                MAX(amount_wei) AS largest \
         FROM distributor_payouts",
    )
    .get_result(&mut conn)
    .await?;

    Ok(Json(PayoutStats {
        total_paid_wei: wei_str(s.total_distributed_wei).unwrap_or_else(|| "0".to_string()),
        rounds_settled: s.rounds_settled,
        unique_recipients: p.unique_recipients,
        largest_payout_wei: wei_str(p.largest).unwrap_or_else(|| "0".to_string()),
        last_round_at: s.last_round_at,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimableResponse {
    pub address: String,
    /// Wei owed to this address from payout pushes the contract could not
    /// complete (contract wallets, reverting receivers). Withdrawable by calling
    /// `claim()` on the Distributor — the wallet signs, we only read.
    ///
    /// `null` when the RPC is unreachable or no Distributor is configured, so the
    /// UI hides the banner instead of telling someone they are owed nothing.
    pub claimable_wei: Option<String>,
    /// Where to send that `claim()`. Served alongside the balance so the frontend
    /// never has to carry a hardcoded copy of an address that can be re-pointed.
    pub distributor_address: Option<String>,
}

/// GET /distributor/claimable/:address — unclaimed BNB from failed payout pushes.
///
/// This money is already the user's and sits in the contract indefinitely; before
/// this endpoint there was no way to discover it short of reading storage.
pub async fn get_claimable(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<ClaimableResponse>> {
    use alloy::primitives::{keccak256, Address as EvmAddress, U256};
    use alloy::providers::{Provider, ProviderBuilder};
    use alloy::rpc::types::{TransactionInput, TransactionRequest};

    let address = address.trim().to_lowercase();
    let user: EvmAddress = address
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid address".to_string()))?;

    let distributor_address = std::env::var("DISTRIBUTOR_ADDRESS")
        .ok()
        .and_then(|s| s.trim().parse::<EvmAddress>().ok())
        .map(|a| format!("{a:#x}"));

    let claimable_wei = async {
        let distributor: EvmAddress = std::env::var("DISTRIBUTOR_ADDRESS").ok()?.parse().ok()?;
        let chain = state
            .chains
            .iter()
            .find(|c| c.network == "bsc")
            // `.first()` resolves to diesel's QueryDsl method in this module.
            .or_else(|| state.chains.iter().next())?;
        let provider = ProviderBuilder::new().connect_http(chain.rpc_url.parse().ok()?);

        // claimable(address) — selector ++ the address left-padded to 32 bytes.
        let mut data = keccak256(b"claimable(address)")[..4].to_vec();
        data.extend_from_slice(&[0u8; 12]);
        data.extend_from_slice(user.as_slice());

        let req = TransactionRequest::default()
            .to(distributor)
            .input(TransactionInput::new(data.into()));
        let out = provider.call(req).await.ok()?;
        if out.len() < 32 {
            return None;
        }
        Some(U256::from_be_slice(&out[..32]).to_string())
    }
    .await;

    Ok(Json(ClaimableResponse {
        address,
        claimable_wei,
        distributor_address,
    }))
}

// POST /distributor/rounds — api-key gated; called by the round-runner after
// distribute() confirms. Recording the round is what resets the leaderboard.
pub async fn record_round(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<RecordRoundBody>,
) -> AppResult<Json<RecordRoundResponse>> {
    let api_key = headers
        .get("api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if api_key != state.api_key {
        return Err(AppError::Unauthorized("Invalid API key".to_string()));
    }
    if body.time_end <= body.time_start || body.round_id <= 0 {
        return Err(AppError::BadRequest("Invalid round".to_string()));
    }

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    diesel::sql_query(
        "INSERT INTO distributor_rounds (round_id, time_start, time_end, tx_hash) \
         VALUES ($1, $2, $3, $4) ON CONFLICT (round_id) DO NOTHING",
    )
    .bind::<BigInt, _>(body.round_id)
    .bind::<BigInt, _>(body.time_start)
    .bind::<BigInt, _>(body.time_end)
    .bind::<Nullable<Text>, _>(body.tx_hash)
    .execute(&mut conn)
    .await?;

    Ok(Json(RecordRoundResponse {
        success: true,
        epoch_start: epoch_start(&state).await?,
    }))
}
