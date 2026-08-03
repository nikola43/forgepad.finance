"""Analytics, wallet and portfolio models.

Everything in this module is an aggregate the server has already computed, so
the numeric fields are genuine ``float`` values rather than decimal strings.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple

from .._convert import as_mapping, opt_str, req_bool, req_float, req_int, req_str, tuple_of

__all__ = [
    "TokenAnalytics",
    "TopTrader",
    "WalletStats",
    "PortfolioPosition",
    "Portfolio",
]


@dataclass(frozen=True)
class TokenAnalytics:
    """Response of ``GET /analytics/token/{network}/{address}``.

    Attributes:
        token_address: ERC-20 contract address.
        network: Chain slug.
        holder_count: Current holder count.
        top10_pct: Share of supply held by the top 10 holders.
        creator_pct: Share of supply held by the creator.
        buys: Lifetime buy count.
        sells: Lifetime sell count.
        volume_usd: Lifetime USD volume.
        graduation_pct: Progress toward the $30,000 graduation target, 0-100.
        launched: ``True`` once graduated to a DEX pair.
        bundle_buyers: Addresses that bought in the launch block.
        bundle_flag: ``True`` when the launch looks bundled.
    """

    token_address: str = ""
    network: str = ""
    holder_count: int = 0
    top10_pct: float = 0.0
    creator_pct: float = 0.0
    buys: int = 0
    sells: int = 0
    volume_usd: float = 0.0
    graduation_pct: float = 0.0
    launched: bool = False
    bundle_buyers: int = 0
    bundle_flag: bool = False

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> TokenAnalytics:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            token_address=req_str(d, "tokenAddress"),
            network=req_str(d, "network"),
            holder_count=req_int(d, "holderCount"),
            top10_pct=req_float(d, "top10Pct"),
            creator_pct=req_float(d, "creatorPct"),
            buys=req_int(d, "buys"),
            sells=req_int(d, "sells"),
            volume_usd=req_float(d, "volumeUsd"),
            graduation_pct=req_float(d, "graduationPct"),
            launched=req_bool(d, "launched"),
            bundle_buyers=req_int(d, "bundleBuyers"),
            bundle_flag=req_bool(d, "bundleFlag"),
        )


@dataclass(frozen=True)
class TopTrader:
    """One row of ``GET /analytics/top-traders/{network}/{address}``.

    Attributes:
        address: Trader wallet.
        username: Display name, or ``None``.
        avatar: Avatar URL, or ``None``.
        realized_pnl_usd: Realised PnL in USD.
        unrealized_pnl_usd: Unrealised PnL in USD.
        total_pnl_usd: Sum of realised and unrealised PnL.
        volume_usd: USD volume traded on this token.
        is_creator: ``True`` when this wallet launched the token.
    """

    address: str = ""
    username: Optional[str] = None
    avatar: Optional[str] = None
    realized_pnl_usd: float = 0.0
    unrealized_pnl_usd: float = 0.0
    total_pnl_usd: float = 0.0
    volume_usd: float = 0.0
    is_creator: bool = False

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> TopTrader:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            address=req_str(d, "address"),
            username=opt_str(d, "username"),
            avatar=opt_str(d, "avatar"),
            realized_pnl_usd=req_float(d, "realizedPnlUsd"),
            unrealized_pnl_usd=req_float(d, "unrealizedPnlUsd"),
            total_pnl_usd=req_float(d, "totalPnlUsd"),
            volume_usd=req_float(d, "volumeUsd"),
            is_creator=req_bool(d, "isCreator"),
        )


@dataclass(frozen=True)
class WalletStats:
    """Response of ``GET /wallet/{address}`` — average-cost PnL across all tokens.

    Attributes:
        address: Wallet address.
        username: Display name, or ``None``.
        avatar: Avatar URL, or ``None``.
        volume_usd: Lifetime USD volume.
        realized_pnl_usd: Realised PnL in USD.
        unrealized_pnl_usd: Unrealised PnL in USD.
        total_pnl_usd: Sum of realised and unrealised PnL.
        roi_pct: Return on invested capital, percent.
        win_rate: Share of traded tokens that are net profitable, 0-1.
        tokens_traded: Distinct tokens traded.
        trade_count: Total trades.
        holding_value_usd: USD value currently held.
    """

    address: str = ""
    username: Optional[str] = None
    avatar: Optional[str] = None
    volume_usd: float = 0.0
    realized_pnl_usd: float = 0.0
    unrealized_pnl_usd: float = 0.0
    total_pnl_usd: float = 0.0
    roi_pct: float = 0.0
    win_rate: float = 0.0
    tokens_traded: int = 0
    trade_count: int = 0
    holding_value_usd: float = 0.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> WalletStats:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            address=req_str(d, "address"),
            username=opt_str(d, "username"),
            avatar=opt_str(d, "avatar"),
            volume_usd=req_float(d, "volumeUsd"),
            realized_pnl_usd=req_float(d, "realizedPnlUsd"),
            unrealized_pnl_usd=req_float(d, "unrealizedPnlUsd"),
            total_pnl_usd=req_float(d, "totalPnlUsd"),
            roi_pct=req_float(d, "roiPct"),
            win_rate=req_float(d, "winRate"),
            tokens_traded=req_int(d, "tokensTraded"),
            trade_count=req_int(d, "tradeCount"),
            holding_value_usd=req_float(d, "holdingValueUsd"),
        )


@dataclass(frozen=True)
class PortfolioPosition:
    """One token still held by an address.

    Average-cost basis; dust positions (balance <= 1e-6) are omitted by the
    server.

    Attributes:
        token_address: ERC-20 contract address.
        name: Token name.
        symbol: Ticker.
        image: Image URL, or ``None``.
        network: Chain slug.
        balance: Net tokens held (buys minus sells), whole tokens.
        current_price_usd: Latest token price in USD.
        value_usd: ``balance * current_price_usd``.
        cost_usd: Average-cost basis of the open position.
        avg_buy_price_usd: Average buy price in USD.
        unrealized_pnl_usd: Unrealised PnL in USD.
        unrealized_pnl_pct: Unrealised PnL, percent.
        realized_pnl_usd: Realised PnL in USD on this token.
    """

    token_address: str = ""
    name: str = ""
    symbol: str = ""
    image: Optional[str] = None
    network: str = ""
    balance: float = 0.0
    current_price_usd: float = 0.0
    value_usd: float = 0.0
    cost_usd: float = 0.0
    avg_buy_price_usd: float = 0.0
    unrealized_pnl_usd: float = 0.0
    unrealized_pnl_pct: float = 0.0
    realized_pnl_usd: float = 0.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> PortfolioPosition:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            token_address=req_str(d, "tokenAddress"),
            name=req_str(d, "name"),
            symbol=req_str(d, "symbol"),
            image=opt_str(d, "image"),
            network=req_str(d, "network"),
            balance=req_float(d, "balance"),
            current_price_usd=req_float(d, "currentPriceUsd"),
            value_usd=req_float(d, "valueUsd"),
            cost_usd=req_float(d, "costUsd"),
            avg_buy_price_usd=req_float(d, "avgBuyPriceUsd"),
            unrealized_pnl_usd=req_float(d, "unrealizedPnlUsd"),
            unrealized_pnl_pct=req_float(d, "unrealizedPnlPct"),
            realized_pnl_usd=req_float(d, "realizedPnlUsd"),
        )


@dataclass(frozen=True)
class Portfolio:
    """Response of ``GET /portfolio/{address}`` — live average-cost PnL.

    An address with no trades returns zeroed totals and an empty ``positions``
    tuple rather than a 404.

    Attributes:
        address: Wallet address.
        total_value_usd: Mark-to-market value of every open position.
        total_cost_usd: Cost basis of every open position.
        unrealized_pnl_usd: Unrealised PnL in USD.
        realized_pnl_usd: Realised PnL in USD.
        total_pnl_usd: Sum of realised and unrealised PnL.
        roi_pct: Return on invested capital, percent.
        positions: Open positions, highest value first.
    """

    address: str = ""
    total_value_usd: float = 0.0
    total_cost_usd: float = 0.0
    unrealized_pnl_usd: float = 0.0
    realized_pnl_usd: float = 0.0
    total_pnl_usd: float = 0.0
    roi_pct: float = 0.0
    positions: Tuple[PortfolioPosition, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Portfolio:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            address=req_str(d, "address"),
            total_value_usd=req_float(d, "totalValueUsd"),
            total_cost_usd=req_float(d, "totalCostUsd"),
            unrealized_pnl_usd=req_float(d, "unrealizedPnlUsd"),
            realized_pnl_usd=req_float(d, "realizedPnlUsd"),
            total_pnl_usd=req_float(d, "totalPnlUsd"),
            roi_pct=req_float(d, "roiPct"),
            positions=tuple_of(d, "positions", PortfolioPosition.from_dict),
        )
