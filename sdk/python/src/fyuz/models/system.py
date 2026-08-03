"""System and shared models: health, chain config and the profile stub."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple

from .._convert import as_mapping, opt_str, req_int, req_str, tuple_of

__all__ = ["HealthStatus", "ChainInfo", "ChainConfig", "CreatorInfo"]


@dataclass(frozen=True)
class HealthStatus:
    """Response of ``GET /health``.

    Attributes:
        status: ``"ok"`` when the service is up.
    """

    status: str = ""

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> HealthStatus:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(status=req_str(d, "status"))


@dataclass(frozen=True)
class ChainInfo:
    """One chain the Fyuz deployment runs against.

    Attributes:
        name: Human-readable chain name, e.g. ``"BNB Smart Chain"``.
        chain_id: EVM chain id, e.g. ``56`` for BNB Smart Chain mainnet.
    """

    name: str = ""
    chain_id: int = 0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ChainInfo:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(name=req_str(d, "name"), chain_id=req_int(d, "chainId"))


@dataclass(frozen=True)
class ChainConfig:
    """Response of ``GET /config``.

    Attributes:
        chains: Supported chains. Currently a single entry for BNB Smart Chain.
    """

    chains: Tuple[ChainInfo, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ChainConfig:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(chains=tuple_of(d, "chains", ChainInfo.from_dict))


@dataclass(frozen=True)
class CreatorInfo:
    """Public profile stub attached to tokens, trades and holders.

    Attributes:
        address: Wallet address.
        username: Display name, or ``None`` when the wallet never set one.
        avatar: Avatar URL, or ``None``.
    """

    address: str = ""
    username: Optional[str] = None
    avatar: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> CreatorInfo:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        return cls(
            address=req_str(d, "address"),
            username=opt_str(d, "username"),
            avatar=opt_str(d, "avatar"),
        )
