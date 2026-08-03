//! Wire-fixture decode coverage for the wallet, profile, leaderboard, season,
//! tier, rewards and analytics models.
//!
//! These models are plain `Deserialize` impls, so a single wrong `rename_all`
//! result or a missing `#[serde(default)]` fails the *whole* response at
//! runtime, on an endpoint nothing else covers. Each body below is shaped
//! exactly like the one `backend-rs` serialises, is sent through the real client
//! method, and is asserted on the fields most likely to drift: the camelCase
//! names that are not a mechanical translation (`top10Pct`), and the nullable
//! ones that must land on `None`.

mod common;

use common::fixtures;
use common::{StubResponse, StubServer};
use fyuz::{FyuzClient, Tier};

fn client_for(server: &StubServer) -> FyuzClient {
    FyuzClient::builder()
        .base_url(&server.base_url)
        .expect("stub base url")
        .max_retries(0)
        .build()
        .expect("build client")
}

#[tokio::test]
async fn decodes_the_leaderboard_and_profile_endpoints() {
    let leaderboard = r#"[{
        "rank": 1,
        "address": "0x1111111111111111111111111111111111111111",
        "username": "alice",
        "avatar": null,
        "volumeUsd": 12500.5,
        "trades": 42,
        "points": 1234.5,
        "pointsTotal": 1500.0,
        "pointsProjected": 1800.25,
        "heldUsd": 900.75,
        "rewardEth": 0.0123
    }]"#;

    let profile = format!(
        r#"{{
            "user": {{
                "id": 7,
                "address": "0x1111111111111111111111111111111111111111",
                "username": "alice",
                "avatar": null,
                "bio": null,
                "likes": 3,
                "isAdmin": null,
                "twitterUsername": "alice_eth"
            }},
            "holdings": [{}],
            "chats": [{{
                "id": 11,
                "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
                "replyAddress": null,
                "comment": "gm",
                "code": null,
                "date": "2026-07-01T12:00:00Z",
                "network": "bsc"
            }}],
            "createdTokens": [{}],
            "followers": 5,
            "followees": 9,
            "referralCount": 2,
            "points": 150,
            "tradingPoints": 1234.5,
            "tradingVolumeUsd": 12500.5,
            "rewardEth": 0.0123
        }}"#,
        fixtures::holder(),
        fixtures::token("MADE", "12345.6789"),
    );

    let top_holders = r#"[{
        "address": "0x2222222222222222222222222222222222222222",
        "username": null,
        "avatar": null,
        "volume": 98765.25
    }]"#;

    let referrals = r#"[{
        "rank": 1,
        "address": "0x3333333333333333333333333333333333333333",
        "username": null,
        "avatar": null,
        "referralCount": 17,
        "refereeVolumeUsd": 45000.0
    }]"#;

    let server = StubServer::start(vec![
        StubResponse::ok(leaderboard),
        StubResponse::ok(profile),
        StubResponse::ok(top_holders),
        StubResponse::ok(referrals),
    ])
    .await;
    let client = client_for(&server);

    let board = client.get_user_leaderboard(Some(1)).await.unwrap();
    assert_eq!(board[0].rank, 1);
    assert_eq!(board[0].points, 1234.5);
    assert_eq!(board[0].points_total, 1500.0);
    assert_eq!(board[0].points_projected, 1800.25);
    assert_eq!(board[0].held_usd, 900.75);
    assert_eq!(board[0].reward_eth, 0.0123);
    assert_eq!(board[0].avatar, None);

    let profile = client.get_user_profile("0x1111").await.unwrap();
    assert_eq!(profile.user.id, 7);
    assert_eq!(profile.user.twitter_username.as_deref(), Some("alice_eth"));
    assert_eq!(profile.user.is_admin, None, "null must not become false");
    assert_eq!(profile.user.bio, None);
    assert_eq!(profile.holdings.len(), 1);
    assert_eq!(profile.holdings[0].token_amount, "1000000.000000000000000001");
    assert_eq!(profile.holdings[0].user.address, profile.holdings[0].creator_address);
    assert_eq!(profile.chats[0].comment, "gm");
    assert_eq!(profile.chats[0].reply_address, None);
    assert_eq!(profile.created_tokens[0].token_symbol, "MADE");
    assert_eq!(profile.referral_count, 2);
    assert_eq!(profile.trading_points, 1234.5);
    assert_eq!(profile.trading_volume_usd, 12500.5);

    let top = client
        .get_top_holders(1, &fyuz::TopHoldersParams::new())
        .await
        .unwrap();
    assert_eq!(top[0].volume, 98765.25);

    let referrals = client.get_referral_leaderboard(None).await.unwrap();
    assert_eq!(referrals[0].referral_count, 17);
    assert_eq!(referrals[0].referee_volume_usd, 45000.0);
}


#[tokio::test]
async fn decodes_the_season_tier_reward_and_king_endpoints() {
    let season = r#"{
        "name": "Season 1",
        "startsAt": 1749900000,
        "endsAt": 1752492000,
        "prizePotEth": 12.5,
        "leaderboard": [{
            "rank": 1,
            "address": "0x1111111111111111111111111111111111111111",
            "username": null,
            "avatar": null,
            "points": 9876.5
        }]
    }"#;

    let diamond = r#"{
        "address": "0x1111111111111111111111111111111111111111",
        "volumeUsd": 25000.0,
        "tier": "Diamond",
        "nextTier": null,
        "nextThresholdUsd": null,
        "progressPct": 100.0
    }"#;

    let silver = r#"{
        "address": "0x2222222222222222222222222222222222222222",
        "volumeUsd": 250.0,
        "tier": "Silver",
        "nextTier": "Gold",
        "nextThresholdUsd": 1000.0,
        "progressPct": 16.6
    }"#;

    // A tier this SDK version does not know about must not fail the response.
    let unknown_tier = r#"{
        "address": "0x3333333333333333333333333333333333333333",
        "volumeUsd": 1000000.0,
        "tier": "Obsidian",
        "nextTier": null,
        "nextThresholdUsd": null,
        "progressPct": 100.0
    }"#;

    let rewards = r#"{
        "address": "0x1111111111111111111111111111111111111111",
        "currentStreak": 4,
        "longestStreak": 11,
        "points": 1234.5,
        "bonusPoints": 200.0,
        "quests": [{
            "key": "daily_trade",
            "title": "Make a trade",
            "description": "Trade once today",
            "kind": "daily",
            "target": 1.0,
            "progress": 1.0,
            "points": 10.0,
            "completed": true,
            "claimed": true
        }],
        "achievements": [{
            "key": "first_launch",
            "title": "Launch a token",
            "description": "Launch your first token",
            "icon": "rocket",
            "points": 100.0,
            "earned": false
        }]
    }"#;

    let kings = r#"[
        {
            "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
            "name": "Test Token",
            "symbol": "TEST",
            "image": null,
            "network": "bsc",
            "startedAt": 1750000000,
            "endedAt": null,
            "durationSecs": 3600
        },
        {
            "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337136",
            "name": "Old King",
            "symbol": "OLD",
            "image": "https://cdn.fyuz.fun/old.png",
            "network": "bsc",
            "startedAt": 1749900000,
            "endedAt": 1749990000,
            "durationSecs": 90000
        }
    ]"#;

    let server = StubServer::start(vec![
        StubResponse::ok(season),
        StubResponse::ok(diamond),
        StubResponse::ok(silver),
        StubResponse::ok(unknown_tier),
        StubResponse::ok(rewards),
        StubResponse::ok(kings),
    ])
    .await;
    let client = client_for(&server);

    let season = client.get_season().await.unwrap();
    assert_eq!(season.name, "Season 1");
    assert_eq!(season.starts_at, 1749900000);
    assert_eq!(season.prize_pot_eth, 12.5);
    assert_eq!(season.leaderboard[0].points, 9876.5);

    let diamond = client.get_tier("0x1111").await.unwrap();
    assert_eq!(diamond.tier, Tier::Diamond);
    assert_eq!(diamond.next_tier, None, "there is no tier above Diamond");
    assert_eq!(diamond.next_threshold_usd, None);
    assert_eq!(diamond.progress_pct, 100.0);

    let silver = client.get_tier("0x2222").await.unwrap();
    assert_eq!(silver.tier, Tier::Silver);
    assert_eq!(silver.next_tier, Some(Tier::Gold));
    assert_eq!(silver.next_threshold_usd, Some(1000.0));

    let unknown = client.get_tier("0x3333").await.unwrap();
    assert_eq!(unknown.tier, Tier::Other("Obsidian".into()));
    assert_eq!(unknown.tier.as_str(), "Obsidian");

    let rewards = client.get_rewards("0x1111").await.unwrap();
    assert_eq!(rewards.current_streak, 4);
    assert_eq!(rewards.longest_streak, 11);
    assert_eq!(rewards.bonus_points, 200.0);
    assert!(rewards.quests[0].completed && rewards.quests[0].claimed);
    assert_eq!(rewards.quests[0].kind, "daily");
    assert_eq!(rewards.achievements[0].icon, "rocket");
    assert!(!rewards.achievements[0].earned);

    let kings = client.get_kings_history().await.unwrap();
    assert_eq!(kings[0].ended_at, None, "an ongoing reign has no end");
    assert_eq!(kings[0].duration_secs, 3600);
    assert_eq!(kings[1].ended_at, Some(1749990000));
    assert_eq!(kings[1].image.as_deref(), Some("https://cdn.fyuz.fun/old.png"));
}


#[tokio::test]
async fn decodes_the_analytics_endpoints() {
    let wallet = r#"{
        "address": "0x1111111111111111111111111111111111111111",
        "username": null,
        "avatar": null,
        "volumeUsd": 12500.5,
        "realizedPnlUsd": 300.25,
        "unrealizedPnlUsd": -50.5,
        "totalPnlUsd": 249.75,
        "roiPct": 12.3,
        "winRate": 0.62,
        "tokensTraded": 8,
        "tradeCount": 42,
        "holdingValueUsd": 900.75
    }"#;

    let portfolio = r#"{
        "address": "0x1111111111111111111111111111111111111111",
        "totalValueUsd": 900.75,
        "totalCostUsd": 951.25,
        "unrealizedPnlUsd": -50.5,
        "realizedPnlUsd": 300.25,
        "totalPnlUsd": 249.75,
        "roiPct": -5.3,
        "positions": [{
            "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
            "name": "Test Token",
            "symbol": "TEST",
            "image": null,
            "network": "bsc",
            "balance": 1000000.0,
            "currentPriceUsd": 0.0009,
            "valueUsd": 900.75,
            "costUsd": 951.25,
            "avgBuyPriceUsd": 0.00095,
            "unrealizedPnlUsd": -50.5,
            "unrealizedPnlPct": -5.3,
            "realizedPnlUsd": 300.25
        }]
    }"#;

    let analytics = r#"{
        "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
        "network": "bsc",
        "holderCount": 214,
        "top10Pct": 34.5,
        "creatorPct": 2.1,
        "buys": 900,
        "sells": 410,
        "volumeUsd": 125000.0,
        "graduationPct": 61.25,
        "launched": false,
        "bundleBuyers": 3,
        "bundleFlag": true
    }"#;

    let traders = r#"[{
        "address": "0x2222222222222222222222222222222222222222",
        "username": "bob",
        "avatar": null,
        "realizedPnlUsd": 1000.0,
        "unrealizedPnlUsd": 250.5,
        "totalPnlUsd": 1250.5,
        "volumeUsd": 50000.0,
        "isCreator": true
    }]"#;

    let server = StubServer::start(vec![
        StubResponse::ok(wallet),
        StubResponse::ok(portfolio),
        StubResponse::ok(analytics),
        StubResponse::ok(traders),
    ])
    .await;
    let client = client_for(&server);

    let wallet = client.get_wallet("0x1111").await.unwrap();
    assert_eq!(wallet.win_rate, 0.62);
    assert_eq!(wallet.tokens_traded, 8);
    assert_eq!(wallet.trade_count, 42);
    assert_eq!(wallet.holding_value_usd, 900.75);
    assert_eq!(wallet.roi_pct, 12.3);
    assert_eq!(server.request(0).path(), "/wallet/0x1111");

    let portfolio = client.get_portfolio("0x1111").await.unwrap();
    assert_eq!(portfolio.total_value_usd, 900.75);
    assert_eq!(portfolio.positions[0].avg_buy_price_usd, 0.00095);
    assert_eq!(portfolio.positions[0].unrealized_pnl_pct, -5.3);
    assert_eq!(portfolio.positions[0].current_price_usd, 0.0009);
    assert_eq!(portfolio.positions[0].image, None);

    let analytics = client.get_token_analytics("bsc", "0x23a8").await.unwrap();
    assert_eq!(analytics.top10_pct, 34.5, "`top10Pct` is not `top10_pct`'s obvious camelCase");
    assert_eq!(analytics.creator_pct, 2.1);
    assert_eq!(analytics.graduation_pct, 61.25);
    assert_eq!(analytics.bundle_buyers, 3);
    assert!(analytics.bundle_flag);
    assert!(!analytics.launched);
    assert_eq!(server.request(2).path(), "/analytics/token/bsc/0x23a8");

    let traders = client.get_top_traders("bsc", "0x23a8").await.unwrap();
    assert!(traders[0].is_creator);
    assert_eq!(traders[0].total_pnl_usd, 1250.5);
    assert_eq!(server.request(3).path(), "/analytics/top-traders/bsc/0x23a8");
}

