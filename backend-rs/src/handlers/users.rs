use axum::extract::{Path, Query, State};
use axum::Json;
use chrono::Utc;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Double, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::errors::{AppError, AppResult};
use crate::middleware::auth::recover_address;
use crate::models::*;
use crate::schema::*;
use crate::AppState;

// ---------------------------------------------------------------------------
// Query / body types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetUserQuery {
    pub user_address: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserBody {
    pub user: UserPayload,
    pub signature: String,
    pub msg: String,
    pub ref_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPayload {
    pub username: Option<String>,
    pub bio: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserBody {
    pub user: UserPayload,
    pub signature: String,
    pub msg: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureBody {
    pub msg: String,
    pub signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopHoldersQuery {
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub network: Option<String>,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfileResponse {
    pub user: UserResponse,
    pub holdings: Vec<HolderResponse>,
    pub chats: Vec<ChatResponse>,
    pub created_tokens: Vec<TokenResponse>,
    pub followers: i64,
    pub followees: i64,
    pub referral_count: i64,
    pub points: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowingResponse {
    pub id: i32,
    pub address: String,
    pub username: Option<String>,
    pub avatar: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopHolderEntry {
    pub address: String,
    pub username: Option<String>,
    pub avatar: Option<String>,
    pub volume: f64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn validate_eth_address(addr: &str) -> Result<(), AppError> {
    let stripped = addr.strip_prefix("0x").unwrap_or(addr);
    if stripped.len() != 40 || !stripped.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(format!("Invalid address: {addr}")));
    }
    Ok(())
}

fn generate_referral_code(address: &str) -> String {
    let stripped = address.strip_prefix("0x").unwrap_or(address);
    stripped[..8.min(stripped.len())].to_lowercase()
}

// ---------------------------------------------------------------------------
// GET /users?userAddress=0x...
// ---------------------------------------------------------------------------

pub async fn get_user_info(
    State(state): State<Arc<AppState>>,
    Query(params): Query<GetUserQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let addr = params.user_address.to_lowercase();

    let user: User = users::table
        .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
            "LOWER(address) = '{}'",
            addr.replace('\'', "")
        )))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Check if admin
    let is_admin: bool = admins::table
        .filter(admins::user_id.eq(user.id))
        .first::<Admin>(&mut conn)
        .await
        .optional()?
        .is_some();

    let mut resp = UserResponse::from(user);
    resp.is_admin = Some(is_admin);

    Ok(Json(serde_json::json!({ "user": resp })))
}

// ---------------------------------------------------------------------------
// POST /users
// ---------------------------------------------------------------------------

pub async fn create_user(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateUserBody>,
) -> AppResult<Json<serde_json::Value>> {
    let recovered = recover_address(&body.msg, &body.signature)?;

    validate_eth_address(&recovered)?;

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let addr_lower = recovered.to_lowercase();

    // Upsert user: try to find existing, otherwise insert
    let existing: Option<User> = users::table
        .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
            "LOWER(address) = '{}'",
            addr_lower.replace('\'', "")
        )))
        .first(&mut conn)
        .await
        .optional()?;

    let user = match existing {
        Some(u) => {
            // Update fields if provided
            diesel::update(users::table.filter(users::id.eq(u.id)))
                .set((
                    users::username.eq(body.user.username.as_deref().or(u.username.as_deref())),
                    users::bio.eq(body.user.bio.as_deref().or(u.bio.as_deref())),
                    users::avatar.eq(body.user.avatar.as_deref().or(u.avatar.as_deref())),
                    users::updated_at.eq(Utc::now()),
                ))
                .get_result::<User>(&mut conn)
                .await?
        }
        None => {
            let new_user = NewUser {
                address: &addr_lower,
                username: body.user.username.as_deref(),
                avatar: body.user.avatar.as_deref(),
                bio: body.user.bio.as_deref(),
            };

            diesel::insert_into(users::table)
                .values(&new_user)
                .get_result::<User>(&mut conn)
                .await?
        }
    };

    // Create referral info if not existing
    let has_ref_info = referral_info::table
        .filter(referral_info::user_id.eq(user.id))
        .first::<ReferralInfo>(&mut conn)
        .await
        .optional()?;

    if has_ref_info.is_none() {
        let code = generate_referral_code(&user.address);
        let new_ref_info = NewReferralInfo {
            user_id: user.id,
            referral_code: code,
        };
        diesel::insert_into(referral_info::table)
            .values(&new_ref_info)
            .execute(&mut conn)
            .await?;
    }

    // Process referral code if provided
    if let Some(ref ref_code) = body.ref_code {
        if !ref_code.is_empty() {
            let referrer_info: Option<ReferralInfo> = referral_info::table
                .filter(referral_info::referral_code.eq(ref_code))
                .first(&mut conn)
                .await
                .optional()?;

            if let Some(ref_info) = referrer_info {
                // Don't allow self-referral
                if ref_info.user_id != user.id {
                    // Check not already referred
                    let already_referred = referrals::table
                        .filter(referrals::referee_id.eq(user.id))
                        .first::<Referral>(&mut conn)
                        .await
                        .optional()?;

                    if already_referred.is_none() {
                        let new_referral = NewReferral {
                            referrer_id: ref_info.user_id,
                            referee_id: user.id,
                        };
                        diesel::insert_into(referrals::table)
                            .values(&new_referral)
                            .execute(&mut conn)
                            .await?;
                    }
                }
            }
        }
    }

    let resp = UserResponse::from(user);
    Ok(Json(serde_json::json!({ "user": resp })))
}

// ---------------------------------------------------------------------------
// GET /users/ranking
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /users/leaderboard
// Points = 10 per $1 bought minus 4 per $1 sold.
// Each point is worth 0.000006 ETH (reward_eth = points * 0.000006), distributed manually.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardQuery {
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    pub rank: i32,
    pub address: String,
    pub username: Option<String>,
    pub avatar: Option<String>,
    pub volume_usd: f64,
    pub trades: i64,
    pub points: f64,
    pub reward_eth: f64,
}

pub async fn get_leaderboard(
    State(state): State<Arc<AppState>>,
    Query(params): Query<LeaderboardQuery>,
) -> AppResult<Json<Vec<LeaderboardEntry>>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let limit = params.limit.unwrap_or(100).clamp(1, 500);

    #[derive(QueryableByName)]
    struct Row {
        #[diesel(sql_type = Text)]
        address: String,
        #[diesel(sql_type = Nullable<Text>)]
        username: Option<String>,
        #[diesel(sql_type = Nullable<Text>)]
        avatar: Option<String>,
        #[diesel(sql_type = Double)]
        volume_usd: f64,
        #[diesel(sql_type = Double)]
        points: f64,
        #[diesel(sql_type = BigInt)]
        trades: i64,
    }

    // points = 10 * buy_volume_usd - 4 * sell_volume_usd. HAVING repeats the
    // expression because Postgres can't reference SELECT aliases there.
    // limit is clamped to an integer, so inlining it is injection-safe.
    const POINTS: &str = "COALESCE(SUM(CASE WHEN t.trade_type = 'buy' THEN t.eth_amount::float8 * t.eth_price::float8 * 10 ELSE 0 END), 0) \
         - COALESCE(SUM(CASE WHEN t.trade_type = 'sell' THEN t.eth_amount::float8 * t.eth_price::float8 * 4 ELSE 0 END), 0)";
    let rows: Vec<Row> = diesel::sql_query(format!(
        "SELECT u.address, u.username, u.avatar, \
         COALESCE(SUM(t.eth_amount::float8 * t.eth_price::float8), 0) as volume_usd, \
         {POINTS} as points, \
         COUNT(t.id) as trades \
         FROM users u \
         JOIN trades t ON t.swapper_id = u.id \
         GROUP BY u.id, u.address, u.username, u.avatar \
         HAVING {POINTS} > 0 \
         ORDER BY points DESC \
         LIMIT {limit}"
    ))
    .load(&mut conn)
    .await?;

    let entries: Vec<LeaderboardEntry> = rows
        .into_iter()
        .enumerate()
        .map(|(i, r)| LeaderboardEntry {
            rank: (i as i32) + 1,
            address: r.address,
            username: r.username,
            avatar: r.avatar,
            volume_usd: r.volume_usd,
            trades: r.trades,
            points: r.points,
            reward_eth: r.points * 0.000006,
        })
        .collect();

    Ok(Json(entries))
}


// ---------------------------------------------------------------------------
// GET /users/profile/:address
// ---------------------------------------------------------------------------

pub async fn get_user_profile(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<UserProfileResponse>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let addr_lower = address.to_lowercase();

    let user: User = users::table
        .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
            "LOWER(address) = '{}'",
            addr_lower.replace('\'', "")
        )))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Check admin status
    let is_admin = admins::table
        .filter(admins::user_id.eq(user.id))
        .first::<Admin>(&mut conn)
        .await
        .optional()?
        .is_some();

    let mut user_resp = UserResponse::from(user.clone());
    user_resp.is_admin = Some(is_admin);

    // Holdings
    let holder_rows: Vec<(Holder, (Token, User))> = holders::table
        .inner_join(
            tokens::table.on(tokens::id.eq(holders::token_id))
                .inner_join(users::table.on(users::id.eq(tokens::creator_id))),
        )
        .filter(holders::user_id.eq(user.id))
        .load(&mut conn)
        .await?;

    let holdings: Vec<HolderResponse> = holder_rows
        .iter()
        .map(|(holder, (token, creator))| HolderResponse {
            id: holder.id,
            token_address: token.token_address.clone(),
            holder_address: user.address.clone(),
            token_amount: holder.amount.to_string(),
            token_name: token.name.clone(),
            token_symbol: token.symbol.clone(),
            token_image: token.image.clone(),
            marketcap: token.marketcap.to_string(),
            network: token.network.clone(),
            creator_address: creator.address.clone(),
        })
        .collect();

    // Chats by user
    let chat_rows: Vec<(Chat, Token)> = chats::table
        .inner_join(tokens::table.on(tokens::id.eq(chats::token_id)))
        .filter(chats::author_id.eq(user.id))
        .order(chats::created_at.desc())
        .limit(50)
        .load(&mut conn)
        .await?;

    let chat_responses: Vec<ChatResponse> = chat_rows
        .iter()
        .map(|(chat, token)| ChatResponse {
            id: chat.id,
            token_address: token.token_address.clone(),
            reply_address: None,
            comment: chat.content.clone(),
            code: chat.code.clone(),
            date: chat.created_at,
            network: chat.network.clone(),
        })
        .collect();

    // Created tokens
    let created_token_rows: Vec<Token> = tokens::table
        .filter(tokens::creator_id.eq(user.id))
        .order(tokens::created_at.desc())
        .load(&mut conn)
        .await?;

    let created_tokens: Vec<TokenResponse> = created_token_rows
        .iter()
        .map(|token| {
            let chain = state
                .chains
                .iter()
                .find(|c| c.network.eq_ignore_ascii_case(&token.network))
                .cloned()
                .unwrap_or_else(|| state.chains[0].clone());
            TokenResponse::from_token_and_creator(token, &user, &chain)
        })
        .collect();

    // Follower count
    let followers: i64 = follows::table
        .filter(follows::followee_id.eq(user.id))
        .count()
        .get_result(&mut conn)
        .await?;

    // Followee count
    let followees: i64 = follows::table
        .filter(follows::follower_id.eq(user.id))
        .count()
        .get_result(&mut conn)
        .await?;

    // Referral count
    let referral_count: i64 = referrals::table
        .filter(referrals::referrer_id.eq(user.id))
        .count()
        .get_result(&mut conn)
        .await?;

    // Points (from referral_info earnings)
    let points: i32 = referral_info::table
        .filter(referral_info::user_id.eq(user.id))
        .select(referral_info::earnings)
        .first(&mut conn)
        .await
        .unwrap_or(0);

    Ok(Json(UserProfileResponse {
        user: user_resp,
        holdings,
        chats: chat_responses,
        created_tokens,
        followers,
        followees,
        referral_count,
        points,
    }))
}

// ---------------------------------------------------------------------------
// GET /users/followings/:address
// ---------------------------------------------------------------------------

pub async fn get_followings(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<Vec<FollowingResponse>>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let addr_lower = address.to_lowercase();

    let user: User = users::table
        .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
            "LOWER(address) = '{}'",
            addr_lower.replace('\'', "")
        )))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Get follows where this user is the follower, join followee user info
    let follow_rows: Vec<Follow> = follows::table
        .filter(follows::follower_id.eq(user.id))
        .load(&mut conn)
        .await?;

    let followee_ids: Vec<i32> = follow_rows.iter().map(|f| f.followee_id).collect();

    let followees: Vec<User> = users::table
        .filter(users::id.eq_any(&followee_ids))
        .load(&mut conn)
        .await?;

    let responses: Vec<FollowingResponse> = followees
        .into_iter()
        .map(|u| FollowingResponse {
            id: u.id,
            address: u.address,
            username: u.username,
            avatar: u.avatar,
        })
        .collect();

    Ok(Json(responses))
}

// ---------------------------------------------------------------------------
// GET /users/balance/:id
// ---------------------------------------------------------------------------

pub async fn get_balance(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i32>,
) -> AppResult<Json<serde_json::Value>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let holder: Holder = holders::table
        .filter(holders::id.eq(id))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("Holder not found".to_string()))?;

    Ok(Json(serde_json::json!({
        "id": holder.id,
        "amount": holder.amount.to_string(),
    })))
}

// ---------------------------------------------------------------------------
// POST /users/follow/:address
// ---------------------------------------------------------------------------

pub async fn follow_user(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
    Json(body): Json<SignatureBody>,
) -> AppResult<Json<serde_json::Value>> {
    let recovered = recover_address(&body.msg, &body.signature)?;

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let follower: User = users::table
        .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
            "LOWER(address) = LOWER('{}')",
            recovered.replace('\'', "")
        )))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("Follower user not found".to_string()))?;

    let addr_lower = address.to_lowercase();
    let followee: User = users::table
        .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
            "LOWER(address) = '{}'",
            addr_lower.replace('\'', "")
        )))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("User to follow not found".to_string()))?;

    if follower.id == followee.id {
        return Err(AppError::BadRequest("Cannot follow yourself".to_string()));
    }

    // Check if already following
    let existing = follows::table
        .filter(follows::follower_id.eq(follower.id))
        .filter(follows::followee_id.eq(followee.id))
        .first::<Follow>(&mut conn)
        .await
        .optional()?;

    if existing.is_some() {
        return Err(AppError::Conflict("Already following this user".to_string()));
    }

    let new_follow = NewFollow {
        follower_id: follower.id,
        followee_id: followee.id,
    };

    diesel::insert_into(follows::table)
        .values(&new_follow)
        .execute(&mut conn)
        .await?;

    Ok(Json(serde_json::json!({ "message": "Followed successfully" })))
}

// ---------------------------------------------------------------------------
// POST /users/unfollow/:address
// ---------------------------------------------------------------------------

pub async fn unfollow_user(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
    Json(body): Json<SignatureBody>,
) -> AppResult<Json<serde_json::Value>> {
    let recovered = recover_address(&body.msg, &body.signature)?;

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let follower: User = users::table
        .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
            "LOWER(address) = LOWER('{}')",
            recovered.replace('\'', "")
        )))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    let addr_lower = address.to_lowercase();
    let followee: User = users::table
        .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
            "LOWER(address) = '{}'",
            addr_lower.replace('\'', "")
        )))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("User to unfollow not found".to_string()))?;

    let deleted = diesel::delete(
        follows::table
            .filter(follows::follower_id.eq(follower.id))
            .filter(follows::followee_id.eq(followee.id)),
    )
    .execute(&mut conn)
    .await?;

    if deleted == 0 {
        return Err(AppError::NotFound("Follow relationship not found".to_string()));
    }

    Ok(Json(serde_json::json!({ "message": "Unfollowed successfully" })))
}

// ---------------------------------------------------------------------------
// POST /users/update
// ---------------------------------------------------------------------------

pub async fn update_user(
    State(state): State<Arc<AppState>>,
    Json(body): Json<UpdateUserBody>,
) -> AppResult<Json<serde_json::Value>> {
    let recovered = recover_address(&body.msg, &body.signature)?;

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let user: User = users::table
        .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
            "LOWER(address) = LOWER('{}')",
            recovered.replace('\'', "")
        )))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Check 24h cooldown on profile updates
    let hours_since_update = Utc::now()
        .signed_duration_since(user.updated_at)
        .num_hours();

    if hours_since_update < 24 {
        let _remaining = 24 - hours_since_update;
        return Err(AppError::RateLimited);
    }

    let updated_user = diesel::update(users::table.filter(users::id.eq(user.id)))
        .set((
            users::username.eq(body.user.username.as_deref().or(user.username.as_deref())),
            users::bio.eq(body.user.bio.as_deref().or(user.bio.as_deref())),
            users::avatar.eq(body.user.avatar.as_deref().or(user.avatar.as_deref())),
            users::updated_at.eq(Utc::now()),
        ))
        .get_result::<User>(&mut conn)
        .await?;

    let resp = UserResponse::from(updated_user);
    Ok(Json(serde_json::json!({ "user": resp })))
}

// ---------------------------------------------------------------------------
// POST /users/avatar
// ---------------------------------------------------------------------------

pub async fn upload_avatar(
    State(state): State<Arc<AppState>>,
    mut multipart: axum::extract::Multipart,
) -> AppResult<Json<serde_json::Value>> {
    let allowed_types = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
    ];
    let max_size: usize = 2 * 1024 * 1024; // 2MB

    let mut signature: Option<String> = None;
    let mut msg: Option<String> = None;
    let mut file_data: Option<(Vec<u8>, String, String)> = None; // (bytes, content_type, original_name)

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {e}")))?
    {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "signature" => {
                signature = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("Bad signature field: {e}")))?,
                );
            }
            "msg" => {
                msg = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("Bad msg field: {e}")))?,
                );
            }
            "avatar" => {
                let content_type = field
                    .content_type()
                    .unwrap_or("application/octet-stream")
                    .to_string();

                if !allowed_types.contains(&content_type.as_str()) {
                    return Err(AppError::BadRequest(
                        "Only image files are allowed (jpeg, png, gif, webp)".to_string(),
                    ));
                }

                let original_name = field.file_name().unwrap_or("avatar").to_string();
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("Failed to read file: {e}")))?;

                if data.len() > max_size {
                    return Err(AppError::BadRequest(format!(
                        "File too large: {} bytes (max {})",
                        data.len(),
                        max_size
                    )));
                }

                file_data = Some((data.to_vec(), content_type, original_name));
            }
            _ => {}
        }
    }

    let signature = signature.ok_or_else(|| AppError::BadRequest("Signature required".into()))?;
    let msg = msg.ok_or_else(|| AppError::BadRequest("Message required".into()))?;
    let (data, _content_type, original_name) =
        file_data.ok_or_else(|| AppError::BadRequest("No avatar file uploaded".into()))?;

    // Verify signature
    let recovered = recover_address(&msg, &signature)?;

    let ext = original_name.rsplit('.').next().unwrap_or("png");
    let filename = format!("avatar-{}.{}", uuid::Uuid::new_v4(), ext);

    let public_url = if let Some(ref s3) = state.s3_client {
        s3.put_object()
            .bucket(&state.s3_bucket)
            .key(&filename)
            .body(data.clone().into())
            .content_type(&_content_type)
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("S3 upload failed: {e}")))?;
        format!("{}/{}", state.s3_public_url, filename)
    } else {
        let filepath = format!("{}/{}", state.upload_dir, filename);
        tokio::fs::write(&filepath, &data)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to save file: {e}")))?;
        format!("{}/{}", state.upload_base_url, filename)
    };

    // Update user avatar in database
    let mut conn = state
        .db
        .get()
        .await
        .map_err(|e| AppError::Pool(e.to_string()))?;

    // Match the existing user case-insensitively (addresses are stored lowercase)
    // so the avatar attaches to the real user row instead of creating a duplicate.
    let addr_lower = recovered.to_lowercase();
    let user: Option<User> = users::table
        .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
            "LOWER(address) = '{}'",
            addr_lower.replace('\'', "")
        )))
        .first::<User>(&mut conn)
        .await
        .optional()?;

    let user = match user {
        Some(u) => {
            diesel::update(users::table.find(u.id))
                .set(users::avatar.eq(&public_url))
                .execute(&mut conn)
                .await?;
            users::table.find(u.id).first::<User>(&mut conn).await?
        }
        None => {
            let new_user = NewUser {
                address: &addr_lower,
                username: None,
                avatar: Some(&public_url),
                bio: None,
            };
            diesel::insert_into(users::table)
                .values(&new_user)
                .returning(users::all_columns)
                .get_result::<User>(&mut conn)
                .await?
        }
    };

    Ok(Json(serde_json::json!({
        "avatar": public_url,
        "user": UserResponse::from(user),
    })))
}

// ---------------------------------------------------------------------------
// GET /users/top/:count
// ---------------------------------------------------------------------------

pub async fn top_holders(
    State(state): State<Arc<AppState>>,
    Path(count): Path<i64>,
    Query(params): Query<TopHoldersQuery>,
) -> AppResult<Json<Vec<TopHolderEntry>>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let limit = count.clamp(1, 100);
    let from_ts = params.from.unwrap_or(0);
    let to_ts = params.to.unwrap_or(i64::MAX);

    // Build a query that sums trading volume per user in the given time range
    let mut where_parts = vec![
        format!("t.traded_at >= {from_ts}"),
        format!("t.traded_at <= {to_ts}"),
    ];

    if let Some(ref network) = params.network {
        where_parts.push(format!(
            "tok.network = '{}'",
            network.replace('\'', "")
        ));
    }

    let where_clause = where_parts.join(" AND ");

    #[derive(QueryableByName)]
    struct TopRow {
        #[diesel(sql_type = Text)]
        address: String,
        #[diesel(sql_type = Nullable<Text>)]
        username: Option<String>,
        #[diesel(sql_type = Nullable<Text>)]
        avatar: Option<String>,
        #[diesel(sql_type = Double)]
        volume: f64,
    }

    let query = format!(
        "SELECT u.address, u.username, u.avatar, \
         SUM(t.eth_amount::float8 * t.eth_price::float8) as volume \
         FROM trades t \
         JOIN users u ON u.id = t.swapper_id \
         JOIN tokens tok ON tok.id = t.token_id \
         WHERE {where_clause} \
         GROUP BY u.id, u.address, u.username, u.avatar \
         ORDER BY volume DESC \
         LIMIT {limit}"
    );

    let rows: Vec<TopRow> = diesel::sql_query(&query)
        .load(&mut conn)
        .await?;

    let entries: Vec<TopHolderEntry> = rows
        .into_iter()
        .map(|r| TopHolderEntry {
            address: r.address,
            username: r.username,
            avatar: r.avatar,
            volume: r.volume,
        })
        .collect();

    Ok(Json(entries))
}
