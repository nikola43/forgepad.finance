package fyuz

import (
	"context"
	"strconv"
)

// DistributorService groups the endpoints of the on-chain leaderboard fee
// Distributor. Reach it through Client.Distributor:
//
//	pot, err := client.Distributor.GetPot(ctx)
//
// The Distributor collects a 0.3% fee stream into a pot and pays it out each
// round: DistributeBps of the pot pro-rata by points, the remainder to a
// single VRF-picked winner.
type DistributorService struct {
	client *Client
}

// SharesOptions selects the window and size of a share allocation.
type SharesOptions struct {
	// From is the window start in UNIX seconds. Defaults to the end of the
	// last paid round.
	From *int64
	// To is the window end in UNIX seconds. Defaults to now and must be after
	// From, or the API rejects the request with 400.
	To *int64
	// Limit is the max holders, top-N by points. Defaults to 100 and is
	// clamped to 1-100, the contract's MAX_HOLDERS.
	Limit *int64
}

func (o *SharesOptions) query() *query {
	q := newQuery()
	if o == nil {
		return q
	}
	q.int64p("from", o.From)
	q.int64p("to", o.To)
	q.int64p("limit", o.Limit)
	return q
}

// ListRoundsOptions pages the public payout ledger.
type ListRoundsOptions struct {
	// Limit is the rows to return. Defaults to 25 and is clamped to 1-100.
	Limit *int64
	// Offset is the rows to skip. Defaults to 0.
	Offset *int64
}

func (o *ListRoundsOptions) query() *query {
	q := newQuery()
	if o == nil {
		return q
	}
	q.int64p("limit", o.Limit)
	q.int64p("offset", o.Offset)
	return q
}

// GetStats returns the lifetime Distributor payback totals.
//
// The wei figures are exact decimal strings; parse them with ParseWei.
//
//	stats, err := client.Distributor.GetStats(ctx)
//	total, err := fyuz.ParseWei(stats.TotalPaidWei)
func (s *DistributorService) GetStats(ctx context.Context) (*PayoutStats, error) {
	var out PayoutStats
	if err := s.client.get(ctx, "/distributor/stats", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetPot returns the current undistributed pot and the round parameters needed
// to price a point.
//
// PotBnb and TotalPoints are nil when they could not be read. Hide the figure
// in that case; rendering 0 would be wrong.
//
//	pot, err := client.Distributor.GetPot(ctx)
//	if pot.PotBnb != nil {
//		fmt.Printf("%.4f BNB in the pot, round closes %s\n",
//			*pot.PotBnb, fyuz.UnixTime(pot.RoundEnd))
//	}
func (s *DistributorService) GetPot(ctx context.Context) (*Pot, error) {
	var out Pot
	if err := s.client.get(ctx, "/distributor/pot", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetShares returns the per-address share allocation for the next round, plus
// the exact calldata the round-runner posts on-chain.
//
//	shares, err := client.Distributor.GetShares(ctx, &fyuz.SharesOptions{
//		Limit: fyuz.Int64(50),
//	})
func (s *DistributorService) GetShares(ctx context.Context, opts *SharesOptions) (*Shares, error) {
	var out Shares
	if err := s.client.get(ctx, "/distributor/shares", opts.query().encoded(), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListRounds returns historical distribution rounds, newest first.
//
//	rounds, err := client.Distributor.ListRounds(ctx, &fyuz.ListRoundsOptions{
//		Limit: fyuz.Int64(10),
//	})
func (s *DistributorService) ListRounds(ctx context.Context, opts *ListRoundsOptions) ([]RoundReceipt, error) {
	var out []RoundReceipt
	if err := s.client.get(ctx, "/distributor/rounds", opts.query().encoded(), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetRound returns one round's receipt together with its recipient list,
// richest first.
//
// The receipt fields are promoted to the top level of RoundDetail through the
// embedded RoundReceipt, matching the flattened wire shape.
//
// Returns an error matching ErrNotFound for an unknown round id.
//
//	detail, err := client.Distributor.GetRound(ctx, 12)
//	fmt.Println(detail.RoundID, len(detail.Payouts))
func (s *DistributorService) GetRound(ctx context.Context, id int64) (*RoundDetail, error) {
	var out RoundDetail
	path := "/distributor/rounds/" + strconv.FormatInt(id, 10)
	if err := s.client.get(ctx, path, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetPayouts returns every payout a single wallet has received, newest round
// first.
//
//	payouts, err := client.Distributor.GetPayouts(ctx, "0xabc...")
//	total, err := fyuz.ParseWei(payouts.TotalWei)
func (s *DistributorService) GetPayouts(ctx context.Context, address string) (*AddressPayouts, error) {
	var out AddressPayouts
	if err := s.client.get(ctx, "/distributor/payouts/"+escapePath(address), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetClaimable returns the wei owed to an address from payout pushes the
// contract could not complete.
//
// ClaimableWei is nil when the RPC is unreachable or no Distributor is
// configured — hide the banner rather than telling the user nothing is owed.
// Withdrawing is a signed call to claim() on DistributorAddress; this API only
// reads.
func (s *DistributorService) GetClaimable(ctx context.Context, address string) (*Claimable, error) {
	var out Claimable
	if err := s.client.get(ctx, "/distributor/claimable/"+escapePath(address), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
