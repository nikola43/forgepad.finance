package fyuz

import "context"

// DiscoverTab is a preset ordering for the discovery feed.
type DiscoverTab string

// The discovery feed orderings.
const (
	// TabTrending ranks by recent trading activity.
	TabTrending DiscoverTab = "trending"
	// TabNew ranks newest first.
	TabNew DiscoverTab = "new"
	// TabGainers ranks by 24h price change.
	TabGainers DiscoverTab = "gainers"
	// TabGraduating ranks by proximity to the $30,000 graduation threshold.
	TabGraduating DiscoverTab = "graduating"
)

// TokenStatus filters by bonding-curve state.
type TokenStatus string

const (
	// StatusBonding selects tokens still trading on the bonding curve, for
	// which this API is the only price source.
	StatusBonding TokenStatus = "bonding"
	// StatusGraduated selects tokens that have a PancakeSwap pair.
	StatusGraduated TokenStatus = "graduated"
)

// SortOrder is a sort direction.
type SortOrder string

const (
	// SortAsc sorts ascending.
	SortAsc SortOrder = "asc"
	// SortDesc sorts descending.
	SortDesc SortOrder = "desc"
)

// DiscoverOptions are the optional filters for Discover. The zero value asks
// for the API's defaults.
type DiscoverOptions struct {
	// Tab is a preset ordering. Empty leaves the server default.
	Tab DiscoverTab
	// Network is the chain slug, e.g. "bsc". Empty means all chains.
	Network string
	// MinMarketcap filters out tokens below this USD market cap.
	MinMarketcap *float64
	// MinVolume filters out tokens below this 24h USD volume.
	MinVolume *float64
	// MinHolders filters out tokens with fewer holders than this.
	MinHolders *int64
	// MaxAgeSecs keeps only tokens created within this many seconds.
	MaxAgeSecs *int64
	// Status filters by bonding-curve state.
	Status TokenStatus
	// Limit caps the number of rows. Defaults to 50 server-side.
	Limit *int64
}

func (o *DiscoverOptions) query() *query {
	q := newQuery()
	if o == nil {
		return q
	}
	q.str("tab", string(o.Tab))
	q.str("network", o.Network)
	q.float64p("minMarketcap", o.MinMarketcap)
	q.float64p("minVolume", o.MinVolume)
	q.int64p("minHolders", o.MinHolders)
	q.int64p("maxAgeSecs", o.MaxAgeSecs)
	q.str("status", string(o.Status))
	q.int64p("limit", o.Limit)
	return q
}

// ListTokensOptions are the optional filters and paging for ListTokens.
type ListTokensOptions struct {
	// OrderType is the field to sort by, e.g. "marketcap", "createdAt",
	// "score".
	OrderType string
	// OrderFlag is the sort direction, SortAsc or SortDesc.
	OrderFlag SortOrder
	// SearchWord free-text matches on name, symbol or address.
	SearchWord string
	// Network is the chain slug, e.g. "bsc".
	Network string
	// Style exact-matches the generated image style ("all" means no filter).
	Style string
	// IncludeNsfw includes tokens flagged not-safe-for-work.
	IncludeNsfw *bool
	// PageNumber is 1-based. Defaults to 1 server-side.
	PageNumber *int64
	// PageSize defaults to 20 server-side and is clamped to at most 100:
	// asking for more still returns 100 rows.
	PageSize *int64
}

func (o *ListTokensOptions) query() *query {
	q := newQuery()
	if o == nil {
		return q
	}
	q.str("orderType", o.OrderType)
	q.str("orderFlag", string(o.OrderFlag))
	q.str("searchWord", o.SearchWord)
	q.str("network", o.Network)
	q.str("style", o.Style)
	q.boolp("includeNsfw", o.IncludeNsfw)
	q.int64p("pageNumber", o.PageNumber)
	q.int64p("pageSize", o.PageSize)
	return q
}

// GetTokenOptions pages the trade list embedded in a token detail response.
type GetTokenOptions struct {
	// PageNumber is the 1-based page of trades. Defaults to 1 server-side.
	PageNumber *int64
	// PageSize is the trades per page. Defaults to 20 server-side.
	PageSize *int64
}

func (o *GetTokenOptions) query() *query {
	q := newQuery()
	if o == nil {
		return q
	}
	q.int64p("pageNumber", o.PageNumber)
	q.int64p("pageSize", o.PageSize)
	return q
}

// Health probes service liveness.
//
//	status, err := client.Health(ctx)
//	fmt.Println(status.Status) // "ok"
func (c *Client) Health(ctx context.Context) (*HealthStatus, error) {
	var out HealthStatus
	if err := c.get(ctx, "/health", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetConfig returns the chain configuration the Fyuz frontend runs against.
//
//	cfg, err := client.GetConfig(ctx)
//	for _, chain := range cfg.Chains {
//		fmt.Println(chain.Name, chain.ChainID)
//	}
func (c *Client) GetConfig(ctx context.Context) (*ChainConfig, error) {
	var out ChainConfig
	if err := c.get(ctx, "/config", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Discover returns the discovery feed: one row per token with market cap, 24h
// volume, buy/sell counts, holder count, price change and graduation progress.
//
// This is the highest-signal single endpoint and the recommended entry point
// for bulk market-data ingestion. Pass nil for the server defaults.
//
//	tokens, err := client.Discover(ctx, &fyuz.DiscoverOptions{
//		Tab:    fyuz.TabGraduating,
//		Status: fyuz.StatusBonding,
//		Limit:  fyuz.Int64(20),
//	})
func (c *Client) Discover(ctx context.Context, opts *DiscoverOptions) ([]DiscoverToken, error) {
	var out []DiscoverToken
	if err := c.get(ctx, "/discover", opts.query().encoded(), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ListTokens returns one page of the token list, with the full token record
// including bonding-curve virtual reserves.
//
// Use IterateTokens to walk every page automatically.
//
//	page, err := client.ListTokens(ctx, &fyuz.ListTokensOptions{
//		OrderType: "marketcap",
//		OrderFlag: fyuz.SortDesc,
//		PageSize:  fyuz.Int64(50),
//	})
//	fmt.Println(len(page.TokenList), "of", page.TokenCount)
func (c *Client) ListTokens(ctx context.Context, opts *ListTokensOptions) (*TokenPage, error) {
	var out TokenPage
	if err := c.get(ctx, "/tokens", opts.query().encoded(), &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetKing returns the current king of the hill: the highest-marketcap token
// still on the bonding curve.
//
// Returns (nil, nil) when the hill is empty. That is a real state, not an
// error — a token leaves the hill the moment it graduates, so between a
// graduation and the next launch there is no king. Check the pointer before
// dereferencing it.
//
//	king, err := client.GetKing(ctx)
//	if err != nil {
//		return err
//	}
//	if king == nil {
//		fmt.Println("no king right now")
//	}
//
// The API wraps the token in a {"king": ...} envelope; it is unwrapped here.
func (c *Client) GetKing(ctx context.Context) (*Token, error) {
	var out struct {
		King *Token `json:"king"`
	}
	if err := c.get(ctx, "/tokens/king", nil, &out); err != nil {
		return nil, err
	}
	return out.King, nil
}

// GetToken returns the full record for one token plus recent trades, holder
// distribution, the 15-minute price and one-day liquidity.
//
// network is the chain slug ("bsc"); tokenAddress is the 0x token address.
// Returns an error matching ErrNotFound when the token is unknown.
//
//	detail, err := client.GetToken(ctx, "bsc", "0x23a8...", nil)
//	if detail.TokenDetails.PairAddress == nil {
//		// still on the bonding curve: no DEX pool exists for this token
//	}
func (c *Client) GetToken(ctx context.Context, network, tokenAddress string, opts *GetTokenOptions) (*TokenDetail, error) {
	var out TokenDetail
	path := "/tokens/" + escapePath(network) + "/" + escapePath(tokenAddress)
	if err := c.get(ctx, path, opts.query().encoded(), &out); err != nil {
		return nil, err
	}
	return &out, nil
}
