//! Wallets, profiles, leaderboards, seasons, tiers and rewards.

use crate::client::{seg, FyuzClient, QueryPairs};
use crate::error::Result;
use crate::models::{
    KingReign, LeaderboardEntry, Portfolio, ReferralLeaderEntry, Rewards, Season, TierInfo,
    TopHolderEntry, UserProfile, WalletStats,
};
use crate::params::{ToQuery, TopHoldersParams};

impl FyuzClient {
    /// `GET /wallet/{address}` — average-cost PnL rolled up across every token
    /// the wallet has traded, plus win rate, volume and holding value.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let w = client.get_wallet("0x1111111111111111111111111111111111111111").await?;
    /// println!("{:+.2} USD over {} trades", w.total_pnl_usd, w.trade_count);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_wallet(&self, address: &str) -> Result<WalletStats> {
        self.get_json(&format!("/wallet/{}", seg(address)), QueryPairs::new())
            .await
    }

    /// `GET /portfolio/{address}` — current holdings with per-position PnL.
    ///
    /// An address with no trades returns zeroed totals and an empty
    /// `positions` list rather than a 404.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let p = client.get_portfolio("0x1111111111111111111111111111111111111111").await?;
    /// for pos in &p.positions {
    ///     println!("{:<8} ${:>10.2} ({:+.1}%)", pos.symbol, pos.value_usd, pos.unrealized_pnl_pct);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_portfolio(&self, address: &str) -> Result<Portfolio> {
        self.get_json(&format!("/portfolio/{}", seg(address)), QueryPairs::new())
            .await
    }

    /// `GET /users/leaderboard` — the global points leaderboard.
    ///
    /// The board resets after every Distributor payout: only activity since the
    /// last settled round counts. `limit` is clamped by the server to 1-500;
    /// `None` takes the server default of 100.
    ///
    /// Rows arrive pre-ranked — [`LeaderboardEntry::rank`] is authoritative, so
    /// do not re-sort them.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// for row in client.get_user_leaderboard(Some(10)).await? {
    ///     println!("#{:<3} {} {:.1} pts", row.rank, row.address, row.points);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_user_leaderboard(&self, limit: Option<i64>) -> Result<Vec<LeaderboardEntry>> {
        self.get_json("/users/leaderboard", limit_query(limit)).await
    }

    /// `GET /users/profile/{address}` — public profile: identity, holdings,
    /// comments, launched tokens and current-round points.
    ///
    /// Answers `404` for an address with no profile; check with
    /// [`Error::is_not_found`](crate::Error::is_not_found).
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// match client.get_user_profile("0x1111111111111111111111111111111111111111").await {
    ///     Ok(profile) => println!("{:?}", profile.user.username),
    ///     Err(e) if e.is_not_found() => println!("no profile"),
    ///     Err(e) => return Err(e),
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_user_profile(&self, address: &str) -> Result<UserProfile> {
        self.get_json(&format!("/users/profile/{}", seg(address)), QueryPairs::new())
            .await
    }

    /// `GET /users/top/{count}` — the wallets with the most USD volume over a
    /// window.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// use fyuz::TopHoldersParams;
    ///
    /// let client = fyuz::FyuzClient::new()?;
    /// let top = client
    ///     .get_top_holders(10, &TopHoldersParams::new().network("bsc"))
    ///     .await?;
    ///
    /// for row in &top {
    ///     println!("{} ${:.0}", row.address, row.volume);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_top_holders(
        &self,
        count: i64,
        params: &TopHoldersParams,
    ) -> Result<Vec<TopHolderEntry>> {
        self.get_json(&format!("/users/top/{count}"), params.to_query())
            .await
    }

    /// `GET /kings/history` — past King-of-the-Hill reigns, most recent first,
    /// capped at 100.
    ///
    /// An ongoing reign has [`KingReign::ended_at`] of `None` and a
    /// `duration_secs` that counts up to now.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// for reign in client.get_kings_history().await? {
    ///     let state = if reign.ended_at.is_none() { "reigning" } else { "past" };
    ///     println!("{:<8} {state} for {}s", reign.symbol, reign.duration_secs);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_kings_history(&self) -> Result<Vec<KingReign>> {
        self.get_json("/kings/history", QueryPairs::new()).await
    }

    /// `GET /season` — the current season window, prize pot and standings.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let season = client.get_season().await?;
    /// println!("{}: {} BNB pot", season.name, season.prize_pot_eth);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_season(&self) -> Result<Season> {
        self.get_json("/season", QueryPairs::new()).await
    }

    /// `GET /referrals/leaderboard` — referrers ranked by active referrals.
    ///
    /// `limit` is clamped by the server to 1-500; `None` takes the server
    /// default of 100.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// for row in client.get_referral_leaderboard(None).await? {
    ///     println!("#{} {} — {} referrals", row.rank, row.address, row.referral_count);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_referral_leaderboard(
        &self,
        limit: Option<i64>,
    ) -> Result<Vec<ReferralLeaderEntry>> {
        self.get_json("/referrals/leaderboard", limit_query(limit))
            .await
    }

    /// `GET /tier/{address}` — display-only trader tier from lifetime USD
    /// volume: Bronze ($0), Silver ($100), Gold ($1,000), Diamond ($10,000).
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let tier = client.get_tier("0x1111111111111111111111111111111111111111").await?;
    /// println!("{} — {:.0}% to {:?}", tier.tier, tier.progress_pct, tier.next_tier);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_tier(&self, address: &str) -> Result<TierInfo> {
        self.get_json(&format!("/tier/{}", seg(address)), QueryPairs::new())
            .await
    }

    /// `GET /rewards/{address}` — streaks, points and quest/achievement state.
    ///
    /// Read-only: rewards are granted automatically by the indexer as they are
    /// earned, so there is no claim step on this surface.
    ///
    /// ```no_run
    /// # async fn demo() -> Result<(), fyuz::Error> {
    /// let client = fyuz::FyuzClient::new()?;
    /// let r = client.get_rewards("0x1111111111111111111111111111111111111111").await?;
    /// println!("{} day streak, {:.1} pts", r.current_streak, r.points);
    /// # Ok(())
    /// # }
    /// ```
    pub async fn get_rewards(&self, address: &str) -> Result<Rewards> {
        self.get_json(&format!("/rewards/{}", seg(address)), QueryPairs::new())
            .await
    }
}

/// The `limit` query the two leaderboards share.
fn limit_query(limit: Option<i64>) -> QueryPairs {
    match limit {
        Some(limit) => vec![("limit", limit.to_string())],
        None => QueryPairs::new(),
    }
}
