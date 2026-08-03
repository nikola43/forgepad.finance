package fyuz

import (
	"context"
	"fmt"
	"math/big"
	"sync"
	"time"
)

// Trading against the bonding curve.
//
// This file builds unsigned transactions. It never sees a private key, never
// signs and never broadcasts — it hands back an UnsignedTx and the caller passes
// that to whatever wallet they already have (go-ethereum's bind, a hardware
// signer, a multisig UI). That is why this module keeps zero dependencies:
// signing is the part that needs a crypto library, and it is not here.
//
//	built, err := client.Trade.BuildBuy(ctx, &BuyOptions{
//	    Token:       "0x…",
//	    AmountWei:   amount,      // native currency, in wei
//	    SlippageBps: 100,         // 1%
//	})
//
// Quotes come from the contract, not from arithmetic here: every one is an
// eth_call to getSwapOutput. Reimplementing the curve locally would mean a
// second formula that has to be kept in step with an upgradeable contract, and
// the day they disagree is the day someone's MinAmountOut is wrong.

// DefaultDeadline is how long a built transaction stays valid when the caller
// does not say.
const DefaultDeadline = 120 * time.Second

// DefaultNetwork is the chain slug used when an option leaves Network empty.
const DefaultNetwork = "bsc"

// bpsDivisor is basis points in 100%.
var bpsDivisor = big.NewInt(10_000)

// UnsignedTx is a transaction ready to be signed and sent.
type UnsignedTx struct {
	// ChainID is the EIP-155 chain id. Check it before signing — it is what stops
	// a BSC-signed transaction replaying elsewhere.
	ChainID int64
	// To is the contract to call.
	To string
	// Data is the ABI-encoded calldata, 0x-prefixed.
	Data string
	// Value is the native amount to attach, in wei. Zero for non-payable calls.
	Value *big.Int
	// From is the sender, when one was supplied. Gas estimation needs it.
	From string
}

// BuyQuote is what a buy will cost and return, priced against current curve state.
type BuyQuote struct {
	Network string
	Token   string
	// AmountInWei is what goes into the curve.
	AmountInWei *big.Int
	// FirstBuyFeeWei is getFirstBuyFee(token), charged on top of AmountInWei.
	FirstBuyFeeWei *big.Int
	// ValueWei is what msg.value must be: AmountInWei + FirstBuyFeeWei.
	ValueWei *big.Int
	// AmountOutWei is the tokens out at the quoted moment.
	AmountOutWei *big.Int
	// PriceImpactBps is the price impact in basis points, as the contract computes it.
	PriceImpactBps int64
}

// SellQuote is what a sell will return, priced against current curve state.
type SellQuote struct {
	Network string
	Token   string
	// AmountInWei is the tokens going in.
	AmountInWei *big.Int
	// AmountOutWei is the native currency out, net of the platform and
	// token-owner fees, which the contract takes off the output rather than the
	// input.
	AmountOutWei *big.Int
	// PriceImpactBps is the price impact in basis points.
	PriceImpactBps int64
}

// BuiltBuy is a buy transaction plus the quote it was priced from.
type BuiltBuy struct {
	Tx *UnsignedTx
	// Quote is the pricing this was built against.
	Quote *BuyQuote
	// LimitWei is the minAmountOut (or maxAmountIn) actually encoded.
	LimitWei *big.Int
	// Deadline is the unix second after which the contract rejects the swap.
	Deadline int64
}

// BuiltSell is a sell transaction plus the quote it was priced from.
type BuiltSell struct {
	Tx       *UnsignedTx
	Quote    *SellQuote
	LimitWei *big.Int
	Deadline int64
}

// slippage is the shared slippage and deadline configuration.
type slippage struct {
	// SlippageBps is the tolerance in basis points — 100 is 1%. Mutually
	// exclusive with LimitWei.
	SlippageBps int64
	// LimitWei sets minAmountOut/maxAmountIn exactly, bypassing SlippageBps.
	LimitWei *big.Int
	// Deadline is an absolute unix second. Wins over DeadlineIn.
	Deadline int64
	// DeadlineIn is a relative window. Defaults to DefaultDeadline.
	DeadlineIn time.Duration
	// From is the sender address, copied onto the transaction.
	From string
}

// BuyOptions spends an exact amount of native currency on a token.
type BuyOptions struct {
	Token   string
	Network string
	// AmountWei is the native currency to spend, excluding the first-buy fee.
	AmountWei *big.Int
	// SlippageBps is the tolerance in basis points — 100 is 1%. Mutually
	// exclusive with LimitWei. One of the two is required: there is no default,
	// because the right tolerance depends on the trade and a wrong one costs
	// you money.
	SlippageBps int64
	// LimitWei sets minAmountOut/maxAmountIn exactly, bypassing SlippageBps.
	LimitWei *big.Int
	// Deadline is an absolute unix second. Wins over DeadlineIn.
	Deadline int64
	// DeadlineIn is a relative validity window. Defaults to DefaultDeadline.
	DeadlineIn time.Duration
	// From is the sender address, copied onto the transaction.
	From string
}

// BuyExactTokensOptions buys an exact number of tokens, capping the spend.
type BuyExactTokensOptions struct {
	Token   string
	Network string
	// AmountOutWei is the exact tokens wanted.
	AmountOutWei *big.Int
	// SlippageBps is the tolerance in basis points — 100 is 1%. Mutually
	// exclusive with LimitWei. One of the two is required: there is no default,
	// because the right tolerance depends on the trade and a wrong one costs
	// you money.
	SlippageBps int64
	// LimitWei sets minAmountOut/maxAmountIn exactly, bypassing SlippageBps.
	LimitWei *big.Int
	// Deadline is an absolute unix second. Wins over DeadlineIn.
	Deadline int64
	// DeadlineIn is a relative validity window. Defaults to DefaultDeadline.
	DeadlineIn time.Duration
	// From is the sender address, copied onto the transaction.
	From string
}

// SellOptions sells tokens for native currency.
type SellOptions struct {
	Token   string
	Network string
	// AmountWei is the tokens to sell.
	AmountWei *big.Int
	// SlippageBps is the tolerance in basis points — 100 is 1%. Mutually
	// exclusive with LimitWei. One of the two is required: there is no default,
	// because the right tolerance depends on the trade and a wrong one costs
	// you money.
	SlippageBps int64
	// LimitWei sets minAmountOut/maxAmountIn exactly, bypassing SlippageBps.
	LimitWei *big.Int
	// Deadline is an absolute unix second. Wins over DeadlineIn.
	Deadline int64
	// DeadlineIn is a relative validity window. Defaults to DefaultDeadline.
	DeadlineIn time.Duration
	// From is the sender address, copied onto the transaction.
	From string
}

// ApproveOptions builds an ERC-20 approval for the curve.
type ApproveOptions struct {
	Token   string
	Network string
	// AmountWei is the exact allowance to grant. Ignored when Unlimited is set.
	AmountWei *big.Int
	// Unlimited approves the uint256 maximum. It saves a transaction per sell, at
	// the cost of a standing allowance against an upgradeable contract.
	Unlimited bool
	From      string
}

// The three option structs spell the slippage and deadline knobs identically.
// They are written out in each rather than embedded from a shared type, because
// an embedded *unexported* struct cannot be populated from another package —
// which would leave these fields unusable by every caller of this SDK.

func (o *BuyOptions) toSlippage() slippage {
	return slippage{o.SlippageBps, o.LimitWei, o.Deadline, o.DeadlineIn, o.From}
}

func (o *BuyExactTokensOptions) toSlippage() slippage {
	return slippage{o.SlippageBps, o.LimitWei, o.Deadline, o.DeadlineIn, o.From}
}

func (o *SellOptions) toSlippage() slippage {
	return slippage{o.SlippageBps, o.LimitWei, o.Deadline, o.DeadlineIn, o.From}
}

// TradeService builds unsigned bonding-curve transactions. Reach it through
// Client.Trade.
type TradeService struct {
	client *Client

	chainsOnce sync.Once
	chains     []ChainInfo
	chainsErr  error

	rpcMu   sync.Mutex
	rpcs    map[string]*RPCClient
	nowFunc func() time.Time
}

func newTradeService(client *Client) *TradeService {
	return &TradeService{client: client, rpcs: make(map[string]*RPCClient)}
}

func (s *TradeService) now() time.Time {
	if s.nowFunc != nil {
		return s.nowFunc()
	}
	return time.Now()
}

func networkOr(network string) string {
	if network == "" {
		return DefaultNetwork
	}
	return network
}

// Chain returns the chain metadata GET /config publishes: contract address,
// chain id, RPC endpoint, explorer.
//
// Fetched once and memoised — it changes about as often as a redeploy. Build a
// new Client to pick up a change.
func (s *TradeService) Chain(ctx context.Context, network string) (*ChainInfo, error) {
	network = networkOr(network)

	s.chainsOnce.Do(func() {
		config, err := s.client.GetConfig(ctx)
		if err != nil {
			s.chainsErr = err
			return
		}
		s.chains = config.Chains
	})
	if s.chainsErr != nil {
		return nil, s.chainsErr
	}

	known := make([]string, 0, len(s.chains))
	for i := range s.chains {
		chain := &s.chains[i]
		known = append(known, chain.Network)
		if chain.Network != network && fmt.Sprint(chain.ChainID) != network {
			continue
		}
		if chain.ContractAddress == "" {
			return nil, fmt.Errorf(
				"fyuz: the API did not publish a contract address for %q, so no transaction can be built", network)
		}
		return chain, nil
	}
	return nil, fmt.Errorf("fyuz: unknown network %q; the API serves: %v", network, known)
}

// rpc returns the JSON-RPC client for a chain, from the override or /config.
func (s *TradeService) rpc(ctx context.Context, network string) (*RPCClient, error) {
	network = networkOr(network)

	s.rpcMu.Lock()
	defer s.rpcMu.Unlock()
	if cached, ok := s.rpcs[network]; ok {
		return cached, nil
	}

	chain, err := s.Chain(ctx, network)
	if err != nil {
		return nil, err
	}
	url := s.client.rpcURL
	if url == "" {
		url = chain.RPCURL
	}
	if url == "" {
		return nil, fmt.Errorf(
			"fyuz: no RPC endpoint for %q: the API published none, and none was configured with WithRPCURL", network)
	}

	client := NewRPCClient(url, s.client.rpcHTTPClient, s.client.rpcHeaders)
	s.rpcs[network] = client
	return client, nil
}

// callContract runs an eth_call against the launchpad and returns the raw result.
func (s *TradeService) callContract(ctx context.Context, network, data string) (CallResult, *ChainInfo, error) {
	chain, err := s.Chain(ctx, network)
	if err != nil {
		return CallResult{}, nil, err
	}
	rpc, err := s.rpc(ctx, network)
	if err != nil {
		return CallResult{}, nil, err
	}
	result, err := rpc.Call(ctx, CallMsg{To: chain.ContractAddress, Data: data})
	return result, chain, err
}

// IsGraduated reports whether the token has left the bonding curve.
//
// It reads tokenPools(token).launched — the contract's own flag, not the
// indexer's view of it, so it cannot lag behind a graduation that happened
// seconds ago.
func (s *TradeService) IsGraduated(ctx context.Context, network, token string) (bool, error) {
	token, err := NormalizeAddress("token", token)
	if err != nil {
		return false, err
	}
	result, _, err := s.callContract(ctx, network, EncodeCall(SelectorTokenPools, AddressWord(token)))
	if err != nil {
		return false, err
	}
	if !result.OK {
		return false, NewRevertError(result.Revert, "tokenPools("+token+")")
	}
	// (uint256,uint256,uint256,uint256,address,address,uint8,bool) — launched last.
	return DecodeBoolAt(result.Data, 7)
}

// FirstBuyFee is getFirstBuyFee(token) in wei — the surcharge on a token's very
// first buy.
func (s *TradeService) FirstBuyFee(ctx context.Context, network, token string) (*big.Int, error) {
	token, err := NormalizeAddress("token", token)
	if err != nil {
		return nil, err
	}
	result, _, err := s.callContract(ctx, network, EncodeCall(SelectorGetFirstBuyFee, AddressWord(token)))
	if err != nil {
		return nil, err
	}
	if !result.OK {
		return nil, NewRevertError(result.Revert, "getFirstBuyFee("+token+")")
	}
	return DecodeUint256At(result.Data, 0)
}

// MaxSellableWei is getMaxSellableETH(token) — the ceiling one sell may extract.
func (s *TradeService) MaxSellableWei(ctx context.Context, network, token string) (*big.Int, error) {
	token, err := NormalizeAddress("token", token)
	if err != nil {
		return nil, err
	}
	result, _, err := s.callContract(ctx, network, EncodeCall(SelectorGetMaxSellableETH, AddressWord(token)))
	if err != nil {
		return nil, err
	}
	if !result.OK {
		return nil, NewRevertError(result.Revert, "getMaxSellableETH("+token+")")
	}
	return DecodeUint256At(result.Data, 0)
}

// Allowance is the ERC-20 allowance(owner, contract) — how much the curve may pull.
func (s *TradeService) Allowance(ctx context.Context, network, token, owner string) (*big.Int, error) {
	token, err := NormalizeAddress("token", token)
	if err != nil {
		return nil, err
	}
	owner, err = NormalizeAddress("owner", owner)
	if err != nil {
		return nil, err
	}
	chain, err := s.Chain(ctx, network)
	if err != nil {
		return nil, err
	}
	rpc, err := s.rpc(ctx, network)
	if err != nil {
		return nil, err
	}

	data, err := rpc.CallOrError(ctx, CallMsg{
		To:   token,
		Data: EncodeCall(SelectorAllowance, AddressWord(owner), AddressWord(chain.ContractAddress)),
	}, "allowance("+owner+")")
	if err != nil {
		return nil, err
	}
	return DecodeUint256At(data, 0)
}

// BalanceOf is the ERC-20 balanceOf(owner), in the token's smallest unit.
func (s *TradeService) BalanceOf(ctx context.Context, network, token, owner string) (*big.Int, error) {
	token, err := NormalizeAddress("token", token)
	if err != nil {
		return nil, err
	}
	owner, err = NormalizeAddress("owner", owner)
	if err != nil {
		return nil, err
	}
	rpc, err := s.rpc(ctx, network)
	if err != nil {
		return nil, err
	}

	data, err := rpc.CallOrError(ctx, CallMsg{
		To:   token,
		Data: EncodeCall(SelectorBalanceOf, AddressWord(owner)),
	}, "balanceOf("+owner+")")
	if err != nil {
		return nil, err
	}
	return DecodeUint256At(data, 0)
}

// swapOutput calls getSwapOutput, promoting the graduated revert to a typed error.
func (s *TradeService) swapOutput(
	ctx context.Context, network, token string, amountIn *big.Int, isETHInput bool,
) (*big.Int, int64, error) {
	data := EncodeCall(SelectorGetSwapOutput,
		AddressWord(token), Uint256Word(amountIn), BoolWord(isETHInput))

	result, _, err := s.callContract(ctx, network, data)
	if err != nil {
		return nil, 0, err
	}
	if !result.OK {
		if RevertSelector(result.Revert) == SelectorAlreadyLaunched {
			return nil, 0, GraduatedError(token, "")
		}
		return nil, 0, NewRevertError(result.Revert, "getSwapOutput("+token+")")
	}

	amountOut, err := DecodeUint256At(result.Data, 0)
	if err != nil {
		return nil, 0, err
	}
	impact, err := DecodeUint256At(result.Data, 1)
	if err != nil {
		return nil, 0, err
	}
	return amountOut, impact.Int64(), nil
}

// QuoteBuy prices a buy: tokens out for a given amount of native currency in.
//
// It returns an error satisfying IsGraduated when the curve is closed.
func (s *TradeService) QuoteBuy(ctx context.Context, network, token string, amountWei *big.Int) (*BuyQuote, error) {
	network = networkOr(network)
	token, err := NormalizeAddress("token", token)
	if err != nil {
		return nil, err
	}
	if err := validateAmount("amountWei", amountWei); err != nil {
		return nil, err
	}
	if amountWei.Sign() == 0 {
		return nil, fmt.Errorf("fyuz: amountWei must be greater than zero")
	}

	amountOut, impact, err := s.swapOutput(ctx, network, token, amountWei, true)
	if err != nil {
		return nil, err
	}
	fee, err := s.FirstBuyFee(ctx, network, token)
	if err != nil {
		return nil, err
	}

	return &BuyQuote{
		Network:        network,
		Token:          token,
		AmountInWei:    new(big.Int).Set(amountWei),
		FirstBuyFeeWei: fee,
		ValueWei:       new(big.Int).Add(amountWei, fee),
		AmountOutWei:   amountOut,
		PriceImpactBps: impact,
	}, nil
}

// QuoteSell prices a sell: native currency out for a given amount of tokens in.
func (s *TradeService) QuoteSell(ctx context.Context, network, token string, amountWei *big.Int) (*SellQuote, error) {
	network = networkOr(network)
	token, err := NormalizeAddress("token", token)
	if err != nil {
		return nil, err
	}
	if err := validateAmount("amountWei", amountWei); err != nil {
		return nil, err
	}
	if amountWei.Sign() == 0 {
		return nil, fmt.Errorf("fyuz: amountWei must be greater than zero")
	}

	amountOut, impact, err := s.swapOutput(ctx, network, token, amountWei, false)
	if err != nil {
		return nil, err
	}
	return &SellQuote{
		Network:        network,
		Token:          token,
		AmountInWei:    new(big.Int).Set(amountWei),
		AmountOutWei:   amountOut,
		PriceImpactBps: impact,
	}, nil
}

// BuildBuy spends an exact amount of native currency on a token.
//
// Tx.Value already includes the first-buy fee; sending only AmountWei reverts
// with InsufficientEthValue. Any excess is refunded by the contract.
func (s *TradeService) BuildBuy(ctx context.Context, opts *BuyOptions) (*BuiltBuy, error) {
	if opts == nil {
		return nil, fmt.Errorf("fyuz: BuildBuy needs options")
	}
	quote, err := s.QuoteBuy(ctx, opts.Network, opts.Token, opts.AmountWei)
	if err != nil {
		return nil, err
	}
	chain, err := s.Chain(ctx, opts.Network)
	if err != nil {
		return nil, err
	}

	limit, err := applyLimit(opts.toSlippage(), quote.AmountOutWei, false, "minAmountOut")
	if err != nil {
		return nil, err
	}
	deadline, err := s.resolveDeadline(opts.toSlippage())
	if err != nil {
		return nil, err
	}
	from, err := optionalAddress(opts.From)
	if err != nil {
		return nil, err
	}

	return &BuiltBuy{
		Tx: &UnsignedTx{
			ChainID: chain.ChainID,
			To:      chain.ContractAddress,
			Data: EncodeCall(SelectorSwapExactETHForTokens,
				AddressWord(quote.Token),
				Uint256Word(quote.AmountInWei),
				Uint256Word(limit),
				Uint256Word(big.NewInt(deadline))),
			Value: new(big.Int).Set(quote.ValueWei),
			From:  from,
		},
		Quote:    quote,
		LimitWei: limit,
		Deadline: deadline,
	}, nil
}

// BuildBuyExactTokens buys an exact number of tokens, capping the spend.
//
// Slippage runs the other way here: LimitWei is a maxAmountIn, so SlippageBps
// widens the cap rather than lowering a floor.
func (s *TradeService) BuildBuyExactTokens(ctx context.Context, opts *BuyExactTokensOptions) (*BuiltBuy, error) {
	if opts == nil {
		return nil, fmt.Errorf("fyuz: BuildBuyExactTokens needs options")
	}
	network := networkOr(opts.Network)
	token, err := NormalizeAddress("token", opts.Token)
	if err != nil {
		return nil, err
	}
	if err := validateAmount("amountOutWei", opts.AmountOutWei); err != nil {
		return nil, err
	}
	if opts.AmountOutWei.Sign() == 0 {
		return nil, fmt.Errorf("fyuz: amountOutWei must be greater than zero")
	}

	// Price the reverse direction to learn roughly what the tokens cost, then let
	// the caller's tolerance set the ceiling on top of that estimate.
	estimate, _, err := s.swapOutput(ctx, network, token, opts.AmountOutWei, false)
	if err != nil {
		return nil, err
	}
	if estimate.Sign() == 0 {
		return nil, fmt.Errorf("fyuz: the curve prices %s of %s at zero — ask for more tokens",
			opts.AmountOutWei, token)
	}

	limit, err := applyLimit(opts.toSlippage(), estimate, true, "maxAmountIn")
	if err != nil {
		return nil, err
	}
	fee, err := s.FirstBuyFee(ctx, network, token)
	if err != nil {
		return nil, err
	}
	chain, err := s.Chain(ctx, network)
	if err != nil {
		return nil, err
	}
	deadline, err := s.resolveDeadline(opts.toSlippage())
	if err != nil {
		return nil, err
	}
	from, err := optionalAddress(opts.From)
	if err != nil {
		return nil, err
	}

	value := new(big.Int).Add(limit, fee)
	return &BuiltBuy{
		Tx: &UnsignedTx{
			ChainID: chain.ChainID,
			To:      chain.ContractAddress,
			Data: EncodeCall(SelectorSwapETHForExactTokens,
				AddressWord(token),
				Uint256Word(opts.AmountOutWei),
				Uint256Word(limit),
				Uint256Word(big.NewInt(deadline))),
			Value: value,
			From:  from,
		},
		Quote: &BuyQuote{
			Network:        network,
			Token:          token,
			AmountInWei:    estimate,
			FirstBuyFeeWei: fee,
			ValueWei:       value,
			AmountOutWei:   new(big.Int).Set(opts.AmountOutWei),
		},
		LimitWei: limit,
		Deadline: deadline,
	}, nil
}

// BuildSell sells tokens for native currency.
//
// The contract pulls the tokens with transferFrom, so an ERC-20 approval must
// already be in place — check Allowance and send BuildApprove first, or the swap
// reverts inside the token.
func (s *TradeService) BuildSell(ctx context.Context, opts *SellOptions) (*BuiltSell, error) {
	if opts == nil {
		return nil, fmt.Errorf("fyuz: BuildSell needs options")
	}
	quote, err := s.QuoteSell(ctx, opts.Network, opts.Token, opts.AmountWei)
	if err != nil {
		return nil, err
	}
	chain, err := s.Chain(ctx, opts.Network)
	if err != nil {
		return nil, err
	}

	limit, err := applyLimit(opts.toSlippage(), quote.AmountOutWei, false, "minAmountOut")
	if err != nil {
		return nil, err
	}
	deadline, err := s.resolveDeadline(opts.toSlippage())
	if err != nil {
		return nil, err
	}
	from, err := optionalAddress(opts.From)
	if err != nil {
		return nil, err
	}

	return &BuiltSell{
		Tx: &UnsignedTx{
			ChainID: chain.ChainID,
			To:      chain.ContractAddress,
			Data: EncodeCall(SelectorSwapExactTokensForETH,
				AddressWord(quote.Token),
				Uint256Word(quote.AmountInWei),
				Uint256Word(limit),
				Uint256Word(big.NewInt(deadline))),
			Value: big.NewInt(0),
			From:  from,
		},
		Quote:    quote,
		LimitWei: limit,
		Deadline: deadline,
	}, nil
}

// BuildApprove builds the ERC-20 approval that lets the curve pull tokens for a sell.
func (s *TradeService) BuildApprove(ctx context.Context, opts *ApproveOptions) (*UnsignedTx, error) {
	if opts == nil {
		return nil, fmt.Errorf("fyuz: BuildApprove needs options")
	}
	token, err := NormalizeAddress("token", opts.Token)
	if err != nil {
		return nil, err
	}
	chain, err := s.Chain(ctx, opts.Network)
	if err != nil {
		return nil, err
	}

	amount := opts.AmountWei
	switch {
	case opts.Unlimited && amount != nil:
		return nil, fmt.Errorf("fyuz: pass either AmountWei or Unlimited, not both")
	case opts.Unlimited:
		amount = MaxUint256
	case amount == nil:
		return nil, fmt.Errorf(
			"fyuz: BuildApprove needs AmountWei, or Unlimited: true to approve the uint256 maximum")
	}
	if err := validateAmount("amountWei", amount); err != nil {
		return nil, err
	}
	from, err := optionalAddress(opts.From)
	if err != nil {
		return nil, err
	}

	return &UnsignedTx{
		ChainID: chain.ChainID,
		To:      token,
		Data: EncodeCall(SelectorApprove,
			AddressWord(chain.ContractAddress), Uint256Word(amount)),
		Value: big.NewInt(0),
		From:  from,
	}, nil
}

// applyLimit turns a quote plus a tolerance into the limit that goes on-chain.
//
// up says which way the tolerance moves the number: false for a minAmountOut
// floor, true for a maxAmountIn ceiling.
func applyLimit(opts slippage, quoted *big.Int, up bool, fieldName string) (*big.Int, error) {
	if opts.LimitWei != nil && opts.SlippageBps != 0 {
		return nil, fmt.Errorf("fyuz: pass either SlippageBps or LimitWei, not both")
	}
	if opts.LimitWei != nil {
		if err := validateAmount("limitWei", opts.LimitWei); err != nil {
			return nil, err
		}
		return new(big.Int).Set(opts.LimitWei), nil
	}
	if opts.SlippageBps == 0 {
		return nil, fmt.Errorf(
			"fyuz: slippage protection is required: set SlippageBps (100 = 1%%) or LimitWei to choose %s yourself. "+
				"There is no default, because the right tolerance depends on the trade and getting it wrong costs you money",
			fieldName)
	}
	if opts.SlippageBps < 0 || opts.SlippageBps >= 10_000 {
		return nil, fmt.Errorf("fyuz: SlippageBps must be in [0, 10000), got %d", opts.SlippageBps)
	}

	factor := new(big.Int)
	if up {
		factor.Add(bpsDivisor, big.NewInt(opts.SlippageBps))
	} else {
		factor.Sub(bpsDivisor, big.NewInt(opts.SlippageBps))
	}
	return new(big.Int).Quo(new(big.Int).Mul(quoted, factor), bpsDivisor), nil
}

// resolveDeadline turns whichever form the caller used into an absolute unix second.
func (s *TradeService) resolveDeadline(opts slippage) (int64, error) {
	if opts.Deadline != 0 {
		if opts.Deadline < 0 {
			return 0, fmt.Errorf("fyuz: Deadline must be a positive unix timestamp in seconds")
		}
		return opts.Deadline, nil
	}
	window := opts.DeadlineIn
	if window == 0 {
		window = DefaultDeadline
	}
	if window < 0 {
		return 0, fmt.Errorf("fyuz: DeadlineIn must be positive")
	}
	return s.now().Add(window).Unix(), nil
}

func optionalAddress(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	return NormalizeAddress("from", value)
}
