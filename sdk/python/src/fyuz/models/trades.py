"""Trade and candle models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Mapping, Optional, Tuple

from .._convert import as_mapping, opt_str, req_float, req_int, req_str, tuple_of

if TYPE_CHECKING:  # pragma: no cover - import cycle guard, types only
    from .tokens import Token

__all__ = ["Trade", "Candle", "RecentTrades"]


@dataclass(frozen=True)
class Trade:
    """A single buy or sell, on the bonding curve or on the graduated pair.

    ``eth_amount``, ``token_amount``, ``token_price`` and ``eth_price`` are
    decimal strings and stay that way — see the precision note in the README.

    Attributes:
        id: Monotonic trade id. Pass the highest one back as
            ``latest_trade_id`` to poll ``/trades/recent`` incrementally.
        token_name: Token name.
        token_symbol: Ticker.
        token_address: ERC-20 contract address.
        token_image: Image URL, or ``None``.
        swapper_address: Wallet that traded.
        swapper_username: Trader display name, or ``None``.
        swapper_avatar: Trader avatar URL, or ``None``.
        type: Trade side, passed through exactly as the server sent it. The
            casing is **not** consistent across endpoints: ``/trades/recent``
            sends ``"buy"``/``"sell"``, while the trades embedded in
            ``/tokens/{network}/{token_address}`` send ``"BUY"``/``"SELL"``.
            Compare with ``trade.type.lower() == "buy"``, never with
            ``trade.type == "buy"``.
        eth_amount: BNB amount, decimal string.
        token_amount: Token amount, decimal string.
        network: Chain slug.
        date: Trade time, UNIX seconds.
        tx_hash: Transaction hash.
        token_price: Token price in USD at trade time, decimal string.
        eth_price: BNB price in USD at trade time, decimal string.
    """

    id: int = 0
    token_name: str = ""
    token_symbol: str = ""
    token_address: str = ""
    token_image: Optional[str] = None
    swapper_address: str = ""
    swapper_username: Optional[str] = None
    swapper_avatar: Optional[str] = None
    type: str = ""
    eth_amount: str = ""
    token_amount: str = ""
    network: str = ""
    date: int = 0
    tx_hash: str = ""
    token_price: str = ""
    eth_price: str = ""

    @property
    def is_buy(self) -> bool:
        """``True`` when this trade is a buy."""
        return self.type == "buy"

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Trade:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            id=req_int(d, "id"),
            token_name=req_str(d, "tokenName"),
            token_symbol=req_str(d, "tokenSymbol"),
            token_address=req_str(d, "tokenAddress"),
            token_image=opt_str(d, "tokenImage"),
            swapper_address=req_str(d, "swapperAddress"),
            swapper_username=opt_str(d, "swapperUsername"),
            swapper_avatar=opt_str(d, "swapperAvatar"),
            type=req_str(d, "type"),
            eth_amount=req_str(d, "ethAmount"),
            token_amount=req_str(d, "tokenAmount"),
            network=req_str(d, "network"),
            date=req_int(d, "date"),
            tx_hash=req_str(d, "txHash"),
            token_price=req_str(d, "tokenPrice"),
            eth_price=req_str(d, "ethPrice"),
        )


@dataclass(frozen=True)
class Candle:
    """One OHLCV candle from ``GET /trades/getChartData``.

    Attributes:
        time: Candle open time, UNIX seconds.
        open: Open price in USD.
        high: High price in USD.
        low: Low price in USD.
        close: Close price in USD.
        volume: Volume traded within the candle.
    """

    time: int = 0
    open: float = 0.0
    high: float = 0.0
    low: float = 0.0
    close: float = 0.0
    volume: float = 0.0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Candle:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            time=req_int(d, "time"),
            open=req_float(d, "open"),
            high=req_float(d, "high"),
            low=req_float(d, "low"),
            close=req_float(d, "close"),
            volume=req_float(d, "volume"),
        )


@dataclass(frozen=True)
class RecentTrades:
    """Response of ``GET /trades/recent``.

    Attributes:
        trades: The platform-wide trade feed, newest first.
        tokens: The token records those trades refer to, so a feed can be
            rendered without a second round trip.
    """

    trades: Tuple[Trade, ...] = ()
    tokens: Tuple[Token, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> RecentTrades:
        """Build from a decoded JSON object, ignoring unknown fields."""
        from .tokens import Token  # local import: Token imports Trade

        d = as_mapping(data)
        return cls(
            trades=tuple_of(d, "trades", Trade.from_dict),
            tokens=tuple_of(d, "tokens", Token.from_dict),
        )
