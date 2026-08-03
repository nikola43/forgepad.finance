// Command exporttokens writes every token matching a filter to CSV.
//
//	go run ./examples/exporttokens [searchWord] > tokens.csv
//
// IterateTokens walks the paginated /tokens endpoint lazily: pages are fetched
// as the loop consumes them, so memory stays flat regardless of how many tokens
// match.
//
// The decimal columns are written straight through as the strings the API sent.
// Parsing them into a float64 on the way past would corrupt exactly the values a
// downstream analyst cares about; see the running total below for the way to do
// arithmetic on them safely.
package main

import (
	"context"
	"encoding/csv"
	"fmt"
	"log"
	"math/big"
	"os"

	fyuz "github.com/nikola43/forgepad.finance/sdk/go"
)

func main() {
	ctx := context.Background()
	client := fyuz.New()

	var searchWord string
	if len(os.Args) > 1 {
		searchWord = os.Args[1]
	}

	writer := csv.NewWriter(os.Stdout)
	defer writer.Flush()

	header := []string{
		"tokenAddress", "tokenSymbol", "tokenName", "network",
		"marketcap", "price", "volume", "liquidity", "pairAddress", "createdAt",
	}
	if err := writer.Write(header); err != nil {
		log.Fatalf("write header: %v", err)
	}

	// big.Rat, not float64: summing thousands of 18-decimal market caps in
	// binary floating point drifts by an amount that grows with the row count.
	runningTotal := new(big.Rat)
	exported := 0

	iterator := client.IterateTokens(&fyuz.ListTokensOptions{
		SearchWord: searchWord,
		OrderType:  "marketcap",
		OrderFlag:  fyuz.SortDesc,
		PageSize:   fyuz.Int64(100),
	})

	for iterator.Next(ctx) {
		token := iterator.Token()

		row := []string{
			token.TokenAddress,
			token.TokenSymbol,
			token.TokenName,
			token.Network,
			token.Marketcap,
			token.Price,
			token.Volume,
			// nil is not 0: an unknown liquidity is left empty rather than invented.
			deref(token.Liquidity),
			deref(token.PairAddress),
			token.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
		if err := writer.Write(row); err != nil {
			log.Fatalf("write row: %v", err)
		}

		if marketcap, err := fyuz.ParseDecimal(token.Marketcap); err == nil {
			runningTotal.Add(runningTotal, marketcap)
		}

		exported++
		if exported%500 == 0 {
			writer.Flush()
			fmt.Fprintf(os.Stderr, "… %d rows\n", exported)
		}
	}
	if err := iterator.Err(); err != nil {
		log.Fatalf("iterate tokens: %v", err)
	}

	total, _ := runningTotal.Float64() // Display only, after the exact sum.
	fmt.Fprintf(os.Stderr, "done — %d of %d rows, %.2f USD total market cap\n",
		exported, iterator.TotalCount(), total)
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
