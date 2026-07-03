use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use diesel::prelude::*;
use diesel::sql_types::{Double, Integer, Text};
use diesel_async::RunQueryDsl;
use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::AppState;

// ---------------------------------------------------------------------------
// Trader Tier — a display-only, lifetime trade-volume based tier.
//
// A user's cumulative USD trade volume (sum of eth_amount * eth_price across all
// their trades) maps to one of four tiers. We also surface the next tier and the
// progress toward it so the frontend can render a badge + progress bar.
// ---------------------------------------------------------------------------

struct TierDef {
    name: &'static str,
    threshold: f64,
}

// Ordered ascending by threshold.
const TIERS: &[TierDef] = &[
    TierDef { name: "Bronze", threshold: 0.0 },
    TierDef { name: "Silver", threshold: 100.0 },
    TierDef { name: "Gold", threshold: 1000.0 },
    TierDef { name: "Diamond", threshold: 10000.0 },
];

#[derive(QueryableByName)]
struct IdRow {
    #[diesel(sql_type = Integer)]
    id: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TierResponse {
    address: String,
    volume_usd: f64,
    tier: String,
    next_tier: Option<String>,
    next_threshold_usd: Option<f64>,
    progress_pct: f64,
}

// GET /tier/:address
pub async fn get_tier(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> AppResult<Json<TierResponse>> {
    let mut conn = state.db.get().await.map_err(|e| AppError::Pool(e.to_string()))?;

    let id_row: Option<IdRow> = diesel::sql_query("SELECT id FROM users WHERE address = $1")
        .bind::<Text, _>(address.to_lowercase())
        .get_result(&mut conn)
        .await
        .optional()?;

    let volume_usd = match id_row {
        Some(r) => {
            let uid = r.id;
            #[derive(QueryableByName)]
            struct V {
                #[diesel(sql_type = Double)]
                total: f64,
            }
            // uid is an i32 from the DB, so inlining is injection-safe.
            let v: V = diesel::sql_query(format!(
                "SELECT COALESCE(SUM(eth_amount::float8 * eth_price::float8), 0) AS total \
                 FROM trades WHERE swapper_id = {uid}"
            ))
            .get_result(&mut conn)
            .await?;
            v.total
        }
        None => 0.0,
    };

    // Current tier: the highest tier whose threshold is met.
    let mut current_idx = 0usize;
    for (i, t) in TIERS.iter().enumerate() {
        if volume_usd >= t.threshold {
            current_idx = i;
        }
    }
    let current = &TIERS[current_idx];

    let (next_tier, next_threshold_usd, progress_pct) = if current_idx + 1 < TIERS.len() {
        let next = &TIERS[current_idx + 1];
        let span = next.threshold - current.threshold;
        let pct = if span > 0.0 {
            (((volume_usd - current.threshold) / span) * 100.0).clamp(0.0, 100.0)
        } else {
            0.0
        };
        (Some(next.name.to_string()), Some(next.threshold), pct)
    } else {
        // Diamond: no next tier.
        (None, None, 100.0)
    };

    Ok(Json(TierResponse {
        address: address.to_lowercase(),
        volume_usd,
        tier: current.name.to_string(),
        next_tier,
        next_threshold_usd,
        progress_pct,
    }))
}
