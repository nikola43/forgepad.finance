use std::net::SocketAddr;

use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use forgepad_backend::config::{chains, database, redis};
use forgepad_backend::services::{self, ws};
use forgepad_backend::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env file
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,forgepad_backend=debug")),
        )
        .init();

    tracing::info!("Starting Arrowpad backend...");

    // Database pool (supports both DATABASE_URL and SUPABASE_URL)
    let database_url = std::env::var("DATABASE_URL")
        .or_else(|_| std::env::var("SUPABASE_URL"))
        .expect("DATABASE_URL or SUPABASE_URL must be set");
    let db_pool = database::create_pool(&database_url);

    // Redis client
    let redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let redis_client = redis::create_client(&redis_url);

    // Chain configs
    let chain_configs = chains::default_chains();

    // API key
    let api_key = std::env::var("API_KEY").unwrap_or_else(|_| "default-api-key".to_string());

    // Create app state
    let state = AppState::new(db_pool, redis_client, chain_configs.clone(), api_key).await;

    // Spawn blockchain listeners
    for chain in chain_configs {
        let state_clone = state.clone();
        tokio::spawn(async move {
            services::blockchain::start_listener(state_clone, chain).await;
        });
    }

    // CORS configuration
    let cors_origins = std::env::var("CORS_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());
    let origins: Vec<_> = cors_origins
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    let cors = if origins.is_empty() {
        CorsLayer::new().allow_origin(Any)
    } else {
        CorsLayer::new().allow_origin(origins)
    }
    .allow_methods(Any)
    .allow_headers(Any);

    let socketio = ws::create_socketio(state.clone());

    // Build router
    let app = forgepad_backend::routes::create_router(state)
        .layer(socketio)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // Bind and serve
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(5000);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    tracing::info!("Listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
