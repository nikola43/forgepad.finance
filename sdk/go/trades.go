package fyuz

import (
	"context"
	"errors"
)

// RecentTradesOptions polls the platform-wide trade feed incrementally.
type RecentTradesOptions struct {
	// LatestTradeID returns only trades with an id greater than this. Feed the
	// highest id you have seen back in to poll for new trades only.
	LatestTradeID *int64
	// LatestTokenID returns only tokens with an id greater than this.
	LatestTokenID *int64
}

func (o *RecentTradesOptions) query() *query {
	q := newQuery()
	if o == nil {
		return q
	}
	q.int64p("latestTradeId", o.LatestTradeID)
	q.int64p("latestTokenId", o.LatestTokenID)
	return q
}

// TokenTradesOptions pages a single token's trade history.
type TokenTradesOptions struct {
	// Limit is the rows to return. Defaults to 50 server-side.
	Limit *int64
	// Offset is the rows to skip. Defaults to 0 server-side.
	Offset *int64
}

func (o *TokenTradesOptions) query() *query {
	q := newQuery()
	if o == nil {
		return q
	}
	q.int64p("limit", o.Limit)
	q.int64p("offset", o.Offset)
	return q
}

// ChartDataOptions requests OHLCV candles. TokenAddress, Interval, From and To
// are required; the rest are optional.
type ChartDataOptions struct {
	// TokenAddress is the token to chart. Required.
	TokenAddress string
	// Interval is the candle width: "1", "5", "15", "60", "1D" — minutes
	// unless suffixed. Required.
	Interval string
	// From is the range start in UNIX seconds. Required.
	From int64
	// To is the range end in UNIX seconds. Required.
	To int64
	// First marks the first request of a chart session, as TradingView's
	// datafeed protocol expects.
	First *int64
	// Dex restricts candles to one venue.
	Dex string
	// CountBack is the number of candles to return ending at To.
	CountBack *int64
}

func (o *ChartDataOptions) validate() error {
	switch {
	case o == nil:
		return errors.New("fyuz: GetChartData requires options")
	case o.TokenAddress == "":
		return errors.New("fyuz: GetChartData requires TokenAddress")
	case o.Interval == "":
		return errors.New("fyuz: GetChartData requires Interval")
	case o.To <= 0:
		return errors.New("fyuz: GetChartData requires To, a UNIX timestamp in seconds")
	case o.From < 0 || o.From >= o.To:
		return errors.New("fyuz: GetChartData requires From < To, both UNIX timestamps in seconds")
	}
	return nil
}

func (o *ChartDataOptions) query() *query {
	q := newQuery()
	q.str("tokenAddress", o.TokenAddress)
	q.str("interval", o.Interval)
	q.int64("from", o.From)
	q.int64("to", o.To)
	q.int64p("first", o.First)
	q.str("dex", o.Dex)
	q.int64p("countBack", o.CountBack)
	return q
}

// GetRecentTrades returns the platform-wide trade feed together with the token
// records those trades reference.
//
// Poll it incrementally by feeding back the highest trade id you have seen:
//
//	feed, err := client.GetRecentTrades(ctx, &fyuz.RecentTradesOptions{
//		LatestTradeID: fyuz.Int64(lastSeen),
//	})
func (c *Client) GetRecentTrades(ctx context.Context, opts *RecentTradesOptions) (*RecentTrades, error) {
	var out RecentTrades
	if err := c.get(ctx, "/trades/recent", opts.query().encoded(), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetTokenTrades returns one token's trade history, newest first.
//
// This is a read, despite being an HTTP POST: the API takes the token address
// in the request body rather than the query string. Nothing is mutated and no
// authentication is involved.
//
//	trades, err := client.GetTokenTrades(ctx, "0x23a8...", &fyuz.TokenTradesOptions{
//		Limit: fyuz.Int64(100),
//	})
func (c *Client) GetTokenTrades(ctx context.Context, tokenAddress string, opts *TokenTradesOptions) ([]Trade, error) {
	if tokenAddress == "" {
		return nil, errors.New("fyuz: GetTokenTrades requires a token address")
	}
	body := struct {
		TokenAddress string `json:"tokenAddress"`
	}{TokenAddress: tokenAddress}

	var out []Trade
	if err := c.post(ctx, "/trades", opts.query().encoded(), body, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// GetChartData returns OHLCV candles for a token, oldest first, shaped for
// TradingView-style charting libraries.
//
// For a token still on the bonding curve these candles are synthesised from
// curve trades — no DEX pool exists to read them from.
//
//	candles, err := client.GetChartData(ctx, &fyuz.ChartDataOptions{
//		TokenAddress: "0x23a8...",
//		Interval:     "5",
//		From:         time.Now().Add(-24 * time.Hour).Unix(),
//		To:           time.Now().Unix(),
//	})
func (c *Client) GetChartData(ctx context.Context, opts *ChartDataOptions) ([]Candle, error) {
	if err := opts.validate(); err != nil {
		return nil, err
	}
	var out []Candle
	if err := c.get(ctx, "/trades/getChartData", opts.query().encoded(), &out); err != nil {
		return nil, err
	}
	return out, nil
}
