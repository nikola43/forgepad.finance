//! End-to-end tests against a local stub server. Nothing here touches the
//! network.

mod common;

use std::time::Duration;

use common::fixtures;
use common::{StubResponse, StubServer};
use fyuz::{
    DiscoverParams, DiscoverTab, Error, FyuzClient, ListTokensParams, TokenStatus,
    TokenTradesParams, TradeSide,
};

/// A client pointed at the stub, with backoff shrunk so retry tests stay fast.
fn client_for(server: &StubServer) -> FyuzClient {
    FyuzClient::builder()
        .base_url(&server.base_url)
        .expect("stub base url")
        .timeout(Duration::from_secs(5))
        .retry_base_delay(Duration::from_millis(1))
        .max_retry_delay(Duration::from_millis(5))
        .build()
        .expect("build client")
}

#[tokio::test]
async fn health_happy_path() {
    let server = StubServer::start(vec![StubResponse::ok(r#"{"status":"ok"}"#)]).await;
    let client = client_for(&server);

    let health = client.health().await.unwrap();

    assert_eq!(health.status, "ok");
    let request = server.request(0);
    assert_eq!(request.method, "GET");
    assert_eq!(request.path(), "/health");
    assert!(
        request
            .header("user-agent")
            .unwrap()
            .starts_with("fyuz-sdk-rust/"),
        "unexpected user agent: {:?}",
        request.header("user-agent")
    );
}

/// `GET /tokens/king` answers with a `{"king": …}` envelope, not a bare token.
/// Deserialising the envelope straight into `Token` is the bug this pins.
#[tokio::test]
async fn get_king_unwraps_the_envelope_and_maps_an_empty_hill_to_none() {
    let server = StubServer::start(vec![
        StubResponse::ok(fixtures::king_envelope(&fixtures::token("KING", "1234.5"))),
        StubResponse::ok(fixtures::king_empty()),
    ])
    .await;
    let client = client_for(&server);

    let king = client.get_king().await.unwrap().expect("king present");
    assert_eq!(king.token_symbol, "KING");
    assert_eq!(king.marketcap, "1234.5");

    // No token on the curve is a real state, not an error and not a blank Token.
    assert!(client.get_king().await.unwrap().is_none());
}

#[tokio::test]
async fn decimal_strings_survive_the_round_trip() {
    // 30 significant digits: far past what an f64 can represent exactly.
    let marketcap = "123456789012345678901234567890";
    let server = StubServer::start(vec![StubResponse::ok(fixtures::king_envelope(
        &fixtures::token("KING", marketcap),
    ))])
    .await;
    let client = client_for(&server);

    let king = client.get_king().await.unwrap().expect("king present");

    assert_eq!(king.marketcap, marketcap, "market cap lost precision");
    assert_eq!(king.virtual_eth_amount, "30.000000000000000001");
    assert_eq!(king.volume, "1234.567890123456789012");

    // The bug this guards against: the same value through f64 is not the same
    // value any more.
    let via_f64 = format!("{:.0}", marketcap.parse::<f64>().unwrap());
    assert_ne!(via_f64, marketcap);
}

#[tokio::test]
async fn omitted_optional_fields_deserialise_to_none() {
    let server = StubServer::start(vec![StubResponse::ok(fixtures::king_envelope(
        &fixtures::token_without_15m(),
    ))])
    .await;
    let client = client_for(&server);

    let king = client.get_king().await.unwrap().expect("king present");

    assert_eq!(king.price_15m, None);
    assert_eq!(king.price_change_15m, None);
    // A token still on the curve has no pair: this is the field that tells you
    // there is no DEX pool to read.
    assert_eq!(king.pair_address, None);
    assert_eq!(king.progress, Some(42.5));
}

#[tokio::test]
async fn retries_a_429_then_succeeds() {
    let server = StubServer::start(vec![
        StubResponse::rate_limited(),
        StubResponse::ok(r#"{"status":"ok"}"#),
    ])
    .await;
    let client = client_for(&server);

    let health = client.health().await.unwrap();

    assert_eq!(health.status, "ok");
    assert_eq!(
        server.request_count(),
        2,
        "the 429 should have been retried"
    );
}

#[tokio::test]
async fn retries_a_5xx_then_succeeds() {
    let server = StubServer::start(vec![
        StubResponse::new(503, r#"{"error":"upstream unavailable"}"#),
        StubResponse::ok(r#"{"status":"ok"}"#),
    ])
    .await;
    let client = client_for(&server);

    assert_eq!(client.health().await.unwrap().status, "ok");
    assert_eq!(server.request_count(), 2);
}

#[tokio::test]
async fn gives_up_on_a_persistent_429_with_a_typed_error() {
    let responses = vec![
        StubResponse::rate_limited(),
        StubResponse::rate_limited(),
        StubResponse::rate_limited(),
    ];
    let server = StubServer::start(responses).await;
    let client = FyuzClient::builder()
        .base_url(&server.base_url)
        .unwrap()
        .max_retries(2)
        .retry_base_delay(Duration::from_millis(1))
        .max_retry_delay(Duration::from_millis(2))
        .build()
        .unwrap();

    let error = client.health().await.unwrap_err();

    assert!(error.is_rate_limited(), "unexpected error: {error}");
    assert_eq!(error.status(), Some(429));
    match &error {
        Error::RateLimited { message, .. } => assert_eq!(message, "Too many requests"),
        other => panic!("expected RateLimited, got {other:?}"),
    }
    assert_eq!(server.request_count(), 3, "1 attempt + 2 retries");
}

#[tokio::test]
async fn surfaces_retry_after_when_retries_are_disabled() {
    let server =
        StubServer::start(vec![StubResponse::rate_limited().header("Retry-After", "1")]).await;
    let client = FyuzClient::builder()
        .base_url(&server.base_url)
        .unwrap()
        .max_retries(0)
        .build()
        .unwrap();

    let error = client.health().await.unwrap_err();

    assert_eq!(error.retry_after(), Some(Duration::from_secs(1)));
    assert_eq!(server.request_count(), 1, "retries were disabled");
}

#[tokio::test]
async fn parses_the_error_envelope_and_does_not_retry_a_404() {
    let server = StubServer::start(vec![StubResponse::new(
        404,
        r#"{"error":"User not found"}"#,
    )])
    .await;
    let client = client_for(&server);

    let error = client
        .get_user_profile("0x1111111111111111111111111111111111111111")
        .await
        .unwrap_err();

    assert!(error.is_not_found());
    match &error {
        Error::Api { status, message } => {
            assert_eq!(*status, 404);
            assert_eq!(message, "User not found");
        }
        other => panic!("expected Api, got {other:?}"),
    }
    assert_eq!(server.request_count(), 1, "4xx must never be retried");
}

#[tokio::test]
async fn does_not_retry_a_400() {
    let server = StubServer::start(vec![StubResponse::new(
        400,
        r#"{"error":"`to` must be after `from`"}"#,
    )])
    .await;
    let client = client_for(&server);

    let error = client
        .distributor()
        .get_shares(&fyuz::SharesParams::new().from(2).to(1))
        .await
        .unwrap_err();

    assert_eq!(error.status(), Some(400));
    assert_eq!(server.request_count(), 1);
}

#[tokio::test]
async fn reports_a_decode_failure_with_the_offending_body() {
    let server = StubServer::start(vec![StubResponse::ok(r#"{"unexpected":true}"#)]).await;
    let client = client_for(&server);

    let error = client.health().await.unwrap_err();

    match &error {
        Error::Decode { body, .. } => assert!(body.contains("unexpected"), "body was {body:?}"),
        other => panic!("expected Decode, got {other:?}"),
    }
}

#[tokio::test]
async fn encodes_query_parameters() {
    let server = StubServer::start(vec![StubResponse::ok("[]")]).await;
    let client = client_for(&server);

    client
        .discover(
            &DiscoverParams::new()
                .tab(DiscoverTab::Graduating)
                .status(TokenStatus::Bonding)
                .min_holders(25)
                .limit(10),
        )
        .await
        .unwrap();

    let query = server.request(0).query().to_string();
    assert!(query.contains("tab=graduating"), "{query}");
    assert!(query.contains("status=bonding"), "{query}");
    assert!(query.contains("minHolders=25"), "{query}");
    assert!(query.contains("limit=10"), "{query}");
}

#[tokio::test]
async fn sends_the_token_address_in_the_post_body() {
    let server = StubServer::start(vec![StubResponse::ok(format!(
        "[{}]",
        fixtures::trade("buy")
    ))])
    .await;
    let client = client_for(&server);

    let trades = client
        .get_token_trades(
            "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
            &TokenTradesParams::new().limit(100).offset(20),
        )
        .await
        .unwrap();

    assert_eq!(trades.len(), 1);
    assert_eq!(trades[0].trade_side, TradeSide::Buy);
    assert_eq!(trades[0].eth_amount, "0.123456789012345678");

    let request = server.request(0);
    assert_eq!(request.method, "POST");
    assert_eq!(request.path(), "/trades");
    assert!(request.query().contains("limit=100"), "{}", request.query());
    assert!(request.query().contains("offset=20"), "{}", request.query());
    assert_eq!(
        request.body,
        r#"{"tokenAddress":"0x23a84ba5bf7bf3236491fa2b5a9807a274337135"}"#
    );
}

#[tokio::test]
async fn keeps_an_unknown_trade_side_verbatim() {
    let server = StubServer::start(vec![StubResponse::ok(format!(
        "[{}]",
        fixtures::trade("migrate")
    ))])
    .await;
    let client = client_for(&server);

    let trades = client
        .get_token_trades("0xabc", &TokenTradesParams::new())
        .await
        .unwrap();

    assert_eq!(trades[0].trade_side, TradeSide::Other("migrate".into()));
    assert_eq!(trades[0].trade_side.as_str(), "migrate");
}

#[tokio::test]
async fn walks_every_page_of_the_token_list() {
    let server = StubServer::start(vec![
        StubResponse::ok(fixtures::token_page(&["AAA", "BBB"], 5)),
        StubResponse::ok(fixtures::token_page(&["CCC", "DDD"], 5)),
        StubResponse::ok(fixtures::token_page(&["EEE"], 5)),
    ])
    .await;
    let client = client_for(&server);

    let mut pager = client.token_pages(&ListTokensParams::new().page_size(2));
    let mut symbols = Vec::new();
    while let Some(token) = pager.next_token().await.unwrap() {
        symbols.push(token.token_symbol);
    }

    assert_eq!(symbols, vec!["AAA", "BBB", "CCC", "DDD", "EEE"]);
    assert_eq!(pager.total_count(), Some(5));
    assert_eq!(pager.fetched_count(), 5);
    assert_eq!(
        server.request_count(),
        3,
        "should stop once tokenCount is covered"
    );

    for (index, expected_page) in [1, 2, 3].iter().enumerate() {
        let query = server.request(index).query().to_string();
        assert!(
            query.contains(&format!("pageNumber={expected_page}")),
            "{query}"
        );
        assert!(query.contains("pageSize=2"), "{query}");
    }
}

#[tokio::test]
async fn wei_fields_stay_exact_decimal_strings() {
    let total = "987654321098765432109876543210";
    let largest = "12345678901234567890";
    let server = StubServer::start(vec![StubResponse::ok(fixtures::payout_stats(
        total, largest,
    ))])
    .await;
    let client = client_for(&server);

    let stats = client.distributor().get_stats().await.unwrap();

    assert_eq!(stats.total_paid_wei, total);
    assert_eq!(stats.largest_payout_wei, largest);
    assert_eq!(stats.last_round_at, Some(1750000000));
}

#[tokio::test]
async fn round_detail_is_flattened_onto_the_top_level() {
    let server = StubServer::start(vec![StubResponse::ok(fixtures::round_detail())]).await;
    let client = client_for(&server);

    let detail = client.distributor().get_round(7).await.unwrap();

    assert_eq!(detail.round.round_id, 7);
    assert_eq!(detail.round.holder_count, Some(2));
    assert_eq!(
        detail.round.pot_wei.as_deref(),
        Some("1234567890123456789012")
    );
    // The VRF word is a decimal string, not hex and not a number.
    assert_eq!(
        detail.round.vrf_random.as_deref(),
        Some("78123640922145690285690156981498572344182")
    );
    assert_eq!(detail.payouts.len(), 2);
    assert_eq!(detail.payouts[0].amount_wei, "555555555555555555555");
    assert_eq!(detail.payouts[0].share, 2147483648);
    assert_eq!(server.request(0).path(), "/distributor/rounds/7");
}

#[tokio::test]
async fn null_is_modelled_as_none_not_zero() {
    let server = StubServer::start(vec![
        StubResponse::ok(
            r#"{"potBnb":null,"distributeBps":9000.0,"roundEnd":1750000000,"totalPoints":null,"pointsPerUsd":1.0}"#,
        ),
        StubResponse::ok(
            r#"{"potBnb":0.0,"distributeBps":9000.0,"roundEnd":1750000000,"totalPoints":0.0,"pointsPerUsd":1.0}"#,
        ),
        StubResponse::ok(r#"{"address":"0xabc","claimableWei":null,"distributorAddress":null}"#),
    ])
    .await;
    let client = client_for(&server);

    let unknown = client.distributor().get_pot().await.unwrap();
    assert_eq!(unknown.pot_bnb, None, "null must not collapse to 0");
    assert_eq!(unknown.total_points, None);

    let empty = client.distributor().get_pot().await.unwrap();
    assert_eq!(empty.pot_bnb, Some(0.0), "an actual zero is Some(0.0)");
    assert_eq!(empty.total_points, Some(0.0));

    let claimable = client.distributor().get_claimable("0xabc").await.unwrap();
    assert_eq!(claimable.claimable_wei, None);
    assert_eq!(claimable.distributor_address, None);
}

#[tokio::test]
async fn sends_the_leaderboard_limit_only_when_given() {
    let server = StubServer::start(vec![StubResponse::ok("[]"), StubResponse::ok("[]")]).await;
    let client = client_for(&server);

    client.get_user_leaderboard(Some(25)).await.unwrap();
    client.get_referral_leaderboard(None).await.unwrap();

    assert_eq!(server.request(0).path(), "/users/leaderboard");
    assert_eq!(server.request(0).query(), "limit=25");
    assert_eq!(server.request(1).path(), "/referrals/leaderboard");
    assert_eq!(server.request(1).query(), "");
}

#[tokio::test]
async fn percent_encodes_path_arguments() {
    let empty_portfolio = r#"{"address":"0x0","totalValueUsd":0.0,"totalCostUsd":0.0,"unrealizedPnlUsd":0.0,"realizedPnlUsd":0.0,"totalPnlUsd":0.0,"roiPct":0.0,"positions":[]}"#;
    let server = StubServer::start(vec![
        StubResponse::ok(empty_portfolio),
        StubResponse::ok(empty_portfolio),
        StubResponse::ok(empty_portfolio),
    ])
    .await;
    let client = client_for(&server);

    // An ordinary address is unreserved throughout and travels untouched.
    client
        .get_portfolio("0x1111111111111111111111111111111111111111")
        .await
        .unwrap();
    assert_eq!(
        server.request(0).path(),
        "/portfolio/0x1111111111111111111111111111111111111111"
    );

    // A `/` in the argument must stay data. If it were passed through as
    // structure it would re-target the request at another endpoint entirely.
    client.get_portfolio("0x1111/../../health").await.unwrap();
    assert_eq!(
        server.request(1).path(),
        "/portfolio/0x1111%2F..%2F..%2Fhealth"
    );

    // Everything else outside the unreserved set is escaped too, so a value can
    // neither open a query string nor smuggle in a fragment.
    client.get_portfolio("0x ab?c#d").await.unwrap();
    assert_eq!(server.request(2).path(), "/portfolio/0x%20ab%3Fc%23d");
    assert_eq!(server.request(2).query(), "");
}

#[tokio::test]
async fn a_hostile_retry_after_cannot_outlast_the_configured_ceiling() {
    let server = StubServer::start(vec![
        StubResponse::rate_limited().header("Retry-After", "99999"),
        StubResponse::ok(r#"{"status":"ok"}"#),
    ])
    .await;
    // `client_for` caps a single wait at 5ms.
    let client = client_for(&server);

    let started = std::time::Instant::now();
    let health = client.health().await.unwrap();
    let elapsed = started.elapsed();

    assert_eq!(health.status, "ok");
    assert_eq!(
        server.request_count(),
        2,
        "the 429 should have been retried"
    );
    assert!(
        elapsed < Duration::from_secs(5),
        "Retry-After outran max_retry_delay: slept {elapsed:?}"
    );
}

#[tokio::test]
async fn a_zero_retry_after_still_waits_the_base_delay() {
    let server = StubServer::start(vec![
        StubResponse::rate_limited().header("Retry-After", "0"),
        StubResponse::ok(r#"{"status":"ok"}"#),
    ])
    .await;
    let client = FyuzClient::builder()
        .base_url(&server.base_url)
        .unwrap()
        .retry_base_delay(Duration::from_millis(40))
        .max_retry_delay(Duration::from_millis(80))
        .build()
        .unwrap();

    let started = std::time::Instant::now();
    client.health().await.unwrap();

    assert!(
        started.elapsed() >= Duration::from_millis(40),
        "`Retry-After: 0` must not turn the retry into a busy loop"
    );
    assert_eq!(server.request_count(), 2);
}
