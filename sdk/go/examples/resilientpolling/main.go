// Command resilientpolling tails the trade feed indefinitely without falling over.
//
//	go run ./examples/resilientpolling
//
// Three things make this survivable in production:
//
//  1. LatestTradeID — ask only for what is new. The server returns trades with an
//     id greater than the one you pass, so poll cost stays flat instead of
//     growing with the token's history.
//  2. The client's own retries — 429s, 5xx and transport failures are retried
//     with exponential backoff and full jitter, honouring Retry-After. The API
//     allows 120 requests/minute per IP; at one poll every 5s this uses 12.
//  3. Errors classified with the package sentinels rather than by string
//     matching. A rate limit that survived the retry budget means back off
//     harder; a 404 means the resource is gone and retrying will never help.
//
// Ctrl-C to stop.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	fyuz "github.com/nikola43/forgepad.finance/sdk/go"
)

const pollInterval = 5 * time.Second

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client := fyuz.New(
		fyuz.WithTimeout(10*time.Second),
		fyuz.WithMaxRetries(5),
		fyuz.WithBackoff(500*time.Millisecond, 30*time.Second),
		// Identify yourself. If the API ever needs to contact a heavy consumer,
		// this is the only thing it has to go on.
		fyuz.WithUserAgent("fyuz-example-poller/1.0 (ops@example.com)"),
	)

	// Start from the current tip rather than replaying history.
	var latestTradeID int64
	if tip, err := client.GetRecentTrades(ctx, nil); err != nil {
		log.Fatalf("initial fetch: %v", err)
	} else if len(tip.Trades) > 0 {
		latestTradeID = tip.Trades[0].ID
	}
	fmt.Printf("polling from trade id %d, every %s\n", latestTradeID, pollInterval)

	consecutiveFailures := 0

	for {
		feed, err := client.GetRecentTrades(ctx, &fyuz.RecentTradesOptions{
			LatestTradeID: fyuz.Int64(latestTradeID),
		})
		if err != nil {
			if ctx.Err() != nil {
				fmt.Println("\nstopping…")
				return
			}
			consecutiveFailures++
			if !sleep(ctx, backoffFor(err, consecutiveFailures)) {
				fmt.Println("\nstopping…")
				return
			}
			continue
		}
		consecutiveFailures = 0

		// The response carries the token records the trades reference, so a feed
		// consumer never has to fan out to /tokens per trade.
		symbols := make(map[string]string, len(feed.Tokens))
		for _, token := range feed.Tokens {
			symbols[token.TokenAddress] = token.TokenSymbol
		}

		// Oldest first, so downstream sees them in the order they happened.
		for i := len(feed.Trades) - 1; i >= 0; i-- {
			trade := feed.Trades[i]
			symbol, ok := symbols[trade.TokenAddress]
			if !ok {
				symbol = trade.TokenSymbol
			}
			side := "sell"
			if trade.Type.Is(fyuz.TradeBuy) {
				side = "buy"
			}
			fmt.Printf("%s  %-4s  %-10.10s  %26s tokens for %s BNB\n",
				fyuz.UnixTime(trade.Date).Format("15:04:05"),
				side, symbol, trade.TokenAmount, trade.EthAmount)

			if trade.ID > latestTradeID {
				latestTradeID = trade.ID
			}
		}

		if !sleep(ctx, pollInterval) {
			fmt.Println("\nstopping…")
			return
		}
	}
}

// backoffFor decides how long to wait after a failure, and says why.
func backoffFor(err error, consecutiveFailures int) time.Duration {
	var apiErr *fyuz.APIError

	switch {
	case fyuz.IsRateLimited(err):
		// The client already exhausted its retries on this one, so the answer is
		// not another immediate retry — it is polling less often.
		wait := time.Minute
		if errors.As(err, &apiErr) && apiErr.RetryAfter > 0 {
			wait = apiErr.RetryAfter
		}
		log.Printf("rate limited past the retry budget; backing off %s", wait)
		return wait

	case fyuz.IsNotFound(err):
		// 404 is a statement about the resource, not the connection. Retrying
		// the same request cannot fix it.
		log.Printf("gone: %v", err)
		return pollInterval

	case errors.As(err, &apiErr):
		log.Printf("HTTP %d: %s", apiErr.StatusCode, apiErr.Message)
		return 2 * pollInterval

	default:
		// Transport failure: DNS, connection refused, TLS, timeout.
		wait := pollInterval << min(consecutiveFailures, 4)
		if wait > time.Minute {
			wait = time.Minute
		}
		log.Printf("transport error: %v — retrying in %s", err, wait)
		return wait
	}
}

// sleep waits for d, returning false if the context was cancelled first.
func sleep(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}
