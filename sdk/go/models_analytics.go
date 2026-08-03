package fyuz

// TokenAnalytics is the per-token analytics rollup: holder concentration,
// buy/sell split, volume, graduation progress and bundle-buyer detection.
//
// Analytics values are aggregates and are returned as numbers rather than
// decimal strings.
type TokenAnalytics struct {
	TokenAddress string `json:"tokenAddress"`
	Network      string `json:"network"`
	HolderCount  int64  `json:"holderCount"`
	// Top10Pct is the share of supply held by the ten largest holders, 0-100.
	Top10Pct float64 `json:"top10Pct"`
	// CreatorPct is the share of supply held by the creator, 0-100.
	CreatorPct float64 `json:"creatorPct"`
	Buys       int64   `json:"buys"`
	Sells      int64   `json:"sells"`
	VolumeUsd  float64 `json:"volumeUsd"`
	// GraduationPct is progress toward the $30,000 graduation target, 0-100.
	GraduationPct float64 `json:"graduationPct"`
	// Launched is true once the token has graduated to a DEX pair.
	Launched bool `json:"launched"`
	// BundleBuyers counts addresses that bought in the launch block, a common
	// sniping pattern.
	BundleBuyers int64 `json:"bundleBuyers"`
	// BundleFlag is the heuristic verdict on whether the launch was bundled.
	BundleFlag bool `json:"bundleFlag"`
}

// TopTrader is one wallet's performance in a single token, ranked by total
// PnL, with the token creator flagged.
type TopTrader struct {
	Address  string  `json:"address"`
	Username *string `json:"username"`
	Avatar   *string `json:"avatar"`
	// RealizedPnlUsd is profit already taken by selling.
	RealizedPnlUsd float64 `json:"realizedPnlUsd"`
	// UnrealizedPnlUsd is the paper profit on the remaining position.
	UnrealizedPnlUsd float64 `json:"unrealizedPnlUsd"`
	TotalPnlUsd      float64 `json:"totalPnlUsd"`
	VolumeUsd        float64 `json:"volumeUsd"`
	// IsCreator marks the wallet that launched the token.
	IsCreator bool `json:"isCreator"`
}

// WalletStats is average-cost PnL rolled up across every token a wallet has
// traded, plus win rate, volume and current holding value.
type WalletStats struct {
	Address  string  `json:"address"`
	Username *string `json:"username"`
	Avatar   *string `json:"avatar"`
	// VolumeUsd is lifetime USD trading volume.
	VolumeUsd        float64 `json:"volumeUsd"`
	RealizedPnlUsd   float64 `json:"realizedPnlUsd"`
	UnrealizedPnlUsd float64 `json:"unrealizedPnlUsd"`
	TotalPnlUsd      float64 `json:"totalPnlUsd"`
	// RoiPct is total PnL as a percentage of cost basis.
	RoiPct float64 `json:"roiPct"`
	// WinRate is the share of traded tokens that are net profitable, 0-1.
	WinRate      float64 `json:"winRate"`
	TokensTraded int64   `json:"tokensTraded"`
	TradeCount   int64   `json:"tradeCount"`
	// HoldingValueUsd is the current USD value of open positions.
	HoldingValueUsd float64 `json:"holdingValueUsd"`
}

// PortfolioPosition is one token still held by an address, on an average-cost
// basis. Dust positions (balance <= 1e-6) are omitted by the API.
type PortfolioPosition struct {
	TokenAddress string  `json:"tokenAddress"`
	Name         string  `json:"name"`
	Symbol       string  `json:"symbol"`
	Image        *string `json:"image"`
	Network      string  `json:"network"`
	// Balance is net tokens held (buys minus sells) in whole tokens.
	Balance         float64 `json:"balance"`
	CurrentPriceUsd float64 `json:"currentPriceUsd"`
	// ValueUsd is Balance * CurrentPriceUsd.
	ValueUsd float64 `json:"valueUsd"`
	// CostUsd is the average-cost basis of the remaining balance.
	CostUsd          float64 `json:"costUsd"`
	AvgBuyPriceUsd   float64 `json:"avgBuyPriceUsd"`
	UnrealizedPnlUsd float64 `json:"unrealizedPnlUsd"`
	UnrealizedPnlPct float64 `json:"unrealizedPnlPct"`
	RealizedPnlUsd   float64 `json:"realizedPnlUsd"`
}

// Portfolio is the live average-cost PnL for an address.
//
// An address with no trades returns zeroed totals and an empty Positions slice
// rather than a 404.
type Portfolio struct {
	Address          string  `json:"address"`
	TotalValueUsd    float64 `json:"totalValueUsd"`
	TotalCostUsd     float64 `json:"totalCostUsd"`
	UnrealizedPnlUsd float64 `json:"unrealizedPnlUsd"`
	RealizedPnlUsd   float64 `json:"realizedPnlUsd"`
	TotalPnlUsd      float64 `json:"totalPnlUsd"`
	RoiPct           float64 `json:"roiPct"`
	// Positions is ordered highest value first.
	Positions []PortfolioPosition `json:"positions"`
}
