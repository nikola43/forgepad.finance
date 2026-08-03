package fyuz

import "time"

// Tier is a display-only trader tier derived from lifetime USD trade volume.
type Tier string

// The four tiers and their lifetime-volume thresholds.
const (
	TierBronze  Tier = "Bronze"  // $0
	TierSilver  Tier = "Silver"  // $100
	TierGold    Tier = "Gold"    // $1,000
	TierDiamond Tier = "Diamond" // $10,000
)

// LeaderboardEntry is one row of the global points leaderboard.
//
// The board resets after every Distributor payout: only activity since the
// last settled round counts.
type LeaderboardEntry struct {
	// Rank is the server-assigned 1-based ordinal in returned order. Do not
	// re-sort client-side.
	Rank     int64   `json:"rank"`
	Address  string  `json:"address"`
	Username *string `json:"username"`
	Avatar   *string `json:"avatar"`
	// VolumeUsd is USD volume in the current round window.
	VolumeUsd float64 `json:"volumeUsd"`
	Trades    int64   `json:"trades"`
	// Points counts toward the payout share — the exact number served to the
	// Distributor. This is the headline figure.
	Points float64 `json:"points"`
	// PointsTotal includes locked grants. Always >= Points. Display only.
	PointsTotal float64 `json:"pointsTotal"`
	// PointsProjected is the points at round close if the current position is
	// held. Guidance, not a payout.
	PointsProjected float64 `json:"pointsProjected"`
	// HeldUsd is the USD value currently held.
	HeldUsd float64 `json:"heldUsd"`
	// RewardEth is the estimated BNB slice of the live pot:
	// 90% x pot x (points / payout-set points). Zero below the payout floor.
	RewardEth float64 `json:"rewardEth"`
}

// UserSummary is a public profile record.
type UserSummary struct {
	ID       int64   `json:"id"`
	Address  string  `json:"address"`
	Username *string `json:"username"`
	Avatar   *string `json:"avatar"`
	Bio      *string `json:"bio"`
	Likes    int64   `json:"likes"`
	IsAdmin  *bool   `json:"isAdmin"`
	// TwitterUsername is the X/Twitter handle without the leading @.
	TwitterUsername *string `json:"twitterUsername"`
}

// ChatMessage is a comment posted by a user on a token page.
type ChatMessage struct {
	ID           int64  `json:"id"`
	TokenAddress string `json:"tokenAddress"`
	// ReplyAddress is always nil on the public profile endpoint.
	ReplyAddress *string `json:"replyAddress"`
	Comment      string  `json:"comment"`
	Code         *string `json:"code"`
	// Date is an RFC-3339 timestamp, unlike the UNIX-second timestamps used
	// elsewhere in the API.
	Date    time.Time `json:"date"`
	Network string    `json:"network"`
}

// UserProfile is the public profile for an address: identity, current
// holdings, comments, launched tokens and current-round points.
type UserProfile struct {
	User UserSummary `json:"user"`
	// Holdings lists positive balances only.
	Holdings []Holder `json:"holdings"`
	// Chats is newest first, capped at 50.
	Chats []ChatMessage `json:"chats"`
	// CreatedTokens are the tokens launched by this address, newest first.
	CreatedTokens []Token `json:"createdTokens"`
	Followers     int64   `json:"followers"`
	Followees     int64   `json:"followees"`
	// ReferralCount counts active referrals only.
	ReferralCount int64 `json:"referralCount"`
	// Points is the referral earnings ledger balance, not the trading points.
	Points int64 `json:"points"`
	// TradingPoints is the points in the current round window; it matches the
	// leaderboard's Points.
	TradingPoints float64 `json:"tradingPoints"`
	// TradingVolumeUsd is USD volume in the current round window.
	TradingVolumeUsd float64 `json:"tradingVolumeUsd"`
	// RewardEth is the estimated BNB slice of the live pot.
	RewardEth float64 `json:"rewardEth"`
}

// TopHolderEntry is a wallet ranked by USD trading volume over the requested
// window.
type TopHolderEntry struct {
	Address  string  `json:"address"`
	Username *string `json:"username"`
	Avatar   *string `json:"avatar"`
	// Volume is USD trading volume over the window.
	Volume float64 `json:"volume"`
}

// KingReign is one King-of-the-Hill reign: the period a token spent as the
// platform's leading token.
type KingReign struct {
	TokenAddress string  `json:"tokenAddress"`
	Name         string  `json:"name"`
	Symbol       string  `json:"symbol"`
	Image        *string `json:"image"`
	Network      string  `json:"network"`
	// StartedAt is UNIX seconds.
	StartedAt int64 `json:"startedAt"`
	// EndedAt is UNIX seconds, nil while the reign is ongoing.
	EndedAt *int64 `json:"endedAt"`
	// DurationSecs counts up to now for an ongoing reign.
	DurationSecs int64 `json:"durationSecs"`
}

// Ongoing reports whether this reign is still in progress.
func (k KingReign) Ongoing() bool { return k.EndedAt == nil }

// SeasonEntry is one row of the season standings.
type SeasonEntry struct {
	// Rank is the server-assigned 1-based ordinal in returned order.
	Rank     int64   `json:"rank"`
	Address  string  `json:"address"`
	Username *string `json:"username"`
	Avatar   *string `json:"avatar"`
	Points   float64 `json:"points"`
}

// Season is the current season window, prize pot and standings.
type Season struct {
	Name string `json:"name"`
	// StartsAt is UNIX seconds.
	StartsAt int64 `json:"startsAt"`
	// EndsAt is UNIX seconds.
	EndsAt int64 `json:"endsAt"`
	// PrizePotEth is the prize pot in BNB.
	PrizePotEth float64 `json:"prizePotEth"`
	// Leaderboard is the top 50 with positive points, highest first.
	Leaderboard []SeasonEntry `json:"leaderboard"`
}

// ReferralLeaderEntry is one row of the referral leaderboard. Only ACTIVE
// referrals — where the referee has cleared the net-buy floor — are counted.
type ReferralLeaderEntry struct {
	// Rank is the server-assigned 1-based ordinal in returned order.
	Rank     int64   `json:"rank"`
	Address  string  `json:"address"`
	Username *string `json:"username"`
	Avatar   *string `json:"avatar"`
	// ReferralCount counts active referrals only.
	ReferralCount int64 `json:"referralCount"`
	// RefereeVolumeUsd is the USD volume traded by those referees.
	RefereeVolumeUsd float64 `json:"refereeVolumeUsd"`
}

// TierInfo is the display-only trader tier for an address.
type TierInfo struct {
	// Address is lower-cased.
	Address string `json:"address"`
	// VolumeUsd is lifetime USD trade volume.
	VolumeUsd float64 `json:"volumeUsd"`
	// Tier is one of TierBronze, TierSilver, TierGold, TierDiamond.
	Tier Tier `json:"tier"`
	// NextTier is nil at Diamond.
	NextTier *string `json:"nextTier"`
	// NextThresholdUsd is nil at Diamond.
	NextThresholdUsd *float64 `json:"nextThresholdUsd"`
	// ProgressPct is progress toward the next tier, 0-100. 100 at Diamond.
	ProgressPct float64 `json:"progressPct"`
}

// QuestState is a quest and an address's progress against it.
type QuestState struct {
	Key         string `json:"key"`
	Title       string `json:"title"`
	Description string `json:"description"`
	// Kind is the quest cadence, e.g. "daily" or "oneoff".
	Kind   string  `json:"kind"`
	Target float64 `json:"target"`
	// Progress is clamped to Target.
	Progress float64 `json:"progress"`
	// Points is awarded on completion.
	Points    float64 `json:"points"`
	Completed bool    `json:"completed"`
	// Claimed is granted automatically by the indexer — there is no claim call
	// on this public surface.
	Claimed bool `json:"claimed"`
}

// AchievementState is a lifetime achievement and whether an address has earned
// it.
type AchievementState struct {
	Key         string  `json:"key"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	Icon        string  `json:"icon"`
	Points      float64 `json:"points"`
	Earned      bool    `json:"earned"`
}

// Rewards is the rewards ledger for an address: streaks, points and
// quest/achievement state. Rewards are granted automatically as they are
// earned; there is no claim step.
type Rewards struct {
	Address string `json:"address"`
	// CurrentStreak is consecutive active days.
	CurrentStreak int64 `json:"currentStreak"`
	LongestStreak int64 `json:"longestStreak"`
	// Points is the headline figure, identical to the leaderboard's.
	Points float64 `json:"points"`
	// BonusPoints is the grant subtotal only; not the number to lead with.
	BonusPoints  float64            `json:"bonusPoints"`
	Quests       []QuestState       `json:"quests"`
	Achievements []AchievementState `json:"achievements"`
}
