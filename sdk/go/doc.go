/*
Package fyuz is the official Go client for the Fyuz public REST API.

Fyuz is a bonding-curve token launchpad on BNB Smart Chain. A token trades
against an internal bonding curve until it reaches a $30,000 market cap, at
which point it "graduates" into a PancakeSwap V2 pair. Before graduation
Token.PairAddress is nil and no DEX pool exists anywhere, so this API is the
only source of price, liquidity and curve state for a pre-graduation token.

Every endpoint exposed by this package is unauthenticated and read-only.

# Quick start

	client := fyuz.New()

	tokens, err := client.Discover(context.Background(), &fyuz.DiscoverOptions{
		Tab:   fyuz.TabTrending,
		Limit: fyuz.Int64(10),
	})
	if err != nil {
		log.Fatal(err)
	}
	for _, t := range tokens {
		fmt.Printf("%-10s $%.2f mcap  %.1f%% to graduation\n",
			t.Symbol, t.Marketcap, t.GraduationPct)
	}

# Configuration

The zero-configuration client talks to https://api.fyuz.fun with a 30 second
per-attempt timeout and up to 3 automatic retries. Everything is overridable
with functional options:

	client := fyuz.New(
		fyuz.WithBaseURL("https://staging.example.com"),
		fyuz.WithTimeout(10*time.Second),
		fyuz.WithMaxRetries(5),
		fyuz.WithHTTPClient(myInstrumentedClient),
	)

# Precision

Token, BNB and market-cap amounts are transported as decimal strings and are
kept as Go strings in the models. Wei amounts (every field whose name ends in
Wei) are exact uint256 decimal strings that routinely exceed the range float64
can represent exactly. Never parse these with strconv.ParseFloat. Use the
opt-in helpers instead:

	wei, err := fyuz.ParseWei(stats.TotalPaidWei) // *big.Int, exact
	mcap, err := fyuz.ParseDecimal(token.Marketcap) // *big.Rat, exact

# Nulls

A nil pointer means "unknown", never "zero". Pot.PotBnb is nil when the RPC
that reads the Distributor balance is unreachable; TokenDetail.CurveHolding is
nil when the on-chain read failed; RoundReceipt.PotWei is nil when the
settlement has not been indexed yet. Rendering any of those as 0 is a
correctness bug.

# Errors

Every non-2xx response becomes an *APIError carrying the HTTP status and the
server's message. Rate limiting and missing resources are matchable with
errors.Is:

	_, err := client.GetToken(ctx, "bsc", addr, nil)
	switch {
	case errors.Is(err, fyuz.ErrNotFound):
		// no such token
	case errors.Is(err, fyuz.ErrRateLimited):
		// backed off 3 times and still limited
	case err != nil:
		var apiErr *fyuz.APIError
		if errors.As(err, &apiErr) {
			log.Printf("status %d: %s", apiErr.StatusCode, apiErr.Message)
		}
	}
*/
package fyuz
