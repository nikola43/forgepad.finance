//! Response types for every endpoint of the Fyuz public API.
//!
//! Every model derives [`Deserialize`](serde::Deserialize), [`Debug`] and
//! [`Clone`]. Field names are snake_case in Rust and are mapped to the API's
//! camelCase wire names with `#[serde(rename_all = "camelCase")]`.
//!
//! # Two number conventions, and why it matters
//!
//! * **Decimal strings** ([`Token::marketcap`], [`Token::price`],
//!   [`Trade::eth_amount`], every `*_wei` field, …) carry values that do not fit
//!   in an `f64` without loss: 18-decimal token amounts and `uint256` wei. They
//!   stay [`String`] in these models on purpose. Parsing them into `f64` is a
//!   silent precision bug — see the crate-level docs for the recommended
//!   alternatives.
//! * **`f64` aggregates** (`volume_usd`, `points`, `reward_eth`, `pot_bnb`, …)
//!   are already-rounded analytics numbers the server computed in floating
//!   point. They arrive as JSON numbers and are modelled as `f64`.
//!
//! `Option::None` never means zero. `pot_bnb`, `claimable_wei`,
//! [`TokenDetail::curve_holding`] and the nullable `*_wei` fields on
//! [`RoundReceipt`] are `null` when the value is *unknown* (RPC unreachable, not
//! yet indexed). Rendering `0` in that case is a correctness bug.

mod analytics;
mod distributor;
mod meta;
mod token;
mod trade;
mod user;

pub use analytics::{Portfolio, PortfolioPosition, TokenAnalytics, TopTrader, WalletStats};
pub use distributor::{
    AddressPayouts, Claimable, PayoutLine, PayoutStats, Pot, RoundDetail, RoundReceipt, ShareEntry,
    Shares,
};
pub use meta::{ChainConfig, ChainInfo, HealthStatus};
pub use token::{CreatorInfo, DiscoverToken, Holder, KingResponse, Token, TokenDetail, TokenPage};
pub use trade::{Candle, RecentTrades, Trade, TradeSide};
pub use user::{
    AchievementState, ChatMessage, KingReign, LeaderboardEntry, QuestState, ReferralLeaderEntry,
    Rewards, Season, SeasonEntry, Tier, TierInfo, TopHolderEntry, UserProfile, UserSummary,
};
