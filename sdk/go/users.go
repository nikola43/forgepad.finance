package fyuz

import (
	"context"
	"strconv"
)

// LeaderboardOptions caps the size of a leaderboard response. It is shared by
// GetUserLeaderboard and GetReferralLeaderboard.
type LeaderboardOptions struct {
	// Limit is the rows to return. Defaults to 100 server-side and is clamped
	// to 1-500 by the API.
	Limit *int64
}

func (o *LeaderboardOptions) query() *query {
	q := newQuery()
	if o == nil {
		return q
	}
	q.int64p("limit", o.Limit)
	return q
}

// TopHoldersOptions narrows the window and chain for GetTopHolders.
type TopHoldersOptions struct {
	// From is the window start in UNIX seconds. Defaults to 0 (all time).
	From *int64
	// To is the window end in UNIX seconds. Defaults to unbounded.
	To *int64
	// Network counts volume on this chain only, e.g. "bsc".
	Network string
}

func (o *TopHoldersOptions) query() *query {
	q := newQuery()
	if o == nil {
		return q
	}
	q.int64p("from", o.From)
	q.int64p("to", o.To)
	q.str("network", o.Network)
	return q
}

// GetUserLeaderboard returns the global points leaderboard, highest projected
// points first.
//
// The board resets after every Distributor payout: only activity since the
// last settled round counts. Rank is server-assigned in returned order — do
// not re-sort it client-side.
//
//	board, err := client.GetUserLeaderboard(ctx, &fyuz.LeaderboardOptions{
//		Limit: fyuz.Int64(25),
//	})
//	for _, row := range board {
//		fmt.Printf("#%d %s %.0f pts\n", row.Rank, row.Address, row.Points)
//	}
func (c *Client) GetUserLeaderboard(ctx context.Context, opts *LeaderboardOptions) ([]LeaderboardEntry, error) {
	var out []LeaderboardEntry
	if err := c.get(ctx, "/users/leaderboard", opts.query().encoded(), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetUserProfile returns the public profile for an address: identity, current
// holdings, comments, launched tokens and current-round points.
//
// Returns an error matching ErrNotFound when the address has no profile.
//
//	profile, err := client.GetUserProfile(ctx, "0xabc...")
//	if errors.Is(err, fyuz.ErrNotFound) {
//		// wallet has never interacted with Fyuz
//	}
func (c *Client) GetUserProfile(ctx context.Context, address string) (*UserProfile, error) {
	var out UserProfile
	if err := c.get(ctx, "/users/profile/"+escapePath(address), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetTopHolders returns the top count wallets by USD trading volume over the
// requested window, highest first.
//
//	top, err := client.GetTopHolders(ctx, 10, &fyuz.TopHoldersOptions{
//		From: fyuz.Int64(time.Now().Add(-7 * 24 * time.Hour).Unix()),
//	})
func (c *Client) GetTopHolders(ctx context.Context, count int64, opts *TopHoldersOptions) ([]TopHolderEntry, error) {
	var out []TopHolderEntry
	path := "/users/top/" + strconv.FormatInt(count, 10)
	if err := c.get(ctx, path, opts.query().encoded(), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetKingsHistory returns past King-of-the-Hill reigns, most recent first,
// capped at 100 by the API.
//
//	reigns, err := client.GetKingsHistory(ctx)
//	for _, r := range reigns {
//		fmt.Println(r.Symbol, time.Duration(r.DurationSecs)*time.Second)
//	}
func (c *Client) GetKingsHistory(ctx context.Context) ([]KingReign, error) {
	var out []KingReign
	if err := c.get(ctx, "/kings/history", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetSeason returns the current season window, prize pot and standings (top 50
// with positive points, highest first).
func (c *Client) GetSeason(ctx context.Context) (*Season, error) {
	var out Season
	if err := c.get(ctx, "/season", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetReferralLeaderboard returns the top referrers, most active referrals
// first. Only ACTIVE referrals — where the referee has cleared the net-buy
// floor — are counted.
func (c *Client) GetReferralLeaderboard(ctx context.Context, opts *LeaderboardOptions) ([]ReferralLeaderEntry, error) {
	var out []ReferralLeaderEntry
	if err := c.get(ctx, "/referrals/leaderboard", opts.query().encoded(), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetTier returns the display-only trader tier for an address, derived from
// lifetime USD trade volume.
//
//	tier, err := client.GetTier(ctx, "0xabc...")
//	if tier.Tier == fyuz.TierDiamond {
//		// NextTier and NextThresholdUsd are nil at the top tier
//	}
func (c *Client) GetTier(ctx context.Context, address string) (*TierInfo, error) {
	var out TierInfo
	if err := c.get(ctx, "/tier/"+escapePath(address), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetRewards returns the rewards ledger for an address: streaks, points and
// quest/achievement state.
//
// Read-only: rewards are granted automatically by the indexer as they are
// earned, so there is no claim call on this surface.
func (c *Client) GetRewards(ctx context.Context, address string) (*Rewards, error) {
	var out Rewards
	if err := c.get(ctx, "/rewards/"+escapePath(address), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
