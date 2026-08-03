//! JSON bodies shaped exactly like the ones `backend-rs` serialises.

#![allow(dead_code)]

/// A full `Token` record. `marketcap` is caller-supplied so tests can push an
/// exact decimal string through and check it comes back byte-identical.
pub fn token(symbol: &str, marketcap: &str) -> String {
    format!(
        r#"{{
            "id": 42,
            "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
            "tokenName": "Test Token",
            "tokenSymbol": "{symbol}",
            "tokenDescription": null,
            "imageStyle": null,
            "tokenImage": null,
            "tokenBanner": null,
            "creatorAddress": "0x1111111111111111111111111111111111111111",
            "user": {{
                "address": "0x1111111111111111111111111111111111111111",
                "username": null,
                "avatar": null
            }},
            "network": "bsc",
            "marketcap": "{marketcap}",
            "price": "0.000000000000000123",
            "ethPrice": "612.123456789012345678",
            "volume": "1234.567890123456789012",
            "score": "9.9",
            "virtualEthAmount": "30.000000000000000001",
            "virtualTokenAmount": "1073000000.000000000000000001",
            "pairAddress": null,
            "poolType": 1,
            "category": "meme",
            "replies": 3,
            "webLink": null,
            "telegramLink": null,
            "twitterLink": null,
            "launchedAt": null,
            "createdAt": "2026-07-01T12:00:00Z",
            "updatedAt": "2026-07-01T12:05:00Z",
            "creationTime": "2026-07-01T11:59:00Z",
            "liquidity": null,
            "progress": 42.5,
            "priceChange": -1.25,
            "price15m": 0.00000012,
            "priceChange15m": 0.5
        }}"#
    )
}

/// `GET /tokens/king` wraps the token in a `king` envelope.
pub fn king_envelope(token_json: &str) -> String {
    format!(r#"{{"king": {token_json}}}"#)
}

/// The envelope the server sends when nothing is on the hill.
pub fn king_empty() -> String {
    r#"{"king": null}"#.to_string()
}

/// The same record with `price15m` / `priceChange15m` omitted, which is what the
/// server sends when it cannot compute them.
pub fn token_without_15m() -> String {
    let full = token("TEST", "12345.6789");
    full.lines()
        .filter(|line| !line.contains("price15m") && !line.contains("priceChange15m"))
        .collect::<Vec<_>>()
        .join("\n")
        .replace("\"priceChange\": -1.25,", "\"priceChange\": -1.25")
}

/// A `Holder` row, as served inside a token detail or a user profile.
pub fn holder() -> String {
    r#"{
        "id": 5,
        "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
        "holderAddress": "0x1111111111111111111111111111111111111111",
        "tokenAmount": "1000000.000000000000000001",
        "tokenName": "Test Token",
        "tokenSymbol": "TEST",
        "tokenImage": null,
        "marketcap": "12345.6789",
        "network": "bsc",
        "creatorAddress": "0x1111111111111111111111111111111111111111",
        "user": {
            "address": "0x1111111111111111111111111111111111111111",
            "username": null,
            "avatar": null
        }
    }"#
    .to_string()
}

/// One page of `GET /tokens`.
pub fn token_page(symbols: &[&str], total: usize) -> String {
    let list = symbols
        .iter()
        .map(|s| token(s, "12345.6789"))
        .collect::<Vec<_>>()
        .join(",");
    format!(r#"{{"tokenList":[{list}],"tokenCount":{total}}}"#)
}

/// A `Trade` with a caller-chosen `type`, so the tolerant enum can be exercised.
pub fn trade(side: &str) -> String {
    format!(
        r#"{{
            "id": 7,
            "tokenName": "Test Token",
            "tokenSymbol": "TEST",
            "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
            "tokenImage": null,
            "swapperAddress": "0x2222222222222222222222222222222222222222",
            "swapperUsername": null,
            "swapperAvatar": null,
            "type": "{side}",
            "ethAmount": "0.123456789012345678",
            "tokenAmount": "1000000.000000000000000001",
            "network": "bsc",
            "date": 1750000000,
            "txHash": "0xfeed",
            "tokenPrice": "0.000000000000000123",
            "ethPrice": "612.12"
        }}"#
    )
}

/// `GET /distributor/stats`, with wei totals well past `2^53`.
pub fn payout_stats(total_paid_wei: &str, largest_payout_wei: &str) -> String {
    format!(
        r#"{{
            "totalPaidWei": "{total_paid_wei}",
            "roundsSettled": 12,
            "uniqueRecipients": 340,
            "largestPayoutWei": "{largest_payout_wei}",
            "lastRoundAt": 1750000000
        }}"#
    )
}

/// `GET /distributor/rounds/{{id}}` — receipt fields flattened next to `payouts`.
pub fn round_detail() -> String {
    r#"{
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
        "distributedAt": 1750000100,
        "payouts": [
            {
                "roundId": 7,
                "address": "0x2222222222222222222222222222222222222222",
                "share": 2147483648,
                "amountWei": "555555555555555555555",
                "username": "alice",
                "avatar": null
            },
            {
                "roundId": 7,
                "address": "0x3333333333333333333333333333333333333333",
                "share": 2147483647,
                "amountWei": "555555555555555555556",
                "username": null,
                "avatar": null
            }
        ]
    }"#
    .to_string()
}
