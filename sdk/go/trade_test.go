package fyuz

import (
	"context"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Trading: calldata encoding, quotes, slippage and revert classification.
//
// The encoding half is driven by ../shared/test-vectors/trade-calldata.json,
// whose expected hex came out of `cast calldata`. Four hand-written ABI encoders
// agreeing with foundry is the only reason to trust any of them.

type calldataVector struct {
	Contract struct {
		BSC     string `json:"bsc"`
		ChainID int64  `json:"chainId"`
	} `json:"contract"`
	Selectors   map[string]string `json:"selectors"`
	FixtureArgs struct {
		Token    string `json:"token"`
		Spender  string `json:"spender"`
		Owner    string `json:"owner"`
		Deadline int64  `json:"deadline"`
	} `json:"fixture_args"`
	Cases []struct {
		Name     string                     `json:"name"`
		Builder  string                     `json:"builder"`
		Function string                     `json:"function"`
		Args     map[string]json.RawMessage `json:"args"`
		Calldata string                     `json:"calldata"`
	} `json:"cases"`
	AddressCasing struct {
		MixedCaseInput string `json:"mixed_case_input"`
		EncodedWord    string `json:"encoded_word"`
	} `json:"address_casing"`
}

type tradeErrorVector struct {
	GraduatedSelector string `json:"graduated_selector"`
	Revertible        []struct {
		Selector   string `json:"selector"`
		Error      string `json:"error"`
		SurfacedAs string `json:"surfaced_as"`
		Retryable  bool   `json:"retryable"`
	} `json:"revertible"`
	DecodeCases []struct {
		Name       string `json:"name"`
		RevertData string `json:"revert_data"`
		Expect     struct {
			SurfacedAs      string `json:"surfaced_as"`
			Error           string `json:"error"`
			Message         string `json:"message"`
			MessageContains string `json:"message_contains"`
		} `json:"expect"`
	} `json:"decode_cases"`
}

// argString reads a fixture argument, whether the JSON spells it as a string or
// a number.
func argString(t *testing.T, args map[string]json.RawMessage, name string) string {
	t.Helper()
	raw, ok := args[name]
	if !ok {
		t.Fatalf("fixture has no argument %q", name)
	}
	var asString string
	if json.Unmarshal(raw, &asString) == nil {
		return asString
	}
	return strings.Trim(string(raw), `"`)
}

func mustBig(t *testing.T, value string) *big.Int {
	t.Helper()
	parsed, ok := new(big.Int).SetString(value, 10)
	if !ok {
		t.Fatalf("not a base-10 integer: %q", value)
	}
	return parsed
}

// word renders one 32-byte return word.
func word(value int64) string { return Uint256Word(big.NewInt(value)) }

// swapOutputResult builds the return data of getSwapOutput.
func swapOutputResult(amountOut *big.Int, impactBps int64) string {
	return "0x" + Uint256Word(amountOut) + word(impactBps)
}

// tokenPoolsResult builds the return data of tokenPools, with launched last.
func tokenPoolsResult(launched bool) string {
	body := strings.Repeat(word(0), 7)
	if launched {
		return "0x" + body + word(1)
	}
	return "0x" + body + word(0)
}

// chainStub answers both halves of a trade: the REST /config lookup and the
// JSON-RPC eth_calls that follow it, on one server.
type chainStub struct {
	server *httptest.Server
	client *Client
	calls  []struct{ To, Data string }
}

func newChainStub(t *testing.T, results, reverts map[string]string) *chainStub {
	t.Helper()
	stub := &chainStub{}

	stub.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		if r.URL.Path == "/config" {
			_, _ = w.Write([]byte(`{"chains":[{"name":"BNB Smart Chain","chainId":56,"network":"bsc",` +
				`"contractAddress":"0x33A98BeF6496684a8daC83734D9CEB0CEFC7019c","currency":"BNB",` +
				`"explorerUrl":"https://bscscan.com"}]}`))
			return
		}

		var payload struct {
			ID     int64 `json:"id"`
			Params []struct {
				To   string `json:"to"`
				Data string `json:"data"`
			} `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if len(payload.Params) == 0 {
			t.Errorf("RPC call with no params")
			return
		}
		call := payload.Params[0]
		stub.calls = append(stub.calls, struct{ To, Data string }{call.To, call.Data})

		selector := strings.ToLower(call.Data[:10])
		if revert, ok := reverts[selector]; ok {
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":3,` +
				`"message":"execution reverted","data":"` + revert + `"}}`))
			return
		}
		result, ok := results[selector]
		if !ok {
			result = "0x"
		}
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"` + result + `"}`))
	}))
	t.Cleanup(stub.server.Close)

	stub.client = New(
		WithBaseURL(stub.server.URL),
		WithRPCURL(stub.server.URL+"/rpc"),
		WithBackoff(time.Nanosecond, time.Nanosecond),
	)
	return stub
}

func (s *chainStub) callsWithSelector(selector string) []struct{ To, Data string } {
	var found []struct{ To, Data string }
	for _, call := range s.calls {
		if strings.HasPrefix(strings.ToLower(call.Data), selector) {
			found = append(found, call)
		}
	}
	return found
}

func loadCalldataVector(t *testing.T) calldataVector {
	t.Helper()
	var vector calldataVector
	loadVector(t, "trade-calldata.json", &vector)
	return vector
}

func fixtureCase(t *testing.T, vector calldataVector, name string) map[string]json.RawMessage {
	t.Helper()
	for _, entry := range vector.Cases {
		if entry.Name == name {
			return entry.Args
		}
	}
	t.Fatalf("fixture %q missing from trade-calldata.json", name)
	return nil
}

func fixtureCalldata(t *testing.T, vector calldataVector, name string) string {
	t.Helper()
	for _, entry := range vector.Cases {
		if entry.Name == name {
			return entry.Calldata
		}
	}
	t.Fatalf("fixture %q missing from trade-calldata.json", name)
	return ""
}

func TestTradeCalldataMatchesGoldenVectors(t *testing.T) {
	vector := loadCalldataVector(t)
	token := vector.FixtureArgs.Token
	deadline := vector.FixtureArgs.Deadline
	ctx := context.Background()

	t.Run("buy_exact_bnb", func(t *testing.T) {
		args := fixtureCase(t, vector, "buy_exact_bnb")
		// amountOut is exactly the fixture's minAmountOut, so 0 bps slippage
		// reproduces the golden calldata with no rounding in the way.
		minOut := mustBig(t, argString(t, args, "minAmountOut"))
		buyAmount := mustBig(t, argString(t, args, "buyAmount"))

		stub := newChainStub(t, map[string]string{
			SelectorGetSwapOutput:  swapOutputResult(minOut, 120),
			SelectorGetFirstBuyFee: "0x" + word(0),
		}, nil)

		built, err := stub.client.Trade.BuildBuy(ctx, &BuyOptions{
			Token:     token,
			AmountWei: buyAmount,
			LimitWei:  minOut,
			Deadline:  deadline,
		})
		if err != nil {
			t.Fatalf("BuildBuy: %v", err)
		}

		if got := built.Tx.Data; got != fixtureCalldata(t, vector, "buy_exact_bnb") {
			t.Errorf("calldata mismatch\n got %s\nwant %s", got, fixtureCalldata(t, vector, "buy_exact_bnb"))
		}
		if built.Tx.To != vector.Contract.BSC {
			t.Errorf("To = %s, want %s", built.Tx.To, vector.Contract.BSC)
		}
		if built.Tx.ChainID != vector.Contract.ChainID {
			t.Errorf("ChainID = %d, want %d", built.Tx.ChainID, vector.Contract.ChainID)
		}
		if built.Tx.Value.Cmp(buyAmount) != 0 {
			t.Errorf("Value = %s, want %s (fee is zero here)", built.Tx.Value, buyAmount)
		}
	})

	t.Run("sell_exact_tokens", func(t *testing.T) {
		args := fixtureCase(t, vector, "sell_exact_tokens")
		minOut := mustBig(t, argString(t, args, "minAmountOut"))
		sellAmount := mustBig(t, argString(t, args, "sellAmount"))

		stub := newChainStub(t, map[string]string{
			SelectorGetSwapOutput: swapOutputResult(minOut, 90),
		}, nil)

		built, err := stub.client.Trade.BuildSell(ctx, &SellOptions{
			Token:     token,
			AmountWei: sellAmount,
			LimitWei:  minOut,
			Deadline:  deadline,
		})
		if err != nil {
			t.Fatalf("BuildSell: %v", err)
		}
		if got, want := built.Tx.Data, fixtureCalldata(t, vector, "sell_exact_tokens"); got != want {
			t.Errorf("calldata mismatch\n got %s\nwant %s", got, want)
		}
		if built.Tx.Value.Sign() != 0 {
			t.Errorf("selling is not payable, Value = %s", built.Tx.Value)
		}
	})

	t.Run("buy_exact_tokens", func(t *testing.T) {
		args := fixtureCase(t, vector, "buy_exact_tokens")
		maxIn := mustBig(t, argString(t, args, "maxAmountIn"))
		wanted := mustBig(t, argString(t, args, "buyAmount"))

		stub := newChainStub(t, map[string]string{
			SelectorGetSwapOutput:  swapOutputResult(maxIn, 0),
			SelectorGetFirstBuyFee: "0x" + word(0),
		}, nil)

		built, err := stub.client.Trade.BuildBuyExactTokens(ctx, &BuyExactTokensOptions{
			Token:        token,
			AmountOutWei: wanted,
			LimitWei:     maxIn,
			Deadline:     deadline,
		})
		if err != nil {
			t.Fatalf("BuildBuyExactTokens: %v", err)
		}
		if got, want := built.Tx.Data, fixtureCalldata(t, vector, "buy_exact_tokens"); got != want {
			t.Errorf("calldata mismatch\n got %s\nwant %s", got, want)
		}
	})

	t.Run("approve", func(t *testing.T) {
		stub := newChainStub(t, nil, nil)

		exactArgs := fixtureCase(t, vector, "approve_exact")
		approve, err := stub.client.Trade.BuildApprove(ctx, &ApproveOptions{
			Token:     token,
			AmountWei: mustBig(t, argString(t, exactArgs, "amount")),
		})
		if err != nil {
			t.Fatalf("BuildApprove: %v", err)
		}
		if got, want := approve.Data, fixtureCalldata(t, vector, "approve_exact"); got != want {
			t.Errorf("calldata mismatch\n got %s\nwant %s", got, want)
		}
		if approve.To != token {
			t.Errorf("approve targets %s, want the token %s", approve.To, token)
		}

		unlimited, err := stub.client.Trade.BuildApprove(ctx, &ApproveOptions{
			Token: token, Unlimited: true,
		})
		if err != nil {
			t.Fatalf("BuildApprove unlimited: %v", err)
		}
		if got, want := unlimited.Data, fixtureCalldata(t, vector, "approve_unlimited"); got != want {
			t.Errorf("calldata mismatch\n got %s\nwant %s", got, want)
		}
	})

	t.Run("quotes_and_reads", func(t *testing.T) {
		stub := newChainStub(t, map[string]string{
			SelectorGetSwapOutput:  swapOutputResult(big.NewInt(1), 1),
			SelectorGetFirstBuyFee: "0x" + word(0),
			SelectorAllowance:      "0x" + word(42),
			SelectorTokenPools:     tokenPoolsResult(false),
		}, nil)

		buyArgs := fixtureCase(t, vector, "quote_buy")
		if _, err := stub.client.Trade.QuoteBuy(ctx, "bsc", token,
			mustBig(t, argString(t, buyArgs, "amountIn"))); err != nil {
			t.Fatalf("QuoteBuy: %v", err)
		}
		sellArgs := fixtureCase(t, vector, "quote_sell")
		if _, err := stub.client.Trade.QuoteSell(ctx, "bsc", token,
			mustBig(t, argString(t, sellArgs, "amountIn"))); err != nil {
			t.Fatalf("QuoteSell: %v", err)
		}

		quoteCalls := stub.callsWithSelector(SelectorGetSwapOutput)
		if len(quoteCalls) < 2 {
			t.Fatalf("expected two getSwapOutput calls, got %d", len(quoteCalls))
		}
		if got, want := quoteCalls[0].Data, fixtureCalldata(t, vector, "quote_buy"); got != want {
			t.Errorf("quote_buy calldata mismatch\n got %s\nwant %s", got, want)
		}
		if got, want := quoteCalls[1].Data, fixtureCalldata(t, vector, "quote_sell"); got != want {
			t.Errorf("quote_sell calldata mismatch\n got %s\nwant %s", got, want)
		}

		allowanceArgs := fixtureCase(t, vector, "allowance")
		allowance, err := stub.client.Trade.Allowance(ctx, "bsc", token, argString(t, allowanceArgs, "owner"))
		if err != nil {
			t.Fatalf("Allowance: %v", err)
		}
		if allowance.Int64() != 42 {
			t.Errorf("allowance = %s, want 42", allowance)
		}
		if got, want := stub.callsWithSelector(SelectorAllowance)[0].Data,
			fixtureCalldata(t, vector, "allowance"); got != want {
			t.Errorf("allowance calldata mismatch\n got %s\nwant %s", got, want)
		}

		// A mixed-case address must encode identically to its lower-cased form.
		if _, err := stub.client.Trade.IsGraduated(ctx, "bsc", strings.ToUpper(token[2:])); err == nil {
			t.Error("an address without the 0x prefix should be rejected")
		}
		if _, err := stub.client.Trade.IsGraduated(ctx, "bsc", token); err != nil {
			t.Fatalf("IsGraduated: %v", err)
		}
		if got, want := stub.callsWithSelector(SelectorTokenPools)[0].Data,
			fixtureCalldata(t, vector, "token_pools"); got != want {
			t.Errorf("tokenPools calldata mismatch\n got %s\nwant %s", got, want)
		}
	})

	t.Run("selectors_match_the_fixture", func(t *testing.T) {
		// Catches a mistyped constant, which would otherwise send a transaction to
		// whatever function happened to share the wrong four bytes.
		for signature, want := range map[string]string{
			"swapExactETHForTokens(address,uint256,uint256,uint256)": SelectorSwapExactETHForTokens,
			"swapETHForExactTokens(address,uint256,uint256,uint256)": SelectorSwapETHForExactTokens,
			"swapExactTokensForETH(address,uint256,uint256,uint256)": SelectorSwapExactTokensForETH,
			"getSwapOutput(address,uint256,bool)":                    SelectorGetSwapOutput,
			"getFirstBuyFee(address)":                                SelectorGetFirstBuyFee,
			"getMaxSellableETH(address)":                             SelectorGetMaxSellableETH,
			"tokenPools(address)":                                    SelectorTokenPools,
			"approve(address,uint256)":                               SelectorApprove,
			"allowance(address,address)":                             SelectorAllowance,
			"balanceOf(address)":                                     SelectorBalanceOf,
		} {
			if got := vector.Selectors[signature]; got != want {
				t.Errorf("%s: SDK has %s, fixture has %s", signature, want, got)
			}
		}
	})

	t.Run("mixed_case_address_encodes_lowercased", func(t *testing.T) {
		if got := AddressWord(vector.AddressCasing.MixedCaseInput); got != vector.AddressCasing.EncodedWord {
			t.Errorf("AddressWord = %s, want %s", got, vector.AddressCasing.EncodedWord)
		}
	})
}

func TestTradeQuoteAddsFirstBuyFeeToValueOnly(t *testing.T) {
	stub := newChainStub(t, map[string]string{
		SelectorGetSwapOutput:  swapOutputResult(big.NewInt(1000), 250),
		SelectorGetFirstBuyFee: "0x" + Uint256Word(big.NewInt(7_000_000_000_000_000)),
	}, nil)

	amount, err := ParseUnits("0.5", 18)
	if err != nil {
		t.Fatalf("ParseUnits: %v", err)
	}
	quote, err := stub.client.Trade.QuoteBuy(context.Background(), "bsc", loadToken(t), amount)
	if err != nil {
		t.Fatalf("QuoteBuy: %v", err)
	}

	if quote.AmountInWei.String() != "500000000000000000" {
		t.Errorf("AmountInWei = %s", quote.AmountInWei)
	}
	if quote.FirstBuyFeeWei.String() != "7000000000000000" {
		t.Errorf("FirstBuyFeeWei = %s", quote.FirstBuyFeeWei)
	}
	if quote.ValueWei.String() != "507000000000000000" {
		t.Errorf("ValueWei = %s, want amount + fee", quote.ValueWei)
	}
	if quote.PriceImpactBps != 250 {
		t.Errorf("PriceImpactBps = %d", quote.PriceImpactBps)
	}
}

func TestTradeRefusesGraduatedToken(t *testing.T) {
	var errorsVector tradeErrorVector
	loadVector(t, "trade-errors.json", &errorsVector)

	stub := newChainStub(t, nil, map[string]string{
		SelectorGetSwapOutput: errorsVector.GraduatedSelector,
	})

	_, err := stub.client.Trade.BuildBuy(context.Background(), &BuyOptions{
		Token:       loadToken(t),
		AmountWei:   big.NewInt(1_000_000),
		SlippageBps: 100,
	})
	if err == nil {
		t.Fatal("expected a graduated error, got none")
	}
	if !IsGraduated(err) {
		t.Fatalf("IsGraduated = false for %v", err)
	}
	if !strings.Contains(err.Error(), "graduated") {
		t.Errorf("message does not mention graduation: %v", err)
	}
}

func TestTradeSlippage(t *testing.T) {
	ctx := context.Background()
	token := loadToken(t)

	t.Run("lowers minAmountOut on a buy", func(t *testing.T) {
		stub := newChainStub(t, map[string]string{
			SelectorGetSwapOutput:  swapOutputResult(big.NewInt(1_000_000), 100),
			SelectorGetFirstBuyFee: "0x" + word(0),
		}, nil)

		built, err := stub.client.Trade.BuildBuy(ctx, &BuyOptions{
			Token:       token,
			AmountWei:   big.NewInt(1_000_000_000),
			SlippageBps: 100,
		})
		if err != nil {
			t.Fatalf("BuildBuy: %v", err)
		}
		if built.LimitWei.String() != "990000" {
			t.Errorf("LimitWei = %s, want 990000", built.LimitWei)
		}
	})

	t.Run("raises maxAmountIn on an exact-tokens buy", func(t *testing.T) {
		stub := newChainStub(t, map[string]string{
			SelectorGetSwapOutput:  swapOutputResult(big.NewInt(1_000_000), 0),
			SelectorGetFirstBuyFee: "0x" + word(0),
		}, nil)

		built, err := stub.client.Trade.BuildBuyExactTokens(ctx, &BuyExactTokensOptions{
			Token:        token,
			AmountOutWei: big.NewInt(5000),
			SlippageBps:  250,
		})
		if err != nil {
			t.Fatalf("BuildBuyExactTokens: %v", err)
		}
		if built.LimitWei.String() != "1025000" {
			t.Errorf("LimitWei = %s, want 1025000", built.LimitWei)
		}
	})

	t.Run("refuses to pick a tolerance", func(t *testing.T) {
		stub := newChainStub(t, map[string]string{
			SelectorGetSwapOutput:  swapOutputResult(big.NewInt(1000), 0),
			SelectorGetFirstBuyFee: "0x" + word(0),
		}, nil)

		_, err := stub.client.Trade.BuildBuy(ctx, &BuyOptions{
			Token: token, AmountWei: big.NewInt(1_000_000),
		})
		if err == nil || !strings.Contains(err.Error(), "slippage protection is required") {
			t.Fatalf("expected a slippage-required error, got %v", err)
		}
	})

	t.Run("rejects both forms at once", func(t *testing.T) {
		stub := newChainStub(t, map[string]string{
			SelectorGetSwapOutput:  swapOutputResult(big.NewInt(1000), 0),
			SelectorGetFirstBuyFee: "0x" + word(0),
		}, nil)

		_, err := stub.client.Trade.BuildBuy(ctx, &BuyOptions{
			Token: token, AmountWei: big.NewInt(1_000_000),
			SlippageBps: 100,
			LimitWei:    big.NewInt(900),
		})
		if err == nil || !strings.Contains(err.Error(), "not both") {
			t.Fatalf("expected a mutual-exclusion error, got %v", err)
		}
	})
}

func TestTradeRevertClassificationMatchesSharedTable(t *testing.T) {
	var vector tradeErrorVector
	loadVector(t, "trade-errors.json", &vector)

	for _, testCase := range vector.DecodeCases {
		t.Run(testCase.Name, func(t *testing.T) {
			err := NewRevertError(testCase.RevertData, "getSwapOutput(0x…)")

			if string(err.Kind) != testCase.Expect.SurfacedAs {
				t.Errorf("Kind = %s, want %s", err.Kind, testCase.Expect.SurfacedAs)
			}
			if testCase.Expect.Error != "" && err.ErrorName != testCase.Expect.Error {
				t.Errorf("ErrorName = %q, want %q", err.ErrorName, testCase.Expect.Error)
			}
			if testCase.Expect.Message != "" && !strings.Contains(err.Error(), testCase.Expect.Message) {
				t.Errorf("%q should contain %q", err.Error(), testCase.Expect.Message)
			}
			if testCase.Expect.MessageContains != "" &&
				!strings.Contains(err.Error(), testCase.Expect.MessageContains) {
				t.Errorf("%q should contain %q", err.Error(), testCase.Expect.MessageContains)
			}
		})
	}

	for _, entry := range vector.Revertible {
		err := NewRevertError(entry.Selector, "call")
		if string(err.Kind) != entry.SurfacedAs {
			t.Errorf("%s: Kind = %s, want %s", entry.Error, err.Kind, entry.SurfacedAs)
		}
		if err.ErrorName != entry.Error {
			t.Errorf("%s: ErrorName = %q", entry.Error, err.ErrorName)
		}
		if err.Retryable != entry.Retryable {
			t.Errorf("%s: Retryable = %v, want %v", entry.Error, err.Retryable, entry.Retryable)
		}
	}
}

func TestParseAndFormatUnits(t *testing.T) {
	cases := []struct{ decimal, wei string }{
		{"0.5", "500000000000000000"},
		{"1", "1000000000000000000"},
		{"0.000000000000000001", "1"},
		// 0.1 + 0.2 in binary floating point is the classic wrong answer; this
		// path never converts to a float, so it is not.
		{"0.30000000000000004", "300000000000000040"},
	}
	for _, testCase := range cases {
		parsed, err := ParseUnits(testCase.decimal, 18)
		if err != nil {
			t.Fatalf("ParseUnits(%q): %v", testCase.decimal, err)
		}
		if parsed.String() != testCase.wei {
			t.Errorf("ParseUnits(%q) = %s, want %s", testCase.decimal, parsed, testCase.wei)
		}
		if formatted := FormatUnits(parsed, 18); formatted != testCase.decimal {
			t.Errorf("FormatUnits round trip = %q, want %q", formatted, testCase.decimal)
		}
	}

	if _, err := ParseUnits("1.0000000000000000001", 18); err == nil {
		t.Error("expected an error for more decimal places than the token carries")
	}
	if _, err := ParseAmount("amountWei", "0.5"); err == nil ||
		!strings.Contains(err.Error(), "ParseUnits") {
		t.Errorf("a decimal string where wei was expected should point at ParseUnits, got %v", err)
	}
	if _, err := NormalizeAddress("token", "0xdead"); err == nil {
		t.Error("expected an error for a short address")
	}
}

// loadToken is the token address the shared fixtures use.
func loadToken(t *testing.T) string {
	t.Helper()
	return loadCalldataVector(t).FixtureArgs.Token
}
