package fyuz

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// tokensPage renders a stub page of n tokens starting at the given id.
func tokensPage(startID, n int, total int) string {
	rows := make([]string, 0, n)
	for i := 0; i < n; i++ {
		id := startID + i
		rows = append(rows, fmt.Sprintf(
			`{"id":%d,"tokenAddress":"0x%03d","tokenName":"T%d","tokenSymbol":"T%d",`+
				`"creatorAddress":"0xc","user":{"address":"0xc","username":null,"avatar":null},`+
				`"network":"bsc","marketcap":"1.000000000000000001","price":"0.1","ethPrice":"600",`+
				`"volume":"0","score":"0","virtualEthAmount":"1","virtualTokenAmount":"1",`+
				`"pairAddress":null,"poolType":1,"category":"meme","replies":0,`+
				`"createdAt":"2026-07-01T10:00:00Z","updatedAt":"2026-07-01T10:00:00Z",`+
				`"creationTime":"2026-07-01T10:00:00Z"}`, id, id, id, id))
	}
	return fmt.Sprintf(`{"tokenList":[%s],"tokenCount":%d}`, strings.Join(rows, ","), total)
}

func TestTokenIteratorWalksEveryPage(t *testing.T) {
	var pages []string
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		pages = append(pages, q.Get("pageNumber")+"/"+q.Get("pageSize"))
		if q.Get("orderType") != "marketcap" {
			t.Errorf("filters were dropped: %q", r.URL.RawQuery)
		}
		switch q.Get("pageNumber") {
		case "1":
			writeJSON(t, w, 200, tokensPage(1, 3, 7))
		case "2":
			writeJSON(t, w, 200, tokensPage(4, 3, 7))
		case "3":
			writeJSON(t, w, 200, tokensPage(7, 1, 7))
		default:
			t.Errorf("iterator asked for page %q after exhausting the list", q.Get("pageNumber"))
			writeJSON(t, w, 200, tokensPage(0, 0, 7))
		}
	})

	it := client.IterateTokens(&ListTokensOptions{
		OrderType: "marketcap",
		PageSize:  Int64(3),
	})
	if got := it.TotalCount(); got != -1 {
		t.Errorf("TotalCount before the first fetch = %d, want -1", got)
	}

	var ids []int64
	for it.Next(context.Background()) {
		ids = append(ids, it.Token().ID)
	}
	if err := it.Err(); err != nil {
		t.Fatalf("iterator: %v", err)
	}
	if len(ids) != 7 {
		t.Fatalf("walked %d tokens (%v), want 7", len(ids), ids)
	}
	for i, id := range ids {
		if id != int64(i+1) {
			t.Fatalf("ids = %v, want 1..7 in order", ids)
		}
	}
	if it.TotalCount() != 7 || it.Fetched() != 7 {
		t.Errorf("TotalCount = %d, Fetched = %d", it.TotalCount(), it.Fetched())
	}
	want := []string{"1/3", "2/3", "3/3"}
	if strings.Join(pages, ",") != strings.Join(want, ",") {
		t.Errorf("requested pages = %v, want %v", pages, want)
	}
}

// The iterator must stop on an empty page even if the server's count lies.
func TestTokenIteratorStopsOnEmptyPage(t *testing.T) {
	var calls int
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls > 3 {
			t.Fatal("iterator kept paging past the empty page")
		}
		if r.URL.Query().Get("pageNumber") == "1" {
			writeJSON(t, w, 200, tokensPage(1, 2, 999999))
			return
		}
		writeJSON(t, w, 200, `{"tokenList":[],"tokenCount":999999}`)
	})

	it := client.IterateTokens(&ListTokensOptions{PageSize: Int64(2)})
	n := 0
	for it.Next(context.Background()) {
		n++
	}
	if err := it.Err(); err != nil {
		t.Fatalf("iterator: %v", err)
	}
	if n != 2 {
		t.Errorf("walked %d tokens, want 2", n)
	}
	if calls != 2 {
		t.Errorf("server calls = %d, want 2", calls)
	}
}

// The server clamps pageSize to 1..100. A caller asking for more must still
// get every row: a page shorter than *requested* is not proof of the end.
func TestTokenIteratorHandlesServerPageSizeClamp(t *testing.T) {
	const total = 250
	var sizes []string
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		sizes = append(sizes, q.Get("pageSize"))
		size, err := strconv.Atoi(q.Get("pageSize"))
		if err != nil {
			t.Fatalf("pageSize = %q: %v", q.Get("pageSize"), err)
		}
		// Replicate the server-side clamp.
		if size > 100 {
			size = 100
		}
		page, err := strconv.Atoi(q.Get("pageNumber"))
		if err != nil {
			t.Fatalf("pageNumber = %q: %v", q.Get("pageNumber"), err)
		}
		start := (page-1)*size + 1
		n := total - start + 1
		if n < 0 {
			n = 0
		}
		if n > size {
			n = size
		}
		writeJSON(t, w, 200, tokensPage(start, n, total))
	})

	it := client.IterateTokens(&ListTokensOptions{PageSize: Int64(500)})
	var ids []int64
	for it.Next(context.Background()) {
		ids = append(ids, it.Token().ID)
	}
	if err := it.Err(); err != nil {
		t.Fatalf("iterator: %v", err)
	}
	if len(ids) != total {
		t.Fatalf("walked %d of %d rows in %d request(s)", len(ids), total, len(sizes))
	}
	for i, id := range ids {
		if id != int64(i+1) {
			t.Fatalf("row %d has id %d, want %d", i, id, i+1)
		}
	}
	if it.TotalCount() != total || it.Fetched() != total {
		t.Errorf("TotalCount = %d, Fetched = %d, want %d", it.TotalCount(), it.Fetched(), total)
	}
	// The oversized request was capped before it left, so no page was short.
	for _, s := range sizes {
		if s != "100" {
			t.Errorf("requested pageSize = %q, want it capped to 100", s)
		}
	}
}

func TestTokenIteratorSurfacesErrors(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("pageNumber") == "1" {
			writeJSON(t, w, 200, tokensPage(1, 2, 100))
			return
		}
		writeJSON(t, w, http.StatusTooManyRequests, `{"error":"Too many requests"}`)
	}, WithMaxRetries(0))

	it := client.IterateTokens(&ListTokensOptions{PageSize: Int64(2)})
	n := 0
	for it.Next(context.Background()) {
		n++
	}
	if n != 2 {
		t.Errorf("walked %d tokens before the failure, want 2", n)
	}
	if !IsRateLimited(it.Err()) {
		t.Fatalf("Err() = %v, want a rate-limit error", it.Err())
	}
	// A failed iterator stays stopped.
	if it.Next(context.Background()) {
		t.Error("Next must keep returning false after an error")
	}
}

func TestTokenIteratorHonoursStartingPage(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("pageNumber"); got != "4" {
			t.Errorf("pageNumber = %q, want 4", got)
		}
		writeJSON(t, w, 200, `{"tokenList":[],"tokenCount":0}`)
	})

	it := client.IterateTokens(&ListTokensOptions{PageNumber: Int64(4), PageSize: Int64(50)})
	if it.Next(context.Background()) {
		t.Error("expected an empty walk")
	}
	if err := it.Err(); err != nil {
		t.Fatalf("iterator: %v", err)
	}
}

// Precision holds across the iterator too.
func TestTokenIteratorPreservesDecimalStrings(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, tokensPage(1, 1, 1))
	})
	it := client.IterateTokens(nil)
	if !it.Next(context.Background()) {
		t.Fatalf("expected one token, err = %v", it.Err())
	}
	if got := it.Token().Marketcap; got != "1.000000000000000001" {
		t.Errorf("Marketcap = %q", got)
	}
	var probe map[string]any
	if err := json.Unmarshal([]byte(`{"marketcap":"1.000000000000000001"}`), &probe); err != nil {
		t.Fatal(err)
	}
	if _, isString := probe["marketcap"].(string); !isString {
		t.Error("the wire format must stay a string")
	}
}
