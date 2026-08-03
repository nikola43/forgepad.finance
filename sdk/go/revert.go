package fyuz

import (
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"
)

// Turning revert data into something a caller can act on.
//
// A reverted eth_call comes back as a bare 4-byte selector — 0xcfa6d878 and
// nothing else. The mapping from that to "the token graduated, trade the DEX
// pair" exists nowhere on-chain and is not in the ABI the API serves, so the
// table below is it. It mirrors ../shared/test-vectors/trade-errors.json, which
// the test suite asserts against.

// RevertKind classifies a contract revert. The values match surfaced_as in the
// shared trade-errors fixture.
type RevertKind string

// Revert classifications.
const (
	RevertGraduated             RevertKind = "graduated"
	RevertNoPool                RevertKind = "no_pool"
	RevertSlippage              RevertKind = "slippage"
	RevertExpired               RevertKind = "expired"
	RevertPriceImpact           RevertKind = "price_impact"
	RevertSellTooLarge          RevertKind = "sell_too_large"
	RevertInsufficientValue     RevertKind = "insufficient_value"
	RevertInsufficientBalance   RevertKind = "insufficient_balance"
	RevertInsufficientInput     RevertKind = "insufficient_input"
	RevertInsufficientLiquidity RevertKind = "insufficient_liquidity"
	RevertZeroAmount            RevertKind = "zero_amount"
	RevertStaleFeed             RevertKind = "stale_feed"
	RevertPaused                RevertKind = "paused"
	RevertString                RevertKind = "revert_string"
	RevertUnknown               RevertKind = "unknown"
)

// SelectorAlreadyLaunched is AlreadyLaunched(), the graduated-token revert.
const SelectorAlreadyLaunched = "0xcfa6d878"

const (
	selectorErrorString = "0x08c379a0" // Error(string)
	selectorPanic       = "0x4e487b71" // Panic(uint256)
)

// ErrGraduated matches any error raised because a token left the bonding curve,
// so errors.Is(err, fyuz.ErrGraduated) works without a type assertion.
var ErrGraduated = errors.New("fyuz: token graduated")

type revertEntry struct {
	errorName string
	kind      RevertKind
	message   string
	retryable bool
}

var revertTable = map[string]revertEntry{
	SelectorAlreadyLaunched: {
		"AlreadyLaunched()", RevertGraduated,
		"The token graduated: the bonding curve is closed and every swap entrypoint reverts. Trade the DEX pair instead.",
		false,
	},
	"0x9c8787c0": {
		"PoolDoesNotExist()", RevertNoPool,
		"No bonding curve exists for this token on this chain — check the address and the network.",
		false,
	},
	"0x8199f5f3": {
		"SlippageExceeded()", RevertSlippage,
		"The price moved past minAmountOut before the transaction landed. Re-quote and retry, or widen the slippage tolerance.",
		true,
	},
	"0x2b32713d": {
		"SwapExpired()", RevertExpired,
		"The deadline passed before the transaction was mined. Rebuild with a later deadline.",
		true,
	},
	"0xe96d2afe": {
		"MaxPriceImpactExceeded()", RevertPriceImpact,
		"The trade would move the curve further than the contract allows. Split it into smaller trades.",
		false,
	},
	"0x9bca8aec": {
		"SellAmountTooLarge()", RevertSellTooLarge,
		"The sell exceeds MAX_SELL_PERCENT of the virtual token reserve. Sell less, or in several transactions.",
		false,
	},
	"0x1985c735": {
		"InsufficientEthValue()", RevertInsufficientValue,
		"msg.value was below buyAmount + getFirstBuyFee(token). The fee is not optional and is not deducted from buyAmount.",
		false,
	},
	"0xe4455cae": {
		"InsufficientTokenBalance()", RevertInsufficientBalance,
		"The wallet does not hold enough of the token to cover this sell.",
		false,
	},
	"0xf8b3bb61": {
		"InsufficientInput()", RevertInsufficientInput,
		"The input amount rounds down to zero output on the curve. Trade a larger amount.",
		false,
	},
	"0xbb55fd27": {
		"InsufficientLiquidity()", RevertInsufficientLiquidity,
		"The curve does not hold enough of the other side to fill this trade.",
		false,
	},
	"0x1f2a2005": {
		"ZeroAmount()", RevertZeroAmount,
		"The amount must be greater than zero.",
		false,
	},
	"0x1087e109": {
		"StalePriceFeed()", RevertStaleFeed,
		"The BNB/USD feed is stale or unavailable, so the contract cannot price this call.",
		true,
	},
	"0xd93c0665": {
		"EnforcedPause()", RevertPaused,
		"Trading is paused on the contract.",
		true,
	},
}

// RevertError is a rejection by the contract.
//
// It is raised from a simulated eth_call, so it costs nothing — this is the
// failure you want, rather than paying gas to discover the same thing on-chain.
type RevertError struct {
	// Kind is the classification from the shared revert table.
	Kind RevertKind
	// ErrorName is the Solidity signature, e.g. "SlippageExceeded()". Empty when unrecognised.
	ErrorName string
	// Selector is the 4-byte selector, when the revert carried one.
	Selector string
	// Data is the raw revert payload, kept so an unrecognised revert is still diagnosable.
	Data string
	// Retryable reports whether re-quoting and retrying could plausibly succeed.
	Retryable bool
	// Context names the call that failed, e.g. "getSwapOutput(0x…)".
	Context string
	// Reason is the decoded text of an Error(string) revert.
	Reason string
	// TokenAddress is set when Kind is RevertGraduated.
	TokenAddress string
	// PairAddress is the DEX pair of a graduated token, when known.
	PairAddress string

	message string
}

func (e *RevertError) Error() string { return e.message }

// Is reports whether this revert matches a package sentinel.
func (e *RevertError) Is(target error) bool {
	return target == ErrGraduated && e.Kind == RevertGraduated
}

// IsGraduated reports whether err was caused by a token leaving the curve.
func IsGraduated(err error) bool { return errors.Is(err, ErrGraduated) }

// GraduatedError builds the error returned when a token has left the curve.
//
// The SDK refuses to build a transaction for such a token rather than let the
// caller pay gas to discover the same thing.
func GraduatedError(token, pair string) *RevertError {
	message := fmt.Sprintf(
		"fyuz: %s has graduated: the bonding curve is closed and every swap reverts. ", token)
	if pair == "" {
		message += "Trade its DEX pair instead."
	} else {
		message += "Trade the DEX pair " + pair + " instead."
	}
	return &RevertError{
		Kind:         RevertGraduated,
		ErrorName:    "AlreadyLaunched()",
		Selector:     SelectorAlreadyLaunched,
		Data:         SelectorAlreadyLaunched,
		TokenAddress: token,
		PairAddress:  pair,
		message:      message,
	}
}

// RevertSelector returns the first four bytes of some revert data, lower-cased,
// or "" when there are not four bytes to read.
func RevertSelector(data string) string {
	body := strings.TrimPrefix(strings.TrimPrefix(data, "0x"), "0X")
	if len(body) < 8 {
		return ""
	}
	return "0x" + strings.ToLower(body[:8])
}

// decodeRevertString pulls the reason out of an Error(string) payload.
func decodeRevertString(data string) string {
	body := strings.TrimPrefix(data, "0x")
	// selector + offset word + length word, then the bytes themselves.
	if len(body) < 8+128 {
		return ""
	}
	length, ok := new(big.Int).SetString(body[72:136], 16)
	if !ok || !length.IsInt64() {
		return ""
	}
	end := 136 + int(length.Int64())*2
	if end > len(body) {
		return ""
	}
	raw, err := hex.DecodeString(body[136:end])
	if err != nil {
		return ""
	}
	return string(raw)
}

// NewRevertError classifies revert data into a typed error.
//
// An unrecognised selector is reported verbatim rather than swallowed — a later
// contract version will add errors this table does not know about, and having
// 0xdeadbeef in the message is at least something to search for.
func NewRevertError(data, context string) *RevertError {
	if data == "" {
		data = "0x"
	}
	selector := RevertSelector(data)

	switch {
	case selector == "":
		return &RevertError{
			Kind: RevertUnknown, Data: data, Context: context,
			message: fmt.Sprintf(
				"fyuz: %s reverted, and the node returned no revert data. Some providers strip it; retry against a node that preserves it to learn why.",
				context),
		}

	case selector == selectorErrorString:
		reason := decodeRevertString(data)
		if reason == "" {
			reason = "Error(string) with an undecodable reason"
		}
		return &RevertError{
			Kind: RevertString, ErrorName: "Error(string)", Selector: selector,
			Data: data, Context: context, Reason: reason,
			message: fmt.Sprintf("fyuz: %s reverted: %s", context, reason),
		}

	case selector == selectorPanic:
		return &RevertError{
			Kind: RevertUnknown, ErrorName: "Panic(uint256)", Selector: selector,
			Data: data, Context: context,
			message: fmt.Sprintf(
				"fyuz: %s hit a Solidity panic — that is a contract bug, not a bad argument.", context),
		}
	}

	entry, known := revertTable[selector]
	if !known {
		return &RevertError{
			Kind: RevertUnknown, Selector: selector, Data: data, Context: context,
			message: fmt.Sprintf(
				"fyuz: %s reverted with the unrecognised selector %s. This SDK version does not know that error; check the contract for a newer one.",
				context, selector),
		}
	}

	return &RevertError{
		Kind: entry.kind, ErrorName: entry.errorName, Selector: selector,
		Data: data, Retryable: entry.retryable, Context: context,
		message: fmt.Sprintf("fyuz: %s reverted: %s", context, entry.message),
	}
}
