//! Error type for every call in this crate.

use std::time::Duration;

use serde::Deserialize;

/// Convenience alias: every fallible call in this crate returns this.
pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Anything that can go wrong talking to the Fyuz API.
///
/// The two variants worth matching on explicitly are [`Error::RateLimited`] —
/// raised only after the client has exhausted its automatic retries — and
/// [`Error::Api`], which carries the HTTP status and the server's own message
/// parsed out of the `{"error": "..."}` envelope.
///
/// ```
/// use fyuz::Error;
///
/// fn describe(err: &Error) -> String {
///     match err {
///         Error::RateLimited { retry_after, .. } => {
///             format!("slow down, retry after {:?}", retry_after)
///         }
///         Error::Api { status: 404, .. } => "no such token".to_string(),
///         other => other.to_string(),
///     }
/// }
/// ```
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The API answered with a non-2xx status other than 429.
    ///
    /// `message` is the server's `{"error": "..."}` text when the body carried
    /// one, otherwise a trimmed excerpt of the raw body.
    #[error("fyuz api error (HTTP {status}): {message}")]
    Api {
        /// HTTP status code.
        status: u16,
        /// Server-supplied message.
        message: String,
    },

    /// The API rate limit (120 requests/minute per IP) was hit and the
    /// configured number of retries did not clear it.
    #[error("fyuz api rate limited (HTTP 429): {message}")]
    RateLimited {
        /// Server-supplied message, normally `"Too many requests"`.
        message: String,
        /// Value of the `Retry-After` header, when the server sent one.
        retry_after: Option<Duration>,
    },

    /// The request never produced an HTTP response: DNS failure, connection
    /// refused, TLS failure or the configured timeout elapsing.
    #[error("http transport error: {0}")]
    Transport(#[from] reqwest::Error),

    /// A 2xx response arrived but did not deserialise into the expected type.
    #[error("could not decode response body: {message} (body began: {body})")]
    Decode {
        /// The serde error.
        message: String,
        /// First 256 bytes of the body, lossily decoded, to make the mismatch
        /// obvious in a log line.
        body: String,
    },

    /// [`FyuzClientBuilder::base_url`](crate::FyuzClientBuilder::base_url) was
    /// given something that is not a usable HTTP base URL.
    #[error("invalid base url {url:?}: {message}")]
    InvalidBaseUrl {
        /// The rejected input.
        url: String,
        /// Why it was rejected.
        message: String,
    },

    /// An argument failed validation before any request was sent.
    ///
    /// Raised by the trading layer for a malformed address, an amount that is
    /// not a whole number of wei, or a build called without slippage protection.
    #[error("{message}")]
    InvalidArgument {
        /// What was wrong, and usually what to do instead.
        message: String,
    },

    /// The contract rejected a call.
    ///
    /// Raised from a simulated `eth_call`, so it costs nothing — this is the
    /// failure you want, rather than paying gas to discover the same thing
    /// on-chain. [`Error::is_graduated`] picks out the case where the token has
    /// left the bonding curve.
    #[error("{message}")]
    ContractRevert {
        /// Classification from `shared/test-vectors/trade-errors.json`.
        kind: crate::revert::RevertKind,
        /// Human-readable explanation, including what to do about it.
        message: String,
        /// Solidity signature, e.g. `SlippageExceeded()`, when recognised.
        error_name: Option<String>,
        /// The 4-byte selector, when the revert carried one.
        selector: Option<String>,
        /// Raw revert data, kept so an unrecognised revert is still diagnosable.
        data: String,
        /// Whether re-quoting and retrying could plausibly succeed.
        retryable: bool,
        /// The token, when this is a graduation refusal.
        token_address: Option<String>,
    },

    /// A JSON-RPC node returned an error, or something that was not a JSON-RPC
    /// response.
    #[error("RPC {method} failed: {message}")]
    Rpc {
        /// The method that failed, e.g. `eth_call`.
        method: String,
        /// The node's message.
        message: String,
        /// JSON-RPC error code, when the node sent a well-formed error object.
        code: Option<i64>,
    },
}

impl Error {
    /// HTTP status, when the failure came from an HTTP response.
    pub fn status(&self) -> Option<u16> {
        match self {
            Error::Api { status, .. } => Some(*status),
            Error::RateLimited { .. } => Some(429),
            Error::Transport(e) => e.status().map(|s| s.as_u16()),
            _ => None,
        }
    }

    /// `true` for [`Error::RateLimited`].
    pub fn is_rate_limited(&self) -> bool {
        matches!(self, Error::RateLimited { .. })
    }

    /// `true` when the API answered `404` — an unknown token, profile or round.
    pub fn is_not_found(&self) -> bool {
        self.status() == Some(404)
    }

    /// `true` when a trade was refused because the token left the bonding curve.
    ///
    /// The curve is closed once a token graduates, and every swap entrypoint
    /// reverts. Trade its DEX pair instead.
    pub fn is_graduated(&self) -> bool {
        matches!(
            self,
            Error::ContractRevert {
                kind: crate::revert::RevertKind::Graduated,
                ..
            }
        )
    }

    /// `true` when the contract rejected the call and retrying could plausibly
    /// help — a slippage miss or an expired deadline, not a closed curve.
    pub fn is_retryable_revert(&self) -> bool {
        matches!(
            self,
            Error::ContractRevert {
                retryable: true,
                ..
            }
        )
    }

    /// `true` when the request timed out rather than being answered.
    pub fn is_timeout(&self) -> bool {
        matches!(self, Error::Transport(e) if e.is_timeout())
    }

    /// The server's `Retry-After`, when it sent one with a 429.
    pub fn retry_after(&self) -> Option<Duration> {
        match self {
            Error::RateLimited { retry_after, .. } => *retry_after,
            _ => None,
        }
    }
}

/// The `{"error": "..."}` envelope every non-2xx response on this API carries.
#[derive(Debug, Deserialize)]
pub(crate) struct ErrorEnvelope {
    pub(crate) error: Option<String>,
}

/// Best-effort extraction of a human message from an error body.
pub(crate) fn message_from_body(body: &[u8], status: reqwest::StatusCode) -> String {
    if let Ok(envelope) = serde_json::from_slice::<ErrorEnvelope>(body) {
        if let Some(message) = envelope.error {
            if !message.is_empty() {
                return message;
            }
        }
    }

    let raw = String::from_utf8_lossy(body);
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        status
            .canonical_reason()
            .unwrap_or("unknown error")
            .to_string()
    } else {
        truncate(trimmed, 256)
    }
}

/// Clip a body excerpt to `max` characters so error messages stay loggable.
pub(crate) fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::StatusCode;

    #[test]
    fn parses_the_error_envelope() {
        let body = br#"{"error":"Too many requests"}"#;
        assert_eq!(
            message_from_body(body, StatusCode::TOO_MANY_REQUESTS),
            "Too many requests"
        );
    }

    #[test]
    fn falls_back_to_the_raw_body() {
        let body = b"upstream exploded";
        assert_eq!(
            message_from_body(body, StatusCode::BAD_GATEWAY),
            "upstream exploded"
        );
    }

    #[test]
    fn falls_back_to_the_status_reason_for_empty_bodies() {
        assert_eq!(message_from_body(b"", StatusCode::NOT_FOUND), "Not Found");
    }

    #[test]
    fn classifies_statuses() {
        let err = Error::Api {
            status: 404,
            message: "nope".into(),
        };
        assert!(err.is_not_found());
        assert!(!err.is_rate_limited());

        let limited = Error::RateLimited {
            message: "Too many requests".into(),
            retry_after: Some(Duration::from_secs(2)),
        };
        assert!(limited.is_rate_limited());
        assert_eq!(limited.status(), Some(429));
        assert_eq!(limited.retry_after(), Some(Duration::from_secs(2)));
    }
}
