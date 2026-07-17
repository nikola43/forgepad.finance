use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::Json;
use bigdecimal::BigDecimal;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Integer, Text};
use diesel_async::RunQueryDsl;
use k256::ecdsa::{SigningKey, VerifyingKey};
use k256::elliptic_curve::rand_core::OsRng;
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
pub struct ListTokensQuery {
    pub order_type: Option<String>,
    pub order_flag: Option<String>,
    pub search_word: Option<String>,
    pub network: Option<String>,
    /// Exact-match filter on the fusion's image style ("all" = no filter).
    pub style: Option<String>,
    pub include_nsfw: Option<bool>,
    pub page_number: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenDetailQuery {
    pub page_number: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTokenBody {
    pub creator_address: String,
    pub token_name: String,
    pub token_symbol: String,
    pub token_description: Option<String>,
    pub image_style: Option<String>,
    pub token_image: Option<String>,
    pub network: String,
    pub telegram_link: Option<String>,
    pub twitter_link: Option<String>,
    pub web_link: Option<String>,
    pub token_address: Option<String>,
    // Required only when updating an existing token's metadata (token_address set).
    pub msg: Option<String>,
    pub signature: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveTokenBody {
    pub signature: String,
    pub msg: String,
    pub category: String,
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTokensResponse {
    pub token_list: Vec<TokenResponse>,
    pub token_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenDetailResponse {
    pub token_details: TokenResponse,
    pub trades: Vec<TradeResponse>,
    pub trades_count: i64,
    pub holders_details: Vec<HolderResponse>,
    pub fifteen_min_price: Option<String>,
    pub one_day_liquidity: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn find_chain(state: &AppState, network: &str) -> Result<crate::config::chains::ChainConfig, AppError> {
    state
        .chains
        .iter()
        .find(|c| c.network.eq_ignore_ascii_case(network))
        .cloned()
        .ok_or_else(|| AppError::BadRequest(format!("Unknown network: {network}")))
}

fn validate_eth_address(addr: &str) -> Result<(), AppError> {
    let stripped = addr.strip_prefix("0x").unwrap_or(addr);
    if stripped.len() != 40 || !stripped.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(format!("Invalid address: {addr}")));
    }
    Ok(())
}

fn validate_url_optional(url: &Option<String>, label: &str) -> Result<(), AppError> {
    if let Some(u) = url {
        if !u.is_empty() && !u.starts_with("http://") && !u.starts_with("https://") {
            return Err(AppError::BadRequest(format!("Invalid {label} URL: {u}")));
        }
    }
    Ok(())
}

/// Detect an image type from its magic bytes. Returns (extension, mime) for a
/// whitelist of image formats, or None if the bytes are not a recognized image.
/// Never trust the client-declared content-type or filename for this — both are
/// spoofable and would otherwise allow storing HTML/JS served as text/html.
pub(crate) fn sniff_image(data: &[u8]) -> Option<(&'static str, &'static str)> {
    if data.len() >= 8 && data[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return Some(("png", "image/png"));
    }
    if data.len() >= 3 && data[..3] == [0xFF, 0xD8, 0xFF] {
        return Some(("jpg", "image/jpeg"));
    }
    if data.len() >= 6 && (&data[..6] == b"GIF87a" || &data[..6] == b"GIF89a") {
        return Some(("gif", "image/gif"));
    }
    if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return Some(("webp", "image/webp"));
    }
    None
}

// ---------------------------------------------------------------------------
// GET /tokens
// ---------------------------------------------------------------------------

pub async fn list_tokens(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ListTokensQuery>,
) -> AppResult<Json<ListTokensResponse>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let page_number = params.page_number.unwrap_or(1).clamp(1, 1_000_000);
    let page_size = params.page_size.unwrap_or(30).clamp(1, 100);
    let offset = (page_number - 1) * page_size;
    let order_type = params.order_type.as_deref().unwrap_or("createdAt");
    let order_flag = params.order_flag.as_deref().unwrap_or("DESC");
    let include_nsfw = params.include_nsfw.unwrap_or(false);

    // For trends / bump ordering we need raw SQL with the decay formula.
    let use_raw = order_type == "trends" || order_type == "bump";

    if use_raw {
        let score_col = if order_type == "trends" { "score" } else { "score" };
        let direction = if order_flag.eq_ignore_ascii_case("ASC") { "ASC" } else { "DESC" };

        let mut where_clauses = Vec::new();
        let mut bind_values: Vec<String> = Vec::new();

        if !include_nsfw {
            where_clauses.push("t.category = 'normal'".to_string());
        }
        if let Some(ref network) = params.network {
            if network != "all" {
                bind_values.push(network.clone());
                where_clauses.push(format!("t.network = ${}", bind_values.len()));
            }
        }
        if let Some(ref style) = params.style {
            if style != "all" && !style.is_empty() {
                bind_values.push(style.clone());
                where_clauses.push(format!("t.image_style = ${}", bind_values.len()));
            }
        }

        let where_sql = if where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", where_clauses.join(" AND "))
        };

        // Search requires a join to users for creatorAddress
        let search_join;
        if let Some(ref word) = params.search_word {
            if !word.is_empty() {
                bind_values.push(format!("%{}%", word.to_lowercase()));
                let idx = bind_values.len();
                search_join = format!(
                    "JOIN users u ON u.id = t.creator_id \
                     AND (LOWER(t.token_address) LIKE ${idx} \
                          OR LOWER(t.name) LIKE ${idx} \
                          OR LOWER(t.symbol) LIKE ${idx} \
                          OR LOWER(u.address) LIKE ${idx})"
                );
            } else {
                search_join = String::new();
            }
        } else {
            search_join = String::new();
        }

        // Build the raw query using diesel sql_query
        let decay_expr = format!(
            "{score_col} / (1.0 + 0.0000001 * x * x + 0.000006 * x * x * x + 0.00000006 * x * x * x * x)"
        );

        let _query_str = format!(
            "SELECT t.*, u_creator.address as creator_address, \
             (EXTRACT(EPOCH FROM (NOW() - t.updated_at)) * 100.0 / 1800.0) as x, \
             ({decay_expr}) as decay_score \
             FROM tokens t \
             JOIN users u_creator ON u_creator.id = t.creator_id \
             {search_join} \
             {where_sql} \
             ORDER BY decay_score {direction} \
             LIMIT {page_size} OFFSET {offset}"
        );

        let count_str = format!(
            "SELECT COUNT(*)::BIGINT as cnt FROM tokens t \
             {search_join} \
             {where_sql}"
        );

        // We fall back to a simpler approach: fetch ids with raw SQL, then load via diesel.
        // This avoids needing to define QueryableByName for every column.
        let id_query = format!(
            "SELECT t.id FROM tokens t \
             JOIN users u_creator ON u_creator.id = t.creator_id \
             {search_join} \
             {where_sql} \
             ORDER BY ({score_col}::float8 / (1.0 + 0.0000001 * pow(EXTRACT(EPOCH FROM (NOW() - t.updated_at)) * 100.0 / 1800.0, 2) \
                        + 0.000006 * pow(EXTRACT(EPOCH FROM (NOW() - t.updated_at)) * 100.0 / 1800.0, 3) \
                        + 0.00000006 * pow(EXTRACT(EPOCH FROM (NOW() - t.updated_at)) * 100.0 / 1800.0, 4))) {direction} \
             LIMIT {page_size} OFFSET {offset}"
        );

        #[derive(QueryableByName)]
        struct IdRow {
            #[diesel(sql_type = Integer)]
            id: i32,
        }

        #[derive(QueryableByName)]
        struct CountRow {
            #[diesel(sql_type = BigInt)]
            cnt: i64,
        }

        // Bind the (network, search) values positionally as $1/$2 — the query
        // strings only ever reference these via placeholders, never interpolate
        // user input. diesel's typed builder forces us to enumerate bind counts.
        let ids: Vec<IdRow> = match bind_values.len() {
            0 => diesel::sql_query(&id_query).load(&mut conn).await?,
            1 => {
                diesel::sql_query(&id_query)
                    .bind::<Text, _>(bind_values[0].clone())
                    .load(&mut conn)
                    .await?
            }
            2 => {
                diesel::sql_query(&id_query)
                    .bind::<Text, _>(bind_values[0].clone())
                    .bind::<Text, _>(bind_values[1].clone())
                    .load(&mut conn)
                    .await?
            }
            _ => {
                diesel::sql_query(&id_query)
                    .bind::<Text, _>(bind_values[0].clone())
                    .bind::<Text, _>(bind_values[1].clone())
                    .bind::<Text, _>(bind_values[2].clone())
                    .load(&mut conn)
                    .await?
            }
        };

        let count_rows: Vec<CountRow> = match bind_values.len() {
            0 => diesel::sql_query(&count_str).load(&mut conn).await?,
            1 => {
                diesel::sql_query(&count_str)
                    .bind::<Text, _>(bind_values[0].clone())
                    .load(&mut conn)
                    .await?
            }
            2 => {
                diesel::sql_query(&count_str)
                    .bind::<Text, _>(bind_values[0].clone())
                    .bind::<Text, _>(bind_values[1].clone())
                    .load(&mut conn)
                    .await?
            }
            _ => {
                diesel::sql_query(&count_str)
                    .bind::<Text, _>(bind_values[0].clone())
                    .bind::<Text, _>(bind_values[1].clone())
                    .bind::<Text, _>(bind_values[2].clone())
                    .load(&mut conn)
                    .await?
            }
        };

        let token_count = count_rows.get(0).map(|r| r.cnt).unwrap_or(0);

        if ids.is_empty() {
            return Ok(Json(ListTokensResponse {
                token_list: vec![],
                token_count,
            }));
        }

        let token_ids: Vec<i32> = ids.into_iter().map(|r| r.id).collect();

        let results: Vec<(Token, User)> = tokens::table
            .inner_join(users::table.on(users::id.eq(tokens::creator_id)))
            .filter(tokens::id.eq_any(&token_ids))
            .load(&mut conn)
            .await?;

        // Preserve the decay-based ordering from raw SQL
        let mut token_map: std::collections::HashMap<i32, (Token, User)> = results
            .into_iter()
            .map(|(t, u)| (t.id, (t, u)))
            .collect();

        let mut token_list = Vec::with_capacity(token_ids.len());
        for tid in &token_ids {
            if let Some((token, user)) = token_map.remove(tid) {
                let chain = find_chain(&state, &token.network).unwrap_or_else(|_| state.chains[0].clone());
                token_list.push(TokenResponse::from_token_and_creator(&token, &user, &chain));
            }
        }

        return Ok(Json(ListTokensResponse {
            token_list,
            token_count,
        }));
    }

    // Standard ordering (createdAt, marketcap, volume)
    let mut query = tokens::table
        .inner_join(users::table.on(users::id.eq(tokens::creator_id)))
        .into_boxed();

    if !include_nsfw {
        query = query.filter(tokens::category.eq(TokenCategory::Normal));
    }

    if let Some(ref network) = params.network {
        if network != "all" {
            query = query.filter(tokens::network.eq(network));
        }
    }

    if let Some(ref style) = params.style {
        if style != "all" && !style.is_empty() {
            query = query.filter(tokens::image_style.eq(style));
        }
    }

    if let Some(ref word) = params.search_word {
        if !word.is_empty() {
            // Bound parameter via ilike (case-insensitive) — never interpolate input.
            let pattern = format!("%{}%", word);
            query = query.filter(
                tokens::token_address
                    .ilike(pattern.clone())
                    .or(tokens::name.ilike(pattern.clone()))
                    .or(tokens::symbol.ilike(pattern.clone()))
                    .or(users::address.ilike(pattern.clone())),
            );
        }
    }

    // Count before pagination
    let _count_query = tokens::table
        .inner_join(users::table.on(users::id.eq(tokens::creator_id)))
        .into_boxed();

    // We need a separate count. Simplest approach: clone filters via a second query.
    // For now, use a count subquery.
    let mut count_q = tokens::table
        .inner_join(users::table.on(users::id.eq(tokens::creator_id)))
        .into_boxed();

    if !include_nsfw {
        count_q = count_q.filter(tokens::category.eq(TokenCategory::Normal));
    }
    if let Some(ref network) = params.network {
        if network != "all" {
            count_q = count_q.filter(tokens::network.eq(network));
        }
    }
    if let Some(ref style) = params.style {
        if style != "all" && !style.is_empty() {
            count_q = count_q.filter(tokens::image_style.eq(style));
        }
    }
    if let Some(ref word) = params.search_word {
        if !word.is_empty() {
            let pattern = format!("%{}%", word);
            count_q = count_q.filter(
                tokens::token_address
                    .ilike(pattern.clone())
                    .or(tokens::name.ilike(pattern.clone()))
                    .or(tokens::symbol.ilike(pattern.clone()))
                    .or(users::address.ilike(pattern.clone())),
            );
        }
    }

    let token_count: i64 = count_q
        .count()
        .get_result(&mut conn)
        .await?;

    let is_desc = !order_flag.eq_ignore_ascii_case("ASC");

    query = match order_type {
        "marketcap" => {
            if is_desc {
                query.order(tokens::marketcap.desc())
            } else {
                query.order(tokens::marketcap.asc())
            }
        }
        "volume" => {
            if is_desc {
                query.order(tokens::volume.desc())
            } else {
                query.order(tokens::volume.asc())
            }
        }
        _ => {
            // createdAt default
            if is_desc {
                query.order(tokens::created_at.desc())
            } else {
                query.order(tokens::created_at.asc())
            }
        }
    };

    let results: Vec<(Token, User)> = query
        .offset(offset)
        .limit(page_size)
        .load(&mut conn)
        .await?;

    let token_list: Vec<TokenResponse> = results
        .iter()
        .map(|(token, user)| {
            let chain = find_chain(&state, &token.network).unwrap_or_else(|_| state.chains[0].clone());
            TokenResponse::from_token_and_creator(token, &user, &chain)
        })
        .collect();

    Ok(Json(ListTokensResponse {
        token_list,
        token_count,
    }))
}

// ---------------------------------------------------------------------------
// GET /tokens/king
// ---------------------------------------------------------------------------

pub async fn get_king(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<serde_json::Value>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    // King of the Hill is a bonding-curve race: once a token graduates
    // (launched_at set), it leaves the hill and the crown passes to the
    // highest-marketcap token still on the curve.
    let result: Option<(Token, User)> = tokens::table
        .inner_join(users::table.on(users::id.eq(tokens::creator_id)))
        .filter(tokens::category.eq(TokenCategory::Normal))
        .filter(tokens::launched_at.is_null())
        .order(tokens::marketcap.desc())
        .first(&mut conn)
        .await
        .optional()?;

    match result {
        Some((token, user)) => {
            let chain = find_chain(&state, &token.network).unwrap_or_else(|_| state.chains[0].clone());
            let resp = TokenResponse::from_token_and_creator(&token, &user, &chain);
            Ok(Json(serde_json::json!({ "king": resp })))
        }
        None => Ok(Json(serde_json::json!({ "king": null }))),
    }
}

// ---------------------------------------------------------------------------
// GET /tokens/:network/:tokenAddress
// ---------------------------------------------------------------------------

pub async fn get_token_details(
    State(state): State<Arc<AppState>>,
    Path((network, token_address)): Path<(String, String)>,
    Query(params): Query<TokenDetailQuery>,
) -> AppResult<Json<TokenDetailResponse>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let page_number = params.page_number.unwrap_or(1).clamp(1, 1_000_000);
    let page_size = params.page_size.unwrap_or(30).clamp(1, 100);
    let offset = (page_number - 1) * page_size;

    // Find token + creator. Addresses are stored lowercase, so normalize the
    // path param — otherwise a checksummed address in the URL 404s a token that
    // actually exists.
    let (token, creator): (Token, User) = tokens::table
        .inner_join(users::table.on(users::id.eq(tokens::creator_id)))
        .filter(tokens::network.eq(&network))
        .filter(tokens::token_address.eq(&token_address.to_lowercase()))
        .first(&mut conn)
        .await
        .optional()?
        .ok_or_else(|| AppError::NotFound("Token not found".to_string()))?;

    let chain = find_chain(&state, &token.network).unwrap_or_else(|_| state.chains[0].clone());
    let mut token_resp = TokenResponse::from_token_and_creator(&token, &creator, &chain);

    // Recent trades (paginated) with swapper info
    let trade_rows: Vec<(Trade, User)> = trades::table
        .inner_join(users::table.on(users::id.eq(trades::swapper_id)))
        .filter(trades::token_id.eq(token.id))
        .order(trades::traded_at.desc())
        .offset(offset)
        .limit(page_size)
        .load(&mut conn)
        .await?;

    let trade_responses: Vec<TradeResponse> = trade_rows
        .iter()
        .map(|(trade, swapper)| TradeResponse {
            id: trade.id,
            token_name: token.name.clone(),
            token_symbol: token.symbol.clone(),
            token_address: token.token_address.clone(),
            token_image: token.image.clone(),
            swapper_address: swapper.address.clone(),
            swapper_username: swapper.username.clone(),
            swapper_avatar: swapper.avatar.clone(),
            type_: match trade.trade_type {
                TradeType::Buy => "BUY".to_string(),
                TradeType::Sell => "SELL".to_string(),
            },
            eth_amount: trade.eth_amount.to_string(),
            token_amount: trade.token_amount.to_string(),
            network: token.network.clone(),
            date: trade.traded_at,
            tx_hash: trade.tx_hash.clone(),
            token_price: trade.token_price.to_string(),
            eth_price: trade.eth_price.to_string(),
        })
        .collect();

    // Holders list
    // Cap to the top holders — a detail view never needs the full holder set,
    // and an unbounded load on a popular token is a memory/latency risk.
    let holder_rows: Vec<(Holder, User)> = holders::table
        .inner_join(users::table.on(users::id.eq(holders::user_id)))
        .filter(holders::token_id.eq(token.id))
        .order(holders::amount.desc())
        .limit(200)
        .load(&mut conn)
        .await?;

    let holder_responses: Vec<HolderResponse> = holder_rows
        .iter()
        .map(|(holder, user)| HolderResponse {
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
            user: CreatorInfo {
                address: user.address.clone(),
                username: user.username.clone(),
                avatar: user.avatar.clone(),
            },
        })
        .collect();

    // 15-minute price: most recent trade within the last 900 seconds
    let now_epoch = chrono::Utc::now().timestamp();
    let fifteen_min_ago = now_epoch - 900;

    let fifteen_min_trade: Option<Trade> = trades::table
        .filter(trades::token_id.eq(token.id))
        .filter(trades::traded_at.gt(fifteen_min_ago))
        .order(trades::traded_at.asc())
        .first(&mut conn)
        .await
        .optional()?;

    let fifteen_min_price = fifteen_min_trade.map(|t| t.token_price.to_string());

    // 1-day liquidity: sum of eth_amount for BUY trades in last 24h
    let one_day_ago = now_epoch - 86400;

    let one_day_liq: Option<BigDecimal> = trades::table
        .filter(trades::token_id.eq(token.id))
        .filter(trades::trade_type.eq(TradeType::Buy))
        .filter(trades::traded_at.gt(one_day_ago))
        .select(diesel::dsl::sum(trades::eth_amount))
        .first(&mut conn)
        .await?;

    let one_day_liquidity = one_day_liq.map(|v| v.to_string());

    let trades_count = trade_responses.len() as i64;

    // Set 15-min price fields on the token response
    if let Some(ref p15) = fifteen_min_price {
        if let Ok(p15_f) = p15.parse::<f64>() {
            let current_price: f64 = token.price.to_string().parse().unwrap_or(0.0);
            token_resp.price_15m = Some(p15_f);
            token_resp.price_change_15m = if p15_f > 0.0 {
                Some(((current_price - p15_f) / p15_f) * 100.0)
            } else {
                Some(0.0)
            };
        }
    }

    Ok(Json(TokenDetailResponse {
        token_details: token_resp,
        trades: trade_responses,
        trades_count,
        holders_details: holder_responses,
        fifteen_min_price,
        one_day_liquidity,
    }))
}

// ---------------------------------------------------------------------------
// POST /tokens
// ---------------------------------------------------------------------------

pub async fn create_token(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateTokenBody>,
) -> AppResult<Json<serde_json::Value>> {
    validate_eth_address(&body.creator_address)?;
    validate_url_optional(&body.telegram_link, "telegram")?;
    validate_url_optional(&body.twitter_link, "twitter")?;
    validate_url_optional(&body.web_link, "web")?;

    if body.token_name.is_empty() || body.token_name.len() > 100 {
        return Err(AppError::BadRequest("Token name must be 1-100 chars".to_string()));
    }
    if body.token_symbol.is_empty() || body.token_symbol.len() > 20 {
        return Err(AppError::BadRequest("Token symbol must be 1-20 chars".to_string()));
    }
    // image_style lands in a VARCHAR(200) at indexing time — reject oversized
    // values here, before the token deploys on-chain and indexing would fail.
    if body.image_style.as_deref().is_some_and(|s| s.chars().count() > 200) {
        return Err(AppError::BadRequest(
            "imageStyle must be 200 characters or fewer".to_string(),
        ));
    }

    // Validate network
    let _chain = find_chain(&state, &body.network)?;

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    match &body.token_address {
        None => {
            let signing_key = SigningKey::random(&mut OsRng);
            let verifying_key = VerifyingKey::from(&signing_key);
            let address_bytes = verifying_key.to_sec1_bytes();
            let address_hex = format!("0x{}", hex::encode(address_bytes));

            let request_body = serde_json::json!({
                "tokenName": body.token_name,
                "tokenSymbol": body.token_symbol,
                "tokenDescription": body.token_description,
                "imageStyle": body.image_style,
                "tokenImage": body.token_image,
                "network": body.network,
                "telegramLink": body.telegram_link,
                "twitterLink": body.twitter_link,
                "webLink": body.web_link,
                "mintAddress": address_hex,
            });

            let new_req = NewTokenCreationRequest {
                creator_address: body.creator_address.to_lowercase(),
                body: request_body,
            };

            let inserted_id: i32 = diesel::insert_into(token_creation_requests::table)
                .values(&new_req)
                .returning(token_creation_requests::id)
                .get_result(&mut conn)
                .await?;

            Ok(Json(serde_json::json!({ "success": true, "sig": inserted_id })))
        }
        Some(token_addr) => {
            validate_eth_address(token_addr)?;

            // Update existing token metadata (only if creator matches)
            let (token, user): (Token, User) = tokens::table
                .inner_join(users::table.on(users::id.eq(tokens::creator_id)))
                .filter(tokens::token_address.eq(token_addr))
                .first(&mut conn)
                .await
                .optional()?
                .ok_or_else(|| AppError::NotFound("Token not found".to_string()))?;

            // Authenticate against a fresh signature from the token's ACTUAL
            // creator (stored on-chain-verified address) — never the client-claimed
            // creator_address, which is public and forgeable.
            let msg = body
                .msg
                .as_deref()
                .ok_or_else(|| AppError::Unauthorized("Signature required".to_string()))?;
            let signature = body
                .signature
                .as_deref()
                .ok_or_else(|| AppError::Unauthorized("Signature required".to_string()))?;
            // Bind the signature to THIS token (like move_token does) so an
            // "Update token" signature for one token can't be redirected to
            // another via the attacker-controlled token_address in the body.
            let prefix = format!("Update token {token_addr}");
            let recovered = verify_signed_action(&state, msg, signature, Some(&prefix)).await?;
            if !recovered.eq_ignore_ascii_case(&user.address) {
                return Err(AppError::Forbidden(
                    "Only the creator can update this token".to_string(),
                ));
            }

            diesel::update(tokens::table.filter(tokens::id.eq(token.id)))
                .set((
                    tokens::name.eq(&body.token_name),
                    tokens::symbol.eq(&body.token_symbol),
                    tokens::description.eq(&body.token_description),
                    tokens::telegram_link.eq(&body.telegram_link),
                    tokens::twitter_link.eq(&body.twitter_link),
                    tokens::web_link.eq(&body.web_link),
                ))
                .execute(&mut conn)
                .await?;

            Ok(Json(serde_json::json!({ "message": "Token updated" })))
        }
    }
}

// ---------------------------------------------------------------------------
// POST /tokens/:tokenAddress/move
// ---------------------------------------------------------------------------

pub async fn move_token(
    State(state): State<Arc<AppState>>,
    Path(token_address): Path<String>,
    Json(body): Json<MoveTokenBody>,
) -> AppResult<Json<serde_json::Value>> {
    // Admin action: fresh + single-use signature BOUND to this specific token, so a
    // signature for any other action/token can't be redirected here.
    let recovered = verify_signed_action(
        &state,
        &body.msg,
        &body.signature,
        Some(&format!("Move token {token_address}")),
    )
    .await?;

    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    // Check if recovered address belongs to an admin
    let admin_user: Option<(Admin, User)> = admins::table
        .inner_join(users::table.on(users::id.eq(admins::user_id)))
        .filter(users::address.eq(recovered.to_lowercase()))
        .first(&mut conn)
        .await
        .optional()?;

    if admin_user.is_none() {
        return Err(AppError::Forbidden("Only admins can move tokens".to_string()));
    }

    let category = match body.category.to_lowercase().as_str() {
        "normal" => TokenCategory::Normal,
        "nsfw" => TokenCategory::Nsfw,
        _ => return Err(AppError::BadRequest("Category must be 'normal' or 'NSFW'".to_string())),
    };

    // Stored addresses are always lowercase (the indexer hex-encodes them), so
    // match case-insensitively — a checksummed path param would otherwise
    // silently no-op the moderation update (updated == 0).
    let updated = diesel::update(
        tokens::table.filter(tokens::token_address.eq(token_address.to_lowercase())),
    )
    .set(tokens::category.eq(category))
    .execute(&mut conn)
    .await?;

    if updated == 0 {
        return Err(AppError::NotFound("Token not found".to_string()));
    }

    Ok(Json(serde_json::json!({ "message": "Token category updated" })))
}

/// Store image bytes and return their public URL + key. Uses S3 when configured,
/// else the local upload dir. Shared by the manual upload and AI generation paths.
pub(crate) async fn store_image_bytes(
    state: &AppState,
    data: &[u8],
    ext: &str,
    content_type: &str,
) -> AppResult<(String, String)> {
    let filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let public_url = if let Some(ref s3) = state.s3_client {
        s3.put_object()
            .bucket(&state.s3_bucket)
            .key(&filename)
            .body(data.to_vec().into())
            .content_type(content_type.to_string())
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("S3 upload failed: {e}")))?;
        format!("{}/{}", state.s3_public_url, filename)
    } else {
        let filepath = format!("{}/{}", state.upload_dir, filename);
        tokio::fs::write(&filepath, data)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Failed to save file: {e}")))?;
        format!("{}/{}", state.upload_base_url, filename)
    };
    Ok((public_url, filename))
}

// ---------------------------------------------------------------------------
// POST /tokens/generate-image
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageBody {
    pub character1: String,
    pub character2: String,
    #[serde(default)]
    pub name: Option<String>,
    /// Universe/art style for the fusion. Blank → a random curated style.
    #[serde(default)]
    pub style: Option<String>,
    /// Wallet-signed authorization: the frontend signs "Generate image\n<addr>\n<ts>".
    pub msg: String,
    pub signature: String,
}

/// POST /tokens/generate-image
///
/// Fyuz's create flow: instead of uploading a logo, the creator names two
/// characters. The backend generates a single fused character image (OpenAI
/// gpt-image-1), stores it on our own S3, and returns the URL — so the browser
/// never sees the OpenAI key and the image is served from our bucket, not a
/// short-lived provider URL.
///
/// Auth: this is a PAID path (each call spends OpenAI credits), so it requires a
/// fresh, single-use wallet signature — NOT a shared api-key. The old api-key
/// gate used a constant that had to be shipped to the browser, making the paid
/// endpoint anonymously reachable. A per-call signature ties every generation to
/// a real wallet and is replay-protected; the per-IP rate limiter bounds volume.
pub async fn generate_image(
    State(state): State<Arc<AppState>>,
    Json(body): Json<GenerateImageBody>,
) -> AppResult<Json<serde_json::Value>> {
    verify_signed_action(&state, &body.msg, &body.signature, Some("Generate image")).await?;

    let c1 = body.character1.trim();
    let c2 = body.character2.trim();
    if c1.is_empty() || c2.is_empty() {
        return Err(AppError::BadRequest(
            "Both character1 and character2 are required".to_string(),
        ));
    }
    // Bound the inputs — these flow into a paid generation prompt.
    if c1.chars().count() > 200 || c2.chars().count() > 200 {
        return Err(AppError::BadRequest(
            "Character descriptions must be 200 characters or fewer".to_string(),
        ));
    }
    if body.style.as_deref().is_some_and(|s| s.chars().count() > 200) {
        return Err(AppError::BadRequest(
            "Style must be 200 characters or fewer".to_string(),
        ));
    }

    let style = crate::services::image_gen::resolve_style(body.style.as_deref());
    let img =
        crate::services::image_gen::generate_fusion(c1, c2, body.name.as_deref(), &style.clause)
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Image generation failed: {e}")))?;

    let (url, key) = store_image_bytes(&state, &img.bytes, img.ext, img.content_type).await?;

    Ok(Json(serde_json::json!({
        "success": true,
        "url": url,
        "key": key,
        // The style actually used (canonical label when curated/auto-picked) so
        // the client can persist it with the token.
        "style": style.label,
    })))
}

// ---------------------------------------------------------------------------
// POST /tokens/upload
// ---------------------------------------------------------------------------

pub async fn upload_logo(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: axum::extract::Multipart,
) -> AppResult<Json<serde_json::Value>> {
    let api_key = headers
        .get("api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if api_key != state.api_key {
        return Err(AppError::Unauthorized("Invalid API key".to_string()));
    }

    let max_size: usize = 5 * 1024 * 1024; // 5MB

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {e}")))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name != "image" {
            continue;
        }

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

        // Derive type + extension from the actual bytes, not the (spoofable)
        // client content-type or filename.
        let (ext, content_type) = sniff_image(&data).ok_or_else(|| {
            AppError::BadRequest(
                "Only image files are allowed (jpeg, png, gif, webp)".to_string(),
            )
        })?;

        let (public_url, filename) = store_image_bytes(&state, &data, ext, content_type).await?;

        return Ok(Json(serde_json::json!({
            "success": true,
            "message": "File uploaded successfully.",
            "url": public_url,
            "key": filename,
            "file": {
                "originalname": filename,
                "mimetype": content_type,
                "size": data.len(),
            }
        })));
    }

    Err(AppError::BadRequest("No file uploaded".to_string()))
}
