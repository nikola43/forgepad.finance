use axum::extract::{Path, State};
use crate::errors::Query;
use axum::Json;
use chrono::Utc;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Double, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::errors::{AppError, AppResult};
use crate::middleware::auth::verify_signed_action;
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
    /// X/Twitter handle. Omitted = keep current; "" = clear; otherwise a handle
    /// or profile URL, normalized and validated in update_user.
    pub twitter: Option<String>,
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
    // Trading rewards — same model as the leaderboard: trading_points is the
    // USD volume traded plus unlocked grants (handlers/points.rs), and
    // reward_eth is this user's slice of the LIVE pot:
    //   90% x distributor balance x (your points / payout-set points).
    // There is deliberately no fixed BNB-per-point rate; see points.rs.
    pub trading_points: f64,
    pub trading_volume_usd: f64,
    pub reward_eth: f64,
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

/// Random 10-char lowercase alphanumeric code, used as a collision fallback for
/// the address-derived referral code.
fn random_referral_code() -> String {
    use rand::RngExt;
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::rng();
    (0..10)
        .map(|_| CHARS[rng.random_range(0..CHARS.len())] as char)
        .collect()
}

/// Bounds for free-text profile fields (columns are text; without a cap a
/// client can store megabytes and bloat every profile response).
const MAX_USERNAME_LEN: usize = 50;
const MAX_BIO_LEN: usize = 500;
const MAX_AVATAR_LEN: usize = 512;

/// Validate the free-text profile fields at the trust boundary. Shared by
/// create_user and update_user so neither path can store oversized input.
fn validate_profile_fields(
    username: Option<&str>,
    bio: Option<&str>,
    avatar: Option<&str>,
) -> Result<(), AppError> {
    if let Some(u) = username {
        if u.chars().count() > MAX_USERNAME_LEN {
            return Err(AppError::BadRequest(format!(
                "Username must be {MAX_USERNAME_LEN} characters or fewer"
            )));
        }
    }
    if let Some(b) = bio {
        if b.chars().count() > MAX_BIO_LEN {
            return Err(AppError::BadRequest(format!(
                "Bio must be {MAX_BIO_LEN} characters or fewer"
            )));
        }
    }
    if let Some(a) = avatar {
        if a.chars().count() > MAX_AVATAR_LEN {
            return Err(AppError::BadRequest(format!(
                "Avatar URL must be {MAX_AVATAR_LEN} characters or fewer"
            )));
        }
    }
    Ok(())
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
        .filter(users::address.eq(&addr))
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
    let recovered = verify_signed_action(
        &state,
        &body.msg,
        &body.signature,
        Some("Register on Fyuz"),
    )
    .await?;

    validate_eth_address(&recovered)?;
    validate_profile_fields(
        body.user.username.as_deref(),
        body.user.bio.as_deref(),
        body.user.avatar.as_deref(),
    )?;

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let addr_lower = recovered.to_lowercase();

    // Upsert user: try to find existing, otherwise insert
    let existing: Option<User> = users::table
        .filter(users::address.eq(&addr_lower))
        .first(&mut conn)
        .await
        .optional()?;

    let user = match existing {
        Some(u) => {
            // For an EXISTING user, "Register on Fyuz" must not double as an
            // uncapped profile-update path (that would bypass update_user's
            // cooldown). Only touch profile fields when the caller actually sent
            // new ones, and enforce the same cooldown update_user uses.
            let wants_profile_change = body.user.username.is_some()
                || body.user.bio.is_some()
                || body.user.avatar.is_some();
            if wants_profile_change {
                let cooldown_hours: i64 = std::env::var("PROFILE_UPDATE_COOLDOWN_HOURS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(0);
                if cooldown_hours > 0
                    && Utc::now().signed_duration_since(u.updated_at).num_hours() < cooldown_hours
                {
                    return Err(AppError::RateLimited);
                }
                diesel::update(users::table.filter(users::id.eq(u.id)))
                    .set((
                        users::username.eq(body.user.username.as_deref().or(u.username.as_deref())),
                        users::bio.eq(body.user.bio.as_deref().or(u.bio.as_deref())),
                        users::avatar.eq(body.user.avatar.as_deref().or(u.avatar.as_deref())),
                        users::updated_at.eq(Utc::now()),
                    ))
                    .get_result::<User>(&mut conn)
                    .await?
            } else {
                u
            }
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
        // The address-derived code (32 bits) can collide; a bare insert would
        // then 500 and permanently block this user's registration. Try the
        // derived code first, then fall back to random codes until one is free.
        let mut code = generate_referral_code(&user.address);
        for attempt in 0..12 {
            let res = diesel::insert_into(referral_info::table)
                .values(NewReferralInfo {
                    user_id: user.id,
                    referral_code: code.clone(),
                })
                .execute(&mut conn)
                .await;
            match res {
                Ok(_) => break,
                Err(diesel::result::Error::DatabaseError(
                    diesel::result::DatabaseErrorKind::UniqueViolation,
                    _,
                )) => {
                    // If THIS user already has a code (concurrent request won the
                    // race on user_id), we're done; otherwise it was a code
                    // collision — retry with a fresh random 10-char code.
                    let mine = referral_info::table
                        .filter(referral_info::user_id.eq(user.id))
                        .first::<ReferralInfo>(&mut conn)
                        .await
                        .optional()?;
                    if mine.is_some() {
                        break;
                    }
                    code = random_referral_code();
                    if attempt == 11 {
                        return Err(AppError::Internal(anyhow::anyhow!(
                            "could not allocate a unique referral code"
                        )));
                    }
                }
                Err(e) => return Err(e.into()),
            }
        }
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
                    // Attribute atomically: a UNIQUE(referee_id) constraint plus
                    // ON CONFLICT DO NOTHING makes "a referee is credited to at
                    // most one referrer" a DB invariant, instead of a racy
                    // check-then-insert two concurrent registrations could both pass.
                    diesel::insert_into(referrals::table)
                        .values(NewReferral {
                            referrer_id: ref_info.user_id,
                            referee_id: user.id,
                        })
                        .on_conflict_do_nothing()
                        .execute(&mut conn)
                        .await?;
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
// Points = USD volume traded in the round, buys and sells alike — see
// handlers/points.rs for the definition and for why manufactured volume is
// structurally lossy rather than farmable. Holding is not required and selling
// does not burn what a trade already earned. Rewards are a pro-rata share of the
// live Distributor pot, not a fixed rate per point.
// ---------------------------------------------------------------------------

/// BNB paid per leaderboard/bonus point. Env-tunable so the rate can track BNB
/// price and observed churn without a rebuild.
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
    /// Points that actually count toward the payout share — this is the exact
    /// number the Distributor is served, so the ranking never advertises a share
    /// the contract will not honour.
    pub points: f64,
    /// Total points EARNED (position + all grants, uncapped). Display only; it
    /// matches the Rewards Hub so the two screens agree. Always >= `points`; the
    /// gap is grants not yet unlocked by the user's held position.
    pub points_total: f64,
    /// Points at round close if the current position is held until then. This is
    /// the real-time number the leaderboard leads with — it moves the moment a
    /// trade lands, where accrued points necessarily lag. Guidance, not a payout.
    pub points_projected: f64,
    /// USD value currently held. Real-time, so a fresh buyer sees their money
    /// represented immediately instead of an apparently broken 0.
    pub held_usd: f64,
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
        #[diesel(sql_type = Double)]
        points_total: f64,
        #[diesel(sql_type = Double)]
        payout_total_points: f64,
        #[diesel(sql_type = Double)]
        points_projected: f64,
        #[diesel(sql_type = Double)]
        held_usd: f64,
        #[diesel(sql_type = BigInt)]
        trades: i64,
    }

    // The leaderboard "clears" after every Distributor payout: only activity
    // since the last paid round's time_end counts (0 before the first round).
    let epoch = crate::handlers::distributor::epoch_start(&state).await?;

    // Canonical scoring — handlers/points.rs. This MUST be the same expression
    // the Distributor pays on, or the leaderboard is advertising a share the
    // contract will not honour; that is why it lives in one module now.
    //
    // `to` is now(), matching what the round-runner passes when it snapshots
    // shares. epoch/limit come from our own DB and a clamped integer, so
    // inlining them is injection-safe.
    let now = chrono::Utc::now().timestamp();
    let epoch = crate::handlers::points::clamp_window_start(&state, epoch).await?;
    let points = crate::handlers::points::points_expr();
    let floor = crate::handlers::points::min_payout_points();
    // Round close drives the projection and the countdown; same Monday-08:00-UTC
    // schedule the contract enforces.
    let round_end = crate::handlers::points::next_round_end(now);
    let rows: Vec<Row> = diesel::sql_query(format!(
        "{with}, payout_set AS ( \
           SELECT {points} AS p FROM users u {joins} \
           WHERE {points} >= {floor} ORDER BY p DESC LIMIT 100 \
         ) \
         SELECT u.address, u.username, u.avatar, \
         COALESCE(vol.volume_usd, 0) as volume_usd, \
         {points} as points, \
         {points_total} as points_total, \
         {points_projected} as points_projected, \
         {held} as held_usd, \
         (SELECT COALESCE(SUM(p), 0) FROM payout_set) as payout_total_points, \
         COALESCE(vol.trades, 0) as trades \
         FROM users u {joins} \
         LEFT JOIN ( \
           SELECT swapper_id AS uid, \
                  SUM(eth_amount::float8 * eth_price::float8) AS volume_usd, \
                  COUNT(id) AS trades \
           FROM trades WHERE traded_at > {epoch} AND traded_at <= {now} \
           GROUP BY swapper_id \
         ) vol ON vol.uid = u.id \
         WHERE {points} > 0 OR {points_projected} > 0 \
         ORDER BY points_projected DESC, points DESC, u.address ASC \
         LIMIT {limit}",
        with = crate::handlers::points::points_with_held(epoch, now),
        joins = format!(
            "{}{}",
            crate::handlers::points::POINTS_JOINS,
            crate::handlers::points::HELD_JOIN
        ),
        points_total = crate::handlers::points::points_total_expr(),
        points_projected = crate::handlers::points::points_projected_expr(epoch, now, round_end),
        held = crate::handlers::points::HELD_NOW_EXPR,
        floor = floor,
    ))
    .load(&mut conn)
    .await?;

    // One cached RPC read per request (60s TTL), shared by every row.
    let pot = crate::handlers::points::distributor_pot_bnb(&state).await;

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
            points_total: r.points_total,
            points_projected: r.points_projected,
            held_usd: r.held_usd,
            // Your actual slice of the real pot: 90% x pot x (you / payout set).
            // Exactly what the contract will compute — no fixed rate to drift.
            reward_eth: crate::handlers::points::estimate_reward_bnb(
                r.points,
                r.payout_total_points,
                pot,
            ),
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
        .filter(users::address.eq(&addr_lower))
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
    // Positive balances only — a fully-sold position leaves its holder row
    // behind with `amount` zeroed rather than deleted, and those are exits, not
    // holdings. Same `amount > 0` rule the token detail holder list uses.
    let holder_rows: Vec<(Holder, (Token, User))> = holders::table
        .inner_join(
            tokens::table.on(tokens::id.eq(holders::token_id))
                .inner_join(users::table.on(users::id.eq(tokens::creator_id))),
        )
        .filter(holders::user_id.eq(user.id))
        .filter(holders::amount.gt(bigdecimal::BigDecimal::from(0)))
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
            // These are the profile owner's own holdings.
            user: CreatorInfo {
                address: user.address.clone(),
                username: user.username.clone(),
                avatar: user.avatar.clone(),
            },
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

    // Referral count — active referrals only, the same bar the points use, so the
    // profile can't advertise referrals that earned nothing.
    #[derive(QueryableByName)]
    struct RefCount {
        #[diesel(sql_type = BigInt)]
        n: i64,
    }
    let referral_count: i64 = diesel::sql_query(format!(
        "SELECT COUNT(*)::bigint AS n FROM referrals r WHERE r.referrer_id = {uid} AND {active}",
        uid = user.id,
        active = crate::handlers::rewards::active_referral_sql("r")
    ))
    .get_result::<RefCount>(&mut conn)
    .await?
    .n;

    // Points (from referral_info earnings)
    let points: i32 = referral_info::table
        .filter(referral_info::user_id.eq(user.id))
        .select(referral_info::earnings)
        .first(&mut conn)
        .await
        .unwrap_or(0);

    // Trading rewards — volume model, identical to get_leaderboard, scoped to
    // this user. user.id is an integer from the DB, so inlining it is injection-safe.
    #[derive(QueryableByName)]
    struct TradeAgg {
        #[diesel(sql_type = Double)]
        volume_usd: f64,
        #[diesel(sql_type = Double)]
        points: f64,
    }
    // Canonical scoring, scoped to the CURRENT round window. This query had no
    // epoch filter at all — neither on the trades sum nor on the ledger sum — so
    // the profile kept accumulating points from rounds that had already been paid
    // out while the leaderboard correctly reset. The "Reward" tile therefore grew
    // without bound and showed BNB the user had already received or would never
    // receive.
    let epoch = crate::handlers::distributor::epoch_start(&state).await?;
    let epoch = crate::handlers::points::clamp_window_start(&state, epoch).await?;
    let now = chrono::Utc::now().timestamp();
    let agg: TradeAgg = diesel::sql_query(format!(
        "{with} \
         SELECT COALESCE(vol.volume_usd, 0) as volume_usd, {points} as points \
         FROM users u {joins} \
         LEFT JOIN ( \
           SELECT swapper_id AS uid, SUM(eth_amount::float8 * eth_price::float8) AS volume_usd \
           FROM trades WHERE traded_at > {epoch} AND traded_at <= {now} GROUP BY swapper_id \
         ) vol ON vol.uid = u.id \
         WHERE u.id = {uid}",
        with = crate::handlers::points::points_with(epoch, now),
        points = crate::handlers::points::points_expr(),
        joins = crate::handlers::points::POINTS_JOINS,
        uid = user.id
    ))
    .get_result(&mut conn)
    .await?;
    // Same pot-share model as the leaderboard (see handlers/points.rs). The
    // denominator is the set that actually gets posted on-chain, so the profile
    // and the leaderboard quote the same BNB for the same user.
    let floor = crate::handlers::points::min_payout_points();
    let payout_total: f64 = {
        #[derive(diesel::QueryableByName)]
        struct T {
            #[diesel(sql_type = Double)]
            t: f64,
        }
        let r: T = diesel::sql_query(format!(
            "{with} SELECT COALESCE(SUM(p), 0) AS t FROM ( \
               SELECT {points} AS p FROM users u {joins} \
               WHERE {points} >= {floor} ORDER BY p DESC LIMIT 100 \
             ) q",
            with = crate::handlers::points::points_with(epoch, now),
            points = crate::handlers::points::points_expr(),
            joins = crate::handlers::points::POINTS_JOINS,
            floor = floor,
        ))
        .get_result(&mut conn)
        .await?;
        r.t
    };
    let pot = crate::handlers::points::distributor_pot_bnb(&state).await;
    let reward_eth = crate::handlers::points::estimate_reward_bnb(agg.points, payout_total, pot);

    Ok(Json(UserProfileResponse {
        user: user_resp,
        holdings,
        chats: chat_responses,
        created_tokens,
        followers,
        followees,
        referral_count,
        points,
        trading_points: agg.points,
        trading_volume_usd: agg.volume_usd,
        reward_eth,
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
        .filter(users::address.eq(&addr_lower))
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
    // Bind the signature to THIS followee — the frontend signs "Follow <addr>\n<ts>",
    // so requiring that exact prefix stops a "Follow A" signature being replayed to
    // follow B (and matches the frontend's capitalized verb).
    let prefix = format!("Follow {address}");
    let recovered = verify_signed_action(&state, &body.msg, &body.signature, Some(&prefix)).await?;

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let follower: User = users::table
        .filter(users::address.eq(recovered.to_lowercase()))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("Follower user not found".to_string()))?;

    let addr_lower = address.to_lowercase();
    let followee: User = users::table
        .filter(users::address.eq(&addr_lower))
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
    // Bind to THIS followee (frontend signs "Unfollow <addr>\n<ts>").
    let prefix = format!("Unfollow {address}");
    let recovered = verify_signed_action(&state, &body.msg, &body.signature, Some(&prefix)).await?;

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let follower: User = users::table
        .filter(users::address.eq(recovered.to_lowercase()))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    let addr_lower = address.to_lowercase();
    let followee: User = users::table
        .filter(users::address.eq(&addr_lower))
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
    let recovered = verify_signed_action(
        &state,
        &body.msg,
        &body.signature,
        Some("Update profile"),
    )
    .await?;

    validate_profile_fields(
        body.user.username.as_deref(),
        body.user.bio.as_deref(),
        body.user.avatar.as_deref(),
    )?;

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let user: User = users::table
        .filter(users::address.eq(recovered.to_lowercase()))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Cooldown on profile updates, in hours. Default 0 = disabled.
    // Override with PROFILE_UPDATE_COOLDOWN_HOURS to re-enable anti-spam.
    let cooldown_hours: i64 = std::env::var("PROFILE_UPDATE_COOLDOWN_HOURS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    if cooldown_hours > 0 {
        let hours_since_update = Utc::now()
            .signed_duration_since(user.updated_at)
            .num_hours();
        if hours_since_update < cooldown_hours {
            return Err(AppError::RateLimited);
        }
    }

    // X/Twitter handle: omitted keeps the current value, "" clears it, anything
    // else is normalized (profile URL or @handle -> bare handle) and validated
    // against X's handle rules (1-15 chars, [A-Za-z0-9_]).
    let new_twitter: Option<String> = match body.user.twitter.as_deref() {
        None => user.twitter_username.clone(),
        Some(raw) => {
            let handle = raw
                .trim()
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .trim_start_matches("www.")
                .trim_start_matches("x.com/")
                .trim_start_matches("twitter.com/")
                .trim_start_matches('@')
                .trim();
            if handle.is_empty() {
                None
            } else if handle.len() <= 15
                && handle.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                Some(handle.to_string())
            } else {
                return Err(AppError::BadRequest(
                    "Invalid X/Twitter handle: 1-15 letters, digits or _".to_string(),
                ));
            }
        }
    };

    let updated_user = diesel::update(users::table.filter(users::id.eq(user.id)))
        .set((
            users::username.eq(body.user.username.as_deref().or(user.username.as_deref())),
            users::bio.eq(body.user.bio.as_deref().or(user.bio.as_deref())),
            users::avatar.eq(body.user.avatar.as_deref().or(user.avatar.as_deref())),
            users::twitter_username.eq(new_twitter),
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

    // Verify signature (fresh + single-use + bound to the avatar-upload action)
    let recovered = verify_signed_action(
        &state,
        &msg,
        &signature,
        Some("Upload avatar"),
    )
    .await?;

    // Cap size and derive type from the actual bytes (never the client-declared
    // content-type or filename) to prevent oversized uploads and stored XSS.
    const MAX_AVATAR: usize = 5 * 1024 * 1024; // 5MB
    if data.len() > MAX_AVATAR {
        return Err(AppError::BadRequest("Avatar too large (max 5MB)".into()));
    }
    let (ext, content_type) = crate::handlers::tokens::sniff_image(&data).ok_or_else(|| {
        AppError::BadRequest("Only image files are allowed (jpeg, png, gif, webp)".into())
    })?;
    let _ = &original_name; // filename is untrusted; derived ext used instead
    let filename = format!("avatar-{}.{}", uuid::Uuid::new_v4(), ext);

    let public_url = if let Some(ref s3) = state.s3_client {
        s3.put_object()
            .bucket(&state.s3_bucket)
            .key(&filename)
            .body(data.clone().into())
            .content_type(content_type)
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
        .filter(users::address.eq(&addr_lower))
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

    let mut network_bind: Option<String> = None;
    if let Some(ref network) = params.network {
        // Bound parameter — never interpolate the raw value.
        where_parts.push("tok.network = $1".to_string());
        network_bind = Some(network.clone());
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

    let rows: Vec<TopRow> = match network_bind {
        Some(net) => {
            diesel::sql_query(&query)
                .bind::<Text, _>(net)
                .load(&mut conn)
                .await?
        }
        None => diesel::sql_query(&query).load(&mut conn).await?,
    };

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
