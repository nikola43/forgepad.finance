"""Token models: the full token record, the discovery row and token detail.

Fyuz tokens live on an internal bonding curve until they reach a $30,000 market
cap, at which point they graduate into a PancakeSwap V2 pair. Before graduation
``pair_address`` is ``None`` and no DEX pool exists anywhere — the curve state
in these models is the only price source for the token.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Tuple

from .._convert import (
    as_mapping,
    opt_float,
    opt_model,
    opt_str,
    req_bool,
    req_float,
    req_int,
    req_model,
    req_str,
    tuple_of,
)
from .system import CreatorInfo
from .trades import Trade

__all__ = ["Token", "TokenPage", "DiscoverToken", "Holder", "TokenDetail"]


@dataclass(frozen=True)
class Token:
    """Full token record as served by ``/tokens``, ``/tokens/king`` and friends.

    Amount fields (``marketcap``, ``price``, ``volume``, the virtual reserves,
    ...) are **decimal strings**, exactly as the server sent them. They are not
    parsed into ``float`` because 18-decimal values do not survive that round
    trip. Use :func:`fyuz.to_decimal` if you need arithmetic.

    Attributes:
        id: Internal numeric id.
        token_address: ERC-20 contract address.
        token_name: Token name.
        token_symbol: Ticker.
        token_description: Free-text description, or ``None``.
        image_style: Generated-image style tag, or ``None``.
        token_image: Token image URL, or ``None``.
        token_banner: Banner image URL, or ``None``.
        creator_address: Wallet that launched the token.
        user: Creator profile stub, or ``None`` when not joined.
        network: Chain slug, currently always ``"bsc"``.
        marketcap: USD market cap, decimal string.
        price: Token price in USD, decimal string.
        eth_price: BNB price in USD at last update, decimal string.
        volume: Cumulative traded volume, decimal string.
        score: Ranking score, decimal string.
        virtual_eth_amount: Bonding-curve virtual BNB reserve, decimal string.
        virtual_token_amount: Bonding-curve virtual token reserve, decimal string.
        pair_address: PancakeSwap pair address, or ``None`` while the token is
            still on the bonding curve.
        pool_type: ``1`` = PancakeSwap V2, ``2`` = V3.
        category: Token category.
        replies: Comment count.
        web_link: Website URL, or ``None``.
        telegram_link: Telegram URL, or ``None``.
        twitter_link: X/Twitter URL, or ``None``.
        launched_at: RFC-3339 graduation timestamp, or ``None`` when the token
            has not graduated.
        created_at: RFC-3339 creation timestamp.
        updated_at: RFC-3339 last-update timestamp.
        creation_time: RFC-3339 on-chain creation timestamp.
        liquidity: Pool liquidity, decimal string, or ``None``.
        progress: Graduation progress toward the $30,000 target, 0-100, or ``None``.
        price_change: 24h price change, or ``None``.
        price_15m: Price 15 minutes ago. ``None`` when unavailable.
        price_change_15m: 15-minute price change. ``None`` when unavailable.
    """

    id: int = 0
    token_address: str = ""
    token_name: str = ""
    token_symbol: str = ""
    token_description: Optional[str] = None
    image_style: Optional[str] = None
    token_image: Optional[str] = None
    token_banner: Optional[str] = None
    creator_address: str = ""
    user: Optional[CreatorInfo] = None
    network: str = ""
    marketcap: str = ""
    price: str = ""
    eth_price: str = ""
    volume: str = ""
    score: str = ""
    virtual_eth_amount: str = ""
    virtual_token_amount: str = ""
    pair_address: Optional[str] = None
    pool_type: int = 0
    category: str = ""
    replies: int = 0
    web_link: Optional[str] = None
    telegram_link: Optional[str] = None
    twitter_link: Optional[str] = None
    launched_at: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""
    creation_time: str = ""
    liquidity: Optional[str] = None
    progress: Optional[float] = None
    price_change: Optional[float] = None
    price_15m: Optional[float] = None
    price_change_15m: Optional[float] = None

    @property
    def graduated(self) -> bool:
        """``True`` once the token has a PancakeSwap pair (i.e. it graduated)."""
        return bool(self.pair_address)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Token:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            id=req_int(d, "id"),
            token_address=req_str(d, "tokenAddress"),
            token_name=req_str(d, "tokenName"),
            token_symbol=req_str(d, "tokenSymbol"),
            token_description=opt_str(d, "tokenDescription"),
            image_style=opt_str(d, "imageStyle"),
            token_image=opt_str(d, "tokenImage"),
            token_banner=opt_str(d, "tokenBanner"),
            creator_address=req_str(d, "creatorAddress"),
            user=opt_model(d, "user", CreatorInfo.from_dict),
            network=req_str(d, "network"),
            marketcap=req_str(d, "marketcap"),
            price=req_str(d, "price"),
            eth_price=req_str(d, "ethPrice"),
            volume=req_str(d, "volume"),
            score=req_str(d, "score"),
            virtual_eth_amount=req_str(d, "virtualEthAmount"),
            virtual_token_amount=req_str(d, "virtualTokenAmount"),
            pair_address=opt_str(d, "pairAddress"),
            pool_type=req_int(d, "poolType"),
            category=req_str(d, "category"),
            replies=req_int(d, "replies"),
            web_link=opt_str(d, "webLink"),
            telegram_link=opt_str(d, "telegramLink"),
            twitter_link=opt_str(d, "twitterLink"),
            launched_at=opt_str(d, "launchedAt"),
            created_at=req_str(d, "createdAt"),
            updated_at=req_str(d, "updatedAt"),
            creation_time=req_str(d, "creationTime"),
            liquidity=opt_str(d, "liquidity"),
            progress=opt_float(d, "progress"),
            price_change=opt_float(d, "priceChange"),
            price_15m=opt_float(d, "price15m"),
            price_change_15m=opt_float(d, "priceChange15m"),
        )


@dataclass(frozen=True)
class TokenPage:
    """One page of ``GET /tokens``.

    Attributes:
        token_list: Tokens on this page.
        token_count: Total matching rows across all pages.
    """

    token_list: Tuple[Token, ...] = ()
    token_count: int = 0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> TokenPage:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            token_list=tuple_of(d, "tokenList", Token.from_dict),
            token_count=req_int(d, "tokenCount"),
        )


@dataclass(frozen=True)
class DiscoverToken:
    """One row of ``GET /discover`` — the densest market-data shape.

    Unlike :class:`Token`, the numeric fields here are already-aggregated
    floats, so they are typed as ``float``.

    Attributes:
        token_address: ERC-20 contract address.
        name: Token name.
        symbol: Ticker.
        image: Image URL, or ``None``.
        network: Chain slug, currently always ``"bsc"``.
        creator_address: Wallet that launched the token, or ``None``.
        marketcap: USD market cap.
        price_usd: Token price in USD.
        created_at: Creation time, UNIX seconds.
        launched: ``True`` once graduated to a DEX pair.
        volume24h: Rolling 24h USD volume.
        buys24h: Buy count in the last 24h.
        sells24h: Sell count in the last 24h.
        holders: Current holder count.
        price_change24h: 24h price change.
        graduation_pct: Progress toward the $30,000 graduation target, 0-100.
    """

    token_address: str = ""
    name: str = ""
    symbol: str = ""
    image: Optional[str] = None
    network: str = ""
    creator_address: Optional[str] = None
    marketcap: float = 0.0
    price_usd: float = 0.0
    created_at: int = 0
    launched: bool = False
    volume24h: float = 0.0
    buys24h: int = 0
    sells24h: int = 0
    holders: int = 0
    price_change24h: float = 0.0
    graduation_pct: float = 0.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> DiscoverToken:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            token_address=req_str(d, "tokenAddress"),
            name=req_str(d, "name"),
            symbol=req_str(d, "symbol"),
            image=opt_str(d, "image"),
            network=req_str(d, "network"),
            creator_address=opt_str(d, "creatorAddress"),
            marketcap=req_float(d, "marketcap"),
            price_usd=req_float(d, "priceUsd"),
            created_at=req_int(d, "createdAt"),
            launched=req_bool(d, "launched"),
            volume24h=req_float(d, "volume24h"),
            buys24h=req_int(d, "buys24h"),
            sells24h=req_int(d, "sells24h"),
            holders=req_int(d, "holders"),
            price_change24h=req_float(d, "priceChange24h"),
            graduation_pct=req_float(d, "graduationPct"),
        )


@dataclass(frozen=True)
class Holder:
    """One holder of a token.

    Attributes:
        id: Internal numeric id.
        token_address: ERC-20 contract address.
        holder_address: Holder wallet.
        token_amount: Balance in whole tokens, decimal string.
        token_name: Token name.
        token_symbol: Ticker.
        token_image: Image URL, or ``None``.
        marketcap: Token USD market cap, decimal string.
        network: Chain slug.
        creator_address: Wallet that launched the token.
        user: Holder profile stub, or ``None``.
    """

    id: int = 0
    token_address: str = ""
    holder_address: str = ""
    token_amount: str = ""
    token_name: str = ""
    token_symbol: str = ""
    token_image: Optional[str] = None
    marketcap: str = ""
    network: str = ""
    creator_address: str = ""
    user: Optional[CreatorInfo] = None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Holder:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            id=req_int(d, "id"),
            token_address=req_str(d, "tokenAddress"),
            holder_address=req_str(d, "holderAddress"),
            token_amount=req_str(d, "tokenAmount"),
            token_name=req_str(d, "tokenName"),
            token_symbol=req_str(d, "tokenSymbol"),
            token_image=opt_str(d, "tokenImage"),
            marketcap=req_str(d, "marketcap"),
            network=req_str(d, "network"),
            creator_address=req_str(d, "creatorAddress"),
            user=opt_model(d, "user", CreatorInfo.from_dict),
        )


@dataclass(frozen=True)
class TokenDetail:
    """Response of ``GET /tokens/{network}/{tokenAddress}``.

    Attributes:
        token_details: The token record itself. Always present — the endpoint
            404s rather than answering without it.
        trades: Recent trades, newest first.
        trades_count: Total trades for this token.
        holders_details: Holder distribution.
        fifteen_min_price: Price 15 minutes ago, decimal string, or ``None``.
        one_day_liquidity: 1-day liquidity, decimal string, or ``None``.
        curve_holding: The bonding curve's own balance in whole tokens, decimal
            string. ``None`` means **unknown** (the on-chain read failed) — it
            does not mean zero, and rendering it as ``0`` is a correctness bug.
    """

    token_details: Token = field(default_factory=lambda: Token())
    trades: Tuple[Trade, ...] = ()
    trades_count: int = 0
    holders_details: Tuple[Holder, ...] = ()
    fifteen_min_price: Optional[str] = None
    one_day_liquidity: Optional[str] = None
    curve_holding: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> TokenDetail:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            token_details=req_model(d, "tokenDetails", Token.from_dict),
            trades=tuple_of(d, "trades", Trade.from_dict),
            trades_count=req_int(d, "tradesCount"),
            holders_details=tuple_of(d, "holdersDetails", Holder.from_dict),
            fifteen_min_price=opt_str(d, "fifteenMinPrice"),
            one_day_liquidity=opt_str(d, "oneDayLiquidity"),
            curve_holding=opt_str(d, "curveHolding"),
        )
