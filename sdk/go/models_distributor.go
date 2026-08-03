package fyuz

// Every field whose name ends in Wei is an exact uint256 decimal string. They
// regularly exceed the range float64 can represent exactly, so they are never
// widened to a number. Use ParseWei to do arithmetic on them.
//
// A nil *string wei field means the value is UNKNOWN — the settlement has not
// been indexed yet, or the RPC was unreachable. It never means zero.

// PayoutStats is the lifetime Distributor payback total.
type PayoutStats struct {
	// TotalPaidWei is everything ever paid out, pro-rata plus lottery, as an
	// exact decimal string. "0" when nothing has settled.
	TotalPaidWei     string `json:"totalPaidWei"`
	RoundsSettled    int64  `json:"roundsSettled"`
	UniqueRecipients int64  `json:"uniqueRecipients"`
	// LargestPayoutWei is "0" when nothing has settled.
	LargestPayoutWei string `json:"largestPayoutWei"`
	// LastRoundAt is UNIX seconds, nil when nothing has settled.
	LastRoundAt *int64 `json:"lastRoundAt"`
}

// Pot is the live undistributed pot and the round parameters needed to price a
// point. The pot accumulates from the 0.3% leaderboard fee stream.
type Pot struct {
	// PotBnb is the live BNB balance of the Distributor.
	//
	// Nil when no Distributor is configured or the RPC is unreachable — hide
	// the figure rather than rendering 0.
	PotBnb *float64 `json:"potBnb"`
	// DistributeBps is the basis points paid pro-rata by points; the remainder
	// goes to the VRF-picked lottery winner. 9000 = 90%.
	DistributeBps float64 `json:"distributeBps"`
	// RoundEnd is the next round close in UNIX seconds, read from the
	// contract's own schedule.
	RoundEnd int64 `json:"roundEnd"`
	// TotalPoints is the points across the whole payout set — the denominator
	// of every share. Nil when it could not be computed.
	TotalPoints *float64 `json:"totalPoints"`
	// PointsPerUsd is the points credited per $1 of volume. Buys and sells
	// score alike.
	PointsPerUsd float64 `json:"pointsPerUsd"`
}

// ShareEntry is one holder's committed share of the next round.
type ShareEntry struct {
	Address string  `json:"address"`
	Points  float64 `json:"points"`
	// Share is the holder's fraction of 2^32 — the on-chain share unit, so it
	// ranges from 0 to 4294967295.
	Share int64 `json:"share"`
}

// Shares is the share allocation the round-runner posts on-chain, plus the
// exact calldata it posts.
type Shares struct {
	// From is the window start in UNIX seconds.
	From int64 `json:"from"`
	// To is the window end in UNIX seconds.
	To          int64   `json:"to"`
	TotalPoints float64 `json:"totalPoints"`
	// Holders is highest points first, capped at 100 (the contract's
	// MAX_HOLDERS).
	Holders []ShareEntry `json:"holders"`
	// Packed is the calldata for Distributor.postShares: 24-byte entries of a
	// 20-byte address followed by the big-endian uint32 share, 0x-prefixed hex.
	Packed string `json:"packed"`
}

// RoundReceipt is a settled distribution round.
type RoundReceipt struct {
	RoundID int64 `json:"roundId"`
	// TimeStart is UNIX seconds.
	TimeStart int64 `json:"timeStart"`
	// TimeEnd is UNIX seconds; it becomes the start of the next leaderboard
	// window.
	TimeEnd int64   `json:"timeEnd"`
	TxHash  *string `json:"txHash"`
	// PotWei is the whole amount that left the contract, pro-rata plus
	// lottery. Nil means not yet indexed, not zero.
	PotWei *string `json:"potWei"`
	// DistributedWei is the pro-rata portion only. Nil means not yet indexed.
	DistributedWei *string `json:"distributedWei"`
	// WinnerAddress is the VRF-picked lottery winner.
	WinnerAddress *string `json:"winnerAddress"`
	// WinnerAmountWei is the lottery payout. Nil means not yet indexed.
	WinnerAmountWei *string `json:"winnerAmountWei"`
	HolderCount     *int64  `json:"holderCount"`
	// VrfRandom is the VRF word that selected the winner, as a DECIMAL string
	// (not hex, not a number). Published so the draw can be checked against
	// the coordinator's own fulfilment.
	VrfRandom *string `json:"vrfRandom"`
	// DistributedAt is UNIX seconds, nil until the round settles.
	DistributedAt *int64 `json:"distributedAt"`
}

// Settled reports whether the round's on-chain settlement has been indexed.
func (r RoundReceipt) Settled() bool { return r.DistributedAt != nil }

// PayoutLine is one recipient's line in a round.
type PayoutLine struct {
	RoundID int64  `json:"roundId"`
	Address string `json:"address"`
	// Share is the recipient's fraction of 2^32, exactly as committed
	// on-chain.
	Share int64 `json:"share"`
	// AmountWei is the exact wei paid, as a decimal string.
	AmountWei string  `json:"amountWei"`
	Username  *string `json:"username"`
	Avatar    *string `json:"avatar"`
}

// RoundDetail is a round receipt with its recipient list.
//
// The receipt fields are flattened into the top level of the JSON object
// alongside "payouts", which the embedded RoundReceipt reproduces exactly:
//
//	detail, _ := client.Distributor.GetRound(ctx, 12)
//	fmt.Println(detail.RoundID, len(detail.Payouts))
type RoundDetail struct {
	RoundReceipt
	// Payouts is richest first.
	Payouts []PayoutLine `json:"payouts"`
}

// AddressPayouts is every payout a single wallet has received.
type AddressPayouts struct {
	// Address is lower-cased.
	Address string `json:"address"`
	// TotalWei is the lifetime wei received across every settled round,
	// summed exactly rather than in floating point.
	TotalWei   string `json:"totalWei"`
	RoundsPaid int64  `json:"roundsPaid"`
	// Payouts is newest round first.
	Payouts []PayoutLine `json:"payouts"`
}

// Claimable is the wei owed to an address from payout pushes the contract
// could not complete (contract wallets, reverting receivers). It is withdrawn
// by calling claim() on the Distributor — the wallet signs, this API only
// reads.
type Claimable struct {
	// Address is lower-cased.
	Address string `json:"address"`
	// ClaimableWei is the exact wei owed, as a decimal string.
	//
	// Nil when the RPC is unreachable or no Distributor is configured — hide
	// the banner rather than telling the user nothing is owed.
	ClaimableWei *string `json:"claimableWei"`
	// DistributorAddress is where to send the claim(). Nil when unconfigured.
	DistributorAddress *string `json:"distributorAddress"`
}
