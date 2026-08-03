"""fyuz — a typed, dependency-free Python client for the Fyuz public API.

Fyuz is a bonding-curve token launchpad on BNB Smart Chain. Tokens trade on an
internal bonding curve until they reach a $30,000 market cap, at which point
they *graduate* into a PancakeSwap V2 pair. **Before graduation there is no DEX
pool anywhere**, so this API is the only source of price and liquidity data for
a pre-graduation token.

Quickstart::

    from fyuz import FyuzClient

    with FyuzClient() as fyuz:
        for token in fyuz.discover(tab="trending", limit=10):
            print(token.symbol, token.marketcap, token.graduation_pct)

Precision: token amounts, prices, market caps and every ``*_wei`` value come
back as **decimal strings** and stay strings in the models. Parsing them into
``float`` silently loses digits on 18-decimal values. Use :func:`to_decimal` or
:func:`wei_to_bnb` when you need arithmetic.
"""

from __future__ import annotations

from ._http import (
    DEFAULT_BACKOFF_INITIAL,
    DEFAULT_BACKOFF_MAX,
    DEFAULT_BASE_URL,
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT,
    USER_AGENT,
)
from ._version import __version__
from .client import FyuzClient
from .distributor import DistributorAPI
from .errors import (
    FyuzAPIError,
    FyuzConnectionError,
    FyuzDecodeError,
    FyuzError,
    FyuzNotFoundError,
    FyuzRateLimitError,
)
from .helpers import from_unix, parse_datetime, to_decimal, wei_to_bnb
from .models import (
    AchievementState,
    AddressPayouts,
    Candle,
    ChainConfig,
    ChainInfo,
    ChatMessage,
    Claimable,
    CreatorInfo,
    DiscoverToken,
    HealthStatus,
    Holder,
    KingReign,
    LeaderboardEntry,
    PayoutLine,
    PayoutStats,
    Portfolio,
    PortfolioPosition,
    Pot,
    QuestState,
    RecentTrades,
    ReferralLeaderEntry,
    Rewards,
    RoundDetail,
    RoundReceipt,
    Season,
    SeasonEntry,
    ShareEntry,
    Shares,
    TierInfo,
    Token,
    TokenAnalytics,
    TokenDetail,
    TokenPage,
    TopHolderEntry,
    TopTrader,
    Trade,
    UserProfile,
    UserSummary,
    WalletStats,
)

__all__ = [
    "__version__",
    # client
    "FyuzClient",
    "DistributorAPI",
    "DEFAULT_BASE_URL",
    "DEFAULT_TIMEOUT",
    "DEFAULT_MAX_RETRIES",
    "DEFAULT_BACKOFF_INITIAL",
    "DEFAULT_BACKOFF_MAX",
    "USER_AGENT",
    # errors
    "FyuzError",
    "FyuzAPIError",
    "FyuzRateLimitError",
    "FyuzNotFoundError",
    "FyuzConnectionError",
    "FyuzDecodeError",
    # helpers
    "to_decimal",
    "wei_to_bnb",
    "parse_datetime",
    "from_unix",
    # models
    "HealthStatus",
    "ChainInfo",
    "ChainConfig",
    "CreatorInfo",
    "Token",
    "TokenPage",
    "DiscoverToken",
    "Holder",
    "TokenDetail",
    "Trade",
    "Candle",
    "RecentTrades",
    "TokenAnalytics",
    "TopTrader",
    "WalletStats",
    "PortfolioPosition",
    "Portfolio",
    "LeaderboardEntry",
    "UserSummary",
    "ChatMessage",
    "UserProfile",
    "TopHolderEntry",
    "ReferralLeaderEntry",
    "KingReign",
    "SeasonEntry",
    "Season",
    "TierInfo",
    "QuestState",
    "AchievementState",
    "Rewards",
    "PayoutStats",
    "Pot",
    "ShareEntry",
    "Shares",
    "RoundReceipt",
    "PayoutLine",
    "RoundDetail",
    "AddressPayouts",
    "Claimable",
]
