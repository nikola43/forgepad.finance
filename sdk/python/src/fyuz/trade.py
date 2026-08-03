"""Trading against the bonding curve.

This module builds **unsigned transactions**. It never sees a private key, never
signs and never broadcasts — it hands you an :class:`UnsignedTransaction` and you
pass that to whatever wallet you already have (web3.py, eth-account, a hardware
signer, a multisig UI). That is why ``fyuz-sdk`` still has zero runtime
dependencies: signing is the part that needs a crypto library, and it is not
here.

::

    built = fyuz.trade.build_buy(
        token="0x…",
        amount_wei=parse_units("0.5"),   # 0.5 BNB
        slippage_bps=100,                # 1%
    )
    print(built.quote.amount_out_wei)
    w3.eth.send_raw_transaction(sign(built.transaction))

Quotes come from the contract, not from arithmetic here: every one is an
``eth_call`` to ``getSwapOutput``. Reimplementing the curve locally would mean a
second formula that has to be kept in step with an upgradeable contract, and the
day they disagree is the day someone's ``min_amount_out`` is wrong.

Slippage is never chosen for you: :meth:`TradeAPI.build_buy` and
:meth:`TradeAPI.build_sell` require either ``slippage_bps`` or an explicit
``limit_wei``. A default here would be a number picked by someone who cannot see
the trade, and being wrong costs the caller money.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Union

from ._http import Transport
from .abi import (
    SELECTOR_ALLOWANCE,
    SELECTOR_APPROVE,
    SELECTOR_BALANCE_OF,
    SELECTOR_GET_FIRST_BUY_FEE,
    SELECTOR_GET_MAX_SELLABLE_ETH,
    SELECTOR_GET_SWAP_OUTPUT,
    SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS,
    SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS,
    SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH,
    SELECTOR_TOKEN_POOLS,
    UINT256_MAX,
    address_word,
    bool_word,
    decode_bool_at,
    decode_uint256_at,
    encode_call,
    normalize_address,
    parse_amount,
    uint256_word,
)
from .errors import FyuzTokenGraduatedError
from .models import ChainConfig, ChainInfo
from .revert import SELECTOR_ALREADY_LAUNCHED, revert_error, revert_selector
from .rpc import RPCClient

__all__ = [
    "DEFAULT_DEADLINE_SECONDS",
    "DEFAULT_NETWORK",
    "UnsignedTransaction",
    "BuyQuote",
    "SellQuote",
    "BuiltTrade",
    "TradeAPI",
]

#: Basis points in 100%.
_BPS_DIVISOR = 10_000

#: How long a built transaction stays valid when the caller does not say.
DEFAULT_DEADLINE_SECONDS = 120

#: Chain slug used when a call does not name one.
DEFAULT_NETWORK = "bsc"


@dataclass(frozen=True)
class UnsignedTransaction:
    """A transaction ready to be signed and sent.

    Attributes:
        chain_id: EIP-155 chain id. Check it before signing — it is what stops a
            BSC-signed transaction replaying elsewhere.
        to: Contract to call.
        data: ABI-encoded calldata, 0x-prefixed.
        value: Native amount to attach, in wei. ``0`` for non-payable calls.
        from_address: Sender, when one was supplied. Gas estimation needs it.
    """

    chain_id: int
    to: str
    data: str
    value: int
    from_address: Optional[str] = None

    def as_dict(self) -> Dict[str, Union[str, int]]:
        """The shape web3.py's ``send_transaction`` and ``estimate_gas`` expect."""
        payload: Dict[str, Union[str, int]] = {
            "chainId": self.chain_id,
            "to": self.to,
            "data": self.data,
            "value": self.value,
        }
        if self.from_address is not None:
            payload["from"] = self.from_address
        return payload


@dataclass(frozen=True)
class BuyQuote:
    """What a buy will cost and return, priced against current curve state.

    Attributes:
        amount_in_wei: What goes into the curve.
        first_buy_fee_wei: ``getFirstBuyFee(token)``, charged **on top of**
            ``amount_in_wei``.
        value_wei: What ``msg.value`` must be: ``amount_in_wei + first_buy_fee_wei``.
        amount_out_wei: Tokens out at the quoted moment.
        price_impact_bps: Price impact in basis points, as the contract computes it.
    """

    network: str
    token: str
    amount_in_wei: int
    first_buy_fee_wei: int
    value_wei: int
    amount_out_wei: int
    price_impact_bps: int


@dataclass(frozen=True)
class SellQuote:
    """What a sell will return, priced against current curve state.

    Attributes:
        amount_in_wei: Tokens going in.
        amount_out_wei: Native currency out, net of the platform and token-owner
            fees, which the contract takes off the output rather than the input.
        price_impact_bps: Price impact in basis points.
    """

    network: str
    token: str
    amount_in_wei: int
    amount_out_wei: int
    price_impact_bps: int


@dataclass(frozen=True)
class BuiltTrade:
    """A built transaction with the quote it was priced from.

    Attributes:
        transaction: The unsigned transaction.
        quote: The pricing it was built against.
        limit_wei: The ``min_amount_out`` (or ``max_amount_in``) actually encoded.
        deadline: Unix second after which the contract rejects the swap.
    """

    transaction: UnsignedTransaction
    quote: Union[BuyQuote, SellQuote]
    limit_wei: int
    deadline: int


class TradeAPI:
    """Builds unsigned bonding-curve transactions.

    Reached through ``client.trade``; constructing one directly is only useful in
    tests.
    """

    def __init__(
        self,
        transport: Transport,
        *,
        rpc_url: Optional[str] = None,
        rpc_timeout: Optional[float] = None,
        rpc_headers: Optional[Dict[str, str]] = None,
    ) -> None:
        self._transport = transport
        self._rpc_url = rpc_url
        self._rpc_timeout = rpc_timeout
        self._rpc_headers = rpc_headers
        self._chains: Optional[List[ChainInfo]] = None
        self._rpcs: Dict[str, RPCClient] = {}
        self._now = time.time

    # -- chain setup ---------------------------------------------------

    def chain(self, network: str = DEFAULT_NETWORK) -> ChainInfo:
        """Chain metadata from ``GET /config``: contract address, chain id, RPC.

        Fetched once and memoised — it changes about as often as a redeploy.
        Build a new client to pick up a change.

        Raises:
            ValueError: The network is unknown, or the API published no contract
                address for it.
        """
        if self._chains is None:
            payload = self._transport.request("GET", "/config")
            self._chains = list(ChainConfig.from_dict(payload).chains)

        for entry in self._chains:
            if entry.network != network and str(entry.chain_id) != network:
                continue
            if not entry.contract_address:
                raise ValueError(
                    f"the API did not publish a contract address for {network!r}, "
                    "so no transaction can be built"
                )
            return entry

        known = ", ".join(c.network or str(c.chain_id) for c in self._chains)
        raise ValueError(f"unknown network {network!r}; the API serves: {known}")

    def _rpc(self, network: str) -> RPCClient:
        """The JSON-RPC client for a chain, from the override or ``/config``."""
        cached = self._rpcs.get(network)
        if cached is not None:
            return cached

        chain = self.chain(network)
        url = self._rpc_url or chain.rpc_url
        if not url:
            raise ValueError(
                f"no RPC endpoint for {network!r}: the API published none, and no "
                "rpc_url was configured"
            )

        kwargs: Dict[str, object] = {}
        if self._rpc_timeout is not None:
            kwargs["timeout"] = self._rpc_timeout
        if self._rpc_headers is not None:
            kwargs["headers"] = self._rpc_headers
        client = RPCClient(url, **kwargs)  # type: ignore[arg-type]
        self._rpcs[network] = client
        return client

    def _call_contract(self, network: str, data: str) -> tuple[bool, str, ChainInfo]:
        chain = self.chain(network)
        result = self._rpc(network).call(chain.contract_address or "", data)
        return result.ok, (result.data if result.ok else result.revert), chain

    # -- reads ---------------------------------------------------------

    def is_graduated(self, token: str, *, network: str = DEFAULT_NETWORK) -> bool:
        """Whether the token has left the bonding curve.

        Reads ``tokenPools(token).launched`` — the contract's own flag, not the
        indexer's view of it, so it cannot lag behind a graduation that happened
        seconds ago.
        """
        token = normalize_address("token", token)
        ok, data, _ = self._call_contract(
            network, encode_call(SELECTOR_TOKEN_POOLS, address_word(token))
        )
        if not ok:
            raise revert_error(data, f"tokenPools({token})")
        # (uint256,uint256,uint256,uint256,address,address,uint8,bool) — launched last.
        return decode_bool_at(data, 7)

    def first_buy_fee(self, token: str, *, network: str = DEFAULT_NETWORK) -> int:
        """``getFirstBuyFee(token)`` in wei — the surcharge on a token's first buy."""
        token = normalize_address("token", token)
        ok, data, _ = self._call_contract(
            network, encode_call(SELECTOR_GET_FIRST_BUY_FEE, address_word(token))
        )
        if not ok:
            raise revert_error(data, f"getFirstBuyFee({token})")
        return decode_uint256_at(data, 0)

    def max_sellable_wei(self, token: str, *, network: str = DEFAULT_NETWORK) -> int:
        """``getMaxSellableETH(token)`` — the ceiling one sell may extract."""
        token = normalize_address("token", token)
        ok, data, _ = self._call_contract(
            network, encode_call(SELECTOR_GET_MAX_SELLABLE_ETH, address_word(token))
        )
        if not ok:
            raise revert_error(data, f"getMaxSellableETH({token})")
        return decode_uint256_at(data, 0)

    def allowance(self, token: str, owner: str, *, network: str = DEFAULT_NETWORK) -> int:
        """ERC-20 ``allowance(owner, contract)`` — how much the curve may pull."""
        token = normalize_address("token", token)
        owner = normalize_address("owner", owner)
        chain = self.chain(network)
        data = self._rpc(network).call_or_raise(
            token,
            encode_call(
                SELECTOR_ALLOWANCE, address_word(owner), address_word(chain.contract_address or "")
            ),
            f"allowance({owner})",
        )
        return decode_uint256_at(data, 0)

    def balance_of(self, token: str, owner: str, *, network: str = DEFAULT_NETWORK) -> int:
        """ERC-20 ``balanceOf(owner)``, in the token's smallest unit."""
        token = normalize_address("token", token)
        owner = normalize_address("owner", owner)
        data = self._rpc(network).call_or_raise(
            token,
            encode_call(SELECTOR_BALANCE_OF, address_word(owner)),
            f"balanceOf({owner})",
        )
        return decode_uint256_at(data, 0)

    # -- quotes --------------------------------------------------------

    def _swap_output(
        self, network: str, token: str, amount_in: int, is_eth_input: bool
    ) -> tuple[int, int]:
        """``getSwapOutput``, with the graduated revert promoted to a typed error."""
        ok, data, _ = self._call_contract(
            network,
            encode_call(
                SELECTOR_GET_SWAP_OUTPUT,
                address_word(token),
                uint256_word(amount_in),
                bool_word(is_eth_input),
            ),
        )
        if not ok:
            if revert_selector(data) == SELECTOR_ALREADY_LAUNCHED:
                raise FyuzTokenGraduatedError(token_address=token, data=data)
            raise revert_error(data, f"getSwapOutput({token})")
        return decode_uint256_at(data, 0), decode_uint256_at(data, 1)

    def quote_buy(
        self, token: str, amount_wei: Union[str, int], *, network: str = DEFAULT_NETWORK
    ) -> BuyQuote:
        """Price a buy: tokens out for a given amount of native currency in.

        Raises:
            FyuzTokenGraduatedError: The curve is closed.
        """
        token = normalize_address("token", token)
        amount_in = parse_amount("amount_wei", amount_wei)
        if amount_in == 0:
            raise ValueError("amount_wei must be greater than zero")

        amount_out, impact = self._swap_output(network, token, amount_in, True)
        fee = self.first_buy_fee(token, network=network)

        return BuyQuote(
            network=network,
            token=token,
            amount_in_wei=amount_in,
            first_buy_fee_wei=fee,
            value_wei=amount_in + fee,
            amount_out_wei=amount_out,
            price_impact_bps=impact,
        )

    def quote_sell(
        self, token: str, amount_wei: Union[str, int], *, network: str = DEFAULT_NETWORK
    ) -> SellQuote:
        """Price a sell: native currency out for a given amount of tokens in.

        Raises:
            FyuzTokenGraduatedError: The curve is closed.
        """
        token = normalize_address("token", token)
        amount_in = parse_amount("amount_wei", amount_wei)
        if amount_in == 0:
            raise ValueError("amount_wei must be greater than zero")

        amount_out, impact = self._swap_output(network, token, amount_in, False)
        return SellQuote(
            network=network,
            token=token,
            amount_in_wei=amount_in,
            amount_out_wei=amount_out,
            price_impact_bps=impact,
        )

    # -- builds --------------------------------------------------------

    def build_buy(
        self,
        token: str,
        amount_wei: Union[str, int],
        *,
        network: str = DEFAULT_NETWORK,
        slippage_bps: Optional[int] = None,
        limit_wei: Optional[Union[str, int]] = None,
        deadline: Optional[int] = None,
        deadline_seconds: int = DEFAULT_DEADLINE_SECONDS,
        from_address: Optional[str] = None,
    ) -> BuiltTrade:
        """Spend an exact amount of native currency on a token.

        ``transaction.value`` already includes the first-buy fee; sending only
        ``amount_wei`` reverts with ``InsufficientEthValue``. Any excess is
        refunded by the contract.
        """
        quote = self.quote_buy(token, amount_wei, network=network)
        chain = self.chain(network)

        limit = _apply_limit(slippage_bps, limit_wei, quote.amount_out_wei, False, "min_amount_out")
        expiry = self._resolve_deadline(deadline, deadline_seconds)

        return BuiltTrade(
            transaction=UnsignedTransaction(
                chain_id=chain.chain_id,
                to=chain.contract_address or "",
                data=encode_call(
                    SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS,
                    address_word(quote.token),
                    uint256_word(quote.amount_in_wei),
                    uint256_word(limit),
                    uint256_word(expiry),
                ),
                value=quote.value_wei,
                from_address=_optional_address(from_address),
            ),
            quote=quote,
            limit_wei=limit,
            deadline=expiry,
        )

    def build_buy_exact_tokens(
        self,
        token: str,
        amount_out_wei: Union[str, int],
        *,
        network: str = DEFAULT_NETWORK,
        slippage_bps: Optional[int] = None,
        limit_wei: Optional[Union[str, int]] = None,
        deadline: Optional[int] = None,
        deadline_seconds: int = DEFAULT_DEADLINE_SECONDS,
        from_address: Optional[str] = None,
    ) -> BuiltTrade:
        """Buy an exact number of tokens, capping what you spend.

        Slippage runs the other way here: ``limit_wei`` is a ``max_amount_in``,
        so ``slippage_bps`` widens the cap rather than lowering a floor.
        """
        token = normalize_address("token", token)
        wanted = parse_amount("amount_out_wei", amount_out_wei)
        if wanted == 0:
            raise ValueError("amount_out_wei must be greater than zero")

        # Price the reverse direction to learn roughly what the tokens cost, then
        # let the caller's tolerance set the ceiling on top of that estimate.
        estimate, _ = self._swap_output(network, token, wanted, False)
        if estimate == 0:
            raise ValueError(
                f"the curve prices {amount_out_wei} of {token} at zero — ask for more tokens"
            )

        limit = _apply_limit(slippage_bps, limit_wei, estimate, True, "max_amount_in")
        fee = self.first_buy_fee(token, network=network)
        chain = self.chain(network)
        expiry = self._resolve_deadline(deadline, deadline_seconds)

        return BuiltTrade(
            transaction=UnsignedTransaction(
                chain_id=chain.chain_id,
                to=chain.contract_address or "",
                data=encode_call(
                    SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS,
                    address_word(token),
                    uint256_word(wanted),
                    uint256_word(limit),
                    uint256_word(expiry),
                ),
                value=limit + fee,
                from_address=_optional_address(from_address),
            ),
            quote=BuyQuote(
                network=network,
                token=token,
                amount_in_wei=estimate,
                first_buy_fee_wei=fee,
                value_wei=limit + fee,
                amount_out_wei=wanted,
                price_impact_bps=0,
            ),
            limit_wei=limit,
            deadline=expiry,
        )

    def build_sell(
        self,
        token: str,
        amount_wei: Union[str, int],
        *,
        network: str = DEFAULT_NETWORK,
        slippage_bps: Optional[int] = None,
        limit_wei: Optional[Union[str, int]] = None,
        deadline: Optional[int] = None,
        deadline_seconds: int = DEFAULT_DEADLINE_SECONDS,
        from_address: Optional[str] = None,
    ) -> BuiltTrade:
        """Sell tokens for native currency.

        The contract pulls the tokens with ``transferFrom``, so an ERC-20
        approval must already be in place — check :meth:`allowance` and send
        :meth:`build_approve` first, or the swap reverts inside the token.
        """
        quote = self.quote_sell(token, amount_wei, network=network)
        chain = self.chain(network)

        limit = _apply_limit(slippage_bps, limit_wei, quote.amount_out_wei, False, "min_amount_out")
        expiry = self._resolve_deadline(deadline, deadline_seconds)

        return BuiltTrade(
            transaction=UnsignedTransaction(
                chain_id=chain.chain_id,
                to=chain.contract_address or "",
                data=encode_call(
                    SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH,
                    address_word(quote.token),
                    uint256_word(quote.amount_in_wei),
                    uint256_word(limit),
                    uint256_word(expiry),
                ),
                value=0,
                from_address=_optional_address(from_address),
            ),
            quote=quote,
            limit_wei=limit,
            deadline=expiry,
        )

    def build_approve(
        self,
        token: str,
        *,
        amount_wei: Optional[Union[str, int]] = None,
        unlimited: bool = False,
        network: str = DEFAULT_NETWORK,
        from_address: Optional[str] = None,
    ) -> UnsignedTransaction:
        """ERC-20 ``approve``, letting the curve pull tokens for a sell.

        Approves exactly ``amount_wei`` by default. ``unlimited=True`` approves
        the ``uint256`` maximum, which saves a transaction per sell at the cost
        of a standing allowance against an upgradeable contract.
        """
        token = normalize_address("token", token)
        chain = self.chain(network)

        if unlimited and amount_wei is not None:
            raise ValueError("pass either amount_wei or unlimited, not both")
        if not unlimited and amount_wei is None:
            raise ValueError(
                "build_approve needs amount_wei, or unlimited=True to approve the "
                "uint256 maximum"
            )

        amount = UINT256_MAX if unlimited else parse_amount("amount_wei", amount_wei or 0)

        return UnsignedTransaction(
            chain_id=chain.chain_id,
            to=token,
            data=encode_call(
                SELECTOR_APPROVE,
                address_word(chain.contract_address or ""),
                uint256_word(amount),
            ),
            value=0,
            from_address=_optional_address(from_address),
        )

    def _resolve_deadline(self, deadline: Optional[int], deadline_seconds: int) -> int:
        """Absolute deadline in unix seconds, from whichever form the caller used."""
        if deadline is not None:
            if deadline <= 0:
                raise ValueError("deadline must be a positive unix timestamp in seconds")
            return deadline
        if deadline_seconds <= 0:
            raise ValueError("deadline_seconds must be a positive whole number")
        return int(self._now()) + deadline_seconds


def _apply_limit(
    slippage_bps: Optional[int],
    limit_wei: Optional[Union[str, int]],
    quoted: int,
    up: bool,
    field_name: str,
) -> int:
    """Turn a quote plus a tolerance into the limit that goes on-chain.

    ``up`` is which way the tolerance moves the number: ``False`` for a
    ``min_amount_out`` floor, ``True`` for a ``max_amount_in`` ceiling.
    """
    if limit_wei is not None and slippage_bps is not None:
        raise ValueError("pass either slippage_bps or limit_wei, not both")

    if limit_wei is not None:
        return parse_amount("limit_wei", limit_wei)

    if slippage_bps is None:
        raise ValueError(
            f"slippage protection is required: pass slippage_bps (100 = 1%) or an "
            f"explicit limit_wei to set {field_name} yourself. There is no default, "
            "because the right tolerance depends on the trade and getting it wrong "
            "costs you money."
        )

    if isinstance(slippage_bps, bool) or not isinstance(slippage_bps, int):
        raise ValueError(f"slippage_bps must be a whole number, got {slippage_bps!r}")
    if slippage_bps < 0 or slippage_bps >= _BPS_DIVISOR:
        raise ValueError(f"slippage_bps must be in [0, 10000), got {slippage_bps}")

    factor = _BPS_DIVISOR + slippage_bps if up else _BPS_DIVISOR - slippage_bps
    return quoted * factor // _BPS_DIVISOR


def _optional_address(value: Optional[str]) -> Optional[str]:
    return None if value is None else normalize_address("from_address", value)
