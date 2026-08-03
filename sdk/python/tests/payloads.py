"""Sample API payloads, shaped exactly like the wire format in openapi.json."""

from __future__ import annotations

from typing import Any, Dict, List

CREATOR: Dict[str, Any] = {
    "address": "0x0000000000000000000000000000000000000001",
    "username": "satoshi",
    "avatar": "https://cdn.fyuz.fun/a/1.png",
}

TOKEN: Dict[str, Any] = {
    "id": 42,
    "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
    "tokenName": "Pepe Forever",
    "tokenSymbol": "PEPE",
    "tokenDescription": "a frog",
    "imageStyle": "pixel",
    "tokenImage": "https://cdn.fyuz.fun/t/42.png",
    "tokenBanner": None,
    "creatorAddress": "0x0000000000000000000000000000000000000001",
    "user": CREATOR,
    "network": "bsc",
    "marketcap": "4472.899483094470000000",
    "price": "0.000004472899483094",
    "ethPrice": "612.430000000000000000",
    "volume": "18231.554000000000000000",
    "score": "88.500000000000000000",
    "virtualEthAmount": "7.300000000000000000",
    "virtualTokenAmount": "1073000000.000000000000000000",
    "pairAddress": None,
    "poolType": 1,
    "category": "meme",
    "replies": 17,
    "webLink": "https://pepe.example",
    "telegramLink": None,
    "twitterLink": None,
    "launchedAt": None,
    "createdAt": "2026-07-28T12:00:00Z",
    "updatedAt": "2026-07-28T12:30:00Z",
    "creationTime": "2026-07-28T12:00:00Z",
    "liquidity": "7.300000000000000000",
    "progress": 14.909664943648233,
    "priceChange": -3.2,
    "price15m": 4.4e-06,
    "priceChange15m": 1.4,
}

TRADE: Dict[str, Any] = {
    "id": 90210,
    "tokenName": "Pepe Forever",
    "tokenSymbol": "PEPE",
    "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
    "tokenImage": "https://cdn.fyuz.fun/t/42.png",
    "swapperAddress": "0x00000000000000000000000000000000000000f0",
    "swapperUsername": None,
    "swapperAvatar": None,
    "type": "buy",
    "ethAmount": "0.150000000000000000",
    "tokenAmount": "21739130.434782608695652174",
    "network": "bsc",
    "date": 1_753_086_000,
    "txHash": "0xabc123",
    "tokenPrice": "0.000004472899483094",
    "ethPrice": "612.430000000000000000",
}

HOLDER: Dict[str, Any] = {
    "id": 7,
    "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
    "holderAddress": "0x00000000000000000000000000000000000000f0",
    "tokenAmount": "1000000.000000000000000000",
    "tokenName": "Pepe Forever",
    "tokenSymbol": "PEPE",
    "tokenImage": None,
    "marketcap": "4472.899483094470000000",
    "network": "bsc",
    "creatorAddress": "0x0000000000000000000000000000000000000001",
    "user": CREATOR,
}

TOKEN_DETAIL: Dict[str, Any] = {
    "tokenDetails": TOKEN,
    "trades": [TRADE],
    "tradesCount": 2,
    "holdersDetails": [HOLDER],
    "fifteenMinPrice": "0.000004400000000000",
    "oneDayLiquidity": "7.100000000000000000",
    "curveHolding": None,
}

DISCOVER_TOKEN: Dict[str, Any] = {
    "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
    "name": "Pepe Forever",
    "symbol": "PEPE",
    "image": "https://cdn.fyuz.fun/t/42.png",
    "network": "bsc",
    "creatorAddress": "0x0000000000000000000000000000000000000001",
    "marketcap": 4472.89948309447,
    "priceUsd": 4.472899483094e-06,
    "createdAt": 1_753_000_000,
    "launched": False,
    "volume24h": 18231.554,
    "buys24h": 61,
    "sells24h": 24,
    "holders": 412,
    "priceChange24h": -3.2,
    "graduationPct": 14.909664943648233,
}

CANDLE: Dict[str, Any] = {
    "time": 1_753_000_000,
    "open": 4.4e-05,
    "high": 4.9e-05,
    "low": 4.3e-05,
    "close": 4.7e-05,
    "volume": 1820.5,
}

TOKEN_ANALYTICS: Dict[str, Any] = {
    "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
    "network": "bsc",
    "holderCount": 412,
    "top10Pct": 38.4,
    "creatorPct": 4.1,
    "buys": 61,
    "sells": 24,
    "volumeUsd": 18231.554,
    "graduationPct": 14.909664943648233,
    "launched": False,
    "bundleBuyers": 3,
    "bundleFlag": True,
}

TOP_TRADER: Dict[str, Any] = {
    "address": "0x0000000000000000000000000000000000000001",
    "username": "satoshi",
    "avatar": None,
    "realizedPnlUsd": 1200.25,
    "unrealizedPnlUsd": 620.25,
    "totalPnlUsd": 1820.5,
    "volumeUsd": 9000.0,
    "isCreator": True,
}

WALLET_STATS: Dict[str, Any] = {
    "address": "0x00000000000000000000000000000000000000f0",
    "username": "satoshi",
    "avatar": None,
    "volumeUsd": 51230.75,
    "realizedPnlUsd": 812.4,
    "unrealizedPnlUsd": 415.6,
    "totalPnlUsd": 1228.0,
    "roiPct": 22.7,
    "winRate": 0.58,
    "tokensTraded": 12,
    "tradeCount": 87,
    "holdingValueUsd": 3120.9,
}

PORTFOLIO: Dict[str, Any] = {
    "address": "0x00000000000000000000000000000000000000f0",
    "totalValueUsd": 3120.9,
    "totalCostUsd": 2210.4,
    "unrealizedPnlUsd": 910.5,
    "realizedPnlUsd": 812.4,
    "totalPnlUsd": 1722.9,
    "roiPct": 41.2,
    "positions": [
        {
            "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
            "name": "Pepe Forever",
            "symbol": "PEPE",
            "image": None,
            "network": "bsc",
            "balance": 1000000.0,
            "currentPriceUsd": 4.472899483094e-06,
            "valueUsd": 4.472899483094,
            "costUsd": 3.1,
            "avgBuyPriceUsd": 3.1e-06,
            "unrealizedPnlUsd": 1.372899483094,
            "unrealizedPnlPct": 44.3,
            "realizedPnlUsd": 0.0,
        }
    ],
}

LEADERBOARD_ENTRY: Dict[str, Any] = {
    "rank": 1,
    "address": "0x00000000000000000000000000000000000000f0",
    "username": "satoshi",
    "avatar": None,
    "volumeUsd": 51230.75,
    "trades": 87,
    "points": 1284.5,
    "pointsTotal": 1394.5,
    "pointsProjected": 1500.0,
    "heldUsd": 3120.9,
    "rewardEth": 0.0421,
}

CHAT_MESSAGE: Dict[str, Any] = {
    "id": 5,
    "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
    "replyAddress": None,
    "comment": "wen graduation",
    "code": None,
    "date": "2026-07-28T13:00:00Z",
    "network": "bsc",
}

USER_PROFILE: Dict[str, Any] = {
    "user": {
        "id": 1,
        "address": "0x00000000000000000000000000000000000000f0",
        "username": "satoshi",
        "avatar": None,
        "bio": "just here for the curve",
        "likes": 12,
        "isAdmin": False,
        "twitterUsername": "satoshi",
    },
    "holdings": [HOLDER],
    "chats": [CHAT_MESSAGE],
    "createdTokens": [TOKEN],
    "followers": 31,
    "followees": 8,
    "referralCount": 4,
    "points": 220,
    "tradingPoints": 1284.5,
    "tradingVolumeUsd": 51230.75,
    "rewardEth": 0.0421,
}

TOP_HOLDER: Dict[str, Any] = {
    "address": "0x00000000000000000000000000000000000000f0",
    "username": "satoshi",
    "avatar": None,
    "volume": 51230.75,
}

KINGS_HISTORY: List[Dict[str, Any]] = [
    {
        "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
        "name": "Pepe Forever",
        "symbol": "PEPE",
        "image": None,
        "network": "bsc",
        "startedAt": 1_753_086_000,
        "endedAt": None,
        "durationSecs": 400,
    },
    {
        "tokenAddress": "0x1111111111111111111111111111111111111111",
        "name": "Doge Again",
        "symbol": "DOGE2",
        "image": None,
        "network": "bsc",
        "startedAt": 1_753_000_000,
        "endedAt": 1_753_003_600,
        "durationSecs": 3600,
    },
]

SEASON: Dict[str, Any] = {
    "name": "Season 1",
    "startsAt": 1_752_000_000,
    "endsAt": 1_754_000_000,
    "prizePotEth": 12.5,
    "leaderboard": [
        {
            "rank": 1,
            "address": "0x00000000000000000000000000000000000000f0",
            "username": "satoshi",
            "avatar": None,
            "points": 1284.5,
        },
        {
            "rank": 2,
            "address": "0x0000000000000000000000000000000000000001",
            "username": None,
            "avatar": None,
            "points": 940.25,
        },
    ],
}

REFERRAL_ENTRY: Dict[str, Any] = {
    "rank": 1,
    "address": "0x00000000000000000000000000000000000000f0",
    "username": "satoshi",
    "avatar": None,
    "referralCount": 9,
    "refereeVolumeUsd": 88120.4,
}

TIER: Dict[str, Any] = {
    "address": "0x00000000000000000000000000000000000000f0",
    "volumeUsd": 512.3,
    "tier": "Silver",
    "nextTier": "Gold",
    "nextThresholdUsd": 1000.0,
    "progressPct": 45.8,
}

TIER_DIAMOND: Dict[str, Any] = {
    "address": "0x00000000000000000000000000000000000000d1",
    "volumeUsd": 51230.75,
    "tier": "Diamond",
    "nextTier": None,
    "nextThresholdUsd": None,
    "progressPct": 100.0,
}

REWARDS: Dict[str, Any] = {
    "address": "0x00000000000000000000000000000000000000f0",
    "currentStreak": 4,
    "longestStreak": 11,
    "points": 1284.5,
    "bonusPoints": 110.0,
    "quests": [
        {
            "key": "daily_trade",
            "title": "Daily trade",
            "description": "Make one trade today",
            "kind": "daily",
            "target": 1.0,
            "progress": 1.0,
            "points": 10.0,
            "completed": True,
            "claimed": True,
        }
    ],
    "achievements": [
        {
            "key": "diamond_hands",
            "title": "Diamond hands",
            "description": "Hold a position for 30 days",
            "icon": "gem",
            "points": 250.0,
            "earned": False,
        }
    ],
}

PAYOUT_STATS: Dict[str, Any] = {
    "totalPaidWei": "1250000000000000000",
    "roundsSettled": 6,
    "uniqueRecipients": 118,
    "largestPayoutWei": "700000000000000000",
    "lastRoundAt": 1_753_003_600,
}

POT: Dict[str, Any] = {
    "potBnb": 3.14159,
    "distributeBps": 9000.0,
    "roundEnd": 1_753_090_000,
    "totalPoints": 98765.4,
    "pointsPerUsd": 1.0,
}

POT_UNKNOWN: Dict[str, Any] = {
    "potBnb": None,
    "distributeBps": 9000.0,
    "roundEnd": 1_753_090_000,
    "totalPoints": None,
    "pointsPerUsd": 1.0,
}

SHARES: Dict[str, Any] = {
    "from": 1_753_000_000,
    "to": 1_753_086_400,
    "totalPoints": 2224.75,
    "holders": [
        {
            "address": "0x00000000000000000000000000000000000000f0",
            "points": 1284.5,
            "share": 2_576_980_377,
        },
        {
            "address": "0x0000000000000000000000000000000000000001",
            "points": 940.25,
            "share": 1_717_986_918,
        },
    ],
    "packed": "0x00000000000000000000000000000000000000f099999999",
}

ROUND_RECEIPT: Dict[str, Any] = {
    "roundId": 6,
    "timeStart": 1_753_000_000,
    "timeEnd": 1_753_003_600,
    "txHash": "0xdeadbeef",
    "potWei": "1250000000000000000",
    "distributedWei": "1125000000000000000",
    "winnerAddress": "0x0000000000000000000000000000000000000001",
    "winnerAmountWei": "125000000000000000",
    "holderCount": 2,
    "vrfRandom": "77985133986447848905248117107615823884",
    "distributedAt": 1_753_003_610,
}

PAYOUT_LINES: List[Dict[str, Any]] = [
    {
        "roundId": 6,
        "address": "0x00000000000000000000000000000000000000f0",
        "share": 2_576_980_377,
        "amountWei": "700000000000000000",
        "username": "satoshi",
        "avatar": None,
    },
    {
        "roundId": 6,
        "address": "0x0000000000000000000000000000000000000001",
        "share": 1_717_986_918,
        "amountWei": "425000000000000000",
        "username": None,
        "avatar": None,
    },
]

# Flattened on the wire: receipt fields sit next to `payouts`, not under a
# nested `round` key.
ROUND_DETAIL: Dict[str, Any] = dict(ROUND_RECEIPT, payouts=PAYOUT_LINES)

ADDRESS_PAYOUTS: Dict[str, Any] = {
    "address": "0x00000000000000000000000000000000000000f0",
    "totalWei": "700000000000000000",
    "roundsPaid": 1,
    "payouts": [PAYOUT_LINES[0]],
}

CLAIMABLE: Dict[str, Any] = {
    "address": "0x00000000000000000000000000000000000000f0",
    "claimableWei": "40000000000000000",
    "distributorAddress": "0xd15721b0",
}
