"""User, profile and leaderboard models.

``rank`` on every leaderboard is a **server-assigned 1-based ordinal in the
returned order**. Do not re-sort client-side: the server's ordering is the one
the payout logic uses.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple

from .._convert import (
    as_mapping,
    opt_bool,
    opt_model,
    opt_str,
    req_float,
    req_int,
    req_str,
    tuple_of,
)
from .tokens import Holder, Token

__all__ = [
    "LeaderboardEntry",
    "UserSummary",
    "ChatMessage",
    "UserProfile",
    "TopHolderEntry",
    "ReferralLeaderEntry",
]


@dataclass(frozen=True)
class LeaderboardEntry:
    """One row of ``GET /users/leaderboard``.

    The board resets after every Distributor payout: only activity since the
    last settled round counts.

    Attributes:
        rank: 1-based, in returned order.
        address: Wallet address.
        username: Display name, or ``None``.
        avatar: Avatar URL, or ``None``.
        volume_usd: USD volume in the current round window.
        trades: Trade count in the current round window.
        points: Points that count toward the payout share — the exact number
            served to the Distributor.
        points_total: Total points earned including locked grants. Always
            ``>= points``. Display only.
        points_projected: Points at round close if the current position is
            held. Guidance, not a payout.
        held_usd: USD value currently held.
        reward_eth: Estimated BNB slice of the live pot:
            ``90% x pot x (points / payout-set points)``. ``0`` when below the
            payout floor.
    """

    rank: int = 0
    address: str = ""
    username: Optional[str] = None
    avatar: Optional[str] = None
    volume_usd: float = 0.0
    trades: int = 0
    points: float = 0.0
    points_total: float = 0.0
    points_projected: float = 0.0
    held_usd: float = 0.0
    reward_eth: float = 0.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> LeaderboardEntry:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            rank=req_int(d, "rank"),
            address=req_str(d, "address"),
            username=opt_str(d, "username"),
            avatar=opt_str(d, "avatar"),
            volume_usd=req_float(d, "volumeUsd"),
            trades=req_int(d, "trades"),
            points=req_float(d, "points"),
            points_total=req_float(d, "pointsTotal"),
            points_projected=req_float(d, "pointsProjected"),
            held_usd=req_float(d, "heldUsd"),
            reward_eth=req_float(d, "rewardEth"),
        )


@dataclass(frozen=True)
class UserSummary:
    """Public profile record.

    Attributes:
        id: Internal numeric id.
        address: Wallet address.
        username: Display name, or ``None``.
        avatar: Avatar URL, or ``None``.
        bio: Free-text bio, or ``None``.
        likes: Profile likes.
        is_admin: ``True`` for staff accounts; ``None`` when unset.
        twitter_username: X/Twitter handle without the ``@``, or ``None``.
    """

    id: int = 0
    address: str = ""
    username: Optional[str] = None
    avatar: Optional[str] = None
    bio: Optional[str] = None
    likes: int = 0
    is_admin: Optional[bool] = None
    twitter_username: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> UserSummary:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            id=req_int(d, "id"),
            address=req_str(d, "address"),
            username=opt_str(d, "username"),
            avatar=opt_str(d, "avatar"),
            bio=opt_str(d, "bio"),
            likes=req_int(d, "likes"),
            is_admin=opt_bool(d, "isAdmin"),
            twitter_username=opt_str(d, "twitterUsername"),
        )


@dataclass(frozen=True)
class ChatMessage:
    """A comment posted by a user on a token page.

    Attributes:
        id: Internal numeric id.
        token_address: Token the comment belongs to.
        reply_address: Always ``None`` on the public profile endpoint.
        comment: Comment text.
        code: Optional attachment code, or ``None``.
        date: RFC-3339 timestamp (this one is *not* UNIX seconds).
        network: Chain slug.
    """

    id: int = 0
    token_address: str = ""
    reply_address: Optional[str] = None
    comment: str = ""
    code: Optional[str] = None
    date: str = ""
    network: str = ""

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ChatMessage:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            id=req_int(d, "id"),
            token_address=req_str(d, "tokenAddress"),
            reply_address=opt_str(d, "replyAddress"),
            comment=req_str(d, "comment"),
            code=opt_str(d, "code"),
            date=req_str(d, "date"),
            network=req_str(d, "network"),
        )


@dataclass(frozen=True)
class UserProfile:
    """Response of ``GET /users/profile/{address}``.

    Attributes:
        user: Identity record, or ``None`` when omitted.
        holdings: Current positive balances.
        chats: Comments, newest first, max 50.
        created_tokens: Tokens launched by this address, newest first.
        followers: Follower count.
        followees: Following count.
        referral_count: Active referrals only.
        points: Referral earnings ledger balance.
        trading_points: Points in the current round window; matches the
            leaderboard's ``points``.
        trading_volume_usd: USD volume in the current round window.
        reward_eth: Estimated BNB slice of the live pot.
    """

    user: Optional[UserSummary] = None
    holdings: Tuple[Holder, ...] = ()
    chats: Tuple[ChatMessage, ...] = ()
    created_tokens: Tuple[Token, ...] = ()
    followers: int = 0
    followees: int = 0
    referral_count: int = 0
    points: int = 0
    trading_points: float = 0.0
    trading_volume_usd: float = 0.0
    reward_eth: float = 0.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> UserProfile:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            user=opt_model(d, "user", UserSummary.from_dict),
            holdings=tuple_of(d, "holdings", Holder.from_dict),
            chats=tuple_of(d, "chats", ChatMessage.from_dict),
            created_tokens=tuple_of(d, "createdTokens", Token.from_dict),
            followers=req_int(d, "followers"),
            followees=req_int(d, "followees"),
            referral_count=req_int(d, "referralCount"),
            points=req_int(d, "points"),
            trading_points=req_float(d, "tradingPoints"),
            trading_volume_usd=req_float(d, "tradingVolumeUsd"),
            reward_eth=req_float(d, "rewardEth"),
        )


@dataclass(frozen=True)
class TopHolderEntry:
    """One row of ``GET /users/top/{count}`` — a wallet ranked by USD volume.

    Attributes:
        address: Wallet address.
        username: Display name, or ``None``.
        avatar: Avatar URL, or ``None``.
        volume: USD trading volume over the requested window.
    """

    address: str = ""
    username: Optional[str] = None
    avatar: Optional[str] = None
    volume: float = 0.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> TopHolderEntry:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            address=req_str(d, "address"),
            username=opt_str(d, "username"),
            avatar=opt_str(d, "avatar"),
            volume=req_float(d, "volume"),
        )


@dataclass(frozen=True)
class ReferralLeaderEntry:
    """One row of ``GET /referrals/leaderboard``.

    Only ACTIVE referrals (the referee has cleared the net-buy floor) count.

    Attributes:
        rank: 1-based, in returned order.
        address: Referrer wallet.
        username: Display name, or ``None``.
        avatar: Avatar URL, or ``None``.
        referral_count: Active referrals only.
        referee_volume_usd: USD volume traded by the referees.
    """

    rank: int = 0
    address: str = ""
    username: Optional[str] = None
    avatar: Optional[str] = None
    referral_count: int = 0
    referee_volume_usd: float = 0.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ReferralLeaderEntry:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            rank=req_int(d, "rank"),
            address=req_str(d, "address"),
            username=opt_str(d, "username"),
            avatar=opt_str(d, "avatar"),
            referral_count=req_int(d, "referralCount"),
            referee_volume_usd=req_float(d, "refereeVolumeUsd"),
        )
