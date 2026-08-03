use axum::extract::State;
use axum::response::{Html, IntoResponse};
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use std::sync::Arc;
use tower_http::services::ServeDir;

use crate::AppState;

pub mod airdrop;
pub mod analytics;
pub mod chats;
pub mod creator;
pub mod discover;
pub mod distributor;
pub mod kings;
pub mod paper;
pub mod portfolio;
pub mod referrals;
pub mod rewards;
pub mod season;
pub mod stream;
pub mod tier;
pub mod tokens;
pub mod trades;
pub mod users;
pub mod wallet;
pub mod watchlist;

pub fn create_router(state: Arc<AppState>) -> Router {
    let upload_dir = state.upload_dir.clone();

    Router::new()
        .nest("/tokens", tokens::router(state.clone()))
        .nest("/trades", trades::router(state.clone()))
        .nest("/users", users::router(state.clone()))
        .nest("/chats", chats::router(state.clone()))
        .nest("/rewards", rewards::router(state.clone()))
        .nest("/referrals", referrals::router(state.clone()))
        .nest("/creator", creator::router(state.clone()))
        .nest("/watchlist", watchlist::router(state.clone()))
        .nest("/season", season::router(state.clone()))
        .nest("/kings", kings::router(state.clone()))
        .nest("/airdrop", airdrop::router(state.clone()))
        .nest("/tier", tier::router(state.clone()))
        .nest("/portfolio", portfolio::router(state.clone()))
        .nest("/discover", discover::router(state.clone()))
        .nest("/distributor", distributor::router(state.clone()))
        .nest("/analytics", analytics::router(state.clone()))
        .nest("/wallet", wallet::router(state.clone()))
        .nest("/stream", stream::router(state.clone()))
        .nest("/paper", paper::router(state.clone()))
        .nest_service("/uploads", ServeDir::new(upload_dir))
        .route("/health", get(health))
        .route("/config", get(config))
        .route("/openapi.json", get(openapi_spec))
        .route("/docs", get(swagger_ui))
        .with_state(state)
}

async fn health() -> impl IntoResponse {
    Json(json!({ "status": "ok" }))
}

/// OpenAPI 3.0 description of the PUBLIC, unauthenticated read surface.
///
/// Baked into the binary with `include_str!` rather than read from disk at
/// runtime: the spec then cannot drift from the deployed build, and there is no
/// filesystem path to get wrong across the native/systemd and container layouts.
const OPENAPI_SPEC: &str = include_str!("../../docs/openapi.json");

async fn openapi_spec() -> impl IntoResponse {
    (
        [
            (axum::http::header::CONTENT_TYPE, "application/json"),
            // The spec only changes on deploy, so let partners and browsers cache it.
            (axum::http::header::CACHE_CONTROL, "public, max-age=300"),
        ],
        OPENAPI_SPEC,
    )
}

/// Swagger UI, pinned to an exact version so a CDN major bump can't change the
/// page under us. Assets load from unpkg; the spec itself is served by us.
async fn swagger_ui() -> impl IntoResponse {
    // r##"…"## (not r#"…"#): the body contains `"#swagger-ui"`, whose `"#` would
    // close a single-hash raw string early.
    Html(
        r##"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fyuz Public API</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: "/openapi.json",
          dom_id: "#swagger-ui",
          deepLinking: true,
          docExpansion: "list",
          defaultModelsExpandDepth: 1,
          tryItOutEnabled: true,
        });
      };
    </script>
  </body>
</html>
"##,
    )
}

async fn config(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(json!({ "chains": state.chains }))
}
