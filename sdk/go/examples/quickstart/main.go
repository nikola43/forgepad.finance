// Command quickstart reports whether the API is up, what chain it serves, and
// what is trending.
//
//	go run ./examples/quickstart
//
// Every endpoint used here is unauthenticated.
package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	fyuz "github.com/nikola43/forgepad.finance/sdk/go"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client := fyuz.New()

	health, err := client.Health(ctx)
	if err != nil {
		log.Fatalf("health: %v", err)
	}
	config, err := client.GetConfig(ctx)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	chains := make([]string, 0, len(config.Chains))
	for _, chain := range config.Chains {
		chains = append(chains, fmt.Sprintf("%s (%d)", chain.Name, chain.ChainID))
	}

	fmt.Printf("api        %s\n", health.Status)
	fmt.Printf("chains     %s\n\n", strings.Join(chains, ", "))

	trending, err := client.Discover(ctx, &fyuz.DiscoverOptions{
		Tab:   fyuz.TabTrending,
		Limit: fyuz.Int64(10),
	})
	if err != nil {
		log.Fatalf("discover: %v", err)
	}

	fmt.Println("symbol       market cap        24h vol    holders    24h %    to graduation")
	fmt.Println(strings.Repeat("─", 78))

	for _, token := range trending {
		progress := fmt.Sprintf("%.1f%%", token.GraduationPct)
		if token.Launched {
			progress = "graduated"
		}
		// Discovery figures are pre-aggregated analytics and arrive as float64,
		// so formatting them this way is safe. The same is *not* true of
		// Token.Marketcap from /tokens — see the exporttokens example.
		fmt.Printf("%-10.10s %14s %13s %9d %+7.1f%% %16s\n",
			token.Symbol,
			fmt.Sprintf("$%.0f", token.Marketcap),
			fmt.Sprintf("$%.0f", token.Volume24h),
			token.Holders,
			token.PriceChange24h,
			progress,
		)
	}

	// The king of the hill is the biggest token *still on the curve*. It is nil
	// in the window between one token graduating and the next taking the lead —
	// a real state, not an error.
	king, err := client.GetKing(ctx)
	if err != nil {
		log.Fatalf("king: %v", err)
	}
	fmt.Println()
	if king == nil {
		fmt.Println("king       nobody on the hill right now")
	} else {
		fmt.Printf("king       %s at %s USD market cap\n", king.TokenSymbol, king.Marketcap)
	}
}
