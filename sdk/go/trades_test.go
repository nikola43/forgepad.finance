package fyuz

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

const tradeJSON = `{
  "id": 9001,
  "tokenName": "Test Token",
  "tokenSymbol": "TST",
  "tokenAddress": "0x23a8",
  "tokenImage": null,
  "swapperAddress": "0xswapper",
  "swapperUsername": null,
  "swapperAvatar": null,
  "type": "buy",
  "ethAmount": "0.123456789012345678",
  "tokenAmount": "31415926.535897932384626433",
  "network": "bsc",
  "date": 1751371200,
  "txHash": "0xhash",
  "tokenPrice": "0.000004472899483094",
  "ethPrice": "612.12"
}`

func TestGetRecentTrades(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/trades/recent" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.URL.Query().Get("latestTradeId") != "9000" {
			t.Errorf("latestTradeId = %q", r.URL.Query().Get("latestTradeId"))
		}
		if _, ok := r.URL.Query()["latestTokenId"]; ok {
			t.Error("unset latestTokenId must not be sent")
		}
		writeJSON(t, w, 200, `{"trades":[`+tradeJSON+`],"tokens":[`+tokenJSON+`]}`)
	})

	feed, err := client.GetRecentTrades(context.Background(), &RecentTradesOptions{
		LatestTradeID: Int64(9000),
	})
	if err != nil {
		t.Fatalf("GetRecentTrades: %v", err)
	}
	if len(feed.Trades) != 1 || len(feed.Tokens) != 1 {
		t.Fatalf("feed = %+v", feed)
	}
	tr := feed.Trades[0]
	if tr.Type != TradeBuy {
		t.Errorf("Type = %q", tr.Type)
	}
	if tr.Date != 1751371200 {
		t.Errorf("Date = %d", tr.Date)
	}
	if got := UnixTime(tr.Date).Format("2006-01-02T15:04:05Z"); got != "2025-07-01T12:00:00Z" {
		t.Errorf("UnixTime = %s", got)
	}
	// 18-decimal trade legs stay exact.
	if tr.TokenAmount != "31415926.535897932384626433" {
		t.Errorf("TokenAmount = %q", tr.TokenAmount)
	}
	if tr.EthAmount != "0.123456789012345678" {
		t.Errorf("EthAmount = %q", tr.EthAmount)
	}
	if tr.SwapperUsername != nil {
		t.Error("null swapperUsername must decode to nil")
	}
}

// POST /trades is a read: the address travels in the body.
func TestGetTokenTradesPostsAddressInBody(t *testing.T) {
	var gotBody, gotContentType, gotMethod string
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotContentType = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		if r.URL.Query().Get("limit") != "100" || r.URL.Query().Get("offset") != "20" {
			t.Errorf("query = %q", r.URL.RawQuery)
		}
		writeJSON(t, w, 200, `[`+tradeJSON+`]`)
	})

	trades, err := client.GetTokenTrades(context.Background(), "0x23a8", &TokenTradesOptions{
		Limit:  Int64(100),
		Offset: Int64(20),
	})
	if err != nil {
		t.Fatalf("GetTokenTrades: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q", gotMethod)
	}
	if gotContentType != "application/json" {
		t.Errorf("Content-Type = %q", gotContentType)
	}
	var body map[string]string
	if err := json.Unmarshal([]byte(gotBody), &body); err != nil {
		t.Fatalf("body %q: %v", gotBody, err)
	}
	if body["tokenAddress"] != "0x23a8" {
		t.Errorf("body = %v", body)
	}
	if len(trades) != 1 || trades[0].ID != 9001 {
		t.Errorf("trades = %+v", trades)
	}
}

// The request body must be replayable, or a retried POST would send nothing.
func TestGetTokenTradesRetryResendsBody(t *testing.T) {
	var bodies []string
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		if len(bodies) == 1 {
			writeJSON(t, w, http.StatusTooManyRequests, `{"error":"Too many requests"}`)
			return
		}
		writeJSON(t, w, 200, `[]`)
	})

	if _, err := client.GetTokenTrades(context.Background(), "0xabc", nil); err != nil {
		t.Fatalf("GetTokenTrades: %v", err)
	}
	if len(bodies) != 2 {
		t.Fatalf("got %d requests, want 2", len(bodies))
	}
	if bodies[0] != bodies[1] || !strings.Contains(bodies[1], "0xabc") {
		t.Errorf("retried body = %q, first body = %q", bodies[1], bodies[0])
	}
}

func TestGetTokenTradesRequiresAddress(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("no request should have been sent")
	})
	if _, err := client.GetTokenTrades(context.Background(), "", nil); err == nil {
		t.Fatal("expected an error for an empty token address")
	}
}

func TestGetChartData(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/trades/getChartData" {
			t.Errorf("path = %q", r.URL.Path)
		}
		q := r.URL.Query()
		for k, want := range map[string]string{
			"tokenAddress": "0x23a8",
			"interval":     "5",
			"from":         "1751000000",
			"to":           "1751371200",
			"countBack":    "300",
		} {
			if q.Get(k) != want {
				t.Errorf("query %s = %q, want %q", k, q.Get(k), want)
			}
		}
		if _, ok := q["dex"]; ok {
			t.Error("empty dex must not be sent")
		}
		writeJSON(t, w, 200, `[{"time":1751000000,"open":1.5,"high":2,"low":1.25,"close":1.75,"volume":42.5}]`)
	})

	candles, err := client.GetChartData(context.Background(), &ChartDataOptions{
		TokenAddress: "0x23a8",
		Interval:     "5",
		From:         1751000000,
		To:           1751371200,
		CountBack:    Int64(300),
	})
	if err != nil {
		t.Fatalf("GetChartData: %v", err)
	}
	if len(candles) != 1 {
		t.Fatalf("candles = %d", len(candles))
	}
	c := candles[0]
	if c.Time != 1751000000 || c.Open != 1.5 || c.High != 2 || c.Low != 1.25 || c.Close != 1.75 || c.Volume != 42.5 {
		t.Errorf("candle = %+v", c)
	}
}

func TestGetChartDataValidatesRequiredParams(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("no request should have been sent")
	})
	ctx := context.Background()
	if _, err := client.GetChartData(ctx, nil); err == nil {
		t.Error("expected an error for nil options")
	}
	if _, err := client.GetChartData(ctx, &ChartDataOptions{Interval: "5"}); err == nil {
		t.Error("expected an error for a missing token address")
	}
	if _, err := client.GetChartData(ctx, &ChartDataOptions{TokenAddress: "0x1"}); err == nil {
		t.Error("expected an error for a missing interval")
	}
	// from and to are required too: sending from=0&to=0 would return an empty
	// candle set instead of an actionable error.
	if _, err := client.GetChartData(ctx, &ChartDataOptions{
		TokenAddress: "0x1", Interval: "5",
	}); err == nil {
		t.Error("expected an error for a missing From/To")
	}
	if _, err := client.GetChartData(ctx, &ChartDataOptions{
		TokenAddress: "0x1", Interval: "5", From: 1751000000,
	}); err == nil {
		t.Error("expected an error for a missing To")
	}
	// From=0 with a valid To is a legitimate open-ended range; checked through
	// validate directly so the stub above stays untouched.
	if err := (&ChartDataOptions{
		TokenAddress: "0x1", Interval: "5", To: 1751371200,
	}).validate(); err != nil {
		t.Errorf("From=0 with a valid To must be accepted: %v", err)
	}
	if _, err := client.GetChartData(ctx, &ChartDataOptions{
		TokenAddress: "0x1", Interval: "5", From: 1751371200, To: 1751000000,
	}); err == nil {
		t.Error("expected an error for From after To")
	}
	if _, err := client.GetChartData(ctx, &ChartDataOptions{
		TokenAddress: "0x1", Interval: "5", From: -1, To: 1751000000,
	}); err == nil {
		t.Error("expected an error for a negative From")
	}
}
