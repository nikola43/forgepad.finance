//! The `/distributor/*` endpoints: pot, shares and the public payout ledger.

use crate::client::{seg, FyuzClient, QueryPairs};
use crate::error::Result;
use crate::models::{
    AddressPayouts, Claimable, PayoutStats, Pot, RoundDetail, RoundReceipt, Shares,
};
use crate::params::{RoundsParams, SharesParams, ToQuery};

/// The Distributor endpoints, reached with
/// [`FyuzClient::distributor`](crate::FyuzClient::distributor).
///
/// The Distributor pays back a share of platform fees every round: most of the
/// pot pro-rata by points, the remainder to one VRF-picked winner. Everything
/// here is a public read of that ledger.
///
/// **Every `*_wei` field is an exact decimal string.** Lifetime totals run past
/// `2^53`, so parsing them into `f64` corrupts them silently. See the
/// [`models`](crate::models) docs.
///
/// ```no_run
/// # async fn demo() -> Result<(), fyuz::Error> {
/// let client = fyuz::FyuzClient::new()?;
/// let stats = client.distributor().get_stats().await?;
/// println!("{} wei paid out over {} rounds", stats.total_paid_wei, stats.rounds_settled);
/// # Ok(())
/// # }
/// ```
#[derive(Debug, Clone, Copy)]
pub struct Distributor<'a> {
    client: &'a FyuzClient,
}

impl<'a> Distributor<'a> {
    pub(crate) fn new(client: &'a FyuzClient) -> Self {
        Self { client }
    }

    /// `GET /distributor/stats` — lifetime payback totals.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let stats = client.distributor().get_stats().await?;
    /// // Decimal string, not a number: print it, do not parse it.
    /// println!("largest single payout: {} wei", stats.largest_payout_wei);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_stats(&self) -> Result<PayoutStats> {
        self.client
            .get_json("/distributor/stats", QueryPairs::new())
            .await
    }

    /// `GET /distributor/pot` — the live undistributed pot and the parameters
    /// needed to price a point.
    ///
    /// [`Pot::pot_bnb`] and [`Pot::total_points`] are `None` when the value could
    /// not be read. That is **unknown**, not zero — hide the figure rather than
    /// showing `0`.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let pot = client.distributor().get_pot().await?;
    /// if let (Some(bnb), Some(points)) = (pot.pot_bnb, pot.total_points) {
    ///     println!("{:.6} BNB per point", bnb * pot.distribute_bps / 10_000.0 / points);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_pot(&self) -> Result<Pot> {
        self.client
            .get_json("/distributor/pot", QueryPairs::new())
            .await
    }

    /// `GET /distributor/shares` — the share allocation for the current window,
    /// plus the exact calldata the round-runner posts on-chain.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// use fyuz::SharesParams;
    ///
    /// let client = fyuz::FyuzClient::new()?;
    /// let shares = client.distributor().get_shares(&SharesParams::new().limit(50)).await?;
    /// println!("{} holders, calldata {} bytes", shares.holders.len(), shares.packed.len() / 2 - 1);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_shares(&self, params: &SharesParams) -> Result<Shares> {
        self.client
            .get_json("/distributor/shares", params.to_query())
            .await
    }

    /// `GET /distributor/rounds` — the public payout ledger, newest first.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// use fyuz::RoundsParams;
    ///
    /// let client = fyuz::FyuzClient::new()?;
    /// for round in client.distributor().list_rounds(&RoundsParams::new().limit(5)).await? {
    ///     // `None` means "not indexed yet", never zero.
    ///     match round.distributed_wei.as_deref() {
    ///         Some(wei) => println!("round {}: {wei} wei", round.round_id),
    ///         None => println!("round {}: pending settlement", round.round_id),
    ///     }
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn list_rounds(&self, params: &RoundsParams) -> Result<Vec<RoundReceipt>> {
        self.client
            .get_json("/distributor/rounds", params.to_query())
            .await
    }

    /// `GET /distributor/rounds/{id}` — one round's receipt and its recipient
    /// list.
    ///
    /// The receipt fields are flattened into the top level of the JSON object;
    /// in Rust they live under [`RoundDetail::round`].
    ///
    /// Answers `404` for an unknown round.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let detail = client.distributor().get_round(7).await?;
    /// println!("round {} paid {} wallets", detail.round.round_id, detail.payouts.len());
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_round(&self, id: i64) -> Result<RoundDetail> {
        self.client
            .get_json(&format!("/distributor/rounds/{id}"), QueryPairs::new())
            .await
    }

    /// `GET /distributor/payouts/{address}` — every payout one wallet has
    /// received.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let paid = client
    ///     .distributor()
    ///     .get_payouts("0x1111111111111111111111111111111111111111")
    ///     .await?;
    /// println!("{} wei across {} rounds", paid.total_wei, paid.rounds_paid);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_payouts(&self, address: &str) -> Result<AddressPayouts> {
        self.client
            .get_json(
                &format!("/distributor/payouts/{}", seg(address)),
                QueryPairs::new(),
            )
            .await
    }

    /// `GET /distributor/claimable/{address}` — wei owed from payout pushes the
    /// contract could not complete.
    ///
    /// [`Claimable::claimable_wei`] is `None` when the RPC is unreachable or no
    /// Distributor is configured. Hide the banner in that case rather than
    /// telling someone they are owed nothing.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let c = client
    ///     .distributor()
    ///     .get_claimable("0x1111111111111111111111111111111111111111")
    ///     .await?;
    ///
    /// match c.claimable_wei.as_deref() {
    ///     Some("0") => println!("nothing pending"),
    ///     Some(wei) => println!("{wei} wei claimable from {:?}", c.distributor_address),
    ///     None => println!("unknown — do not render a zero here"),
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_claimable(&self, address: &str) -> Result<Claimable> {
        self.client
            .get_json(
                &format!("/distributor/claimable/{}", seg(address)),
                QueryPairs::new(),
            )
            .await
    }
}
