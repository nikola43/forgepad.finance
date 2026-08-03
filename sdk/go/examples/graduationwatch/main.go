// Command graduationwatch lists the tokens closest to leaving the bonding curve.
//
//	go run ./examples/graduationwatch
//
// A Fyuz token trades on an internal bonding curve until it reaches a $30,000
// market cap, then graduates into a PancakeSwap V2 pair. Until that happens
// there is no DEX pool anywhere: PairAddress is nil and no aggregator has a
// price. This API is the only source, which is what makes the pre-graduation
// window worth watching.
package main

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	fyuz "github.com/nikola43/forgepad.finance/sdk/go"
)

// graduationTargetUSD is the market cap at which a token graduates.
const graduationTargetUSD = 30_000

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client := fyuz.New()

	candidates, err := client.Discover(ctx, &fyuz.DiscoverOptions{
		Tab:        fyuz.TabGraduating,
		Status:     fyuz.StatusBonding,
		MinHolders: fyuz.Int64(10),
		Limit:      fyuz.Int64(25),
	})
	if err != nil {
		log.Fatalf("discover: %v", err)
	}
	if len(candidates) == 0 {
		fmt.Println("nothing close to graduation right now")
		return
	}

	// GraduationPct is what the server computed; recomputing it from market cap
	// here would only introduce a second, disagreeing number.
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].GraduationPct > candidates[j].GraduationPct
	})

	fmt.Printf("%d tokens on the curve, closest first\n\n", len(candidates))
	for _, token := range candidates {
		remaining := graduationTargetUSD - token.Marketcap
		if remaining < 0 {
			remaining = 0
		}
		fmt.Printf("%-10.10s %s %6.1f%% %18s %14s\n",
			token.Symbol,
			bar(token.GraduationPct),
			token.GraduationPct,
			fmt.Sprintf("$%.0f to go", remaining),
			fmt.Sprintf("%d holders", token.Holders),
		)
	}

	leader := candidates[0]
	fmt.Printf("\nwatching the top candidate: %s\n", leader.Symbol)

	detail, err := client.GetToken(ctx, leader.Network, leader.TokenAddress, &fyuz.GetTokenOptions{
		PageSize: fyuz.Int64(1),
	})
	if err != nil {
		log.Fatalf("token detail: %v", err)
	}

	// These are exact decimal strings and stay strings. CurveHolding is nil when
	// the on-chain read failed — that means *unknown*, and printing 0 would tell
	// the reader something false.
	fmt.Printf("  market cap     %s USD (exact)\n", detail.TokenDetails.Marketcap)
	fmt.Printf("  price          %s USD (exact)\n", detail.TokenDetails.Price)
	fmt.Printf("  curve holding  %s\n", orElse(detail.CurveHolding, "unknown — on-chain read failed"))
	fmt.Printf("  pair address   %s\n", orElse(detail.TokenDetails.PairAddress,
		"none — still on the curve, no DEX pool exists"))
}

// bar renders a fixed-width progress bar.
func bar(percent float64) string {
	const width = 24
	filled := int(percent/100*width + 0.5)
	if filled < 0 {
		filled = 0
	}
	if filled > width {
		filled = width
	}
	return "[" + strings.Repeat("█", filled) + strings.Repeat("·", width-filled) + "]"
}

// orElse renders a nullable string, keeping "unknown" distinct from a value.
func orElse(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}
