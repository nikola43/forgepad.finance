use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{Bool, Integer, Nullable, Text, Timestamptz};
use diesel_async::RunQueryDsl;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};
use crate::middleware::auth::verify_signed_action;
use crate::AppState;

// ---------------------------------------------------------------------------
// Native in-app livestreaming (Tier C). Creators broadcast from the browser via
// a self-hosted LiveKit SFU; viewers subscribe on the coin page. This handler
// only mints LiveKit access tokens (HS256 JWT over the API secret) and tracks
// live state: `tokens.is_live` / `stream_started_at` in Postgres and an
// ephemeral heartbeat set of live viewers in Redis. One room per token
// (room name = token address).
// ---------------------------------------------------------------------------

/// Viewers whose last heartbeat is older than this are considered gone.
const VIEWER_TTL_SECS: i64 = 35;
/// Publisher/viewer tokens are valid for a long single stream session.
const TOKEN_TTL_SECS: i64 = 6 * 3600;

struct LiveKitConfig {
    api_key: String,
    api_secret: String,
    url: String,
}

fn livekit_config() -> AppResult<LiveKitConfig> {
    let api_key = std::env::var("LIVEKIT_API_KEY")
        .map_err(|_| AppError::Internal(anyhow::anyhow!("LIVEKIT_API_KEY not configured")))?;
    let api_secret = std::env::var("LIVEKIT_API_SECRET")
        .map_err(|_| AppError::Internal(anyhow::anyhow!("LIVEKIT_API_SECRET not configured")))?;
    // The public wss URL the browser connects to (through the cloudflared tunnel).
    let url = std::env::var("LIVEKIT_URL")
        .or_else(|_| std::env::var("NEXT_PUBLIC_LIVEKIT_URL"))
        .unwrap_or_else(|_| "ws://localhost:7880".to_string());
    Ok(LiveKitConfig { api_key, api_secret, url })
}

#[derive(Serialize)]
struct VideoGrant {
    room: String,
    #[serde(rename = "roomJoin")]
    room_join: bool,
    #[serde(rename = "canPublish")]
    can_publish: bool,
    #[serde(rename = "canSubscribe")]
    can_subscribe: bool,
    #[serde(rename = "canPublishData")]
    can_publish_data: bool,
}

#[derive(Serialize)]
struct Claims {
    iss: String,
    sub: String,
    name: String,
    nbf: i64,
    exp: i64,
    #[serde(rename = "kind")]
    kind: String,
    video: VideoGrant,
}

/// Mint a LiveKit access token. `can_publish=true` for the broadcasting creator,
/// false for subscribe-only viewers.
fn mint_token(cfg: &LiveKitConfig, identity: &str, room: &str, can_publish: bool) -> AppResult<String> {
    let now = chrono::Utc::now().timestamp();
    let claims = Claims {
        iss: cfg.api_key.clone(),
        sub: identity.to_string(),
        name: identity.to_string(),
        nbf: now - 10,
        exp: now + TOKEN_TTL_SECS,
        kind: "standard".to_string(),
        video: VideoGrant {
            room: room.to_string(),
            room_join: true,
            can_publish,
            can_subscribe: true,
            can_publish_data: true,
        },
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(cfg.api_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to mint LiveKit token: {e}")))
}

// ---- token resolution -----------------------------------------------------

#[derive(QueryableByName)]
struct StreamTokenRow {
    #[diesel(sql_type = Integer)]
    id: i32,
    #[diesel(sql_type = Text)]
    creator_address: String,
    #[diesel(sql_type = Bool)]
    is_live: bool,
    #[diesel(sql_type = Nullable<Timestamptz>)]
    stream_started_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn resolve_stream_token(
    conn: &mut diesel_async::AsyncPgConnection,
    address: &str,
) -> AppResult<StreamTokenRow> {
    diesel::sql_query(
        "SELECT t.id, u.address AS creator_address, t.is_live, t.stream_started_at \
         FROM tokens t JOIN users u ON u.id = t.creator_id \
         WHERE t.token_address = $1",
    )
    .bind::<Text, _>(address.to_lowercase())
    .get_result::<StreamTokenRow>(conn)
    .await
    .optional()?
    .ok_or_else(|| AppError::NotFound("Token not found".to_string()))
}

// ---- Redis viewer heartbeat set -------------------------------------------

fn viewers_key(address: &str) -> String {
    format!("stream_viewers:{}", address.to_lowercase())
}

/// Record a viewer heartbeat and return the current fresh viewer count.
async fn touch_and_count_viewers(state: &AppState, address: &str, identity: &str) -> i64 {
    let key = viewers_key(address);
    let now = chrono::Utc::now().timestamp();
    let cutoff = now - VIEWER_TTL_SECS;
    match state.redis.get_multiplexed_async_connection().await {
        Ok(mut conn) => {
            let _: Result<(), redis::RedisError> = redis::pipe()
                .cmd("ZADD").arg(&key).arg(now).arg(identity).ignore()
                .cmd("ZREMRANGEBYSCORE").arg(&key).arg("-inf").arg(cutoff).ignore()
                .cmd("EXPIRE").arg(&key).arg(VIEWER_TTL_SECS * 2).ignore()
                .query_async(&mut conn)
                .await;
            redis::cmd("ZCARD").arg(&key).query_async(&mut conn).await.unwrap_or(0)
        }
        Err(_) => 0,
    }
}

/// Count fresh viewers without recording a heartbeat (for the status/badge poll).
async fn count_viewers(state: &AppState, address: &str) -> i64 {
    let key = viewers_key(address);
    let cutoff = chrono::Utc::now().timestamp() - VIEWER_TTL_SECS;
    match state.redis.get_multiplexed_async_connection().await {
        Ok(mut conn) => {
            let _: Result<(), redis::RedisError> = redis::cmd("ZREMRANGEBYSCORE")
                .arg(&key).arg("-inf").arg(cutoff)
                .query_async(&mut conn).await;
            redis::cmd("ZCARD").arg(&key).query_async(&mut conn).await.unwrap_or(0)
        }
        Err(_) => 0,
    }
}

async fn clear_viewers(state: &AppState, address: &str) {
    if let Ok(mut conn) = state.redis.get_multiplexed_async_connection().await {
        let _: Result<(), redis::RedisError> =
            redis::cmd("DEL").arg(viewers_key(address)).query_async(&mut conn).await;
    }
}

// ---- responses ------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamStatus {
    token_address: String,
    is_live: bool,
    viewers: i64,
    started_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamToken {
    token: String,
    url: String,
    room: String,
    identity: String,
    is_publisher: bool,
    viewers: i64,
}

// GET /stream/:tokenAddress  — live status + viewer count (badge / poll).
pub async fn get_status(
    State(state): State<Arc<AppState>>,
    Path(token_address): Path<String>,
) -> AppResult<Json<StreamStatus>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let tk = resolve_stream_token(&mut conn, &token_address).await?;
    let viewers = if tk.is_live { count_viewers(&state, &token_address).await } else { 0 };
    Ok(Json(StreamStatus {
        token_address: token_address.to_lowercase(),
        is_live: tk.is_live,
        viewers,
        started_at: tk.stream_started_at,
    }))
}

#[derive(Deserialize)]
pub struct StartStreamBody {
    #[serde(alias = "tokenAddress")]
    pub token_address: String,
    pub address: String,
    pub signature: String,
    #[serde(alias = "msg")]
    pub message: String,
}

// POST /stream/start — creator-only; signature-gated. Sets the token live and
// returns a publisher (can-publish) LiveKit token.
pub async fn start_stream(
    State(state): State<Arc<AppState>>,
    Json(body): Json<StartStreamBody>,
) -> AppResult<Json<StreamToken>> {
    // Bind the signature to this action + token address, then confirm the signer
    // is the token's creator.
    let prefix = format!("Go live on {}", body.token_address);
    let signer = verify_signed_action(&state, &body.message, &body.signature, Some(&prefix)).await?;
    if !signer.eq_ignore_ascii_case(&body.address) {
        return Err(AppError::Unauthorized("Signer does not match address".to_string()));
    }

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let tk = resolve_stream_token(&mut conn, &body.token_address).await?;
    if !signer.eq_ignore_ascii_case(&tk.creator_address) {
        return Err(AppError::Forbidden("Only the token creator can go live".to_string()));
    }

    diesel::sql_query("UPDATE tokens SET is_live = TRUE, stream_started_at = NOW() WHERE id = $1")
        .bind::<Integer, _>(tk.id)
        .execute(&mut conn)
        .await?;

    let cfg = livekit_config()?;
    let room = body.token_address.to_lowercase();
    let token = mint_token(&cfg, &signer, &room, true)?;
    Ok(Json(StreamToken {
        token,
        url: cfg.url,
        room: room.clone(),
        identity: signer,
        is_publisher: true,
        viewers: count_viewers(&state, &room).await,
    }))
}

#[derive(Deserialize)]
pub struct StopStreamBody {
    #[serde(alias = "tokenAddress")]
    pub token_address: String,
    pub address: String,
    pub signature: String,
    #[serde(alias = "msg")]
    pub message: String,
}

// POST /stream/stop — creator-only; signature-gated. Ends the broadcast.
pub async fn stop_stream(
    State(state): State<Arc<AppState>>,
    Json(body): Json<StopStreamBody>,
) -> AppResult<Json<StreamStatus>> {
    let prefix = format!("End stream on {}", body.token_address);
    let signer = verify_signed_action(&state, &body.message, &body.signature, Some(&prefix)).await?;
    if !signer.eq_ignore_ascii_case(&body.address) {
        return Err(AppError::Unauthorized("Signer does not match address".to_string()));
    }

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let tk = resolve_stream_token(&mut conn, &body.token_address).await?;
    if !signer.eq_ignore_ascii_case(&tk.creator_address) {
        return Err(AppError::Forbidden("Only the token creator can end the stream".to_string()));
    }

    diesel::sql_query("UPDATE tokens SET is_live = FALSE, stream_started_at = NULL WHERE id = $1")
        .bind::<Integer, _>(tk.id)
        .execute(&mut conn)
        .await?;
    clear_viewers(&state, &body.token_address).await;

    Ok(Json(StreamStatus {
        token_address: body.token_address.to_lowercase(),
        is_live: false,
        viewers: 0,
        started_at: None,
    }))
}

#[derive(Deserialize)]
pub struct JoinQuery {
    pub address: Option<String>,
}

// GET /stream/:tokenAddress/join?address=… — viewer (subscribe-only) token +
// records a heartbeat. Anonymous viewers get a generated identity to reuse.
pub async fn join_stream(
    State(state): State<Arc<AppState>>,
    Path(token_address): Path<String>,
    Query(q): Query<JoinQuery>,
) -> AppResult<Json<StreamToken>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let tk = resolve_stream_token(&mut conn, &token_address).await?;
    if !tk.is_live {
        return Err(AppError::NotFound("This token is not live".to_string()));
    }

    // Namespace viewer identities under "viewer:" so a viewer can NEVER be issued
    // the publisher's identity (the creator's bare address) — LiveKit disconnects
    // the older holder of a duplicate identity, so without this a viewer could
    // join as the creator and kick them off their own stream.
    let base = q
        .address
        .filter(|a| !a.is_empty())
        .unwrap_or_else(|| format!("guest-{}", uuid::Uuid::new_v4()));
    let identity = format!("viewer:{base}");
    let room = token_address.to_lowercase();
    let viewers = touch_and_count_viewers(&state, &room, &identity).await;

    let cfg = livekit_config()?;
    let token = mint_token(&cfg, &identity, &room, false)?;
    Ok(Json(StreamToken {
        token,
        url: cfg.url,
        room: room.clone(),
        identity,
        is_publisher: false,
        viewers,
    }))
}

#[derive(Deserialize)]
pub struct HeartbeatBody {
    pub identity: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerCount {
    viewers: i64,
}

// POST /stream/:tokenAddress/heartbeat — keep a viewer "fresh" and return count.
pub async fn heartbeat(
    State(state): State<Arc<AppState>>,
    Path(token_address): Path<String>,
    Json(body): Json<HeartbeatBody>,
) -> AppResult<Json<ViewerCount>> {
    // Only count heartbeats for identities issued by join_stream (the "viewer:"
    // namespace). This stops a heartbeat from registering the publisher's bare
    // identity as a viewer, and bounds the identity length so the viewer set
    // can't be spammed with arbitrarily long keys.
    if !body.identity.starts_with("viewer:") || body.identity.len() > 128 {
        return Err(AppError::BadRequest("Invalid viewer identity".to_string()));
    }
    let viewers = touch_and_count_viewers(&state, &token_address, &body.identity).await;
    Ok(Json(ViewerCount { viewers }))
}
