// Command tokendeepdive prints everything the API knows about one token.
//
//	go run ./examples/tokendeepdive [address] [network]
//
// With no address, the current king of the hill is used.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	fyuz "github.com/nikola43/forgepad.finance/sdk/go"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	client := fyuz.New()

	var address string
	network := "bsc"
	if len(os.Args) > 1 {
		address = os.Args[1]
	}
	if len(os.Args) > 2 {
		network = os.Args[2]
	}

	if address == "" {
		king, err := client.GetKing(ctx)
		if err != nil {
			log.Fatalf("king: %v", err)
		}
		if king == nil {
			log.Fatal("no king right now — pass a token address explicitly")
		}
		address = king.TokenAddress
		fmt.Printf("no address given, using the king: %s\n\n", king.TokenSymbol)
	}

	detail, err := client.GetToken(ctx, network, address, &fyuz.GetTokenOptions{
		PageSize: fyuz.Int64(10),
	})
	if err != nil {
		if fyuz.IsNotFound(err) {
			log.Fatalf("no such token: %s on %s", address, network)
		}
		log.Fatalf("token detail: %v", err)
	}
	token := detail.TokenDetails

	creator := token.CreatorAddress
	if token.User.Username != nil {
		creator = *token.User.Username
	}

	fmt.Printf("%s (%s)\n", token.TokenName, token.TokenSymbol)
	fmt.Printf("  address        %s\n", token.TokenAddress)
	fmt.Printf("  creator        %s\n", creator)
	fmt.Printf("  created        %s\n\n", token.CreatedAt.Format(time.RFC3339))

	// Exact decimal strings, printed verbatim on purpose: parsing them into a
	// float64 would round the last digits off a market cap or a price.
	fmt.Printf("  market cap     %s\n", token.Marketcap)
	fmt.Printf("  price          %s\n", token.Price)
	fmt.Printf("  volume         %s\n", token.Volume)
	fmt.Printf("  liquidity      %s\n\n", orElse(token.Liquidity, "unknown"))

	if token.PairAddress == nil {
		progress := "?"
		if token.Progress != nil {
			progress = fmt.Sprintf("%.1f", *token.Progress)
		}
		fmt.Printf("  status         on the bonding curve, %s%% to graduation\n", progress)
	} else {
		fmt.Printf("  status         graduated — pair %s\n", *token.PairAddress)
	}
	fmt.Printf("  trades         %d\n\n", detail.TradesCount)

	fmt.Printf("top holders (%d shown)\n", len(detail.HoldersDetails))
	for i, holder := range detail.HoldersDetails {
		if i == 10 {
			break
		}
		who := holder.HolderAddress
		if holder.User.Username != nil {
			who = *holder.User.Username
		}
		fmt.Printf("  %-24.24s %s\n", who, holder.TokenAmount)
	}
	fmt.Println()

	fmt.Println("recent trades")
	for i, trade := range detail.Trades {
		if i == 10 {
			break
		}
		// Type.Is, not ==: this endpoint sends "BUY"/"SELL" while /trades/recent
		// sends "buy"/"sell".
		side := "sell"
		if trade.Type.Is(fyuz.TradeBuy) {
			side = "buy"
		}
		fmt.Printf("  %s  %-4s  %28s @ %s\n",
			fyuz.UnixTime(trade.Date).Format("2006-01-02 15:04:05"),
			side, trade.TokenAmount, trade.TokenPrice)
	}
	fmt.Println()

	// Hourly candles for the last day. Candle values are pre-aggregated
	// analytics, so unlike the fields above they legitimately are float64.
	to := time.Now().Unix()
	candles, err := client.GetChartData(ctx, &fyuz.ChartDataOptions{
		TokenAddress: address,
		Interval:     "60",
		From:         to - 24*60*60,
		To:           to,
	})
	if err != nil {
		log.Fatalf("chart data: %v", err)
	}

	fmt.Printf("hourly candles, last 24h (%d returned)\n", len(candles))
	start := len(candles) - 8
	if start < 0 {
		start = 0
	}
	for _, candle := range candles[start:] {
		fmt.Printf("  %s  o %.6g  h %.6g  l %.6g  c %.6g  vol %.0f\n",
			fyuz.UnixTime(candle.Time).Format("15:04"),
			candle.Open, candle.High, candle.Low, candle.Close, candle.Volume)
	}
}

// orElse renders a nullable string, keeping "unknown" distinct from a value.
func orElse(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}
