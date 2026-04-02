use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use governor::clock::DefaultClock;
use governor::state::keyed::DashMapStateStore;
use governor::{Quota, RateLimiter};
use serde_json::json;
use std::net::{IpAddr, SocketAddr};
use std::num::NonZeroU32;
use std::sync::Arc;

pub type KeyedRateLimiter = RateLimiter<IpAddr, DashMapStateStore<IpAddr>, DefaultClock>;

/// Create a keyed rate limiter: approximately 100 requests per 15 minutes per IP.
pub fn create_rate_limiter() -> Arc<KeyedRateLimiter> {
    let quota = Quota::per_minute(NonZeroU32::new(7).unwrap());
    Arc::new(RateLimiter::dashmap(quota))
}

/// Axum middleware that enforces per-IP rate limiting.
///
/// Extracts the client IP from the `x-forwarded-for` header first,
/// falling back to `ConnectInfo<SocketAddr>`.
pub async fn rate_limit_middleware(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let limiter = request.extensions().get::<Arc<KeyedRateLimiter>>().cloned();

    let limiter = match limiter {
        Some(l) => l,
        None => return next.run(request).await,
    };

    let ip = extract_ip(&request, addr);

    match limiter.check_key(&ip) {
        Ok(_) => next.run(request).await,
        Err(_) => {
            let body = json!({ "error": "Too many requests" });
            (StatusCode::TOO_MANY_REQUESTS, axum::Json(body)).into_response()
        }
    }
}

/// Extract the client IP from `x-forwarded-for` header or fall back to the
/// connected socket address.
fn extract_ip(request: &Request<Body>, fallback: SocketAddr) -> IpAddr {
    request
        .headers()
        .get("x-forwarded-for")
        .and_then(|val| val.to_str().ok())
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse::<IpAddr>().ok())
        .unwrap_or_else(|| fallback.ip())
}
