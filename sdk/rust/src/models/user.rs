//! Profiles, leaderboards, seasons, tiers and rewards.

use serde::{Deserialize, Deserializer};

use super::token::{Holder, Token};

/// One row of the global points leaderboard.
///
/// The board resets after every Distributor payout: only activity since the
/// last settled round counts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    /// 1-based rank, already in returned order. Do not re-sort client side.
    pub rank: i32,
    /// Wallet address.
    pub address: String,
    /// Display name, when set.
    #[serde(default)]
    pub username: Option<String>,
    /// Avatar URL, when set.
    #[serde(default)]
    pub avatar: Option<String>,
    /// USD volume in the current round window.
    pub volume_usd: f64,
    /// Trade count in the current round window.
    pub trades: i64,
    /// Points that count toward the payout share — the exact number served to
    /// the Distributor.
    pub points: f64,
    /// Total points earned including locked grants. Always >= [`points`](Self::points).
    /// Display only.
    pub points_total: f64,
    /// Points at round close if the current position is held. Guidance, not a
    /// payout.
    pub points_projected: f64,
    /// USD value currently held.
    pub held_usd: f64,
    /// Estimated BNB slice of the live pot: `90% x pot x (points / payout-set
    /// points)`. `0.0` when below the payout floor.
    pub reward_eth: f64,
}

/// Public profile record.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSummary {
    /// Internal user id.
    pub id: i32,
    /// Wallet address.
    pub address: String,
    /// Display name, when set.
    #[serde(default)]
    pub username: Option<String>,
    /// Avatar URL, when set.
    #[serde(default)]
    pub avatar: Option<String>,
    /// Free-text bio.
    #[serde(default)]
    pub bio: Option<String>,
    /// Profile likes received.
    pub likes: i32,
    /// `true` for Fyuz staff accounts.
    #[serde(default)]
    pub is_admin: Option<bool>,
    /// X/Twitter handle, no `@`.
    #[serde(default)]
    pub twitter_username: Option<String>,
}

/// A comment posted by a user on a token page.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    /// Internal message id.
    pub id: i32,
    /// Token the comment was posted on.
    pub token_address: String,
    /// Address replied to. Always `None` on this endpoint.
    #[serde(default)]
    pub reply_address: Option<String>,
    /// Comment body.
    pub comment: String,
    /// Optional attached code/snippet reference.
    #[serde(default)]
    pub code: Option<String>,
    /// Post time, RFC-3339 (unlike most timestamps on this API, which are UNIX
    /// seconds).
    pub date: String,
    /// Chain slug.
    pub network: String,
}

/// Public profile: identity, holdings, comments, launched tokens and
/// current-round points.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    /// Identity record.
    pub user: UserSummary,
    /// Positive balances only.
    pub holdings: Vec<Holder>,
    /// Newest first, max 50.
    pub chats: Vec<ChatMessage>,
    /// Tokens launched by this address, newest first.
    pub created_tokens: Vec<Token>,
    /// Follower count.
    pub followers: i64,
    /// Followed-account count.
    pub followees: i64,
    /// Active referrals only.
    pub referral_count: i64,
    /// Referral earnings ledger balance.
    pub points: i32,
    /// Points in the current round window; matches the leaderboard's
    /// [`LeaderboardEntry::points`].
    pub trading_points: f64,
    /// USD volume in the current round window.
    pub trading_volume_usd: f64,
    /// Estimated BNB slice of the live pot.
    pub reward_eth: f64,
}

/// A wallet ranked by USD trading volume over the requested window.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopHolderEntry {
    /// Wallet address.
    pub address: String,
    /// Display name, when set.
    #[serde(default)]
    pub username: Option<String>,
    /// Avatar URL, when set.
    #[serde(default)]
    pub avatar: Option<String>,
    /// USD trading volume over the window.
    pub volume: f64,
}

/// One King-of-the-Hill reign.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KingReign {
    /// Token that held the crown.
    pub token_address: String,
    /// Token name.
    pub name: String,
    /// Token ticker.
    pub symbol: String,
    /// Token image URL.
    #[serde(default)]
    pub image: Option<String>,
    /// Chain slug.
    pub network: String,
    /// Reign start, UNIX **seconds**.
    pub started_at: i64,
    /// Reign end, UNIX **seconds**. `None` while the reign is ongoing.
    #[serde(default)]
    pub ended_at: Option<i64>,
    /// Reign length in seconds. Ongoing reigns count up to now.
    pub duration_secs: i64,
}

/// One row of the season standings.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonEntry {
    /// 1-based rank, already in returned order.
    pub rank: i32,
    /// Wallet address.
    pub address: String,
    /// Display name, when set.
    #[serde(default)]
    pub username: Option<String>,
    /// Avatar URL, when set.
    #[serde(default)]
    pub avatar: Option<String>,
    /// Season points.
    pub points: f64,
}

/// Current season window, prize pot and standings.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Season {
    /// Season name.
    pub name: String,
    /// Season start, UNIX **seconds**.
    pub starts_at: i64,
    /// Season end, UNIX **seconds**.
    pub ends_at: i64,
    /// Prize pot in BNB.
    pub prize_pot_eth: f64,
    /// Top 50 with positive points, highest first.
    pub leaderboard: Vec<SeasonEntry>,
}

/// One row of the referral leaderboard.
///
/// Only ACTIVE referrals (the referee has cleared the net-buy floor) count.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferralLeaderEntry {
    /// 1-based rank, already in returned order.
    pub rank: i32,
    /// Referrer wallet address.
    pub address: String,
    /// Display name, when set.
    #[serde(default)]
    pub username: Option<String>,
    /// Avatar URL, when set.
    #[serde(default)]
    pub avatar: Option<String>,
    /// Active referrals only.
    pub referral_count: i64,
    /// USD volume traded by the referees.
    pub referee_volume_usd: f64,
}

/// Display-only trader tier.
///
/// Deserialisation is tolerant: an unknown tier lands in [`Tier::Other`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tier {
    /// From $0 of lifetime volume.
    Bronze,
    /// From $100 of lifetime volume.
    Silver,
    /// From $1,000 of lifetime volume.
    Gold,
    /// From $10,000 of lifetime volume. Top tier.
    Diamond,
    /// A tier this SDK version does not know about, kept verbatim.
    Other(String),
}

impl Tier {
    /// The wire representation of this tier.
    pub fn as_str(&self) -> &str {
        match self {
            Tier::Bronze => "Bronze",
            Tier::Silver => "Silver",
            Tier::Gold => "Gold",
            Tier::Diamond => "Diamond",
            Tier::Other(s) => s,
        }
    }
}

impl std::fmt::Display for Tier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for Tier {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "Bronze" => Tier::Bronze,
            "Silver" => Tier::Silver,
            "Gold" => Tier::Gold,
            "Diamond" => Tier::Diamond,
            _ => Tier::Other(raw),
        })
    }
}

/// Display-only trader tier derived from lifetime USD trade volume.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TierInfo {
    /// Wallet address, lower-cased.
    pub address: String,
    /// Lifetime USD trade volume.
    pub volume_usd: f64,
    /// Current tier.
    pub tier: Tier,
    /// Next tier up. `None` at Diamond.
    #[serde(default)]
    pub next_tier: Option<Tier>,
    /// Volume needed for the next tier. `None` at Diamond.
    #[serde(default)]
    pub next_threshold_usd: Option<f64>,
    /// Progress toward the next tier, 0-100. `100.0` at Diamond.
    pub progress_pct: f64,
}

/// A quest and one address's progress against it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestState {
    /// Stable machine key.
    pub key: String,
    /// Display title.
    pub title: String,
    /// Display description.
    pub description: String,
    /// Quest cadence, e.g. `daily` or `oneoff`.
    pub kind: String,
    /// Value that completes the quest.
    pub target: f64,
    /// Current progress, clamped to [`target`](Self::target).
    pub progress: f64,
    /// Points awarded on completion.
    pub points: f64,
    /// `true` once `progress >= target`.
    pub completed: bool,
    /// `true` once granted. Granted automatically by the indexer — there is no
    /// claim call on this public surface.
    pub claimed: bool,
}

/// A lifetime achievement and whether an address has earned it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementState {
    /// Stable machine key.
    pub key: String,
    /// Display title.
    pub title: String,
    /// Display description.
    pub description: String,
    /// Display icon name.
    pub icon: String,
    /// Points awarded when earned.
    pub points: f64,
    /// `true` once earned.
    pub earned: bool,
}

/// Rewards ledger for an address: streaks, points and quest/achievement state.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rewards {
    /// Wallet address.
    pub address: String,
    /// Consecutive active days.
    pub current_streak: i64,
    /// Longest streak ever reached.
    pub longest_streak: i64,
    /// Headline figure — identical to the leaderboard's
    /// [`LeaderboardEntry::points`].
    pub points: f64,
    /// Grant subtotal only; not the number to lead with.
    pub bonus_points: f64,
    /// Quest progress.
    pub quests: Vec<QuestState>,
    /// Achievement progress.
    pub achievements: Vec<AchievementState>,
}
