//! Distributor: pot, share allocation and the public payout ledger.
//!
//! # Wei fields are strings, always
//!
//! Every `*_wei` field in this module is an exact `uint256` decimal string with
//! no fractional part. `1_000_000_000_000_000_000` wei is 1 BNB; lifetime totals
//! run far past `2^53` and would be silently corrupted by `f64`. Keep them as
//! strings, compare them as strings or big integers, and format them for display
//! by shifting the decimal point 18 places — never by parsing to a float.
//!
//! [`RoundReceipt::vrf_random`] is likewise a decimal string (a `uint256` VRF
//! word), not hex and not a number.

use serde::Deserialize;

/// Lifetime Distributor payback totals.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayoutStats {
    /// Everything ever paid out — pro-rata plus lottery. Exact wei as a decimal
    /// string; `"0"` when nothing has settled.
    pub total_paid_wei: String,
    /// Number of settled rounds.
    pub rounds_settled: i64,
    /// Distinct addresses that have received something.
    pub unique_recipients: i64,
    /// Largest single payout. Exact wei as a decimal string; `"0"` when nothing
    /// has settled.
    pub largest_payout_wei: String,
    /// Settlement time of the most recent round, UNIX **seconds**. `None` when
    /// nothing has settled.
    #[serde(default)]
    pub last_round_at: Option<i64>,
}

/// Live undistributed pot and the round parameters needed to price a point.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pot {
    /// Live BNB balance of the Distributor.
    ///
    /// `None` when no Distributor is configured or the RPC is unreachable —
    /// hide the figure, do **not** render `0`.
    #[serde(default)]
    pub pot_bnb: Option<f64>,
    /// Basis points paid pro-rata by points; the remainder goes to the VRF
    /// winner.
    pub distribute_bps: f64,
    /// Next round close, UNIX **seconds**, read from the contract's own
    /// schedule.
    pub round_end: i64,
    /// Points across the whole payout set — the denominator of every share.
    /// `None` when it could not be computed (not zero).
    #[serde(default)]
    pub total_points: Option<f64>,
    /// Points credited per $1 of volume. Buys and sells score alike.
    pub points_per_usd: f64,
}

/// One holder's committed share of the next round.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareEntry {
    /// Holder wallet address.
    pub address: String,
    /// Points earned in the window.
    pub points: f64,
    /// The holder's fraction of `2^32` — the on-chain share unit. Fits `u32`.
    pub share: i64,
}

/// The share allocation the round-runner posts on-chain, plus the exact calldata
/// it posts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shares {
    /// Window start, UNIX **seconds**.
    pub from: i64,
    /// Window end, UNIX **seconds**.
    pub to: i64,
    /// Total points across the returned set.
    pub total_points: f64,
    /// Highest points first, capped at 100 (the contract's `MAX_HOLDERS`).
    pub holders: Vec<ShareEntry>,
    /// Calldata for `Distributor.postShares`: 24-byte entries of a 20-byte
    /// address followed by the big-endian `uint32` share. `0x`-prefixed hex.
    pub packed: String,
}

/// A settled distribution round.
///
/// Null wei fields mean the on-chain settlement has not been indexed yet — they
/// do **not** mean zero.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundReceipt {
    /// Round number.
    pub round_id: i64,
    /// Window start, UNIX **seconds**.
    pub time_start: i64,
    /// Window end, UNIX **seconds**; becomes the start of the next leaderboard
    /// window.
    pub time_end: i64,
    /// Settlement transaction hash.
    #[serde(default)]
    pub tx_hash: Option<String>,
    /// Whole amount that left the contract — pro-rata plus lottery. Exact wei as
    /// a decimal string.
    #[serde(default)]
    pub pot_wei: Option<String>,
    /// Pro-rata portion only. Exact wei as a decimal string.
    #[serde(default)]
    pub distributed_wei: Option<String>,
    /// VRF-picked lottery winner.
    #[serde(default)]
    pub winner_address: Option<String>,
    /// Amount sent to the lottery winner. Exact wei as a decimal string.
    #[serde(default)]
    pub winner_amount_wei: Option<String>,
    /// Number of holders paid pro-rata.
    #[serde(default)]
    pub holder_count: Option<i32>,
    /// The VRF word that selected the winner, as a **decimal string** (not hex).
    /// Published so the draw can be checked against the coordinator's own
    /// fulfilment.
    #[serde(default)]
    pub vrf_random: Option<String>,
    /// Settlement time, UNIX **seconds**.
    #[serde(default)]
    pub distributed_at: Option<i64>,
}

/// One recipient's line in a round.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayoutLine {
    /// Round this line belongs to.
    pub round_id: i64,
    /// Recipient wallet address.
    pub address: String,
    /// The recipient's fraction of `2^32`, exactly as committed on-chain.
    pub share: i64,
    /// Exact wei as a decimal string.
    pub amount_wei: String,
    /// Recipient's display name, when set.
    #[serde(default)]
    pub username: Option<String>,
    /// Recipient's avatar URL, when set.
    #[serde(default)]
    pub avatar: Option<String>,
}

/// A round receipt with its recipient list.
///
/// On the wire the receipt fields sit at the **top level** next to `payouts`;
/// [`round`](Self::round) is `#[serde(flatten)]`ed, so
/// `detail.round.round_id` reads the same `roundId` key the API sends.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundDetail {
    /// The receipt fields, flattened into the top level of the JSON object.
    #[serde(flatten)]
    pub round: RoundReceipt,
    /// Recipients, richest first.
    pub payouts: Vec<PayoutLine>,
}

/// Every payout a single wallet has received.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressPayouts {
    /// Wallet address, lower-cased.
    pub address: String,
    /// Lifetime wei received across every settled round. Summed exactly, not in
    /// floating point.
    pub total_wei: String,
    /// Number of rounds this wallet was paid in.
    pub rounds_paid: i64,
    /// Payout lines, newest round first.
    pub payouts: Vec<PayoutLine>,
}

/// Wei owed to an address from payout pushes the contract could not complete
/// (contract wallets, reverting receivers).
///
/// Withdrawable by calling `claim()` on the Distributor — the wallet signs, this
/// API only reads.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claimable {
    /// Wallet address, lower-cased.
    pub address: String,
    /// Exact wei as a decimal string. `None` when the RPC is unreachable or no
    /// Distributor is configured — hide the banner rather than telling someone
    /// they are owed nothing.
    #[serde(default)]
    pub claimable_wei: Option<String>,
    /// Where to send the `claim()`. `None` when unconfigured.
    #[serde(default)]
    pub distributor_address: Option<String>,
}
