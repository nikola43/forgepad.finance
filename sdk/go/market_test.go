package fyuz

import (
	"context"
	"encoding/json"
	"math/big"
	"net/http"
	"strconv"
	"testing"
	"time"
)

const tokenJSON = `{
  "id": 42,
  "tokenAddress": "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
  "tokenName": "Test Token",
  "tokenSymbol": "TST",
  "tokenDescription": null,
  "imageStyle": null,
  "tokenImage": "https://cdn.example/t.png",
  "tokenBanner": null,
  "creatorAddress": "0xcreator",
  "user": {"address": "0xcreator", "username": "alice", "avatar": null},
  "network": "bsc",
  "marketcap": "4472.899483094470000000",
  "price": "0.000004472899483094",
  "ethPrice": "612.120000000000000000",
  "volume": "1234.500000000000000000",
  "score": "9.5",
  "virtualEthAmount": "7.123456789012345678",
  "virtualTokenAmount": "1073000000.000000000000000000",
  "pairAddress": null,
  "poolType": 1,
  "category": "meme",
  "replies": 7,
  "webLink": null,
  "telegramLink": null,
  "twitterLink": null,
  "launchedAt": null,
  "createdAt": "2026-07-01T10:00:00Z",
  "updatedAt": "2026-07-02T11:30:00.123456Z",
  "creationTime": "2026-07-01T10:00:00Z",
  "liquidity": "4361.05",
  "progress": 14.9,
  "priceChange": -3.25
}`

func TestHealth(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Method != http.MethodGet {
			t.Errorf("method = %q", r.Method)
		}
		writeJSON(t, w, 200, `{"status":"ok"}`)
	})

	got, err := client.Health(context.Background())
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if got.Status != "ok" {
		t.Errorf("Status = %q", got.Status)
	}
}

func TestGetConfig(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"chains":[{"name":"BNB Smart Chain","chainId":56,"network":"bsc"}]}`)
	})

	cfg, err := client.GetConfig(context.Background())
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if len(cfg.Chains) != 1 {
		t.Fatalf("chains = %d", len(cfg.Chains))
	}
	if cfg.Chains[0].ChainID != 56 || cfg.Chains[0].Name != "BNB Smart Chain" {
		t.Errorf("chain = %+v", cfg.Chains[0])
	}
}

func TestDiscoverSendsEveryOption(t *testing.T) {
	var got map[string]string
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/discover" {
			t.Errorf("path = %q", r.URL.Path)
		}
		got = map[string]string{}
		for k, v := range r.URL.Query() {
			got[k] = v[0]
		}
		writeJSON(t, w, 200, `[]`)
	})

	_, err := client.Discover(context.Background(), &DiscoverOptions{
		Tab:          TabGraduating,
		Network:      "bsc",
		MinMarketcap: Float64(1500.5),
		MinVolume:    Float64(0), // explicit zero must still be sent
		MinHolders:   Int64(10),
		MaxAgeSecs:   Int64(86400),
		Status:       StatusBonding,
		Limit:        Int64(25),
	})
	if err != nil {
		t.Fatalf("Discover: %v", err)
	}

	want := map[string]string{
		"tab":          "graduating",
		"network":      "bsc",
		"minMarketcap": "1500.5",
		"minVolume":    "0",
		"minHolders":   "10",
		"maxAgeSecs":   "86400",
		"status":       "bonding",
		"limit":        "25",
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("query %s = %q, want %q", k, got[k], v)
		}
	}
	if len(got) != len(want) {
		t.Errorf("query = %v, want exactly %v", got, want)
	}
}

func TestDiscoverNilOptionsSendsNoQuery(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" {
			t.Errorf("RawQuery = %q, want empty", r.URL.RawQuery)
		}
		writeJSON(t, w, 200, `[]`)
	})
	if _, err := client.Discover(context.Background(), nil); err != nil {
		t.Fatalf("Discover: %v", err)
	}
}

func TestListTokensAndTokenDecoding(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("orderType") != "marketcap" {
			t.Errorf("orderType = %q", r.URL.Query().Get("orderType"))
		}
		if r.URL.Query().Get("orderFlag") != "desc" {
			t.Errorf("orderFlag = %q", r.URL.Query().Get("orderFlag"))
		}
		if r.URL.Query().Get("includeNsfw") != "false" {
			t.Errorf("includeNsfw = %q", r.URL.Query().Get("includeNsfw"))
		}
		writeJSON(t, w, 200, `{"tokenList":[`+tokenJSON+`],"tokenCount":137}`)
	})

	page, err := client.ListTokens(context.Background(), &ListTokensOptions{
		OrderType:   "marketcap",
		OrderFlag:   SortDesc,
		IncludeNsfw: Bool(false),
	})
	if err != nil {
		t.Fatalf("ListTokens: %v", err)
	}
	if page.TokenCount != 137 || len(page.TokenList) != 1 {
		t.Fatalf("page = %+v", page)
	}

	tok := page.TokenList[0]
	if tok.ID != 42 || tok.TokenSymbol != "TST" {
		t.Errorf("token = %+v", tok)
	}
	if tok.PairAddress != nil {
		t.Error("PairAddress should be nil for a pre-graduation token")
	}
	if tok.Graduated() {
		t.Error("Graduated() must be false while PairAddress is nil")
	}
	if tok.LaunchedAt != nil {
		t.Error("LaunchedAt should be nil for a pre-graduation token")
	}
	if tok.TokenDescription != nil {
		t.Error("null tokenDescription must decode to nil")
	}
	if tok.User.Username == nil || *tok.User.Username != "alice" {
		t.Errorf("User = %+v", tok.User)
	}
	if tok.PoolType != PoolTypePancakeV2 {
		t.Errorf("PoolType = %d", tok.PoolType)
	}
	if tok.Progress == nil || *tok.Progress != 14.9 {
		t.Errorf("Progress = %v", tok.Progress)
	}
	if tok.Price15m != nil {
		t.Error("omitted price15m must decode to nil")
	}
	wantCreated := time.Date(2026, 7, 1, 10, 0, 0, 0, time.UTC)
	if !tok.CreatedAt.Equal(wantCreated) {
		t.Errorf("CreatedAt = %v, want %v", tok.CreatedAt, wantCreated)
	}
}

// The 18-decimal amount fields must survive the round trip byte for byte. The
// same value through a float64 loses digits, which is exactly what the string
// model exists to prevent.
func TestDecimalStringsSurviveRoundTripWithoutPrecisionLoss(t *testing.T) {
	const exactMarketcap = "4472.899483094470000000"
	const exactVirtualToken = "1073000000.000000000000000000"
	const exactVirtualEth = "7.123456789012345678"

	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"tokenList":[`+tokenJSON+`],"tokenCount":1}`)
	})

	page, err := client.ListTokens(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListTokens: %v", err)
	}
	tok := page.TokenList[0]

	if tok.Marketcap != exactMarketcap {
		t.Errorf("Marketcap = %q, want %q", tok.Marketcap, exactMarketcap)
	}
	if tok.VirtualTokenAmount != exactVirtualToken {
		t.Errorf("VirtualTokenAmount = %q, want %q", tok.VirtualTokenAmount, exactVirtualToken)
	}
	if tok.VirtualEthAmount != exactVirtualEth {
		t.Errorf("VirtualEthAmount = %q, want %q", tok.VirtualEthAmount, exactVirtualEth)
	}

	// Re-encoding keeps the exact string.
	blob, err := json.Marshal(tok)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var again Token
	if err := json.Unmarshal(blob, &again); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if again.VirtualEthAmount != exactVirtualEth {
		t.Errorf("after re-encode: %q", again.VirtualEthAmount)
	}

	// ParseDecimal is exact where float64 is not.
	rat, err := ParseDecimal(exactVirtualEth)
	if err != nil {
		t.Fatalf("ParseDecimal: %v", err)
	}
	if got := rat.FloatString(18); got != "7.123456789012345678" {
		t.Errorf("ParseDecimal round trip = %q", got)
	}
	// The premise of the string model: the float path corrupts this value.
	if lossy := strconv.FormatFloat(mustFloat(t, exactVirtualEth), 'f', 18, 64); lossy == exactVirtualEth {
		t.Errorf("expected float64 to lose digits on %s, got %s", exactVirtualEth, lossy)
	}
}

func mustFloat(t *testing.T, s string) float64 {
	t.Helper()
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		t.Fatalf("ParseFloat: %v", err)
	}
	return f
}

func TestParseWeiExactness(t *testing.T) {
	// 10^30 wei: far beyond float64's 2^53 exact-integer range.
	const huge = "1000000000000000000000000000001"
	n, err := ParseWei(huge)
	if err != nil {
		t.Fatalf("ParseWei: %v", err)
	}
	if n.String() != huge {
		t.Fatalf("ParseWei round trip = %s, want %s", n, huge)
	}
	// Proof that the float path would corrupt it.
	viaFloat := new(big.Float).SetFloat64(mustFloat(t, huge))
	asInt, _ := viaFloat.Int(nil)
	if asInt.String() == huge {
		t.Error("expected float64 to lose precision on a 10^30 wei value")
	}
	if _, err := ParseWei("not a number"); err == nil {
		t.Error("expected an error for a non-numeric wei string")
	}
	if got, err := ParseWeiPtr(nil); err != nil || got != nil {
		t.Errorf("ParseWeiPtr(nil) = %v, %v; want nil, nil", got, err)
	}
}

func TestWeiToBNB(t *testing.T) {
	wei, err := ParseWei("1250000000000000000")
	if err != nil {
		t.Fatalf("ParseWei: %v", err)
	}
	if got := WeiToBNB(wei).FloatString(4); got != "1.2500" {
		t.Errorf("WeiToBNB = %s, want 1.2500", got)
	}
	if WeiToBNB(nil) != nil {
		t.Error("WeiToBNB(nil) must stay nil")
	}
}

// GET /tokens/king answers with a {"king": ...} envelope, not a bare token.
// Decoding the envelope straight into a Token yields a zero-valued struct with
// no error, which is the bug this pins.
func TestGetKing(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tokens/king" {
			t.Errorf("path = %q", r.URL.Path)
		}
		writeJSON(t, w, 200, `{"king": `+tokenJSON+`}`)
	})
	king, err := client.GetKing(context.Background())
	if err != nil {
		t.Fatalf("GetKing: %v", err)
	}
	if king == nil {
		t.Fatal("GetKing returned nil for a populated envelope")
	}
	if king.TokenSymbol != "TST" {
		t.Errorf("symbol = %q", king.TokenSymbol)
	}
	if king.Marketcap == "" {
		t.Error("marketcap is empty: the envelope was not unwrapped")
	}
}

// An empty hill is a real state: every token on the curve has graduated. It
// must come back as (nil, nil), not as a blank Token.
func TestGetKingEmptyHill(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"king": null}`)
	})
	king, err := client.GetKing(context.Background())
	if err != nil {
		t.Fatalf("GetKing: %v", err)
	}
	if king != nil {
		t.Errorf("king = %+v, want nil", king)
	}
}

func TestGetTokenPathAndNullCurveHolding(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		wantPath := "/tokens/bsc/0x23a84ba5bf7bf3236491fa2b5a9807a274337135"
		if r.URL.Path != wantPath {
			t.Errorf("path = %q, want %q", r.URL.Path, wantPath)
		}
		if r.URL.Query().Get("pageNumber") != "2" || r.URL.Query().Get("pageSize") != "5" {
			t.Errorf("query = %q", r.URL.RawQuery)
		}
		writeJSON(t, w, 200, `{
			"tokenDetails": `+tokenJSON+`,
			"trades": [],
			"tradesCount": 0,
			"holdersDetails": [],
			"fifteenMinPrice": null,
			"oneDayLiquidity": "12.5",
			"curveHolding": null
		}`)
	})

	detail, err := client.GetToken(context.Background(), "bsc", "0x23a84ba5bf7bf3236491fa2b5a9807a274337135",
		&GetTokenOptions{PageNumber: Int64(2), PageSize: Int64(5)})
	if err != nil {
		t.Fatalf("GetToken: %v", err)
	}
	// null must stay nil: rendering it as "0" would claim the curve holds
	// nothing, when in fact the chain read failed.
	if detail.CurveHolding != nil {
		t.Errorf("CurveHolding = %v, want nil for an unknown value", *detail.CurveHolding)
	}
	if detail.FifteenMinPrice != nil {
		t.Error("FifteenMinPrice should be nil")
	}
	if detail.OneDayLiquidity == nil || *detail.OneDayLiquidity != "12.5" {
		t.Errorf("OneDayLiquidity = %v", detail.OneDayLiquidity)
	}
	if detail.TokenDetails.ID != 42 {
		t.Errorf("nested token id = %d", detail.TokenDetails.ID)
	}
}

func TestPathParamsAreEscaped(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		// A traversal attempt must arrive as one literal, escaped segment.
		if got := r.URL.EscapedPath(); got != "/wallet/..%2Fadmin" {
			t.Errorf("escaped path = %q, want /wallet/..%%2Fadmin", got)
		}
		writeJSON(t, w, 200, `{"address":"x"}`)
	})
	if _, err := client.GetWallet(context.Background(), "../admin"); err != nil {
		t.Fatalf("GetWallet: %v", err)
	}
}
