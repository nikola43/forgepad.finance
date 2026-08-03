//! Conformance tests, driven by `sdk/shared/test-vectors`.
//!
//! The same fixtures back the TypeScript, Go and Python suites. A change to the
//! wire contract fails all four at once, which is the only thing keeping four
//! hand-written clients honest about the same API.
//!
//! The fixtures are pulled in with `include_str!`, so moving or deleting one is
//! a compile error rather than a test that quietly stops asserting anything.

mod common;

use std::time::Duration;

use common::{StubResponse, StubServer};
use fyuz::models::{Token, TradeSide};
use fyuz::{Error, FyuzClient, ListTokensParams, RecentTradesParams};
use serde_json::Value;

const TOKEN_VECTOR: &str = include_str!("../../shared/test-vectors/token.json");
const ERROR_VECTOR: &str = include_str!("../../shared/test-vectors/http-errors.json");
const TRADE_SIDE_VECTOR: &str = include_str!("../../shared/test-vectors/trade-side.json");

const MAX_RETRIES: u32 = 2;

fn token_vector() -> Value {
    serde_json::from_str(TOKEN_VECTOR).expect("parse token.json")
}

fn client_for(server: &StubServer) -> FyuzClient {
    FyuzClient::builder()
        .base_url(&server.base_url)
        .expect("stub base url")
        .timeout(Duration::from_secs(5))
        .max_retries(MAX_RETRIES)
        .retry_base_delay(Duration::from_millis(1))
        .max_retry_delay(Duration::from_millis(5))
        .build()
        .expect("build client")
}

/// Serve the shared payload once and hand back the token the client parsed.
async fn fetch_conformance_token(vector: &Value) -> Token {
    let wire = serde_json::to_string(&vector["wire"]).expect("re-encode wire payload");
    let server = StubServer::start(vec![StubResponse::ok(wire)]).await;
    let client = client_for(&server);

    let page = client
        .list_tokens(&ListTokensParams::new())
        .await
        .expect("list_tokens");

    assert_eq!(
        page.token_count,
        vector["expect"]["scalars"]["tokenCount"]
            .as_i64()
            .expect("tokenCount")
    );
    assert_eq!(page.token_list.len(), 1);
    page.token_list.into_iter().next().expect("one token")
}

/// Wire field name to the parsed value.
///
/// Written out rather than derived: the models are `Deserialize`-only on
/// purpose, so there is no `Serialize` round trip to reflect over. The upside is
/// that a renamed field breaks this match at compile time.
fn decimal_field<'a>(token: &'a Token, wire_name: &str) -> &'a str {
    match wire_name {
        "marketcap" => &token.marketcap,
        "price" => &token.price,
        "ethPrice" => &token.eth_price,
        "volume" => &token.volume,
        "score" => &token.score,
        "virtualEthAmount" => &token.virtual_eth_amount,
        "virtualTokenAmount" => &token.virtual_token_amount,
        other => panic!("fixture names a decimal field this test does not map: {other}"),
    }
}

/// Whether a nullable field came back as `None`.
fn nullable_is_none(token: &Token, wire_name: &str) -> bool {
    match wire_name {
        "tokenDescription" => token.token_description.is_none(),
        "imageStyle" => token.image_style.is_none(),
        "tokenBanner" => token.token_banner.is_none(),
        "pairAddress" => token.pair_address.is_none(),
        "webLink" => token.web_link.is_none(),
        "telegramLink" => token.telegram_link.is_none(),
        "twitterLink" => token.twitter_link.is_none(),
        "launchedAt" => token.launched_at.is_none(),
        "liquidity" => token.liquidity.is_none(),
        other => panic!("fixture names a nullable field this test does not map: {other}"),
    }
}

/// The invariant the whole crate is built around: a decimal the server sent
/// arrives byte-identical, because every one of these values is a value `f64`
/// would corrupt.
#[tokio::test]
async fn decimals_survive_exactly() {
    let vector = token_vector();
    let expected = vector["expect"]["exact_strings"]
        .as_object()
        .expect("exact_strings")
        .clone();
    assert!(
        !expected.is_empty(),
        "fixture has no exact_strings; the test would pass vacuously"
    );

    let token = fetch_conformance_token(&vector).await;

    for (wire_name, entry) in &expected {
        let want = entry["value"].as_str().expect("value");
        let why = entry["why"].as_str().unwrap_or("");
        assert_eq!(decimal_field(&token, wire_name), want, "{wire_name}: {why}");
    }
}

/// The fixture only means anything if these values really are float-unsafe.
/// Without this, someone could weaken the vectors and the test above would keep
/// passing while protecting nothing.
#[test]
fn fixture_values_are_actually_corrupted_by_f64() {
    let vector = token_vector();
    let corrupted = vector["expect"]["exact_strings"]
        .as_object()
        .expect("exact_strings")
        .values()
        .filter(|entry| {
            let wire = entry["value"].as_str().expect("value");
            match wire.parse::<f64>() {
                Ok(parsed) => format!("{parsed}") != wire,
                Err(_) => false,
            }
        })
        .count();

    assert!(
        corrupted > 0,
        "no vector in exact_strings survives a round trip through f64 differently — \
         the fixture proves nothing"
    );
}

/// `None` means unknown, never zero. A `None` `pair_address` in particular means
/// the token is still on the bonding curve and no DEX pool exists to look up.
#[tokio::test]
async fn null_is_not_zero() {
    let vector = token_vector();
    let nullable: Vec<String> = vector["expect"]["must_be_null"]["fields"]
        .as_array()
        .expect("must_be_null.fields")
        .iter()
        .map(|field| field.as_str().expect("field name").to_string())
        .collect();
    assert!(!nullable.is_empty(), "fixture has no must_be_null fields");

    let why = vector["expect"]["must_be_null"]["why"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let token = fetch_conformance_token(&vector).await;

    for wire_name in &nullable {
        assert!(
            nullable_is_none(&token, wire_name),
            "{wire_name} should be None: {why}"
        );
    }
}

#[tokio::test]
async fn scalars_round_trip() {
    let vector = token_vector();
    let scalars = vector["expect"]["scalars"].clone();
    let token = fetch_conformance_token(&vector).await;

    assert_eq!(token.id, scalars["id"].as_i64().expect("id"));
    assert_eq!(
        token.pool_type,
        scalars["poolType"].as_i64().expect("poolType")
    );
    assert_eq!(token.replies, scalars["replies"].as_i64().expect("replies"));
}

/// The API sends `"buy"`/`"sell"` from `/trades/recent` and `"BUY"`/`"SELL"`
/// from the token detail endpoint. `TradeSide` is a normalising enum, so both
/// casings have to land on the same variant — otherwise matching on
/// `TradeSide::Buy` would silently miss every trade from one of the two
/// endpoints.
#[tokio::test]
async fn trade_side_casing_folds_to_one_variant() {
    let vector: Value = serde_json::from_str(TRADE_SIDE_VECTOR).expect("parse trade-side.json");
    let cases = vector["cases"].as_array().expect("cases").clone();
    assert!(
        !cases.is_empty(),
        "fixture has no cases; the test would pass vacuously"
    );

    for case in &cases {
        let wire = case["wire"].as_str().expect("wire");
        let side = case["side"].as_str().expect("side");

        let mut body = vector["wire_template"].clone();
        body["trades"][0]["type"] = Value::String(wire.to_string());

        let server = StubServer::start(vec![StubResponse::ok(
            serde_json::to_string(&body).expect("re-encode wire template"),
        )])
        .await;
        let client = client_for(&server);

        let feed = client
            .get_recent_trades(&RecentTradesParams::new())
            .await
            .expect("get_recent_trades");

        assert_eq!(feed.trades.len(), 1, "{wire}");
        let parsed = &feed.trades[0].trade_side;
        let expected = match side {
            "buy" => TradeSide::Buy,
            "sell" => TradeSide::Sell,
            other => panic!("fixture uses unknown side {other}"),
        };
        assert_eq!(
            parsed, &expected,
            "wire {wire:?} should deserialise to {expected:?}"
        );
        assert_eq!(
            parsed.as_str(),
            side,
            "as_str is the canonical lowercase form"
        );
    }
}

/// Each status maps to the error the shared fixture documents, and only the
/// retryable ones are retried.
#[tokio::test]
async fn error_classification_and_retries() {
    let vector: Value = serde_json::from_str(ERROR_VECTOR).expect("parse http-errors.json");
    let cases = vector["cases"].as_array().expect("cases");
    assert!(
        !cases.is_empty(),
        "fixture has no cases; the test would pass vacuously"
    );

    for case in cases {
        let name = case["name"].as_str().expect("name");
        let status = case["status"].as_u64().expect("status") as u16;
        let body = case["body"].as_str().expect("body");
        let classification = case["classification"].as_str().expect("classification");
        let retryable = case["retryable"].as_bool().expect("retryable");

        let expected_attempts = if retryable {
            MAX_RETRIES as usize + 1
        } else {
            1
        };

        // One response more than expected is queued, so an over-fetching client
        // shows up in the request count rather than in the status it received.
        let responses = std::iter::repeat_with(|| StubResponse::new(status, body))
            .take(expected_attempts + 1)
            .collect();
        let server = StubServer::start(responses).await;
        let client = client_for(&server);

        let error = client
            .health()
            .await
            .expect_err(&format!("{name}: status {status} returned no error"));

        assert_eq!(error.status(), Some(status), "{name}: status");

        match classification {
            "not_found" => assert!(error.is_not_found(), "{name}: expected not-found"),
            "rate_limited" => {
                assert!(error.is_rate_limited(), "{name}: expected rate-limited");
                assert!(
                    matches!(error, Error::RateLimited { .. }),
                    "{name}: expected Error::RateLimited"
                );
            }
            "api" => {
                assert!(
                    matches!(error, Error::Api { .. }),
                    "{name}: expected Error::Api, got {error:?}"
                );
                assert!(!error.is_rate_limited(), "{name}: misclassified");
                assert!(!error.is_not_found(), "{name}: misclassified");
            }
            other => panic!("fixture uses unknown classification {other}"),
        }

        let message = match &error {
            Error::Api { message, .. } | Error::RateLimited { message, .. } => message.clone(),
            other => panic!("{name}: unexpected error variant {other:?}"),
        };
        match case["message"].as_str() {
            Some(want) => assert_eq!(message, want, "{name}: message"),
            // A body the SDK could not parse still has to yield something readable.
            None => assert!(!message.trim().is_empty(), "{name}: message was empty"),
        }

        assert_eq!(
            server.request_count(),
            expected_attempts,
            "{name}: retryable={retryable}"
        );
    }
}
