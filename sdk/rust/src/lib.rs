//! Async Rust client for the [Fyuz](https://fyuz.fun) public REST API.
//!
//! Fyuz is a bonding-curve token launchpad on BNB Smart Chain. A new token
//! trades on an internal bonding curve until it reaches a **$30,000 market cap**,
//! at which point it *graduates* into a PancakeSwap V2 pair.
//!
//! **Before graduation there is no DEX pool anywhere.** `pair_address` is
//! `None`, no on-chain pair exists to quote, and this API is the *only* source
//! of price, liquidity and volume data for that token. Anything you build that
//! reads pre-graduation prices from a DEX aggregator will simply find nothing.
//!
//! Every endpoint in this crate is unauthenticated and safe to poll.
//!
//! # Quickstart
//!
//! ```no_run
//! use fyuz::{DiscoverParams, DiscoverTab, FyuzClient};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), fyuz::Error> {
//!     let client = FyuzClient::new()?;
//!
//!     let trending = client
//!         .discover(&DiscoverParams::new().tab(DiscoverTab::Trending).limit(10))
//!         .await?;
//!
//!     for token in &trending {
//!         println!(
//!             "{:<10} ${:>12.0} mcap   {:>6.2}% to graduation",
//!             token.symbol, token.marketcap, token.graduation_pct
//!         );
//!     }
//!
//!     Ok(())
//! }
//! ```
//!
//! # Decimal strings, and why they are not floats
//!
//! Token balances, prices, market caps and every `*_wei` field come back as
//! **decimal strings** and stay [`String`] in this crate's models. An 18-decimal
//! token amount, or a `uint256` wei total, does not survive a round trip through
//! `f64`:
//!
//! ```
//! let wire = "123456789012345678901234567890";
//! // What a "just parse it as a number" client would do:
//! let lossy = wire.parse::<f64>().unwrap();
//! assert_ne!(format!("{lossy:.0}"), wire); // silently wrong
//! ```
//!
//! If you need arithmetic, parse into a big-integer or decimal type of your
//! choosing (`rust_decimal`, `bigdecimal`, `primitive_types::U256`, …) at the
//! edge of your own code. The SDK deliberately does not pick one for you, and
//! deliberately never parses these into `f64` on your behalf.
//!
//! Aggregates that the server already computed in floating point — `volume_usd`,
//! `points`, `reward_eth`, `pot_bnb`, PnL figures — arrive as JSON numbers and
//! are modelled as `f64`.
//!
//! # `None` is not `0`
//!
//! [`Pot::pot_bnb`](models::Pot::pot_bnb),
//! [`Claimable::claimable_wei`](models::Claimable::claimable_wei),
//! [`TokenDetail::curve_holding`](models::TokenDetail::curve_holding) and the
//! nullable `*_wei` fields on [`RoundReceipt`] are `None`
//! when the value is **unknown** — the RPC was unreachable, or the settlement is
//! not indexed yet. Rendering `0` in that case tells a user something false.
//!
//! # Rate limits and retries
//!
//! The API allows 120 requests per minute per IP and answers `429` with
//! `{"error": "Too many requests"}` past that. The client retries `429`s, `5xx`s
//! and transport failures automatically with exponential backoff and full
//! jitter, honouring `Retry-After` when the server sends one. Other `4xx`
//! statuses are never retried. Three retries is the default:
//!
//! ```no_run
//! # fn demo() -> Result<(), fyuz::Error> {
//! use std::time::Duration;
//!
//! let client = fyuz::FyuzClient::builder()
//!     .timeout(Duration::from_secs(10))
//!     .max_retries(5)
//!     .user_agent("acme-indexer/2.1 (ops@acme.example)")
//!     .build()?;
//! # let _ = client;
//! # Ok(())
//! # }
//! ```
//!
//! Once the retries are spent the call fails with [`Error::RateLimited`], which
//! is a distinct variant precisely so a backpressure handler can match on it.
//!
//! # What is not here
//!
//! Only the public, unauthenticated surface is implemented. The API-key-gated
//! routes (recording a distribution round, posting chats, watchlists, paper
//! trading, airdrops, …) are deliberately absent — including `POST
//! /distributor/rounds`, which shares a path with
//! [`Distributor::list_rounds`] but is not a public endpoint.

#![deny(missing_docs)]
#![deny(rustdoc::broken_intra_doc_links)]
#![warn(clippy::all)]

mod abi;
mod api;
mod client;
mod error;
mod pagination;
mod params;
mod revert;
mod rpc;
mod trade;

pub mod models;

pub use abi::{
    address_word, bool_word, decode_address_at, decode_bool_at, decode_uint256_at, encode_call,
    format_units, normalize_address, parse_units, uint256_word, SELECTOR_ALLOWANCE,
    SELECTOR_APPROVE, SELECTOR_BALANCE_OF, SELECTOR_GET_FIRST_BUY_FEE,
    SELECTOR_GET_MAX_SELLABLE_ETH, SELECTOR_GET_SWAP_OUTPUT, SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS,
    SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS, SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH, SELECTOR_TOKEN_POOLS,
    U256,
};
pub use api::distributor::Distributor;
pub use client::{FyuzClient, FyuzClientBuilder, DEFAULT_BASE_URL, VERSION};
pub use error::{Error, Result};
pub use pagination::TokenPager;
pub use params::{
    ChartDataParams, DiscoverParams, DiscoverTab, ListTokensParams, RecentTradesParams,
    RoundsParams, SharesParams, SortDirection, TokenDetailParams, TokenStatus, TokenTradesParams,
    TopHoldersParams,
};
pub use revert::{revert_error, revert_selector, RevertKind, SELECTOR_ALREADY_LAUNCHED};
pub use rpc::{CallOutcome, RpcClient, DEFAULT_RPC_TIMEOUT};
pub use trade::{
    BuiltBuy, BuiltSell, BuyExactTokensParams, BuyParams, BuyQuote, SellParams, SellQuote,
    TradeApi, UnsignedTransaction, DEFAULT_DEADLINE_SECONDS, DEFAULT_NETWORK,
};

// Every response model is re-exported at the crate root for convenience; they
// also live in `fyuz::models` if you prefer the namespace.
pub use models::*;
