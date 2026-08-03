package fyuz_test

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	fyuz "github.com/nikola43/forgepad.finance/sdk/go"
)

// The discovery feed is the recommended entry point for market-data ingestion.
func ExampleClient_Discover() {
	client := fyuz.New()

	tokens, err := client.Discover(context.Background(), &fyuz.DiscoverOptions{
		Tab:    fyuz.TabGraduating,
		Status: fyuz.StatusBonding,
		Limit:  fyuz.Int64(10),
	})
	if err != nil {
		log.Fatal(err)
	}

	for _, t := range tokens {
		fmt.Printf("%-8s $%10.2f  %5.1f%% to graduation\n", t.Symbol, t.Marketcap, t.GraduationPct)
	}
}

// Pre-graduation tokens have no DEX pool, so this API is their only price
// source. Check PairAddress to tell the two states apart.
func ExampleClient_GetToken() {
	client := fyuz.New()

	detail, err := client.GetToken(context.Background(), "bsc", "0x23a84ba5bf7bf3236491fa2b5a9807a274337135", nil)
	switch {
	case errors.Is(err, fyuz.ErrNotFound):
		fmt.Println("no such token")
		return
	case err != nil:
		log.Fatal(err)
	}

	if detail.TokenDetails.Graduated() {
		fmt.Println("trading on PancakeSwap at", *detail.TokenDetails.PairAddress)
	} else {
		fmt.Println("still on the bonding curve; this API is the only price source")
	}

	// A nil CurveHolding means the chain read failed. It does not mean zero.
	if detail.CurveHolding != nil {
		fmt.Println("curve balance:", *detail.CurveHolding)
	}
}

// The iterator walks every page of the token list, fetching lazily.
func ExampleClient_IterateTokens() {
	client := fyuz.New()
	ctx := context.Background()

	it := client.IterateTokens(&fyuz.ListTokensOptions{
		OrderType: "marketcap",
		OrderFlag: fyuz.SortDesc,
		PageSize:  fyuz.Int64(100),
	})
	for it.Next(ctx) {
		token := it.Token()
		fmt.Println(token.TokenSymbol, token.Marketcap)
	}
	if err := it.Err(); err != nil {
		log.Fatal(err)
	}
}

// Rate limiting is handled for you; this is how to react when the retries run
// out anyway.
func ExampleAPIError() {
	client := fyuz.New(
		fyuz.WithTimeout(10*time.Second),
		fyuz.WithMaxRetries(5),
	)

	_, err := client.GetUserProfile(context.Background(), "0x0000000000000000000000000000000000000000")
	switch {
	case errors.Is(err, fyuz.ErrNotFound):
		fmt.Println("wallet has no Fyuz profile")
	case errors.Is(err, fyuz.ErrRateLimited):
		fmt.Println("still rate limited after 5 retries; slow down")
	case err != nil:
		var apiErr *fyuz.APIError
		if errors.As(err, &apiErr) {
			fmt.Printf("HTTP %d from %s: %s\n", apiErr.StatusCode, apiErr.URL, apiErr.Message)
		}
	}
}

// Wei amounts are exact integers far beyond float64's range, so they stay
// strings on the wire and are parsed with math/big.
func ExampleParseWei() {
	// As returned in PayoutStats.TotalPaidWei.
	const totalPaidWei = "1250000000000000000"

	wei, err := fyuz.ParseWei(totalPaidWei)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(wei.String(), "wei")
	fmt.Println(fyuz.WeiToBNB(wei).FloatString(4), "BNB")

	// Output:
	// 1250000000000000000 wei
	// 1.2500 BNB
}

// Market caps and token balances are fixed-point decimal strings; ParseDecimal
// keeps every digit.
func ExampleParseDecimal() {
	// As returned in Token.Marketcap.
	const marketcap = "4472.899483094470000000"

	rat, err := fyuz.ParseDecimal(marketcap)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(rat.FloatString(2))

	// Output:
	// 4472.90
}

// UNIX-second timestamps convert with UnixTime; the nullable ones stay nil
// rather than collapsing to the epoch.
func ExampleUnixTime() {
	fmt.Println(fyuz.UnixTime(1751371200).Format(time.RFC3339))
	fmt.Println(fyuz.UnixTimePtr(nil))

	// Output:
	// 2025-07-01T12:00:00Z
	// <nil>
}
