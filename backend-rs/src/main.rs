use std::net::SocketAddr;

use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use forgepad_backend::config::{chains, database, redis};
use forgepad_backend::middleware::rate_limit;
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

    tracing::info!("Starting Fyuz backend...");

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
    tracing::info!("Loaded {} chain(s): {}", chain_configs.len(), chain_configs.iter().map(|c| format!("{}({})", c.name, c.chain_id)).collect::<Vec<_>>().join(", "));

    // API key (fail-closed: refuse to start without it). `.expect` only catches
    // an ABSENT var; an empty API_KEY= would otherwise make every api-key-gated
    // endpoint compare against "" and accept a missing/empty header — reject it.
    let api_key = std::env::var("API_KEY").expect("API_KEY must be set");
    if api_key.trim().is_empty() {
        panic!("API_KEY must not be empty");
    }

    // Create app state
    let state = AppState::new(db_pool, redis_client, chain_configs.clone(), api_key).await;

    // Spawn blockchain listeners
    for chain in chain_configs {
        let state_clone = state.clone();
        tokio::spawn(async move {
            services::blockchain::start_listener(state_clone, chain).await;
        });
    }

    // CORS configuration. When CORS_ORIGINS is unset we fall back to the known
    // production + localhost origins so a missing env var on a deployed host
    // can't silently break the browser (No 'Access-Control-Allow-Origin').
    const DEFAULT_CORS_ORIGINS: &str = "https://fyuz.fun,https://www.fyuz.fun,http://localhost:3000,http://localhost:8080";
    let cors_origins =
        std::env::var("CORS_ORIGINS").unwrap_or_else(|_| DEFAULT_CORS_ORIGINS.to_string());
    let origins: Vec<_> = cors_origins
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    let cors = if origins.is_empty() {
        // Fail-closed: never fall back to `Any` for the origin. Use the safe
        // production + localhost defaults when no valid origins are configured.
        let defaults: Vec<_> = DEFAULT_CORS_ORIGINS
            .split(',')
            .filter_map(|s| s.trim().parse().ok())
            .collect();
        CorsLayer::new().allow_origin(defaults)
    } else {
        CorsLayer::new().allow_origin(origins)
    }
    .allow_methods(Any)
    .allow_headers(Any)
    .allow_credentials(false);

    let socketio = ws::create_socketio(state.clone());

    // Per-IP rate limiter (shared via request extensions)
    let limiter = rate_limit::create_rate_limiter();

    // The keyed store never evicts on its own, so a stream of distinct IPs
    // (IPv6 /64s, spoofed XFF behind the proxy) grows it unbounded. Periodically
    // drop keys whose quota has fully recovered.
    {
        let limiter = limiter.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(300));
            loop {
                tick.tick().await;
                limiter.retain_recent();
                limiter.shrink_to_fit();
            }
        });
    }

    // Build router
    let app = forgepad_backend::routes::create_router(state)
        .layer(socketio)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        // Send X-Content-Type-Options: nosniff on every response
        .layer(tower_http::set_header::SetResponseHeaderLayer::if_not_present(
            axum::http::header::X_CONTENT_TYPE_OPTIONS,
            axum::http::HeaderValue::from_static("nosniff"),
        ))
        // Enforce the per-IP rate limit, and make the limiter available to it.
        // In axum, the LAST-added layer is the OUTERMOST (runs first on ingress),
        // so the Extension must be added AFTER the middleware — otherwise the
        // middleware runs before the Extension populates request extensions,
        // finds no limiter, and silently passes every request (rate limit off).
        .layer(axum::middleware::from_fn(rate_limit::rate_limit_middleware))
        .layer(axum::Extension(limiter));

    // Bind and serve
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(5000);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    tracing::info!("Listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    // ConnectInfo is required by the rate-limit middleware, so serve with it.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;

    Ok(())
}
