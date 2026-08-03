//! A minimal stub HTTP server built on a plain `tokio::net::TcpListener`.
//!
//! No wiremock, no hyper: the tests need canned responses, recorded requests and
//! nothing else. Every test binds `127.0.0.1:0`, so the suite never touches the
//! network and never collides on a port.

#![allow(dead_code)]

pub mod fixtures;

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// A canned response the stub will hand out, in queue order.
#[derive(Debug, Clone)]
pub struct StubResponse {
    pub status: u16,
    pub body: String,
    pub headers: Vec<(String, String)>,
}

impl StubResponse {
    /// `200 OK` with a JSON body.
    pub fn ok(body: impl Into<String>) -> Self {
        Self::new(200, body)
    }

    /// Any status with a JSON body.
    pub fn new(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            body: body.into(),
            headers: Vec::new(),
        }
    }

    /// `429` with the envelope the real API sends.
    pub fn rate_limited() -> Self {
        Self::new(429, r#"{"error":"Too many requests"}"#)
    }

    /// Add a response header.
    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }
}

/// One request the stub received.
#[derive(Debug, Clone)]
pub struct RecordedRequest {
    pub method: String,
    /// Path including the query string, exactly as it arrived.
    pub target: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl RecordedRequest {
    /// Path without the query string.
    pub fn path(&self) -> &str {
        self.target.split('?').next().unwrap_or(&self.target)
    }

    /// Query string, without the leading `?`.
    pub fn query(&self) -> &str {
        self.target.split_once('?').map(|(_, q)| q).unwrap_or("")
    }

    /// Case-insensitive header lookup.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// A running stub server. Dropping it leaves the accept task to be torn down
/// with the test's runtime.
pub struct StubServer {
    pub base_url: String,
    responses: Arc<Mutex<VecDeque<StubResponse>>>,
    requests: Arc<Mutex<Vec<RecordedRequest>>>,
}

impl StubServer {
    /// Start a server that answers with `responses`, in order.
    pub async fn start(responses: Vec<StubResponse>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local_addr");

        let responses = Arc::new(Mutex::new(VecDeque::from(responses)));
        let requests = Arc::new(Mutex::new(Vec::new()));

        let accept_responses = Arc::clone(&responses);
        let accept_requests = Arc::clone(&requests);
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let responses = Arc::clone(&accept_responses);
                let requests = Arc::clone(&accept_requests);
                tokio::spawn(async move {
                    let _ = serve(stream, responses, requests).await;
                });
            }
        });

        Self {
            base_url: format!("http://{addr}"),
            responses,
            requests,
        }
    }

    /// Everything the stub has been asked for so far.
    pub fn requests(&self) -> Vec<RecordedRequest> {
        self.requests.lock().unwrap().clone()
    }

    /// How many requests have arrived.
    pub fn request_count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }

    /// The `n`th request, panicking with a useful message if it never arrived.
    pub fn request(&self, n: usize) -> RecordedRequest {
        self.requests
            .lock()
            .unwrap()
            .get(n)
            .unwrap_or_else(|| panic!("expected at least {} request(s)", n + 1))
            .clone()
    }
}

async fn serve(
    mut stream: TcpStream,
    responses: Arc<Mutex<VecDeque<StubResponse>>>,
    requests: Arc<Mutex<Vec<RecordedRequest>>>,
) -> std::io::Result<()> {
    let mut buffer: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 1024];

    let head_end = loop {
        if let Some(position) = find(&buffer, b"\r\n\r\n") {
            break position + 4;
        }
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Ok(());
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or_default().to_string();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default().to_string();

    let mut headers = Vec::new();
    let mut content_length = 0usize;
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim().to_string();
            let value = value.trim().to_string();
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.parse().unwrap_or(0);
            }
            headers.push((name, value));
        }
    }

    let mut body = buffer[head_end..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }

    requests.lock().unwrap().push(RecordedRequest {
        method,
        target,
        headers,
        body: String::from_utf8_lossy(&body).to_string(),
    });

    // 418 rather than 500 when the queue runs dry: a 4xx is never retried, so an
    // over-fetching test fails immediately instead of hanging in backoff.
    let response = responses.lock().unwrap().pop_front().unwrap_or_else(|| {
        StubResponse::new(418, r#"{"error":"stub: no response queued"}"#)
    });

    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        response.status,
        reason(response.status),
        response.body.len()
    );
    for (name, value) in &response.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");

    stream.write_all(head.as_bytes()).await?;
    stream.write_all(response.body.as_bytes()).await?;
    stream.flush().await?;
    let _ = stream.shutdown().await;
    Ok(())
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        418 => "I'm a teapot",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Status",
    }
}
