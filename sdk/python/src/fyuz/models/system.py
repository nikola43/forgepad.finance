"""System and shared models: health, chain config and the profile stub."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional, Tuple

from .._convert import as_mapping, opt_float, opt_int, opt_str, req_int, req_str, tuple_of

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

    Beyond the two documented fields, the live endpoint publishes the deployment
    details the trading layer needs. They are modelled here because
    :class:`fyuz.TradeAPI` reads them — that is what keeps the launchpad address
    out of the SDK source, where a contract upgrade would strand it.

    Attributes:
        name: Human-readable chain name, e.g. ``"BNB Smart Chain"``.
        chain_id: EVM chain id, e.g. ``56`` for BNB Smart Chain mainnet.
        network: Chain slug used everywhere else in the API, e.g. ``"bsc"``.
        contract_address: The Fyuz launchpad — the ``to`` of every swap.
        rpc_url: A JSON-RPC endpoint, as configured by the API operator. Treat it
            as a default, not an entitlement: it is shared by every caller and
            can change without notice. Pass your own ``rpc_url`` in production.
        ws_url: WebSocket sibling of ``rpc_url``.
        currency: Native gas symbol, e.g. ``"BNB"``.
        explorer_url: Block explorer root.
        pools: DEX venues a graduated token can end up on.
        target_market_cap: USD market cap at which a token graduates.
        total_supply: Tokens minted per launch.
        virtual_eth_amount: Virtual native reserve a new curve starts with.
        virtual_token_amount: Virtual token reserve a new curve starts with.
        start_block: First block the indexer reads.
        abi: Contract ABI as served. The SDK does not use it — every selector it
            needs is pinned in :mod:`fyuz.abi` — but it is here so it can be
            handed to web3.py without a second request.
    """

    name: str = ""
    chain_id: int = 0
    network: str = ""
    contract_address: Optional[str] = None
    rpc_url: Optional[str] = None
    ws_url: Optional[str] = None
    currency: Optional[str] = None
    explorer_url: Optional[str] = None
    pools: Tuple[str, ...] = ()
    target_market_cap: Optional[float] = None
    total_supply: Optional[float] = None
    virtual_eth_amount: Optional[float] = None
    virtual_token_amount: Optional[float] = None
    start_block: Optional[int] = None
    abi: Optional[Tuple[Any, ...]] = None

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ChainInfo:
        """Build from a decoded JSON object, ignoring unknown fields."""
        d = as_mapping(data)
        raw_pools = d.get("pools")
        raw_abi = d.get("abi")
        return cls(
            name=req_str(d, "name"),
            chain_id=req_int(d, "chainId"),
            network=opt_str(d, "network") or "",
            contract_address=opt_str(d, "contractAddress"),
            rpc_url=opt_str(d, "rpcUrl"),
            ws_url=opt_str(d, "wsUrl"),
            currency=opt_str(d, "currency"),
            explorer_url=opt_str(d, "explorerUrl"),
            pools=tuple(str(p) for p in raw_pools) if isinstance(raw_pools, list) else (),
            target_market_cap=opt_float(d, "targetMarketCap"),
            total_supply=opt_float(d, "totalSupply"),
            virtual_eth_amount=opt_float(d, "virtualEthAmount"),
            virtual_token_amount=opt_float(d, "virtualTokenAmount"),
            start_block=opt_int(d, "startBlock"),
            abi=tuple(raw_abi) if isinstance(raw_abi, list) else None,
        )


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
