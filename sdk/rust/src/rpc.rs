//! A JSON-RPC client just large enough to read the bonding curve.
//!
//! `eth_call` against a view function is an HTTP POST with a JSON body. That is
//! the whole requirement, so this rides on the `reqwest` client the crate
//! already carries rather than pulling in a web3 stack.

use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::Error;

/// Default per-call timeout for RPC requests.
pub const DEFAULT_RPC_TIMEOUT: Duration = Duration::from_secs(15);

/// The outcome of an `eth_call`: return data, or revert data.
///
/// Reverts are extremely common here — quoting a graduated token reverts by
/// design — so they are a return value rather than an error. The caller decides
/// what a revert means and builds the error with the right context.
#[derive(Debug, Clone)]
pub enum CallOutcome {
    /// The call returned data.
    Ok(String),
    /// The call reverted, carrying this payload (possibly `"0x"`).
    Reverted(String),
}

#[derive(Debug, Deserialize)]
struct RpcResponse {
    result: Option<Value>,
    error: Option<RpcErrorBody>,
}

#[derive(Debug, Deserialize)]
struct RpcErrorBody {
    code: Option<i64>,
    message: Option<String>,
    data: Option<Value>,
}

/// Minimal JSON-RPC transport.
#[derive(Debug)]
pub struct RpcClient {
    url: String,
    http: reqwest::Client,
    next_id: AtomicI64,
}

impl RpcClient {
    /// Build a client posting to `url`.
    pub fn new(url: impl Into<String>, timeout: Duration) -> Result<Self, Error> {
        let http = reqwest::Client::builder().timeout(timeout).build()?;
        Ok(Self {
            url: url.into(),
            http,
            next_id: AtomicI64::new(1),
        })
    }

    /// Build a client from an already-configured `reqwest::Client`.
    pub fn with_http(url: impl Into<String>, http: reqwest::Client) -> Self {
        Self {
            url: url.into(),
            http,
            next_id: AtomicI64::new(1),
        }
    }

    /// The endpoint this client posts to.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// Invoke a JSON-RPC method and return its `result`.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, Error> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let body = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });

        let response = self.http.post(&self.url).json(&body).send().await?;
        let status = response.status();
        let text = response.text().await?;

        if !status.is_success() {
            return Err(Error::Rpc {
                method: method.to_string(),
                message: format!("HTTP {}: {}", status.as_u16(), truncate(&text, 256)),
                code: None,
            });
        }

        let decoded: RpcResponse = serde_json::from_str(&text).map_err(|_| Error::Rpc {
            method: method.to_string(),
            message: format!("body is not a JSON-RPC response: {}", truncate(&text, 256)),
            code: None,
        })?;

        if let Some(error) = decoded.error {
            // The revert payload rides along in `data`; `eth_call` digs it out
            // rather than treating every revert as a transport failure.
            let mut message = error.message.unwrap_or_else(|| "unknown error".to_string());
            if let Some(data) = &error.data {
                message.push_str(&format!(" (data: {data})"));
            }
            return Err(Error::Rpc {
                method: method.to_string(),
                message,
                code: error.code,
            });
        }

        Ok(decoded.result.unwrap_or(Value::Null))
    }

    /// Run `eth_call`, separating a revert from a transport failure.
    pub async fn call(
        &self,
        to: &str,
        data: &str,
        from: Option<&str>,
    ) -> Result<CallOutcome, Error> {
        let mut message = json!({ "to": to, "data": data });
        if let Some(from) = from {
            message["from"] = Value::String(from.to_string());
        }

        match self.request("eth_call", json!([message, "latest"])).await {
            Ok(Value::String(result)) => Ok(CallOutcome::Ok(result)),
            Ok(_) => Ok(CallOutcome::Ok("0x".to_string())),
            Err(error) => match extract_revert_data(&error) {
                Some(revert) => Ok(CallOutcome::Reverted(revert)),
                None => Err(error),
            },
        }
    }

    /// Run `eth_call` and fail on revert, for calls that should never revert.
    pub async fn call_or_error(
        &self,
        to: &str,
        data: &str,
        context: &str,
    ) -> Result<String, Error> {
        match self.call(to, data, None).await? {
            CallOutcome::Ok(result) => Ok(result),
            CallOutcome::Reverted(revert) => Err(crate::revert::revert_error(&revert, context)),
        }
    }
}

/// Dig the revert payload out of a node error.
///
/// Every provider spells this differently: geth puts the hex straight in
/// `error.data`, others nest it as `error.data.data`, and some drop it into the
/// message text and nothing else. Because [`RpcClient::request`] folds `data`
/// into the message, one scan over the text covers all three — falling back to
/// `"0x"`, which says "it reverted, and this node would not tell us why".
fn extract_revert_data(error: &Error) -> Option<String> {
    let Error::Rpc { message, .. } = error else {
        return None;
    };

    // The longest 0x-run in the message is the revert payload: any nested
    // wrapper is shorter than the data it wraps.
    let mut best: Option<&str> = None;
    let bytes = message.as_bytes();
    let mut index = 0;
    while index + 2 <= bytes.len() {
        if bytes[index] == b'0' && (bytes[index + 1] == b'x' || bytes[index + 1] == b'X') {
            let start = index;
            let mut end = index + 2;
            while end < bytes.len() && (bytes[end] as char).is_ascii_hexdigit() {
                end += 1;
            }
            if end - start >= 10 {
                let candidate = &message[start..end];
                // `is_none_or` would be tidier, but it is stable only from 1.82
                // and this crate supports 1.75.
                if best.map_or(true, |current| candidate.len() > current.len()) {
                    best = Some(candidate);
                }
            }
            index = end;
        } else {
            index += 1;
        }
    }

    if let Some(found) = best {
        return Some(found.to_string());
    }
    message
        .to_ascii_lowercase()
        .contains("revert")
        .then(|| "0x".to_string())
}

fn truncate(text: &str, limit: usize) -> &str {
    match text.char_indices().nth(limit) {
        Some((index, _)) => &text[..index],
        None => text,
    }
}
