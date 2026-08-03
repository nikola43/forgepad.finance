"""King-of-the-hill and season models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple

from .._convert import as_mapping, opt_int, opt_str, req_float, req_int, req_str, tuple_of

__all__ = ["KingReign", "SeasonEntry", "Season"]


@dataclass(frozen=True)
class KingReign:
    """One King-of-the-Hill reign, from ``GET /kings/history``.

    Attributes:
        token_address: The token that held the crown.
        name: Token name.
        symbol: Ticker.
        image: Image URL, or ``None``.
        network: Chain slug.
        started_at: Reign start, UNIX seconds.
        ended_at: Reign end, UNIX seconds. ``None`` while the reign is ongoing
            — that is a live crown, not a zero-length reign.
        duration_secs: Reign length in seconds. Ongoing reigns count up to now.
    """

    token_address: str = ""
    name: str = ""
    symbol: str = ""
    image: Optional[str] = None
    network: str = ""
    started_at: int = 0
    ended_at: Optional[int] = None
    duration_secs: int = 0

    @property
    def ongoing(self) -> bool:
        """``True`` while this token still holds the crown."""
        return self.ended_at is None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> KingReign:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            token_address=req_str(d, "tokenAddress"),
            name=req_str(d, "name"),
            symbol=req_str(d, "symbol"),
            image=opt_str(d, "image"),
            network=req_str(d, "network"),
            started_at=req_int(d, "startedAt"),
            ended_at=opt_int(d, "endedAt"),
            duration_secs=req_int(d, "durationSecs"),
        )


@dataclass(frozen=True)
class SeasonEntry:
    """One row of the season standings.

    Attributes:
        rank: 1-based, in returned order.
        address: Wallet address.
        username: Display name, or ``None``.
        avatar: Avatar URL, or ``None``.
        points: Season points.
    """

    rank: int = 0
    address: str = ""
    username: Optional[str] = None
    avatar: Optional[str] = None
    points: float = 0.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> SeasonEntry:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            rank=req_int(d, "rank"),
            address=req_str(d, "address"),
            username=opt_str(d, "username"),
            avatar=opt_str(d, "avatar"),
            points=req_float(d, "points"),
        )


@dataclass(frozen=True)
class Season:
    """Response of ``GET /season`` — window, prize pot and standings.

    Attributes:
        name: Season name, e.g. ``"Season 1"``.
        starts_at: Season start, UNIX seconds.
        ends_at: Season end, UNIX seconds.
        prize_pot_eth: Prize pot in BNB.
        leaderboard: Top 50 with positive points, highest first.
    """

    name: str = ""
    starts_at: int = 0
    ends_at: int = 0
    prize_pot_eth: float = 0.0
    leaderboard: Tuple[SeasonEntry, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Season:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            name=req_str(d, "name"),
            starts_at=req_int(d, "startsAt"),
            ends_at=req_int(d, "endsAt"),
            prize_pot_eth=req_float(d, "prizePotEth"),
            leaderboard=tuple_of(d, "leaderboard", SeasonEntry.from_dict),
        )
