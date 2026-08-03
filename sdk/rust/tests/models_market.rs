//! Wire-fixture decode coverage for the market-data and Distributor models.
//!
//! These models are plain `Deserialize` impls, so a single wrong `rename_all`
//! result or a missing `#[serde(default)]` fails the *whole* response at
//! runtime, on an endpoint nothing else covers. Each body below is shaped
//! exactly like the one `backend-rs` serialises, is sent through the real client
//! method, and is asserted on the fields most likely to drift: the camelCase
//! names that are not a mechanical translation (`volume24h`,
//! `priceChange24h`), and the nullable ones that must land on `None`.

mod common;

use common::fixtures;
use common::{StubResponse, StubServer};
use fyuz::FyuzClient;

fn client_for(server: &StubServer) -> FyuzClient {
    FyuzClient::builder()
        .base_url(&server.base_url)
        .expect("stub base url")
        .max_retries(0)
        .build()
        .expect("build client")
}

#[tokio::test]
async fn decodes_the_market_endpoints() {
    let config = r#"{"chains":[{"name":"BNB Smart Chain","chainId":56,"rpcUrl":"https://bsc-dataseed.example"}]}"#;

    let discover = r#"[{
        "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
        "name": "Test Token",
        "symbol": "TEST",
        "image": null,
        "network": "bsc",
        "creatorAddress": null,
        "marketcap": 18500.5,
        "priceUsd": 0.0000185,
        "createdAt": 1750000000,
        "launched": false,
        "volume24h": 4200.25,
        "buys24h": 88,
        "sells24h": 31,
        "holders": 214,
        "priceChange24h": -12.5,
        "graduationPct": 61.25
    }]"#;

    let detail = format!(
        r#"{{
            "tokenDetails": {},
            "trades": [{}],
            "tradesCount": 1301,
            "holdersDetails": [{}],
            "fifteenMinPrice": "0.000000000000000122",
            "oneDayLiquidity": "12345.678901234567890123",
            "curveHolding": null
        }}"#,
        fixtures::token("TEST", "12345.6789"),
        fixtures::trade("sell"),
        fixtures::holder(),
    );

    let candles = r#"[{
        "time": 1750000000,
        "open": 0.0000185,
        "high": 0.0000191,
        "low": 0.0000180,
        "close": 0.0000188,
        "volume": 4200.25
    }]"#;

    let recent = format!(
        r#"{{"trades":[{}],"tokens":[{}]}}"#,
        fixtures::trade("buy"),
        fixtures::token("TEST", "12345.6789"),
    );

    let server = StubServer::start(vec![
        StubResponse::ok(config),
        StubResponse::ok(discover),
        StubResponse::ok(detail),
        StubResponse::ok(candles),
        StubResponse::ok(recent),
    ])
    .await;
    let client = client_for(&server);

    let config = client.get_config().await.unwrap();
    assert_eq!(config.chains[0].name, "BNB Smart Chain");
    assert_eq!(config.chains[0].chain_id, 56);

    let discover = client.discover(&fyuz::DiscoverParams::new()).await.unwrap();
    assert_eq!(discover[0].volume24h, 4200.25);
    assert_eq!(discover[0].buys24h, 88);
    assert_eq!(discover[0].sells24h, 31);
    assert_eq!(discover[0].price_change24h, -12.5);
    assert_eq!(discover[0].price_usd, 0.0000185);
    assert_eq!(discover[0].creator_address, None);

    let detail = client
        .get_token("bsc", "0x23a8", &fyuz::TokenDetailParams::new())
        .await
        .unwrap();
    assert_eq!(detail.trades_count, 1301);
    assert_eq!(detail.token_details.token_symbol, "TEST");
    assert_eq!(detail.holders_details[0].holder_address.len(), 42);
    assert_eq!(
        detail.fifteen_min_price.as_deref(),
        Some("0.000000000000000122")
    );
    assert_eq!(
        detail.one_day_liquidity.as_deref(),
        Some("12345.678901234567890123"),
        "liquidity is a decimal string, not a float"
    );
    assert_eq!(
        detail.curve_holding, None,
        "an unreadable curve balance is unknown, never zero"
    );
    assert_eq!(server.request(2).path(), "/tokens/bsc/0x23a8");

    let candles = client
        .get_chart_data(&fyuz::ChartDataParams::new("0x23a8", "5", 1, 2))
        .await
        .unwrap();
    assert_eq!(candles[0].time, 1750000000);
    assert_eq!(candles[0].open, 0.0000185);
    assert_eq!(candles[0].close, 0.0000188);
    assert_eq!(candles[0].volume, 4200.25);

    let recent = client
        .get_recent_trades(&fyuz::RecentTradesParams::new())
        .await
        .unwrap();
    assert_eq!(recent.trades[0].tx_hash, "0xfeed");
    assert_eq!(recent.tokens[0].token_symbol, "TEST");
}

#[tokio::test]
async fn decodes_the_distributor_endpoints() {
    let shares = r#"{
        "from": 1749900000,
        "to": 1750000000,
        "totalPoints": 98765.5,
        "holders": [{
            "address": "0x1111111111111111111111111111111111111111",
            "points": 1234.5,
            "share": 2147483648
        }],
        "packed": "0x111111111111111111111111111111111111111180000000"
    }"#;

    let rounds = r#"[
        {
            "roundId": 8,
            "timeStart": 1750000000,
            "timeEnd": 1750100000,
            "txHash": null,
            "potWei": null,
            "distributedWei": null,
            "winnerAddress": null,
            "winnerAmountWei": null,
            "holderCount": null,
            "vrfRandom": null,
            "distributedAt": null
        },
        {
            "roundId": 7,
            "timeStart": 1749900000,
            "timeEnd": 1750000000,
            "txHash": "0xabc",
            "potWei": "1234567890123456789012",
            "distributedWei": "1111111111111111111111",
            "winnerAddress": "0x3333333333333333333333333333333333333333",
            "winnerAmountWei": "123456779012345677901",
            "holderCount": 2,
            "vrfRandom": "78123640922145690285690156981498572344182",
            "distributedAt": 1750000100
        }
    ]"#;

    let payouts = r#"{
        "address": "0x2222222222222222222222222222222222222222",
        "totalWei": "987654321098765432109876543210",
        "roundsPaid": 3,
        "payouts": [{
            "roundId": 7,
            "address": "0x2222222222222222222222222222222222222222",
            "share": 2147483648,
            "amountWei": "555555555555555555555",
            "username": null,
            "avatar": null
        }]
    }"#;

    let server = StubServer::start(vec![
        StubResponse::ok(shares),
        StubResponse::ok(rounds),
        StubResponse::ok(payouts),
    ])
    .await;
    let client = client_for(&server);

    let shares = client
        .distributor()
        .get_shares(&fyuz::SharesParams::new())
        .await
        .unwrap();
    assert_eq!(shares.from, 1749900000);
    assert_eq!(shares.to, 1750000000);
    assert_eq!(shares.total_points, 98765.5);
    assert_eq!(
        shares.holders[0].share, 2147483648,
        "a u32 share does not fit i32"
    );
    assert!(shares.packed.starts_with("0x"));

    let rounds = client
        .distributor()
        .list_rounds(&fyuz::RoundsParams::new())
        .await
        .unwrap();
    assert_eq!(rounds[0].round_id, 8);
    assert_eq!(
        rounds[0].distributed_wei, None,
        "an unsettled round is unknown, never zero"
    );
    assert_eq!(rounds[0].holder_count, None);
    assert_eq!(rounds[0].distributed_at, None);
    assert_eq!(rounds[1].pot_wei.as_deref(), Some("1234567890123456789012"));
    assert_eq!(
        rounds[1].winner_amount_wei.as_deref(),
        Some("123456779012345677901")
    );
    assert_eq!(rounds[1].holder_count, Some(2));

    let paid = client.distributor().get_payouts("0x2222").await.unwrap();
    assert_eq!(paid.total_wei, "987654321098765432109876543210");
    assert_eq!(paid.rounds_paid, 3);
    assert_eq!(paid.payouts[0].amount_wei, "555555555555555555555");
    assert_eq!(paid.payouts[0].username, None);
    assert_eq!(server.request(2).path(), "/distributor/payouts/0x2222");
}
