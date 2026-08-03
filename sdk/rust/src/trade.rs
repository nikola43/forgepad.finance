//! Trading against the bonding curve.
//!
//! This module builds **unsigned transactions**. It never sees a private key,
//! never signs and never broadcasts — it hands you an [`UnsignedTransaction`]
//! and you pass that to whatever wallet you already have (`alloy`, `ethers-rs`,
//! a hardware signer, a multisig UI). Signing is the part that needs a crypto
//! stack, and it is not here.
//!
//! ```no_run
//! # async fn demo() -> Result<(), fyuz::Error> {
//! use fyuz::{parse_units, BuyParams, FyuzClient};
//!
//! let client = FyuzClient::new()?;
//! let built = client
//!     .trade()
//!     .build_buy(
//!         &BuyParams::new("0x0000000000000000000000000000000000000001", parse_units("0.5", 18)?)
//!             .slippage_bps(100),
//!     )
//!     .await?;
//!
//! println!("expecting {} tokens", built.quote.amount_out_wei);
//! # Ok(())
//! # }
//! ```
//!
//! Quotes come from the contract, not from arithmetic here: every one is an
//! `eth_call` to `getSwapOutput`. Reimplementing the curve locally would mean a
//! second formula that has to be kept in step with an upgradeable contract, and
//! the day they disagree is the day someone's `min_amount_out` is wrong.
//!
//! Slippage is never chosen for you. [`TradeApi::build_buy`] and
//! [`TradeApi::build_sell`] require either `slippage_bps` or an explicit
//! `limit_wei`; a default here would be a number picked by someone who cannot
//! see the trade.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::{Mutex, OnceCell};

use crate::abi::{
    address_word, bool_word, decode_bool_at, decode_uint256_at, encode_call, normalize_address,
    uint256_word, SELECTOR_ALLOWANCE, SELECTOR_APPROVE, SELECTOR_BALANCE_OF,
    SELECTOR_GET_FIRST_BUY_FEE, SELECTOR_GET_MAX_SELLABLE_ETH, SELECTOR_GET_SWAP_OUTPUT,
    SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS, SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS,
    SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH, SELECTOR_TOKEN_POOLS, U256,
};
use crate::models::ChainInfo;
use crate::revert::{graduated_error, revert_error, revert_selector, SELECTOR_ALREADY_LAUNCHED};
use crate::rpc::{CallOutcome, RpcClient, DEFAULT_RPC_TIMEOUT};
use crate::{Error, FyuzClient};

/// Basis points in 100%.
const BPS_DIVISOR: u32 = 10_000;

/// How long a built transaction stays valid when the caller does not say.
pub const DEFAULT_DEADLINE_SECONDS: u64 = 120;

/// Chain slug used when a call does not name one.
pub const DEFAULT_NETWORK: &str = "bsc";

fn invalid(message: impl Into<String>) -> Error {
    Error::InvalidArgument {
        message: message.into(),
    }
}

/// A transaction ready to be signed and sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnsignedTransaction {
    /// EIP-155 chain id. Check it before signing — it is what stops a
    /// BSC-signed transaction replaying elsewhere.
    pub chain_id: i64,
    /// Contract to call.
    pub to: String,
    /// ABI-encoded calldata, `0x`-prefixed.
    pub data: String,
    /// Native value to attach, in wei. Zero for non-payable calls.
    pub value: U256,
    /// Sender, when one was supplied. Gas estimation needs it.
    pub from: Option<String>,
}

/// What a buy will cost and return, priced against current curve state.
#[derive(Debug, Clone)]
pub struct BuyQuote {
    /// Chain slug this was priced on.
    pub network: String,
    /// The token, lower-cased.
    pub token: String,
    /// What goes into the curve.
    pub amount_in_wei: U256,
    /// `getFirstBuyFee(token)`, charged **on top of** `amount_in_wei`.
    pub first_buy_fee_wei: U256,
    /// What `msg.value` must be: `amount_in_wei + first_buy_fee_wei`.
    pub value_wei: U256,
    /// Tokens out at the quoted moment.
    pub amount_out_wei: U256,
    /// Price impact in basis points, as the contract computes it.
    pub price_impact_bps: u64,
}

/// What a sell will return, priced against current curve state.
#[derive(Debug, Clone)]
pub struct SellQuote {
    /// Chain slug this was priced on.
    pub network: String,
    /// The token, lower-cased.
    pub token: String,
    /// Tokens going in.
    pub amount_in_wei: U256,
    /// Native currency out, net of the platform and token-owner fees, which the
    /// contract takes off the output rather than the input.
    pub amount_out_wei: U256,
    /// Price impact in basis points.
    pub price_impact_bps: u64,
}

/// A built buy with the quote it was priced from.
#[derive(Debug, Clone)]
pub struct BuiltBuy {
    /// Ready to sign and send.
    pub transaction: UnsignedTransaction,
    /// The pricing it was built against.
    pub quote: BuyQuote,
    /// The `minAmountOut` (or `maxAmountIn`) actually encoded.
    pub limit_wei: U256,
    /// Unix second after which the contract rejects the swap.
    pub deadline: u64,
}

/// A built sell with the quote it was priced from.
#[derive(Debug, Clone)]
pub struct BuiltSell {
    /// Ready to sign and send.
    pub transaction: UnsignedTransaction,
    /// The pricing it was built against.
    pub quote: SellQuote,
    /// The `minAmountOut` actually encoded.
    pub limit_wei: U256,
    /// Unix second after which the contract rejects the swap.
    pub deadline: u64,
}

/// Slippage and deadline configuration, shared by every build.
#[derive(Debug, Clone, Default)]
struct Limits {
    slippage_bps: Option<u32>,
    limit_wei: Option<U256>,
    deadline: Option<u64>,
    deadline_seconds: Option<u64>,
    from: Option<String>,
}

macro_rules! limit_builders {
    () => {
        /// Tolerance in basis points — `100` is 1%. Mutually exclusive with
        /// [`limit_wei`](Self::limit_wei).
        pub fn slippage_bps(mut self, bps: u32) -> Self {
            self.limits.slippage_bps = Some(bps);
            self
        }

        /// Set `minAmountOut`/`maxAmountIn` exactly, bypassing the tolerance.
        pub fn limit_wei(mut self, limit: U256) -> Self {
            self.limits.limit_wei = Some(limit);
            self
        }

        /// Absolute deadline, unix seconds. Wins over
        /// [`deadline_seconds`](Self::deadline_seconds).
        pub fn deadline(mut self, unix_seconds: u64) -> Self {
            self.limits.deadline = Some(unix_seconds);
            self
        }

        /// Relative deadline in seconds from now. Defaults to 120.
        pub fn deadline_seconds(mut self, seconds: u64) -> Self {
            self.limits.deadline_seconds = Some(seconds);
            self
        }

        /// Sender address, copied onto the transaction.
        pub fn from(mut self, address: impl Into<String>) -> Self {
            self.limits.from = Some(address.into());
            self
        }

        /// Chain slug. Defaults to `"bsc"`.
        pub fn network(mut self, network: impl Into<String>) -> Self {
            self.network = network.into();
            self
        }
    };
}

/// Spend an exact amount of native currency on a token.
#[derive(Debug, Clone)]
pub struct BuyParams {
    token: String,
    amount_wei: U256,
    network: String,
    limits: Limits,
}

impl BuyParams {
    /// The token to buy, and the native currency to spend (excluding the
    /// first-buy fee, which the SDK adds to `value` for you).
    pub fn new(token: impl Into<String>, amount_wei: U256) -> Self {
        Self {
            token: token.into(),
            amount_wei,
            network: DEFAULT_NETWORK.to_string(),
            limits: Limits::default(),
        }
    }

    limit_builders!();
}

/// Buy an exact number of tokens, capping the spend.
#[derive(Debug, Clone)]
pub struct BuyExactTokensParams {
    token: String,
    amount_out_wei: U256,
    network: String,
    limits: Limits,
}

impl BuyExactTokensParams {
    /// The token, and the exact number of tokens wanted.
    pub fn new(token: impl Into<String>, amount_out_wei: U256) -> Self {
        Self {
            token: token.into(),
            amount_out_wei,
            network: DEFAULT_NETWORK.to_string(),
            limits: Limits::default(),
        }
    }

    limit_builders!();
}

/// Sell tokens for native currency.
#[derive(Debug, Clone)]
pub struct SellParams {
    token: String,
    amount_wei: U256,
    network: String,
    limits: Limits,
}

impl SellParams {
    /// The token, and how much of it to sell.
    pub fn new(token: impl Into<String>, amount_wei: U256) -> Self {
        Self {
            token: token.into(),
            amount_wei,
            network: DEFAULT_NETWORK.to_string(),
            limits: Limits::default(),
        }
    }

    limit_builders!();
}

/// Builds unsigned bonding-curve transactions. Reach it through
/// [`FyuzClient::trade`].
#[derive(Debug)]
pub struct TradeApi<'a> {
    client: &'a FyuzClient,
}

impl<'a> TradeApi<'a> {
    pub(crate) fn new(client: &'a FyuzClient) -> Self {
        Self { client }
    }

    // ---------------------------------------------------------- chain setup

    /// Chain metadata from `GET /config`: contract address, chain id, RPC.
    ///
    /// Fetched once and memoised — it changes about as often as a redeploy.
    pub async fn chain(&self, network: &str) -> Result<ChainInfo, Error> {
        let chains = self
            .client
            .trade_state()
            .chains
            .get_or_try_init(|| async { Ok::<_, Error>(self.client.get_config().await?.chains) })
            .await?;

        for chain in chains {
            if chain.network.as_deref() != Some(network) && chain.chain_id.to_string() != network {
                continue;
            }
            if chain.contract_address.is_none() {
                return Err(invalid(format!(
                    "the API did not publish a contract address for {network:?}, so no \
                     transaction can be built"
                )));
            }
            return Ok(chain.clone());
        }

        let known: Vec<String> = chains
            .iter()
            .map(|c| c.network.clone().unwrap_or_else(|| c.chain_id.to_string()))
            .collect();
        Err(invalid(format!(
            "unknown network {network:?}; the API serves: {}",
            known.join(", ")
        )))
    }

    /// The JSON-RPC client for a chain, from the override or `/config`.
    async fn rpc(&self, network: &str) -> Result<Arc<RpcClient>, Error> {
        {
            let cache = self.client.trade_state().rpcs.lock().await;
            if let Some(existing) = cache.get(network) {
                return Ok(Arc::clone(existing));
            }
        }

        let chain = self.chain(network).await?;
        let url = self
            .client
            .rpc_url()
            .map(str::to_string)
            .or_else(|| chain.rpc_url.clone())
            .ok_or_else(|| {
                invalid(format!(
                    "no RPC endpoint for {network:?}: the API published none, and none was \
                     configured with FyuzClientBuilder::rpc_url"
                ))
            })?;

        let client = Arc::new(RpcClient::new(
            url,
            self.client.rpc_timeout().unwrap_or(DEFAULT_RPC_TIMEOUT),
        )?);

        let mut cache = self.client.trade_state().rpcs.lock().await;
        Ok(Arc::clone(
            cache.entry(network.to_string()).or_insert(client),
        ))
    }

    /// An `eth_call` against the launchpad on `network`.
    async fn call_contract(&self, network: &str, data: &str) -> Result<CallOutcome, Error> {
        let chain = self.chain(network).await?;
        let rpc = self.rpc(network).await?;
        rpc.call(
            chain.contract_address.as_deref().unwrap_or_default(),
            data,
            None,
        )
        .await
    }

    // ---------------------------------------------------------------- reads

    /// Whether the token has left the bonding curve.
    ///
    /// Reads `tokenPools(token).launched` — the contract's own flag, not the
    /// indexer's view of it, so it cannot lag behind a graduation that happened
    /// seconds ago.
    pub async fn is_graduated(&self, network: &str, token: &str) -> Result<bool, Error> {
        let token = normalize_address("token", token)?;
        let data = encode_call(SELECTOR_TOKEN_POOLS, &[address_word(&token)]);

        match self.call_contract(network, &data).await? {
            // (uint256,uint256,uint256,uint256,address,address,uint8,bool) — launched last.
            CallOutcome::Ok(result) => decode_bool_at(&result, 7),
            CallOutcome::Reverted(revert) => {
                Err(revert_error(&revert, &format!("tokenPools({token})")))
            }
        }
    }

    /// `getFirstBuyFee(token)` in wei — the surcharge on a token's first buy.
    pub async fn first_buy_fee(&self, network: &str, token: &str) -> Result<U256, Error> {
        let token = normalize_address("token", token)?;
        let data = encode_call(SELECTOR_GET_FIRST_BUY_FEE, &[address_word(&token)]);

        match self.call_contract(network, &data).await? {
            CallOutcome::Ok(result) => decode_uint256_at(&result, 0),
            CallOutcome::Reverted(revert) => {
                Err(revert_error(&revert, &format!("getFirstBuyFee({token})")))
            }
        }
    }

    /// `getMaxSellableETH(token)` — the ceiling one sell may extract.
    pub async fn max_sellable_wei(&self, network: &str, token: &str) -> Result<U256, Error> {
        let token = normalize_address("token", token)?;
        let data = encode_call(SELECTOR_GET_MAX_SELLABLE_ETH, &[address_word(&token)]);

        match self.call_contract(network, &data).await? {
            CallOutcome::Ok(result) => decode_uint256_at(&result, 0),
            CallOutcome::Reverted(revert) => Err(revert_error(
                &revert,
                &format!("getMaxSellableETH({token})"),
            )),
        }
    }

    /// ERC-20 `allowance(owner, contract)` — how much the curve may pull.
    pub async fn allowance(&self, network: &str, token: &str, owner: &str) -> Result<U256, Error> {
        let token = normalize_address("token", token)?;
        let owner = normalize_address("owner", owner)?;
        let chain = self.chain(network).await?;
        let rpc = self.rpc(network).await?;

        let data = encode_call(
            SELECTOR_ALLOWANCE,
            &[
                address_word(&owner),
                address_word(chain.contract_address.as_deref().unwrap_or_default()),
            ],
        );
        let result = rpc
            .call_or_error(&token, &data, &format!("allowance({owner})"))
            .await?;
        decode_uint256_at(&result, 0)
    }

    /// ERC-20 `balanceOf(owner)`, in the token's smallest unit.
    pub async fn balance_of(&self, network: &str, token: &str, owner: &str) -> Result<U256, Error> {
        let token = normalize_address("token", token)?;
        let owner = normalize_address("owner", owner)?;
        let rpc = self.rpc(network).await?;

        let data = encode_call(SELECTOR_BALANCE_OF, &[address_word(&owner)]);
        let result = rpc
            .call_or_error(&token, &data, &format!("balanceOf({owner})"))
            .await?;
        decode_uint256_at(&result, 0)
    }

    // --------------------------------------------------------------- quotes

    /// `getSwapOutput`, with the graduated revert promoted to a typed error.
    async fn swap_output(
        &self,
        network: &str,
        token: &str,
        amount_in: U256,
        is_eth_input: bool,
    ) -> Result<(U256, u64), Error> {
        let data = encode_call(
            SELECTOR_GET_SWAP_OUTPUT,
            &[
                address_word(token),
                uint256_word(amount_in),
                bool_word(is_eth_input),
            ],
        );

        match self.call_contract(network, &data).await? {
            CallOutcome::Ok(result) => {
                let amount_out = decode_uint256_at(&result, 0)?;
                let impact = decode_uint256_at(&result, 1)?;
                let impact = impact.to_string().parse::<u64>().unwrap_or(u64::MAX);
                Ok((amount_out, impact))
            }
            CallOutcome::Reverted(revert) => {
                if revert_selector(&revert).as_deref() == Some(SELECTOR_ALREADY_LAUNCHED) {
                    return Err(graduated_error(token, None));
                }
                Err(revert_error(&revert, &format!("getSwapOutput({token})")))
            }
        }
    }

    /// Price a buy: tokens out for a given amount of native currency in.
    ///
    /// Returns an error satisfying [`Error::is_graduated`] when the curve is closed.
    pub async fn quote_buy(
        &self,
        network: &str,
        token: &str,
        amount_wei: U256,
    ) -> Result<BuyQuote, Error> {
        let token = normalize_address("token", token)?;
        if amount_wei.is_zero() {
            return Err(invalid("amount_wei must be greater than zero"));
        }

        let (amount_out, price_impact_bps) =
            self.swap_output(network, &token, amount_wei, true).await?;
        let fee = self.first_buy_fee(network, &token).await?;
        let value = amount_wei
            .checked_add(fee)
            .ok_or_else(|| invalid("amount plus first-buy fee exceeds uint256"))?;

        Ok(BuyQuote {
            network: network.to_string(),
            token,
            amount_in_wei: amount_wei,
            first_buy_fee_wei: fee,
            value_wei: value,
            amount_out_wei: amount_out,
            price_impact_bps,
        })
    }

    /// Price a sell: native currency out for a given amount of tokens in.
    pub async fn quote_sell(
        &self,
        network: &str,
        token: &str,
        amount_wei: U256,
    ) -> Result<SellQuote, Error> {
        let token = normalize_address("token", token)?;
        if amount_wei.is_zero() {
            return Err(invalid("amount_wei must be greater than zero"));
        }

        let (amount_out, price_impact_bps) =
            self.swap_output(network, &token, amount_wei, false).await?;

        Ok(SellQuote {
            network: network.to_string(),
            token,
            amount_in_wei: amount_wei,
            amount_out_wei: amount_out,
            price_impact_bps,
        })
    }

    // --------------------------------------------------------------- builds

    /// Spend an exact amount of native currency on a token.
    ///
    /// `transaction.value` already includes the first-buy fee; sending only the
    /// amount reverts with `InsufficientEthValue`. Excess is refunded on-chain.
    pub async fn build_buy(&self, params: &BuyParams) -> Result<BuiltBuy, Error> {
        let quote = self
            .quote_buy(&params.network, &params.token, params.amount_wei)
            .await?;
        let chain = self.chain(&params.network).await?;

        let limit = apply_limit(
            &params.limits,
            quote.amount_out_wei,
            false,
            "min_amount_out",
        )?;
        let deadline = resolve_deadline(&params.limits)?;

        Ok(BuiltBuy {
            transaction: UnsignedTransaction {
                chain_id: chain.chain_id,
                to: chain.contract_address.clone().unwrap_or_default(),
                data: encode_call(
                    SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS,
                    &[
                        address_word(&quote.token),
                        uint256_word(quote.amount_in_wei),
                        uint256_word(limit),
                        uint256_word(U256::from_u64(deadline)),
                    ],
                ),
                value: quote.value_wei,
                from: optional_address(params.limits.from.as_deref())?,
            },
            quote,
            limit_wei: limit,
            deadline,
        })
    }

    /// Buy an exact number of tokens, capping what you spend.
    ///
    /// Slippage runs the other way here: the limit is a `maxAmountIn`, so
    /// `slippage_bps` widens the cap rather than lowering a floor.
    pub async fn build_buy_exact_tokens(
        &self,
        params: &BuyExactTokensParams,
    ) -> Result<BuiltBuy, Error> {
        let token = normalize_address("token", &params.token)?;
        if params.amount_out_wei.is_zero() {
            return Err(invalid("amount_out_wei must be greater than zero"));
        }

        // Price the reverse direction to learn roughly what the tokens cost,
        // then let the caller's tolerance set the ceiling on top of that.
        let (estimate, _) = self
            .swap_output(&params.network, &token, params.amount_out_wei, false)
            .await?;
        if estimate.is_zero() {
            return Err(invalid(format!(
                "the curve prices {} of {token} at zero — ask for more tokens",
                params.amount_out_wei
            )));
        }

        let limit = apply_limit(&params.limits, estimate, true, "max_amount_in")?;
        let fee = self.first_buy_fee(&params.network, &token).await?;
        let chain = self.chain(&params.network).await?;
        let deadline = resolve_deadline(&params.limits)?;
        let value = limit
            .checked_add(fee)
            .ok_or_else(|| invalid("max input plus first-buy fee exceeds uint256"))?;

        Ok(BuiltBuy {
            transaction: UnsignedTransaction {
                chain_id: chain.chain_id,
                to: chain.contract_address.clone().unwrap_or_default(),
                data: encode_call(
                    SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS,
                    &[
                        address_word(&token),
                        uint256_word(params.amount_out_wei),
                        uint256_word(limit),
                        uint256_word(U256::from_u64(deadline)),
                    ],
                ),
                value,
                from: optional_address(params.limits.from.as_deref())?,
            },
            quote: BuyQuote {
                network: params.network.clone(),
                token,
                amount_in_wei: estimate,
                first_buy_fee_wei: fee,
                value_wei: value,
                amount_out_wei: params.amount_out_wei,
                price_impact_bps: 0,
            },
            limit_wei: limit,
            deadline,
        })
    }

    /// Sell tokens for native currency.
    ///
    /// The contract pulls the tokens with `transferFrom`, so an ERC-20 approval
    /// must already be in place — check [`TradeApi::allowance`] and send
    /// [`TradeApi::build_approve`] first, or the swap reverts inside the token.
    pub async fn build_sell(&self, params: &SellParams) -> Result<BuiltSell, Error> {
        let quote = self
            .quote_sell(&params.network, &params.token, params.amount_wei)
            .await?;
        let chain = self.chain(&params.network).await?;

        let limit = apply_limit(
            &params.limits,
            quote.amount_out_wei,
            false,
            "min_amount_out",
        )?;
        let deadline = resolve_deadline(&params.limits)?;

        Ok(BuiltSell {
            transaction: UnsignedTransaction {
                chain_id: chain.chain_id,
                to: chain.contract_address.clone().unwrap_or_default(),
                data: encode_call(
                    SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH,
                    &[
                        address_word(&quote.token),
                        uint256_word(quote.amount_in_wei),
                        uint256_word(limit),
                        uint256_word(U256::from_u64(deadline)),
                    ],
                ),
                value: U256::ZERO,
                from: optional_address(params.limits.from.as_deref())?,
            },
            quote,
            limit_wei: limit,
            deadline,
        })
    }

    /// ERC-20 `approve`, letting the curve pull tokens for a sell.
    ///
    /// Pass [`U256::MAX`] to approve once and forever — it saves a transaction
    /// per sell, at the cost of a standing allowance against an upgradeable
    /// contract.
    pub async fn build_approve(
        &self,
        network: &str,
        token: &str,
        amount_wei: U256,
    ) -> Result<UnsignedTransaction, Error> {
        let token = normalize_address("token", token)?;
        let chain = self.chain(network).await?;

        Ok(UnsignedTransaction {
            chain_id: chain.chain_id,
            to: token,
            data: encode_call(
                SELECTOR_APPROVE,
                &[
                    address_word(chain.contract_address.as_deref().unwrap_or_default()),
                    uint256_word(amount_wei),
                ],
            ),
            value: U256::ZERO,
            from: None,
        })
    }
}

/// Per-client trading state: the memoised `/config` and the RPC clients.
#[derive(Debug, Default)]
pub(crate) struct TradeState {
    pub(crate) chains: OnceCell<Vec<ChainInfo>>,
    pub(crate) rpcs: Mutex<HashMap<String, Arc<RpcClient>>>,
}

/// Turn a quote plus a tolerance into the limit that goes on-chain.
///
/// `up` is which way the tolerance moves the number: `false` for a
/// `minAmountOut` floor, `true` for a `maxAmountIn` ceiling.
fn apply_limit(limits: &Limits, quoted: U256, up: bool, field: &str) -> Result<U256, Error> {
    if limits.limit_wei.is_some() && limits.slippage_bps.is_some() {
        return Err(invalid("pass either slippage_bps or limit_wei, not both"));
    }
    if let Some(limit) = limits.limit_wei {
        return Ok(limit);
    }

    let Some(bps) = limits.slippage_bps else {
        return Err(invalid(format!(
            "slippage protection is required: set slippage_bps (100 = 1%) or limit_wei to \
             choose {field} yourself. There is no default, because the right tolerance \
             depends on the trade and getting it wrong costs you money"
        )));
    };
    if bps >= BPS_DIVISOR {
        return Err(invalid(format!(
            "slippage_bps must be below 10000, got {bps}"
        )));
    }

    let factor = if up {
        BPS_DIVISOR + bps
    } else {
        BPS_DIVISOR - bps
    };
    let scaled = quoted
        .mul_small(factor)
        .ok_or_else(|| invalid("applying slippage overflowed uint256"))?;
    Ok(scaled.div_rem_small(BPS_DIVISOR).0)
}

/// Absolute deadline in unix seconds, from whichever form the caller used.
fn resolve_deadline(limits: &Limits) -> Result<u64, Error> {
    if let Some(deadline) = limits.deadline {
        if deadline == 0 {
            return Err(invalid("deadline must be a positive unix timestamp"));
        }
        return Ok(deadline);
    }
    let window = limits.deadline_seconds.unwrap_or(DEFAULT_DEADLINE_SECONDS);
    if window == 0 {
        return Err(invalid("deadline_seconds must be positive"));
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs();
    Ok(now + window)
}

fn optional_address(value: Option<&str>) -> Result<Option<String>, Error> {
    value.map(|v| normalize_address("from", v)).transpose()
}
