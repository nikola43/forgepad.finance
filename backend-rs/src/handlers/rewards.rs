use std::collections::HashSet;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use chrono::{Duration, NaiveDate, Utc};
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Double, Text};
use diesel_async::RunQueryDsl;
use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::models::user::User;
use crate::schema::users;
use crate::AppState;

// ---------------------------------------------------------------------------
// Rewards Hub — quests, daily streak, and achievements.
//
// Definitions live in code; per-user progress is computed live from the existing
// `trades`/`tokens`/`referrals`/`holders` tables. The only persisted state is the
// `points_ledger`: discrete point grants keyed by a UNIQUE `ref` so re-evaluation
// (or a double-claim) never double-grants. Each point is worth the same as a
// leaderboard point (reward_eth = this user's share of the live pot).
// ---------------------------------------------------------------------------

struct QuestDef {
    key: &'static str,
    title: &'static str,
    description: &'static str,
    kind: &'static str, // "oneoff" | "daily"
    target: f64,
    points: f64,
}

const QUESTS: &[QuestDef] = &[
    QuestDef { key: "first_buy", title: "First Buy", description: "Make your first token buy", kind: "oneoff", target: 1.0, points: 5.0 },
    QuestDef { key: "launch_token", title: "Launch a Token", description: "Create your first token", kind: "oneoff", target: 1.0, points: 20.0 },
    QuestDef { key: "refer_trader", title: "Bring a Friend", description: "Refer your first trader to Fyuz — and every referred trader keeps earning you +25 automatically", kind: "oneoff", target: 1.0, points: 25.0 },
    QuestDef { key: "daily_trade", title: "Daily Trader", description: "Make at least one trade today", kind: "daily", target: 1.0, points: 3.0 },
    QuestDef { key: "daily_volume", title: "Volume Runner", description: "Trade $10 of volume today", kind: "daily", target: 10.0, points: 10.0 },
];

struct AchDef {
    key: &'static str,
    title: &'static str,
    description: &'static str,
    icon: &'static str,
    points: f64,
}

const ACHIEVEMENTS: &[AchDef] = &[
    AchDef { key: "first_blood", title: "First Blood", description: "Completed your first trade", icon: "🩸", points: 0.0 },
    AchDef { key: "creator", title: "Creator", description: "Launched a token on Fyuz", icon: "🏗️", points: 10.0 },
    AchDef { key: "whale", title: "Whale", description: "Made a single trade over $100", icon: "🐋", points: 15.0 },
    AchDef { key: "graduate", title: "Graduate", description: "Held a token through graduation", icon: "🎓", points: 15.0 },
    AchDef { key: "week_warrior", title: "Week Warrior", description: "Reached a 7-day trading streak", icon: "🔥", points: 20.0 },
];

// Daily-quest ref is scoped to a date; one-off is scoped once.
fn quest_ref(q: &QuestDef, today: NaiveDate) -> String {
    if q.kind == "daily" {
        format!("quest:{}:{}", q.key, today)
    } else {
        format!("quest:{}", q.key)
    }
}

#[derive(QueryableByName)]
struct Metrics {
    #[diesel(sql_type = BigInt)]
    buy_count: i64,
    #[diesel(sql_type = BigInt)]
    trade_count: i64,
    #[diesel(sql_type = Double)]
    max_trade_usd: f64,
    #[diesel(sql_type = BigInt)]
    trades_today: i64,
    #[diesel(sql_type = Double)]
    volume_today: f64,
    #[diesel(sql_type = BigInt)]
    tokens_created: i64,
    #[diesel(sql_type = BigInt)]
    referral_count: i64,
    #[diesel(sql_type = BigInt)]
    holds_graduated: i64,
}

#[derive(QueryableByName)]
struct RefRow {
    #[diesel(sql_type = Text)]
    r: String,
}

#[derive(QueryableByName)]
struct DateRow {
    #[diesel(sql_type = Text)]
    d: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestState {
    key: String,
    title: String,
    description: String,
    kind: String,
    target: f64,
    progress: f64,
    points: f64,
    completed: bool,
    claimed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementState {
    key: String,
    title: String,
    description: String,
    icon: String,
    points: f64,
    earned: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewardsResponse {
    address: String,
    current_streak: i64,
    longest_streak: i64,
    bonus_points: f64,
    quests: Vec<QuestState>,
    achievements: Vec<AchievementState>,
}

/// Progress value for a quest given the computed metrics.
fn quest_progress(key: &str, m: &Metrics) -> f64 {
    match key {
        "first_buy" => m.buy_count as f64,
        "launch_token" => m.tokens_created as f64,
        "refer_trader" => m.referral_count as f64,
        "daily_trade" => m.trades_today as f64,
        "daily_volume" => m.volume_today,
        _ => 0.0,
    }
}

/// Whether an achievement's condition is met.
fn ach_earned(key: &str, m: &Metrics, longest_streak: i64) -> bool {
    match key {
        "first_blood" => m.trade_count >= 1,
        "creator" => m.tokens_created >= 1,
        "whale" => m.max_trade_usd >= 100.0,
        "graduate" => m.holds_graduated >= 1,
        "week_warrior" => longest_streak >= 7,
        _ => false,
    }
}

/// Compute (current, longest) streak from the set of distinct trade dates.
fn compute_streaks(dates: &HashSet<NaiveDate>, today: NaiveDate) -> (i64, i64) {
    if dates.is_empty() {
        return (0, 0);
    }
    // Current streak: anchor on today, else yesterday, then walk backwards.
    let mut current = 0i64;
    let mut anchor = if dates.contains(&today) {
        Some(today)
    } else if dates.contains(&(today - Duration::days(1))) {
        Some(today - Duration::days(1))
    } else {
        None
    };
    while let Some(day) = anchor {
        if dates.contains(&day) {
            current += 1;
            anchor = Some(day - Duration::days(1));
        } else {
            break;
        }
    }
    // Longest streak across all history.
    let mut sorted: Vec<NaiveDate> = dates.iter().copied().collect();
    sorted.sort();
    let mut longest = 1i64;
    let mut run = 1i64;
    for w in sorted.windows(2) {
        if w[1] == w[0] + Duration::days(1) {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 1;
        }
    }
    (current, longest)
}

async fn load_user(state: &AppState, address: &str) -> AppResult<User> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    users::table
        .filter(users::address.eq(address.to_lowercase()))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))
}

async fn compute_metrics(state: &AppState, uid: i32) -> AppResult<Metrics> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    // uid is an i32 from the DB, so inlining is injection-safe.
    let m: Metrics = diesel::sql_query(format!(
        "SELECT \
           COALESCE(SUM(CASE WHEN t.trade_type = 'buy' THEN 1 ELSE 0 END), 0)::bigint AS buy_count, \
           COUNT(t.id)::bigint AS trade_count, \
           COALESCE(MAX(CASE WHEN t.trade_type = 'buy' THEN t.eth_amount::float8 * t.eth_price::float8 ELSE 0 END), 0) AS max_trade_usd, \
           COALESCE(SUM(CASE WHEN t.trade_type = 'buy' AND to_timestamp(t.traded_at) AT TIME ZONE 'UTC' >= date_trunc('day', now() AT TIME ZONE 'UTC') THEN 1 ELSE 0 END), 0)::bigint AS trades_today, \
           COALESCE(SUM(CASE WHEN t.trade_type = 'buy' AND to_timestamp(t.traded_at) AT TIME ZONE 'UTC' >= date_trunc('day', now() AT TIME ZONE 'UTC') THEN t.eth_amount::float8 * t.eth_price::float8 ELSE 0 END), 0) AS volume_today, \
           (SELECT COUNT(*) FROM tokens WHERE creator_id = {uid})::bigint AS tokens_created, \
           (SELECT COUNT(*) FROM referrals WHERE referrer_id = {uid})::bigint AS referral_count, \
           (SELECT COUNT(*) FROM holders h JOIN tokens tk ON tk.id = h.token_id \
              WHERE h.user_id = {uid} AND h.amount > 0 AND tk.launched_at IS NOT NULL)::bigint AS holds_graduated \
         FROM trades t WHERE t.swapper_id = {uid}"
    ))
    .get_result(&mut conn)
    .await?;
    Ok(m)
}

async fn compute_streak_pair(state: &AppState, uid: i32) -> AppResult<(i64, i64)> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let rows: Vec<DateRow> = diesel::sql_query(format!(
        "SELECT DISTINCT to_timestamp(traded_at)::date::text AS d FROM trades WHERE swapper_id = {uid}"
    ))
    .load(&mut conn)
    .await?;
    let dates: HashSet<NaiveDate> = rows
        .into_iter()
        .filter_map(|r| NaiveDate::parse_from_str(&r.d, "%Y-%m-%d").ok())
        .collect();
    Ok(compute_streaks(&dates, Utc::now().date_naive()))
}

async fn claimed_quest_refs(state: &AppState, uid: i32) -> AppResult<HashSet<String>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let rows: Vec<RefRow> = diesel::sql_query(format!(
        "SELECT ref AS r FROM points_ledger WHERE user_id = {uid} AND source = 'quest'"
    ))
    .load(&mut conn)
    .await?;
    Ok(rows.into_iter().map(|r| r.r).collect())
}

async fn bonus_points(state: &AppState, uid: i32) -> AppResult<f64> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    #[derive(QueryableByName)]
    struct P {
        #[diesel(sql_type = Double)]
        total: f64,
    }
    let p: P = diesel::sql_query(format!(
        "SELECT round(COALESCE(SUM(amount), 0)::numeric)::float8 AS total \
         FROM points_ledger WHERE user_id = {uid}"
    ))
    .get_result(&mut conn)
    .await?;
    Ok(p.total)
}

/// Token ids created by the user that have graduated (launched to a DEX).
async fn graduated_created_tokens(state: &AppState, uid: i32) -> AppResult<Vec<i32>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    #[derive(QueryableByName)]
    struct T {
        #[diesel(sql_type = diesel::sql_types::Integer)]
        id: i32,
    }
    let rows: Vec<T> = diesel::sql_query(format!(
        "SELECT id FROM tokens WHERE creator_id = {uid} AND launched_at IS NOT NULL"
    ))
    .load(&mut conn)
    .await?;
    Ok(rows.into_iter().map(|t| t.id).collect())
}

/// Insert an idempotent point grant (no-op if this USER already has `ref`).
/// Returns rows inserted (1 = newly granted, 0 = already present).
///
/// The conflict target is (user_id, ref), NOT ref alone. It used to be `ref`,
/// which was globally unique while the refs built by quest_ref/achievements
/// carry no user id — so the first user to claim "quest:first_buy" consumed it
/// for the entire platform and every later claim silently inserted 0 rows.
async fn grant(state: &AppState, uid: i32, source: &str, amount: f64, reference: &str) -> AppResult<usize> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let n = diesel::sql_query(
        "INSERT INTO points_ledger (user_id, source, amount, ref) VALUES ($1, $2, $3, $4) \
         ON CONFLICT (user_id, ref) DO NOTHING",
    )
    .bind::<diesel::sql_types::Integer, _>(uid)
    .bind::<Text, _>(source)
    .bind::<Double, _>(amount)
    .bind::<Text, _>(reference)
    .execute(&mut conn)
    .await?;
    Ok(n)
}

/// Points granted per referred trader (once they make their first trade).
const REFERRAL_POINTS: f64 = 25.0;

/// Minimum net USD a referee must have bought (and still hold) before the
/// referrer is paid for them. "Made one trade" was too cheap a bar: a dust buy
/// costs cents, so 25 points per wallet was a faucet priced far below the pot
/// share those points claim.
const REFERRAL_MIN_REFEREE_USD: f64 = 50.0;

/// Referees of `uid` who are real traders: net USD bought (buys minus sells)
/// at or above REFERRAL_MIN_REFEREE_USD. Self-referrals are excluded outright.
async fn traded_referees(state: &AppState, uid: i32) -> AppResult<Vec<i32>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    #[derive(QueryableByName)]
    struct T {
        #[diesel(sql_type = diesel::sql_types::Integer)]
        referee_id: i32,
    }
    let rows: Vec<T> = diesel::sql_query(format!(
        "SELECT r.referee_id FROM referrals r WHERE r.referrer_id = {uid} \
         AND r.referee_id <> {uid} \
         AND COALESCE(( \
               SELECT SUM(CASE WHEN t.trade_type = 'buy' \
                               THEN t.eth_amount::float8 * t.eth_price::float8 \
                               ELSE -(t.eth_amount::float8 * t.eth_price::float8) END) \
               FROM trades t WHERE t.swapper_id = r.referee_id \
             ), 0) >= {min_usd}",
        min_usd = REFERRAL_MIN_REFEREE_USD
    ))
    .load(&mut conn)
    .await?;
    Ok(rows.into_iter().map(|t| t.referee_id).collect())
}

/// Grant every reward `uid` has earned but not yet been credited. Idempotent —
/// each grant is keyed by a (user_id, ref) unique constraint, so calling this
/// repeatedly is a no-op once a reward has landed.
///
/// This is deliberately NOT called from a read handler. Grants are timestamped
/// with `created_at`, and `created_at` decides which payout round a grant scores
/// in — so if an anonymous GET triggered the write, a stranger refreshing a
/// profile would choose which week a user's points counted toward, and a user
/// nobody viewed would never be credited at all. It is driven instead by the
/// events that actually earn the reward: a trade landing in the indexer, a token
/// being created, a referral being registered.
pub async fn sync_grants(state: &AppState, uid: i32) -> AppResult<()> {
    let metrics = compute_metrics(state, uid).await?;
    let (_, longest_streak) = compute_streak_pair(state, uid).await?;
    let today = Utc::now().date_naive();

    // Quests: granted the moment their condition is met. There is no claim step
    // — users should not have to click to receive something they have earned.
    for q in QUESTS {
        if quest_progress(q.key, &metrics) >= q.target {
            let _ = grant(state, uid, "quest", q.points, &quest_ref(q, today)).await;
        }
    }

    // Achievements.
    for a in ACHIEVEMENTS {
        if a.points > 0.0 && ach_earned(a.key, &metrics, longest_streak) {
            let _ = grant(state, uid, "achievement", a.points, &format!("ach:{}", a.key)).await;
        }
    }

    // Creator reward: +50 points per token you created that graduated to a DEX.
    for tid in graduated_created_tokens(state, uid).await? {
        let _ = grant(state, uid, "creator", 50.0, &format!("creator_grad:{tid}")).await;
    }

    // Referral reward: +25 points per referred trader who cleared the activity
    // floor. Idempotent — a referee has exactly one referrer, so refs can't collide.
    for rid in traded_referees(state, uid).await? {
        let _ = grant(state, uid, "referral", REFERRAL_POINTS, &format!("referral:{rid}")).await;
    }
    Ok(())
}

/// Periodically credit every recently-active user.
///
/// The indexer hook alone is not enough, for two reasons:
///
///   1. Not every reward is earned by a trade. Creating a token completes
///      `launch_token`, a token graduating pays `creator_grad`, and a streak
///      crosses a day boundary with no trade at all. Nothing in those paths
///      touches the swap indexer, so a purely trade-driven grant leaves them
///      pending forever — the UI shows "Crediting…" and it never resolves.
///   2. Anything earned BEFORE the auto-grant existed was never credited, and
///      would not be until the user happened to trade again.
///
/// The sweep is the backstop that makes "automatic" actually mean automatic:
/// idempotent, so it only ever fills gaps, and scoped to users active within the
/// round window since nobody outside it can be earning.
pub async fn sweep_grants(state: &AppState) -> AppResult<usize> {
    use diesel::sql_types::BigInt;
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    #[derive(QueryableByName)]
    struct U {
        #[diesel(sql_type = diesel::sql_types::Integer)]
        id: i32,
    }
    // Active = traded or created a token in the last 8 days (one round window
    // plus slack). Bounded so this stays cheap as the user table grows.
    let cutoff = chrono::Utc::now().timestamp() - 8 * 86400;
    let users: Vec<U> = diesel::sql_query(
        "SELECT DISTINCT u.id FROM users u \
         WHERE EXISTS (SELECT 1 FROM trades t WHERE t.swapper_id = u.id AND t.traded_at >= $1) \
            OR EXISTS (SELECT 1 FROM tokens tk WHERE tk.creator_id = u.id)",
    )
    .bind::<BigInt, _>(cutoff)
    .load(&mut conn)
    .await?;
    drop(conn);

    let mut n = 0;
    for u in &users {
        if sync_grants(state, u.id).await.is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

// GET /rewards/:address — READ ONLY. See sync_grants for why nothing is minted here.
pub async fn get_rewards(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<RewardsResponse>> {
    let user = load_user(&state, &address).await?;
    let uid = user.id;
    let metrics = compute_metrics(&state, uid).await?;
    let (current_streak, longest_streak) = compute_streak_pair(&state, uid).await?;
    let today = Utc::now().date_naive();

    let claimed = claimed_quest_refs(&state, uid).await?;
    let quests = QUESTS
        .iter()
        .map(|q| {
            let progress = quest_progress(q.key, &metrics);
            QuestState {
                key: q.key.to_string(),
                title: q.title.to_string(),
                description: q.description.to_string(),
                kind: q.kind.to_string(),
                target: q.target,
                progress: progress.min(q.target),
                points: q.points,
                completed: progress >= q.target,
                claimed: claimed.contains(&quest_ref(q, today)),
            }
        })
        .collect();

    let achievements = ACHIEVEMENTS
        .iter()
        .map(|a| AchievementState {
            key: a.key.to_string(),
            title: a.title.to_string(),
            description: a.description.to_string(),
            icon: a.icon.to_string(),
            points: a.points,
            earned: ach_earned(a.key, &metrics, longest_streak),
        })
        .collect();

    let bonus = bonus_points(&state, uid).await?;

    Ok(Json(RewardsResponse {
        address: user.address,
        current_streak,
        longest_streak,
        bonus_points: bonus,
        quests,
        achievements,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimResponse {
    claimed: bool,
    points: f64,
    message: String,
}

// Quests are granted automatically by sync_grants() as soon as they are earned,
// so there is no claim endpoint. The old POST /rewards/:address/claim/:questKey
// is gone: a claim button meant a user could earn a reward and never receive it
// by simply not clicking, and gating the mint behind a request made an
// unauthenticated caller the one deciding when points were created.
