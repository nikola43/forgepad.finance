use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{Double, Integer, Nullable, Text};
use diesel_async::RunQueryDsl;
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Watchlist (Tier 3) — tokens a user stars for quick access. Toggling is a
// low-stakes, unauthenticated write keyed by the connected wallet address,
// consistent with the rest of the app's address-scoped endpoints.
// ---------------------------------------------------------------------------

#[derive(QueryableByName)]
struct IdRow {
    #[diesel(sql_type = Integer)]
    id: i32,
}

async fn user_id(conn: &mut diesel_async::AsyncPgConnection, address: &str) -> AppResult<Option<i32>> {
    Ok(diesel::sql_query("SELECT id FROM users WHERE address = $1")
        .bind::<Text, _>(address.to_lowercase())
        .get_result::<IdRow>(conn)
        .await
        .optional()?
        .map(|r| r.id))
}

async fn token_id(
    conn: &mut diesel_async::AsyncPgConnection,
    token_address: &str,
    network: &str,
) -> AppResult<Option<i32>> {
    Ok(
        diesel::sql_query("SELECT id FROM tokens WHERE token_address = $1 AND network = $2")
            .bind::<Text, _>(token_address.to_lowercase())
            .bind::<Text, _>(network)
            .get_result::<IdRow>(conn)
            .await
            .optional()?
            .map(|r| r.id),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleBody {
    pub user_address: String,
    pub token_address: String,
    pub network: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleResponse {
    watchlisted: bool,
}

// POST /watchlist/toggle
pub async fn toggle(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ToggleBody>,
) -> AppResult<Json<ToggleResponse>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let uid = user_id(&mut conn, &body.user_address)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;
    let tid = token_id(&mut conn, &body.token_address, &body.network)
        .await?
        .ok_or_else(|| AppError::NotFound("Token not found".to_string()))?;

    // Toggle: delete if present, else insert.
    let deleted = diesel::sql_query(format!(
        "DELETE FROM watchlist WHERE user_id = {uid} AND token_id = {tid}"
    ))
    .execute(&mut conn)
    .await?;
    if deleted > 0 {
        return Ok(Json(ToggleResponse { watchlisted: false }));
    }
    diesel::sql_query(format!(
        "INSERT INTO watchlist (user_id, token_id) VALUES ({uid}, {tid}) ON CONFLICT DO NOTHING"
    ))
    .execute(&mut conn)
    .await?;
    Ok(Json(ToggleResponse { watchlisted: true }))
}

#[derive(QueryableByName)]
struct WatchTokenRow {
    #[diesel(sql_type = Text)]
    token_address: String,
    #[diesel(sql_type = Text)]
    name: String,
    #[diesel(sql_type = Text)]
    symbol: String,
    #[diesel(sql_type = Nullable<Text>)]
    image: Option<String>,
    #[diesel(sql_type = Text)]
    network: String,
    #[diesel(sql_type = Double)]
    marketcap: f64,
    #[diesel(sql_type = Double)]
    price: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchToken {
    token_address: String,
    name: String,
    symbol: String,
    image: Option<String>,
    network: String,
    marketcap: f64,
    price: f64,
}

// GET /watchlist/:address
pub async fn get_list(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<Vec<WatchToken>>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;
    let uid = match user_id(&mut conn, &address).await? {
        Some(id) => id,
        None => return Ok(Json(vec![])),
    };
    let rows: Vec<WatchTokenRow> = diesel::sql_query(format!(
        "SELECT tk.token_address, tk.name, tk.symbol, tk.image, tk.network, \
           COALESCE(tk.marketcap::float8, 0) AS marketcap, COALESCE(tk.price::float8, 0) AS price \
         FROM watchlist w JOIN tokens tk ON tk.id = w.token_id \
         WHERE w.user_id = {uid} ORDER BY w.created_at DESC"
    ))
    .load(&mut conn)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|r| WatchToken {
                token_address: r.token_address,
                name: r.name,
                symbol: r.symbol,
                image: r.image,
                network: r.network,
                marketcap: r.marketcap,
                price: r.price,
            })
            .collect(),
    ))
}
