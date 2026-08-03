//! The HTTP client: construction, configuration and the retry loop.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::RETRY_AFTER;
use reqwest::{Method, StatusCode, Url};
use serde::de::DeserializeOwned;

use crate::api::distributor::Distributor;
use crate::error::{message_from_body, truncate, Error, Result};
use crate::trade::{TradeApi, TradeState};

/// Production base URL, used unless
/// [`FyuzClientBuilder::base_url`] overrides it.
pub const DEFAULT_BASE_URL: &str = "https://api.fyuz.fun";

/// Version of this crate, as reported in the `User-Agent`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_MAX_RETRIES: u32 = 3;
const DEFAULT_RETRY_BASE_DELAY: Duration = Duration::from_millis(250);
const DEFAULT_MAX_RETRY_DELAY: Duration = Duration::from_secs(8);

/// Query string pairs, in the order they will be encoded.
pub(crate) type QueryPairs = Vec<(&'static str, String)>;

/// Async client for the Fyuz public REST API.
///
/// Cloning is cheap — the underlying `reqwest::Client` and configuration are
/// shared behind an [`Arc`], and the connection pool is shared with it. Create
/// one per process and clone it around rather than building a new one per call.
///
/// ```no_run
/// # async fn demo() -> Result<(), fyuz::Error> {
/// use fyuz::{DiscoverParams, DiscoverTab, FyuzClient};
///
/// let client = FyuzClient::new()?;
///
/// let trending = client
///     .discover(&DiscoverParams::new().tab(DiscoverTab::Trending).limit(10))
///     .await?;
///
/// for token in &trending {
///     println!("{} {:.0}% to graduation", token.symbol, token.graduation_pct);
/// }
/// # Ok(())
/// # }
/// ```
#[derive(Debug, Clone)]
pub struct FyuzClient {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    http: reqwest::Client,
    base_url: Url,
    max_retries: u32,
    retry_base_delay: Duration,
    max_retry_delay: Duration,
    /// Jitter source. A tiny xorshift keeps `rand` out of the dependency list;
    /// nothing here is security sensitive.
    rng: AtomicU64,
    /// JSON-RPC override for the trading layer. `None` falls back to whatever
    /// `GET /config` publishes for the chain.
    rpc_url: Option<String>,
    /// Per-call RPC timeout. `None` uses [`DEFAULT_RPC_TIMEOUT`].
    rpc_timeout: Option<Duration>,
    /// Memoised `/config` and the per-chain RPC clients.
    trade_state: TradeState,
}

impl FyuzClient {
    /// Build a client pointed at <https://api.fyuz.fun> with the default 30s
    /// timeout and 3 retries.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// println!("{}", client.health().await?.status);
    /// # Ok(())
    /// # }
    /// ```
    pub fn new() -> Result<Self> {
        Self::builder().build()
    }

    /// Start configuring a client.
    ///
    /// ```no_run
    /// # fn demo() -> Result<(), fyuz::Error> {
    /// use std::time::Duration;
    ///
    /// let client = fyuz::FyuzClient::builder()
    ///     .base_url("http://127.0.0.1:8080")?
    ///     .timeout(Duration::from_secs(5))
    ///     .max_retries(5)
    ///     .build()?;
    /// # let _ = client;
    /// # Ok(())
    /// # }
    /// ```
    pub fn builder() -> FyuzClientBuilder {
        FyuzClientBuilder::new()
    }

    /// The base URL every request is resolved against.
    pub fn base_url(&self) -> &Url {
        &self.inner.base_url
    }

    /// The Distributor endpoints (`/distributor/*`), grouped together.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let pot = client.distributor().get_pot().await?;
    /// match pot.pot_bnb {
    ///     Some(bnb) => println!("{bnb} BNB in the pot"),
    ///     // `None` means unknown, never zero.
    ///     None => println!("pot unavailable right now"),
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub fn distributor(&self) -> Distributor<'_> {
        Distributor::new(self)
    }

    /// Bonding-curve trading: quotes, and unsigned buy/sell/approve transactions.
    ///
    /// Builds transactions only — it never handles a key. See [`TradeApi`].
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// use fyuz::{parse_units, BuyParams};
    ///
    /// let client = fyuz::FyuzClient::new()?;
    /// let built = client
    ///     .trade()
    ///     .build_buy(
    ///         &BuyParams::new("0x0000000000000000000000000000000000000001", parse_units("0.5", 18)?)
    ///             .slippage_bps(100),
    ///     )
    ///     .await?;
    /// println!("{}", built.transaction.data);
    /// # Ok(())
    /// # }
    /// ```
    pub fn trade(&self) -> TradeApi<'_> {
        TradeApi::new(self)
    }

    pub(crate) fn rpc_url(&self) -> Option<&str> {
        self.inner.rpc_url.as_deref()
    }

    pub(crate) fn rpc_timeout(&self) -> Option<Duration> {
        self.inner.rpc_timeout
    }

    pub(crate) fn trade_state(&self) -> &TradeState {
        &self.inner.trade_state
    }

    pub(crate) async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: QueryPairs,
    ) -> Result<T> {
        self.request(Method::GET, path, query, None).await
    }

    pub(crate) async fn post_json<T: DeserializeOwned>(
        &self,
        path: &str,
        query: QueryPairs,
        body: serde_json::Value,
    ) -> Result<T> {
        self.request(Method::POST, path, query, Some(body)).await
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        query: QueryPairs,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        let bytes = self.send_with_retry(method, path, query, body).await?;
        serde_json::from_slice(&bytes).map_err(|e| Error::Decode {
            message: e.to_string(),
            body: truncate(String::from_utf8_lossy(&bytes).trim(), 256),
        })
    }

    /// Send, retrying 429s, 5xx and transport failures with exponential backoff
    /// and full jitter. 4xx statuses other than 429 return immediately.
    async fn send_with_retry(
        &self,
        method: Method,
        path: &str,
        query: QueryPairs,
        body: Option<serde_json::Value>,
    ) -> Result<Vec<u8>> {
        let url = build_url(&self.inner.base_url, path);
        let mut attempt: u32 = 0;

        loop {
            match self.attempt(&method, &url, &query, body.as_ref()).await {
                Ok(bytes) => return Ok(bytes),
                Err(Failure::Fatal(err)) => return Err(err),
                Err(Failure::Retryable { error, retry_after }) => {
                    if attempt >= self.inner.max_retries {
                        return Err(error);
                    }
                    let delay = match retry_after {
                        // `Retry-After` is the one delay an outside party
                        // chooses, so it is held to the same ceiling as the
                        // computed backoff — a hostile or buggy header must not
                        // be able to park the caller's task. The floor keeps
                        // `Retry-After: 0` from spinning the retries away with
                        // no sleep at all.
                        Some(after) => after
                            .max(self.inner.retry_base_delay)
                            .min(self.inner.max_retry_delay),
                        None => self.backoff(attempt),
                    };
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
            }
        }
    }

    async fn attempt(
        &self,
        method: &Method,
        url: &Url,
        query: &QueryPairs,
        body: Option<&serde_json::Value>,
    ) -> std::result::Result<Vec<u8>, Failure> {
        let mut request = self.inner.http.request(method.clone(), url.clone());
        if !query.is_empty() {
            request = request.query(query);
        }
        if let Some(body) = body {
            request = request.json(body);
        }

        let response = match request.send().await {
            Ok(response) => response,
            Err(err) => {
                let retryable = err.is_timeout() || err.is_connect() || err.is_request();
                return Err(if retryable {
                    Failure::Retryable {
                        error: Error::Transport(err),
                        retry_after: None,
                    }
                } else {
                    Failure::Fatal(Error::Transport(err))
                });
            }
        };

        let status = response.status();
        let retry_after = parse_retry_after(response.headers());
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes.to_vec(),
            // The status line arrived but the body did not. For this read-only
            // API every request is safe to repeat, so treat it as retryable.
            Err(err) => {
                return Err(Failure::Retryable {
                    error: Error::Transport(err),
                    retry_after,
                })
            }
        };

        if status.is_success() {
            return Ok(bytes);
        }

        let message = message_from_body(&bytes, status);

        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(Failure::Retryable {
                error: Error::RateLimited {
                    message,
                    retry_after,
                },
                retry_after,
            });
        }

        let error = Error::Api {
            status: status.as_u16(),
            message,
        };

        Err(if status.is_server_error() {
            Failure::Retryable { error, retry_after }
        } else {
            Failure::Fatal(error)
        })
    }

    /// Full jitter: sleep a uniform random duration in `[0, cap]`, where `cap`
    /// doubles per attempt up to `max_retry_delay`.
    fn backoff(&self, attempt: u32) -> Duration {
        let factor = 1u32 << attempt.min(16);
        let cap = self
            .inner
            .retry_base_delay
            .saturating_mul(factor)
            .min(self.inner.max_retry_delay);
        let cap_ms = cap.as_millis() as u64;
        if cap_ms == 0 {
            return Duration::ZERO;
        }
        Duration::from_millis(self.next_random() % (cap_ms + 1))
    }

    /// xorshift64, seeded from the clock at construction time.
    ///
    /// The advance is a compare-and-swap, not a load/store pair: clones of one
    /// client share this state, and two tasks that read it concurrently would
    /// otherwise compute the same "jitter" and sleep in lockstep — exactly the
    /// thundering herd the jitter exists to break up.
    fn next_random(&self) -> u64 {
        let previous = self
            .inner
            .rng
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |state| {
                Some(xorshift(state))
            })
            // The closure never returns `None`, so `fetch_update` cannot fail.
            .unwrap_or(1);
        xorshift(previous)
    }
}

/// One step of xorshift64. Zero is a fixed point, which the seed rules out.
fn xorshift(mut state: u64) -> u64 {
    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    state
}

/// Outcome of one HTTP attempt that did not produce a usable body.
enum Failure {
    Fatal(Error),
    Retryable {
        error: Error,
        retry_after: Option<Duration>,
    },
}

/// Percent-encode one value for use as a single path segment.
///
/// Everything outside the RFC 3986 *unreserved* set is escaped, `/` included.
/// That is the point: [`build_url`] treats `/` as structure, so an unencoded one
/// inside a caller-supplied address would add a path segment and send the
/// request to a different endpoint than the method promises.
///
/// Encoding happens exactly once, here — [`build_url`] joins the result
/// verbatim rather than escaping the `%` a second time.
///
/// The one thing this cannot express is a segment that *is* `.` or `..`: the
/// URL standard resolves those away before any escaping is looked at, and every
/// `%2e` spelling with them. A value of `".."` therefore drops its own segment
/// rather than travelling as data. It costs the request, not the target of a
/// neighbouring endpoint, and no address or chain slug is ever spelled that way.
pub(crate) fn seg(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";

    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char)
            }
            _ => {
                encoded.push('%');
                encoded.push(HEX[usize::from(byte >> 4)] as char);
                encoded.push(HEX[usize::from(byte & 0x0f)] as char);
            }
        }
    }
    encoded
}

/// Join a `/`-separated path onto the base URL.
///
/// Segments arrive already encoded — the structural parts are ASCII literals in
/// this crate, and every caller-supplied value goes through [`seg`] first — so
/// they are joined as they are. `Url::set_path` leaves an existing `%XX` alone
/// and still escapes anything unsafe that reached it raw.
fn build_url(base: &Url, path: &str) -> Url {
    let mut url = base.clone();
    let mut joined = url.path().trim_end_matches('/').to_string();
    for segment in path.split('/').filter(|s| !s.is_empty()) {
        joined.push('/');
        joined.push_str(segment);
    }
    url.set_path(&joined);
    url
}

/// `Retry-After` in delta-seconds form. The HTTP-date form is ignored, which
/// falls the caller back onto ordinary exponential backoff.
fn parse_retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let raw = headers.get(RETRY_AFTER)?.to_str().ok()?;
    let seconds: u64 = raw.trim().parse().ok()?;
    Some(Duration::from_secs(seconds))
}

/// Builder for [`FyuzClient`]. Created with [`FyuzClient::builder`].
#[derive(Debug, Clone)]
pub struct FyuzClientBuilder {
    base_url: Url,
    user_agent: String,
    timeout: Duration,
    max_retries: u32,
    retry_base_delay: Duration,
    max_retry_delay: Duration,
    rpc_url: Option<String>,
    rpc_timeout: Option<Duration>,
}

impl FyuzClientBuilder {
    /// A builder with every default in place: production base URL, 30s timeout,
    /// 3 retries.
    pub fn new() -> Self {
        Self {
            base_url: Url::parse(DEFAULT_BASE_URL).expect("DEFAULT_BASE_URL is a valid URL"),
            user_agent: format!("fyuz-sdk-rust/{VERSION}"),
            timeout: DEFAULT_TIMEOUT,
            max_retries: DEFAULT_MAX_RETRIES,
            retry_base_delay: DEFAULT_RETRY_BASE_DELAY,
            max_retry_delay: DEFAULT_MAX_RETRY_DELAY,
            rpc_url: None,
            rpc_timeout: None,
        }
    }

    /// Point the client somewhere other than <https://api.fyuz.fun> — a staging
    /// host, a caching proxy, or a stub server in tests.
    ///
    /// A path prefix is respected: `http://gateway/fyuz/` sends `/health` to
    /// `http://gateway/fyuz/health`.
    pub fn base_url(mut self, base_url: &str) -> Result<Self> {
        let mut parsed = Url::parse(base_url).map_err(|e| Error::InvalidBaseUrl {
            url: base_url.to_string(),
            message: e.to_string(),
        })?;

        if parsed.cannot_be_a_base() {
            return Err(Error::InvalidBaseUrl {
                url: base_url.to_string(),
                message: "URL cannot be used as a base".to_string(),
            });
        }
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(Error::InvalidBaseUrl {
                url: base_url.to_string(),
                message: format!(
                    "unsupported scheme {:?}, expected http or https",
                    parsed.scheme()
                ),
            });
        }

        // Normalise to a trailing slash so path joining is unambiguous.
        if !parsed.path().ends_with('/') {
            let path = format!("{}/", parsed.path());
            parsed.set_path(&path);
        }

        self.base_url = parsed;
        Ok(self)
    }

    /// Override the `User-Agent`. Defaults to `fyuz-sdk-rust/<version>`.
    ///
    /// Identifying your application here is appreciated — it is what lets the
    /// Fyuz team raise your rate-limit allowance.
    pub fn user_agent(mut self, user_agent: impl Into<String>) -> Self {
        self.user_agent = user_agent.into();
        self
    }

    /// Per-request timeout, covering connect plus response body. Default 30s.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// How many times to retry a 429, a 5xx or a transport failure. Default 3;
    /// `0` disables retrying entirely.
    ///
    /// One call therefore blocks for at most
    /// `max_retries × max_retry_delay` of waiting on top of the request time —
    /// 24s of waiting with the defaults.
    pub fn max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    /// First backoff window. Attempt `n` sleeps a uniform random duration in
    /// `[0, base * 2^n]`, capped by [`max_retry_delay`](Self::max_retry_delay).
    /// Default 250ms.
    pub fn retry_base_delay(mut self, delay: Duration) -> Self {
        self.retry_base_delay = delay;
        self
    }

    /// Ceiling on a single wait between attempts. Default 8s.
    ///
    /// This bounds *every* delay the client takes, the computed backoff window
    /// and a server's `Retry-After` alike. A server that asks for longer than
    /// this is retried at the ceiling instead, and if it keeps refusing, the
    /// [`Error::RateLimited`](crate::Error::RateLimited) that comes back still
    /// carries the server's own
    /// [`retry_after`](crate::Error::retry_after) for the caller to honour.
    pub fn max_retry_delay(mut self, delay: Duration) -> Self {
        self.max_retry_delay = delay;
        self
    }

    /// Point the trading layer at a JSON-RPC endpoint of your choosing.
    ///
    /// Without this, [`FyuzClient::trade`] uses whatever `GET /config` publishes
    /// for the chain. That endpoint belongs to the API operator, is shared by
    /// every caller, and can change without notice — so set your own for
    /// anything in production.
    pub fn rpc_url(mut self, url: impl Into<String>) -> Self {
        self.rpc_url = Some(url.into());
        self
    }

    /// Per-call timeout for JSON-RPC requests. Defaults to
    /// [`DEFAULT_RPC_TIMEOUT`](crate::DEFAULT_RPC_TIMEOUT).
    pub fn rpc_timeout(mut self, timeout: Duration) -> Self {
        self.rpc_timeout = Some(timeout);
        self
    }

    /// Build the client.
    ///
    /// Fails only if the TLS backend or DNS resolver cannot be initialised.
    pub fn build(self) -> Result<FyuzClient> {
        let http = reqwest::Client::builder()
            .user_agent(self.user_agent)
            .timeout(self.timeout)
            .build()?;

        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15)
            // xorshift is a fixed point at zero.
            | 1;

        Ok(FyuzClient {
            inner: Arc::new(Inner {
                http,
                base_url: self.base_url,
                max_retries: self.max_retries,
                retry_base_delay: self.retry_base_delay,
                max_retry_delay: self.max_retry_delay,
                rng: AtomicU64::new(seed),
                rpc_url: self.rpc_url,
                rpc_timeout: self.rpc_timeout,
                trade_state: TradeState::default(),
            }),
        })
    }
}

impl Default for FyuzClientBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(url: &str) -> Url {
        FyuzClientBuilder::new().base_url(url).unwrap().base_url
    }

    #[test]
    fn joins_paths_onto_a_bare_host() {
        assert_eq!(
            build_url(&base("http://127.0.0.1:8080"), "/tokens/king").as_str(),
            "http://127.0.0.1:8080/tokens/king"
        );
    }

    #[test]
    fn joins_paths_onto_a_prefixed_base() {
        assert_eq!(
            build_url(&base("http://gateway/fyuz"), "/distributor/rounds/7").as_str(),
            "http://gateway/fyuz/distributor/rounds/7"
        );
    }

    #[test]
    fn percent_encodes_path_segments() {
        let url = build_url(&base("https://api.fyuz.fun"), "/wallet/0x00 ff");
        assert_eq!(url.as_str(), "https://api.fyuz.fun/wallet/0x00%20ff");
    }

    #[test]
    fn seg_escapes_everything_outside_the_unreserved_set() {
        assert_eq!(
            seg("0x1111111111111111111111111111111111111111"),
            "0x1111111111111111111111111111111111111111"
        );
        assert_eq!(seg("-._~"), "-._~", "unreserved punctuation stays literal");
        assert_eq!(seg("a/b"), "a%2Fb", "a slash must not become structure");
        assert_eq!(seg("a?b=c#d"), "a%3Fb%3Dc%23d");
        assert_eq!(seg("0x00 ff"), "0x00%20ff");
        assert_eq!(seg("%2F"), "%252F", "a pre-escaped slash is data too");
        assert_eq!(seg("é"), "%C3%A9", "non-ASCII is escaped per UTF-8 byte");
    }

    #[test]
    fn a_slash_in_an_argument_cannot_retarget_the_request() {
        let base = base("https://api.fyuz.fun");

        let url = build_url(&base, &format!("/wallet/{}", seg("../distributor/stats")));
        assert_eq!(
            url.path(),
            "/wallet/..%2Fdistributor%2Fstats",
            "the argument must stay one segment"
        );

        let url = build_url(&base, &format!("/tier/{}", seg("0xabc/../../health")));
        assert_eq!(url.path(), "/tier/0xabc%2F..%2F..%2Fhealth");
    }

    #[test]
    fn a_bare_dot_segment_collapses_rather_than_reaching_a_sibling_endpoint() {
        // Documented limitation of URL semantics, pinned so it cannot drift into
        // something worse: `..` loses its own segment, it does not walk up and
        // pick a different endpoint the way an unencoded `/` used to.
        let url = build_url(
            &base("https://api.fyuz.fun"),
            &format!("/wallet/{}", seg("..")),
        );
        assert_eq!(url.path(), "/");
        assert_eq!(seg(".."), "..");
    }

    #[test]
    fn build_url_does_not_escape_an_already_escaped_segment_twice() {
        let url = build_url(
            &base("https://api.fyuz.fun"),
            &format!("/wallet/{}", seg("a b")),
        );
        assert_eq!(url.as_str(), "https://api.fyuz.fun/wallet/a%20b");
    }

    #[test]
    fn rejects_non_http_base_urls() {
        let err = FyuzClientBuilder::new()
            .base_url("ftp://example.com")
            .unwrap_err();
        assert!(matches!(err, Error::InvalidBaseUrl { .. }));
        let err = FyuzClientBuilder::new().base_url("not a url").unwrap_err();
        assert!(matches!(err, Error::InvalidBaseUrl { .. }));
    }

    #[test]
    fn parses_retry_after_seconds() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(RETRY_AFTER, "3".parse().unwrap());
        assert_eq!(parse_retry_after(&headers), Some(Duration::from_secs(3)));

        headers.insert(
            RETRY_AFTER,
            "Wed, 21 Oct 2026 07:28:00 GMT".parse().unwrap(),
        );
        assert_eq!(parse_retry_after(&headers), None);
    }

    #[test]
    fn backoff_stays_within_the_cap() {
        let client = FyuzClientBuilder::new()
            .retry_base_delay(Duration::from_millis(100))
            .max_retry_delay(Duration::from_millis(400))
            .build()
            .unwrap();

        for attempt in 0..6 {
            let delay = client.backoff(attempt);
            assert!(delay <= Duration::from_millis(400), "{delay:?}");
        }
        assert!(client.backoff(0) <= Duration::from_millis(100));
    }
}
