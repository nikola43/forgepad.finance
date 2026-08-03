package fyuz

import "time"

// Integer fields are int64 across every model regardless of whether the API
// schema declares int32 or int64, so no conversion is ever needed when feeding
// a value from one call into the options of another.

// TradeType is the side of a trade.
type TradeType string

const (
	// TradeBuy is a purchase of tokens with BNB.
	TradeBuy TradeType = "buy"
	// TradeSell is a sale of tokens for BNB.
	TradeSell TradeType = "sell"
)

// Pool types returned in Token.PoolType. The API schema types the field as a
// plain integer with no enum, so treat this set as open and always handle an
// unrecognised value.
const (
	// PoolTypePancakeV2 is a PancakeSwap V2 pair, the graduation target.
	PoolTypePancakeV2 int64 = 1
	// PoolTypePancakeV3 is a PancakeSwap V3 pool.
	PoolTypePancakeV3 int64 = 2
	// PoolTypePancakeV4 is a PancakeSwap V4 pool. Direct launches, which skip
	// the bonding curve, also report 3 — they live on a V4 pool too, and the
	// distinction is conveyed by LaunchedAt / Graduated rather than by this
	// field.
	PoolTypePancakeV4 int64 = 3
)

// HealthStatus is the liveness probe response.
type HealthStatus struct {
	// Status is "ok" when the service is up.
	Status string `json:"status"`
}

// ChainConfig is the chain configuration the Fyuz frontend runs against.
type ChainConfig struct {
	// Chains lists every supported chain. Currently BNB Smart Chain only.
	Chains []ChainInfo `json:"chains"`
}

// ChainInfo identifies one supported chain.
//
// The live endpoint returns further fields (RPC URL, explorer URL, contract
// address) that are not part of the published API schema; they are ignored
// here rather than pinned to an undocumented shape.
type ChainInfo struct {
	// Name is the human-readable chain name, e.g. "BNB Smart Chain".
	Name string `json:"name"`
	// ChainID is the EVM chain id, e.g. 56 for BNB Smart Chain mainnet.
	ChainID int64 `json:"chainId"`
}

// CreatorInfo is the public profile stub attached to tokens, trades and
// holders. Username and Avatar are nil for wallets that never set a profile.
type CreatorInfo struct {
	Address  string  `json:"address"`
	Username *string `json:"username"`
	Avatar   *string `json:"avatar"`
}

// Token is the full token record.
//
// The amount fields (Marketcap, Price, EthPrice, Volume, Score,
// VirtualEthAmount, VirtualTokenAmount, Liquidity) are decimal strings, kept
// as strings to preserve 18-decimal precision. Parse them with ParseDecimal,
// never with strconv.ParseFloat.
//
// PairAddress is nil while the token is still on the bonding curve. A nil
// PairAddress means no DEX pool exists anywhere and this API is the only
// source of price data for the token.
type Token struct {
	ID               int64   `json:"id"`
	TokenAddress     string  `json:"tokenAddress"`
	TokenName        string  `json:"tokenName"`
	TokenSymbol      string  `json:"tokenSymbol"`
	TokenDescription *string `json:"tokenDescription"`
	// ImageStyle is the generated-image style preset, if any.
	ImageStyle  *string `json:"imageStyle"`
	TokenImage  *string `json:"tokenImage"`
	TokenBanner *string `json:"tokenBanner"`
	// CreatorAddress is the wallet that launched the token.
	CreatorAddress string      `json:"creatorAddress"`
	User           CreatorInfo `json:"user"`
	// Network is the chain slug, currently always "bsc".
	Network string `json:"network"`
	// Marketcap is the USD market cap as a decimal string.
	Marketcap string `json:"marketcap"`
	// Price is the token price in USD as a decimal string.
	Price string `json:"price"`
	// EthPrice is the BNB price in USD at the last update, as a decimal string.
	EthPrice string `json:"ethPrice"`
	Volume   string `json:"volume"`
	Score    string `json:"score"`
	// VirtualEthAmount is the bonding curve's virtual BNB reserve.
	VirtualEthAmount string `json:"virtualEthAmount"`
	// VirtualTokenAmount is the bonding curve's virtual token reserve.
	VirtualTokenAmount string `json:"virtualTokenAmount"`
	// PairAddress is the PancakeSwap pair. Nil while still on the curve.
	PairAddress *string `json:"pairAddress"`
	// PoolType is the DEX venue: PoolTypePancakeV2 (1), PoolTypePancakeV3 (2)
	// or PoolTypePancakeV4 (3, also reported for direct launches). The set is
	// open — handle unrecognised values rather than assuming these three.
	PoolType int64  `json:"poolType"`
	Category string `json:"category"`
	// Replies is the number of comments on the token page.
	Replies      int64   `json:"replies"`
	WebLink      *string `json:"webLink"`
	TelegramLink *string `json:"telegramLink"`
	TwitterLink  *string `json:"twitterLink"`
	// LaunchedAt is the graduation timestamp. Nil means the token has not
	// graduated and is still trading on the bonding curve.
	LaunchedAt *time.Time `json:"launchedAt"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	// CreationTime is when the token was created on-chain.
	CreationTime time.Time `json:"creationTime"`
	// Liquidity is a decimal string; nil when unknown.
	Liquidity *string `json:"liquidity"`
	// Progress is graduation progress toward the $30,000 target, 0-100.
	Progress *float64 `json:"progress"`
	// PriceChange is the price change over the reporting window, in percent.
	PriceChange *float64 `json:"priceChange"`
	// Price15m is the price 15 minutes ago. Omitted by the API when
	// unavailable, so nil means no 15-minute reference point exists.
	Price15m *float64 `json:"price15m,omitempty"`
	// PriceChange15m is the 15-minute price change in percent, omitted when
	// unavailable.
	PriceChange15m *float64 `json:"priceChange15m,omitempty"`
}

// Graduated reports whether the token has left the bonding curve for a DEX
// pair. While false, this API is the only source of price data for it.
func (t Token) Graduated() bool {
	return t.PairAddress != nil && *t.PairAddress != ""
}

// TokenPage is one page of ListTokens results.
type TokenPage struct {
	// TokenList holds this page's tokens.
	TokenList []Token `json:"tokenList"`
	// TokenCount is the total number of matching rows across all pages.
	TokenCount int64 `json:"tokenCount"`
}

// Trade is a single buy or sell against a token.
//
// EthAmount, TokenAmount, TokenPrice and EthPrice are decimal strings.
type Trade struct {
	ID          int64  `json:"id"`
	TokenName   string `json:"tokenName"`
	TokenSymbol string `json:"tokenSymbol"`
	// TokenAddress is the token that was traded.
	TokenAddress string  `json:"tokenAddress"`
	TokenImage   *string `json:"tokenImage"`
	// SwapperAddress is the wallet that traded.
	SwapperAddress  string  `json:"swapperAddress"`
	SwapperUsername *string `json:"swapperUsername"`
	SwapperAvatar   *string `json:"swapperAvatar"`
	// Type is TradeBuy or TradeSell.
	Type TradeType `json:"type"`
	// EthAmount is the BNB leg of the trade, a decimal string.
	EthAmount string `json:"ethAmount"`
	// TokenAmount is the token leg of the trade, a decimal string.
	TokenAmount string `json:"tokenAmount"`
	Network     string `json:"network"`
	// Date is the trade time in UNIX seconds. Use UnixTime to convert.
	Date   int64  `json:"date"`
	TxHash string `json:"txHash"`
	// TokenPrice is the USD token price at trade time, a decimal string.
	TokenPrice string `json:"tokenPrice"`
	// EthPrice is the USD BNB price at trade time, a decimal string.
	EthPrice string `json:"ethPrice"`
}

// Holder is one wallet's position in a token. TokenAmount and Marketcap are
// decimal strings.
type Holder struct {
	ID           int64  `json:"id"`
	TokenAddress string `json:"tokenAddress"`
	// HolderAddress is the wallet holding the tokens.
	HolderAddress string `json:"holderAddress"`
	// TokenAmount is the balance in whole tokens, a decimal string.
	TokenAmount string  `json:"tokenAmount"`
	TokenName   string  `json:"tokenName"`
	TokenSymbol string  `json:"tokenSymbol"`
	TokenImage  *string `json:"tokenImage"`
	// Marketcap is the token's USD market cap, a decimal string.
	Marketcap      string      `json:"marketcap"`
	Network        string      `json:"network"`
	CreatorAddress string      `json:"creatorAddress"`
	User           CreatorInfo `json:"user"`
}

// TokenDetail is the full token record plus recent trades, holder
// distribution, the 15-minute price and one-day liquidity.
type TokenDetail struct {
	// TokenDetails is the token record itself.
	TokenDetails Token `json:"tokenDetails"`
	// Trades is the requested page of recent trades, newest first.
	Trades []Trade `json:"trades"`
	// TradesCount is the total number of trades, for pagination.
	TradesCount int64 `json:"tradesCount"`
	// HoldersDetails is the holder distribution.
	HoldersDetails []Holder `json:"holdersDetails"`
	// FifteenMinPrice is the price 15 minutes ago, a decimal string.
	FifteenMinPrice *string `json:"fifteenMinPrice"`
	// OneDayLiquidity is a decimal string.
	OneDayLiquidity *string `json:"oneDayLiquidity"`
	// CurveHolding is the bonding curve's own balance in whole tokens, as a
	// decimal string.
	//
	// Nil means UNKNOWN — the on-chain read failed. It does not mean zero and
	// must never be rendered as 0.
	CurveHolding *string `json:"curveHolding"`
}

// Candle is one OHLCV bar. Candle values are aggregates and come back as
// numbers, not decimal strings.
type Candle struct {
	// Time is the candle open time in UNIX seconds.
	Time   int64   `json:"time"`
	Open   float64 `json:"open"`
	High   float64 `json:"high"`
	Low    float64 `json:"low"`
	Close  float64 `json:"close"`
	Volume float64 `json:"volume"`
}

// DiscoverToken is one row of the discovery feed: the highest-signal single
// endpoint for bulk market-data ingestion. Its numeric fields are pre-computed
// aggregates and are plain numbers rather than decimal strings.
type DiscoverToken struct {
	TokenAddress string  `json:"tokenAddress"`
	Name         string  `json:"name"`
	Symbol       string  `json:"symbol"`
	Image        *string `json:"image"`
	Network      string  `json:"network"`
	// CreatorAddress is nil when the launcher is unknown.
	CreatorAddress *string `json:"creatorAddress"`
	// Marketcap is the USD market cap.
	Marketcap float64 `json:"marketcap"`
	PriceUsd  float64 `json:"priceUsd"`
	// CreatedAt is the creation time in UNIX seconds.
	CreatedAt int64 `json:"createdAt"`
	// Launched is true once the token has graduated to a DEX pair.
	Launched bool `json:"launched"`
	// Volume24h is the trailing 24 hour USD volume.
	Volume24h float64 `json:"volume24h"`
	Buys24h   int64   `json:"buys24h"`
	Sells24h  int64   `json:"sells24h"`
	Holders   int64   `json:"holders"`
	// PriceChange24h is the 24 hour price change in percent.
	PriceChange24h float64 `json:"priceChange24h"`
	// GraduationPct is progress toward the $30,000 graduation target, 0-100.
	GraduationPct float64 `json:"graduationPct"`
}

// RecentTrades is the platform-wide trade feed together with the token records
// the trades reference, so a consumer can render a feed without a second call.
type RecentTrades struct {
	Trades []Trade `json:"trades"`
	Tokens []Token `json:"tokens"`
}
