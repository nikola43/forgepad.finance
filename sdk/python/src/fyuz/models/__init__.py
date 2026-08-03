"""Response models for the Fyuz public API.

Every model is a frozen :func:`~dataclasses.dataclass` with a ``from_dict``
classmethod that maps the API's camelCase JSON onto snake_case attributes and
**ignores unknown fields**, so a server-side addition never breaks a deployed
client.

Collection fields are tuples rather than lists, because the models are frozen
and a tuple keeps them genuinely immutable (and hashable). Client methods that
map to a bare JSON array return a plain ``list``.
"""

from __future__ import annotations

from .analytics import (
    Portfolio,
    PortfolioPosition,
    TokenAnalytics,
    TopTrader,
    WalletStats,
)
from .distributor import (
    AddressPayouts,
    Claimable,
    PayoutLine,
    PayoutStats,
    Pot,
    RoundDetail,
    RoundReceipt,
    ShareEntry,
    Shares,
)
from .rewards import AchievementState, QuestState, Rewards, TierInfo
from .seasons import KingReign, Season, SeasonEntry
from .system import ChainConfig, ChainInfo, CreatorInfo, HealthStatus
from .tokens import DiscoverToken, Holder, Token, TokenDetail, TokenPage
from .trades import Candle, RecentTrades, Trade
from .users import (
    ChatMessage,
    LeaderboardEntry,
    ReferralLeaderEntry,
    TopHolderEntry,
    UserProfile,
    UserSummary,
)

__all__ = [
    # system
    "HealthStatus",
    "ChainInfo",
    "ChainConfig",
    "CreatorInfo",
    # market data
    "Token",
    "TokenPage",
    "DiscoverToken",
    "Holder",
    "TokenDetail",
    # trades
    "Trade",
    "Candle",
    "RecentTrades",
    # analytics & wallets
    "TokenAnalytics",
    "TopTrader",
    "WalletStats",
    "PortfolioPosition",
    "Portfolio",
    # users & leaderboards
    "LeaderboardEntry",
    "UserSummary",
    "ChatMessage",
    "UserProfile",
    "TopHolderEntry",
    "ReferralLeaderEntry",
    # kings & seasons
    "KingReign",
    "SeasonEntry",
    "Season",
    # rewards
    "TierInfo",
    "QuestState",
    "AchievementState",
    "Rewards",
    # distributor
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
