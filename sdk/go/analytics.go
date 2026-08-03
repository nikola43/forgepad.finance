package fyuz

import "context"

// GetTokenAnalytics returns holder concentration, buy/sell split, volume,
// graduation progress and bundle-buyer detection for one token.
//
// Returns an error matching ErrNotFound when the token is unknown.
//
//	stats, err := client.GetTokenAnalytics(ctx, "bsc", "0x23a8...")
//	if stats.BundleFlag {
//		log.Printf("%d addresses bought in the launch block", stats.BundleBuyers)
//	}
func (c *Client) GetTokenAnalytics(ctx context.Context, network, address string) (*TokenAnalytics, error) {
	var out TokenAnalytics
	path := "/analytics/token/" + escapePath(network) + "/" + escapePath(address)
	if err := c.get(ctx, path, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetTopTraders returns the best-performing wallets in one token, ranked by
// total PnL, with the token creator flagged.
//
//	traders, err := client.GetTopTraders(ctx, "bsc", "0x23a8...")
func (c *Client) GetTopTraders(ctx context.Context, network, address string) ([]TopTrader, error) {
	var out []TopTrader
	path := "/analytics/top-traders/" + escapePath(network) + "/" + escapePath(address)
	if err := c.get(ctx, path, nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetWallet returns average-cost PnL rolled up across every token a wallet has
// traded, plus win rate, volume and current holding value.
//
//	stats, err := client.GetWallet(ctx, "0xabc...")
//	fmt.Printf("%.2f%% ROI over %d trades\n", stats.RoiPct, stats.TradeCount)
func (c *Client) GetWallet(ctx context.Context, address string) (*WalletStats, error) {
	var out WalletStats
	if err := c.get(ctx, "/wallet/"+escapePath(address), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetPortfolio returns the current holdings and live average-cost PnL for an
// address, highest value first.
//
// An address with no trades yields zeroed totals and an empty Positions slice
// rather than a not-found error.
//
//	pf, err := client.GetPortfolio(ctx, "0xabc...")
//	for _, p := range pf.Positions {
//		fmt.Printf("%-8s $%.2f (%.1f%%)\n", p.Symbol, p.ValueUsd, p.UnrealizedPnlPct)
//	}
func (c *Client) GetPortfolio(ctx context.Context, address string) (*Portfolio, error) {
	var out Portfolio
	if err := c.get(ctx, "/portfolio/"+escapePath(address), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
