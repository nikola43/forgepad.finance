use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Rate limited")]
    RateLimited,

    #[error("Database error: {0}")]
    Database(#[from] diesel::result::Error),

    #[error("Pool error: {0}")]
    Pool(String),

    #[error("Redis error: {0}")]
    Redis(#[from] redis::RedisError),

    #[error("Internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg.clone()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            AppError::RateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                "Too many requests".to_string(),
            ),
            AppError::Database(e) => {
                tracing::error!("Database error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".to_string(),
                )
            }
            AppError::Pool(e) => {
                tracing::error!("Pool error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".to_string(),
                )
            }
            AppError::Redis(e) => {
                tracing::error!("Redis error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".to_string(),
                )
            }
            AppError::Internal(e) => {
                tracing::error!("Internal error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error".to_string(),
                )
            }
        };

        let body = json!({ "error": message });
        (status, axum::Json(body)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// Query-string extractor that reports failures in the API's standard
/// `{"error": ...}` envelope.
///
/// axum's own `Query` rejection serialises as a bare text body
/// (`Failed to deserialize query string: missing field \`from\``), which is the
/// one 4xx on this API that isn't JSON — a client doing `res.json().error`
/// gets `undefined` and reports "unknown error" instead of the real cause.
/// Routing the rejection through `AppError` keeps every error response the
/// same shape.
pub struct Query<T>(pub T);

impl<S, T> axum::extract::FromRequestParts<S> for Query<T>
where
    T: serde::de::DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        match axum::extract::Query::<T>::from_request_parts(parts, state).await {
            Ok(axum::extract::Query(value)) => Ok(Query(value)),
            Err(rejection) => Err(AppError::BadRequest(rejection.body_text())),
        }
    }
}

#[cfg(test)]
mod query_rejection_tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Params {
        from: i64,
    }

    async fn handler(Query(p): Query<Params>) -> String {
        p.from.to_string()
    }

    async fn call(uri: &str) -> (StatusCode, String) {
        let res = Router::new()
            .route("/", get(handler))
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 64 * 1024).await.unwrap();
        (status, String::from_utf8(bytes.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn missing_field_returns_json_error_envelope() {
        let (status, body) = call("/").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        // The whole point: parseable JSON with an `error` key, not a bare string.
        let v: serde_json::Value = serde_json::from_str(&body)
            .unwrap_or_else(|_| panic!("rejection body was not JSON: {body}"));
        assert!(v.get("error").and_then(|e| e.as_str()).is_some_and(|s| s.contains("from")));
    }

    #[tokio::test]
    async fn wrong_type_returns_json_error_envelope() {
        let (status, body) = call("/?from=notanumber").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let v: serde_json::Value = serde_json::from_str(&body).expect("not JSON");
        assert!(v.get("error").is_some());
    }

    #[tokio::test]
    async fn valid_query_still_passes_through() {
        let (status, body) = call("/?from=42").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "42");
    }
}
