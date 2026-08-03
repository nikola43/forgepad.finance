// Command trade quotes and builds bonding-curve trades.
//
//	go run ./examples/trade [token] [wallet]
//
// This example signs nothing and sends nothing. It prints the unsigned
// transactions, which is the whole surface this SDK offers: you hand
// {To, Data, Value} to go-ethereum's bind, a hardware signer or a multisig, and
// that library owns the key. Nothing here can move funds.
package main

import (
	"context"
	"fmt"
	"log"
	"math/big"
	"os"
	"time"

	fyuz "github.com/nikola43/forgepad.finance/sdk/go"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	var token, wallet string
	if len(os.Args) > 1 {
		token = os.Args[1]
	}
	if len(os.Args) > 2 {
		wallet = os.Args[2]
	}

	// The endpoint /config publishes belongs to the API operator and is shared by
	// every caller. Point this at your own node for anything real.
	rpc := os.Getenv("BSC_RPC_URL")
	if rpc == "" {
		rpc = "https://bsc-dataseed.bnbchain.org"
	}
	client := fyuz.New(fyuz.WithRPCURL(rpc))

	chain, err := client.Trade.Chain(ctx, "bsc")
	if err != nil {
		log.Fatalf("chain config: %v", err)
	}
	fmt.Printf("chain      %s (%d)\n", chain.Name, chain.ChainID)
	fmt.Printf("contract   %s\n\n", chain.ContractAddress)

	if token == "" {
		king, err := client.GetKing(ctx)
		if err != nil {
			log.Fatalf("king: %v", err)
		}
		if king == nil {
			log.Fatal("no king right now — pass a token address explicitly")
		}
		token = king.TokenAddress
		fmt.Printf("using the king: %s (%s)\n\n", king.TokenSymbol, token)
	}

	// ---------------------------------------------------------------- buying

	spend, err := fyuz.ParseUnits("0.01", 18) // 0.01 BNB, in wei
	if err != nil {
		log.Fatalf("parse amount: %v", err)
	}

	quote, err := client.Trade.QuoteBuy(ctx, "bsc", token, spend)
	if err != nil {
		if fyuz.IsGraduated(err) {
			// The SDK refuses rather than letting you pay gas to learn this on-chain.
			fmt.Printf("buy refused: %v\n", err)
			return
		}
		log.Fatalf("quote buy: %v", err)
	}

	fmt.Println("buy quote")
	fmt.Printf("  spending       %s %s\n", fyuz.FormatUnits(quote.AmountInWei, 18), chain.Currency)
	fmt.Printf("  first-buy fee  %s %s\n", fyuz.FormatUnits(quote.FirstBuyFeeWei, 18), chain.Currency)
	fmt.Printf("  msg.value      %s %s  <- includes the fee\n",
		fyuz.FormatUnits(quote.ValueWei, 18), chain.Currency)
	fmt.Printf("  tokens out     %s\n", fyuz.FormatUnits(quote.AmountOutWei, 18))
	fmt.Printf("  price impact   %.2f%%\n\n", float64(quote.PriceImpactBps)/100)

	// SlippageBps is required. There is no default, because the right tolerance
	// depends on the trade and a wrong one costs you money.
	built, err := client.Trade.BuildBuy(ctx, &fyuz.BuyOptions{
		Token:       token,
		AmountWei:   spend,
		SlippageBps: 100, // 1%
		DeadlineIn:  2 * time.Minute,
		From:        wallet,
	})
	if err != nil {
		log.Fatalf("build buy: %v", err)
	}

	fmt.Println("buy transaction (unsigned)")
	printTransaction(built.Tx)
	fmt.Printf("  minAmountOut   %s tokens\n", fyuz.FormatUnits(built.LimitWei, 18))
	fmt.Printf("  deadline       %s\n\n", fyuz.UnixTime(built.Deadline).Format(time.RFC3339))

	// --------------------------------------------------------------- selling

	sellAmount, err := fyuz.ParseUnits("1000", 18)
	if err != nil {
		log.Fatalf("parse amount: %v", err)
	}

	sellQuote, err := client.Trade.QuoteSell(ctx, "bsc", token, sellAmount)
	if err != nil {
		log.Fatalf("quote sell: %v", err)
	}

	fmt.Println("sell quote")
	fmt.Printf("  selling        %s tokens\n", fyuz.FormatUnits(sellQuote.AmountInWei, 18))
	fmt.Printf("  %s out         %s  <- net of fees\n",
		chain.Currency, fyuz.FormatUnits(sellQuote.AmountOutWei, 18))
	fmt.Printf("  price impact   %.2f%%\n\n", float64(sellQuote.PriceImpactBps)/100)

	// Selling needs an ERC-20 approval first: the contract pulls the tokens with
	// transferFrom, so without one the swap reverts inside the token.
	if wallet != "" {
		allowance, err := client.Trade.Allowance(ctx, "bsc", token, wallet)
		if err != nil {
			log.Fatalf("allowance: %v", err)
		}
		fmt.Printf("current allowance %s tokens\n", fyuz.FormatUnits(allowance, 18))

		if allowance.Cmp(sellAmount) < 0 {
			approve, err := client.Trade.BuildApprove(ctx, &fyuz.ApproveOptions{
				Token: token, AmountWei: sellAmount, From: wallet,
			})
			if err != nil {
				log.Fatalf("build approve: %v", err)
			}
			fmt.Println("\napprove transaction (unsigned) — send this before the sell")
			printTransaction(approve)
			fmt.Println()
		}
	}

	sell, err := client.Trade.BuildSell(ctx, &fyuz.SellOptions{
		Token:       token,
		AmountWei:   sellAmount,
		SlippageBps: 150, // 1.5%
		From:        wallet,
	})
	if err != nil {
		log.Fatalf("build sell: %v", err)
	}

	fmt.Println("sell transaction (unsigned)")
	printTransaction(sell.Tx)
	fmt.Printf("  minAmountOut   %s %s\n\n", fyuz.FormatUnits(sell.LimitWei, 18), chain.Currency)
	fmt.Println("Nothing above was signed or broadcast. Hand these to your wallet to execute.")
}

func printTransaction(tx *fyuz.UnsignedTx) {
	value := tx.Value
	if value == nil {
		value = big.NewInt(0)
	}
	fmt.Printf("  chainId        %d\n", tx.ChainID)
	fmt.Printf("  to             %s\n", tx.To)
	fmt.Printf("  value          %s\n", value)
	fmt.Printf("  data           %.74s…\n", tx.Data)
}
