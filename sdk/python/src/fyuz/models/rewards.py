"""Tier, quest, achievement and rewards models.

Rewards are granted automatically by the indexer as they are earned — there is
no claim step anywhere on this public surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple

from .._convert import (
    as_mapping,
    opt_float,
    opt_str,
    req_bool,
    req_float,
    req_int,
    req_str,
    tuple_of,
)

__all__ = ["TierInfo", "QuestState", "AchievementState", "Rewards"]


@dataclass(frozen=True)
class TierInfo:
    """Response of ``GET /tier/{address}``.

    Display-only trader tier derived from lifetime USD trade volume.
    Thresholds: Bronze (0), Silver (100), Gold (1,000), Diamond (10,000).

    Attributes:
        address: Wallet address, lower-cased by the server.
        volume_usd: Lifetime USD trade volume.
        tier: One of ``"Bronze"``, ``"Silver"``, ``"Gold"``, ``"Diamond"``.
        next_tier: Next tier name, or ``None`` at Diamond.
        next_threshold_usd: Volume needed for the next tier, or ``None`` at
            Diamond.
        progress_pct: Progress toward the next tier, 0-100. ``100`` at Diamond.
    """

    address: str = ""
    volume_usd: float = 0.0
    tier: str = ""
    next_tier: Optional[str] = None
    next_threshold_usd: Optional[float] = None
    progress_pct: float = 0.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> TierInfo:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            address=req_str(d, "address"),
            volume_usd=req_float(d, "volumeUsd"),
            tier=req_str(d, "tier"),
            next_tier=opt_str(d, "nextTier"),
            next_threshold_usd=opt_float(d, "nextThresholdUsd"),
            progress_pct=req_float(d, "progressPct"),
        )


@dataclass(frozen=True)
class QuestState:
    """A quest and one address's progress against it.

    Attributes:
        key: Stable quest key, e.g. ``"daily_trade"``.
        title: Display title.
        description: Display description.
        kind: Quest cadence, e.g. ``"daily"`` or ``"oneoff"``.
        target: Value that completes the quest.
        progress: Current progress, clamped to ``target``.
        points: Points awarded on completion.
        completed: ``True`` once ``progress`` reached ``target``.
        claimed: Granted automatically by the indexer — there is no claim call
            on this public surface.
    """

    key: str = ""
    title: str = ""
    description: str = ""
    kind: str = ""
    target: float = 0.0
    progress: float = 0.0
    points: float = 0.0
    completed: bool = False
    claimed: bool = False

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> QuestState:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            key=req_str(d, "key"),
            title=req_str(d, "title"),
            description=req_str(d, "description"),
            kind=req_str(d, "kind"),
            target=req_float(d, "target"),
            progress=req_float(d, "progress"),
            points=req_float(d, "points"),
            completed=req_bool(d, "completed"),
            claimed=req_bool(d, "claimed"),
        )


@dataclass(frozen=True)
class AchievementState:
    """A lifetime achievement and whether an address has earned it.

    Attributes:
        key: Stable achievement key.
        title: Display title.
        description: Display description.
        icon: Icon identifier.
        points: Points awarded when earned.
        earned: ``True`` once earned.
    """

    key: str = ""
    title: str = ""
    description: str = ""
    icon: str = ""
    points: float = 0.0
    earned: bool = False

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> AchievementState:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            key=req_str(d, "key"),
            title=req_str(d, "title"),
            description=req_str(d, "description"),
            icon=req_str(d, "icon"),
            points=req_float(d, "points"),
            earned=req_bool(d, "earned"),
        )


@dataclass(frozen=True)
class Rewards:
    """Response of ``GET /rewards/{address}`` — streaks, points and quest state.

    Attributes:
        address: Wallet address.
        current_streak: Consecutive active days.
        longest_streak: Longest streak ever.
        points: Headline figure — identical to the leaderboard's ``points``.
        bonus_points: Grant subtotal only; not the number to lead with.
        quests: Quest progress.
        achievements: Achievement state.
    """

    address: str = ""
    current_streak: int = 0
    longest_streak: int = 0
    points: float = 0.0
    bonus_points: float = 0.0
    quests: Tuple[QuestState, ...] = ()
    achievements: Tuple[AchievementState, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Rewards:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            address=req_str(d, "address"),
            current_streak=req_int(d, "currentStreak"),
            longest_streak=req_int(d, "longestStreak"),
            points=req_float(d, "points"),
            bonus_points=req_float(d, "bonusPoints"),
            quests=tuple_of(d, "quests", QuestState.from_dict),
            achievements=tuple_of(d, "achievements", AchievementState.from_dict),
        )
