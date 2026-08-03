package fyuz

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
)

// The smallest ABI codec that covers this contract, and nothing more.
//
// Every argument the Fyuz swap entrypoints take is a static 32-byte word —
// address, uint256, bool — and so is every value they return. That makes
// encoding a selector followed by left-padded words, and decoding a walk over
// fixed offsets. No dynamic types, no head/tail split, no ABI library.
//
// Selectors are pinned constants rather than computed. Deriving one needs
// keccak-256, which the standard library does not provide: crypto/sha3 is the
// FIPS variant and produces a different digest from Ethereum's Keccak-256. The
// values below came from `cast sig` and are asserted against
// ../shared/test-vectors/trade-calldata.json, so a typo fails the test suite
// instead of sending a transaction to the wrong function.
const (
	// SelectorSwapExactETHForTokens is swapExactETHForTokens(address,uint256,uint256,uint256).
	SelectorSwapExactETHForTokens = "0x6bf05b01"
	// SelectorSwapETHForExactTokens is swapETHForExactTokens(address,uint256,uint256,uint256).
	SelectorSwapETHForExactTokens = "0x0541a872"
	// SelectorSwapExactTokensForETH is swapExactTokensForETH(address,uint256,uint256,uint256).
	SelectorSwapExactTokensForETH = "0xeacad12a"
	// SelectorGetSwapOutput is getSwapOutput(address,uint256,bool).
	SelectorGetSwapOutput = "0x908235cc"
	// SelectorGetFirstBuyFee is getFirstBuyFee(address).
	SelectorGetFirstBuyFee = "0xb3cd4902"
	// SelectorGetMaxSellableETH is getMaxSellableETH(address).
	SelectorGetMaxSellableETH = "0x82bfb367"
	// SelectorTokenPools is tokenPools(address).
	SelectorTokenPools = "0xc3d2c3c1"
	// SelectorApprove is approve(address,uint256).
	SelectorApprove = "0x095ea7b3"
	// SelectorAllowance is allowance(address,address).
	SelectorAllowance = "0xdd62ed3e"
	// SelectorBalanceOf is balanceOf(address).
	SelectorBalanceOf = "0x70a08231"
)

// MaxUint256 is 2^256 - 1, the unlimited-approval amount.
var MaxUint256 = new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1))

// NormalizeAddress validates an EVM address and returns it lower-cased.
//
// EIP-55 checksums are accepted but not verified: confirming one needs
// keccak-256, and the encoded word is identical either way. What is checked is
// the part that can actually corrupt a transaction — that the value is 20 hex
// bytes and not, say, a token symbol or a truncated paste.
func NormalizeAddress(name, value string) (string, error) {
	if len(value) != 42 || !strings.HasPrefix(value, "0x") {
		return "", fmt.Errorf("fyuz: %s must be a 0x-prefixed 20-byte address, got %q", name, value)
	}
	if _, err := hex.DecodeString(value[2:]); err != nil {
		return "", fmt.Errorf("fyuz: %s is not valid hex: %q", name, value)
	}
	return strings.ToLower(value), nil
}

// ParseAmount parses a base-10 amount in the smallest unit (wei).
//
// It deliberately refuses anything with a decimal point. A caller passing "0.5"
// means BNB, not wei, and silently reading that as 0 would build a transaction
// that buys nothing — see ParseUnits for the conversion.
func ParseAmount(name, value string) (*big.Int, error) {
	if strings.ContainsRune(value, '.') {
		return nil, fmt.Errorf(
			"fyuz: %s must be a whole amount in wei, got %q — decimal input looks like whole units, convert it with ParseUnits first",
			name, value)
	}
	parsed, ok := new(big.Int).SetString(value, 10)
	if !ok {
		return nil, fmt.Errorf("fyuz: %s must be a base-10 integer string, got %q", name, value)
	}
	return parsed, validateAmount(name, parsed)
}

func validateAmount(name string, value *big.Int) error {
	if value == nil {
		return fmt.Errorf("fyuz: %s must not be nil", name)
	}
	if value.Sign() < 0 {
		return fmt.Errorf("fyuz: %s must not be negative", name)
	}
	if value.Cmp(MaxUint256) > 0 {
		return fmt.Errorf("fyuz: %s exceeds uint256", name)
	}
	return nil
}

// ParseUnits converts whole units to the smallest unit — "0.5" BNB to
// 500000000000000000 wei.
//
// String in, big.Int out, with no float anywhere in between: 0.1 * 1e18 in
// float64 gives 100000000000000000 on a good day and 99999999999999998 on a bad
// one.
func ParseUnits(value string, decimals int) (*big.Int, error) {
	if decimals < 0 {
		return nil, fmt.Errorf("fyuz: decimals must not be negative, got %d", decimals)
	}
	whole, fraction, _ := strings.Cut(value, ".")
	if whole == "" {
		whole = "0"
	}
	if len(fraction) > decimals {
		return nil, fmt.Errorf(
			"fyuz: amount %q has %d decimal places, more than the %d this token carries — the extra digits would be silently truncated",
			value, len(fraction), decimals)
	}

	digits := whole + fraction + strings.Repeat("0", decimals-len(fraction))
	parsed, ok := new(big.Int).SetString(digits, 10)
	if !ok {
		return nil, fmt.Errorf("fyuz: amount must be a non-negative decimal string, got %q", value)
	}
	return parsed, validateAmount("amount", parsed)
}

// FormatUnits converts the smallest unit back to whole units, exactly. It is the
// inverse of ParseUnits.
func FormatUnits(value *big.Int, decimals int) string {
	if value == nil {
		return "0"
	}
	base := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
	whole, remainder := new(big.Int).QuoRem(value, base, new(big.Int))

	fraction := strings.TrimRight(fmt.Sprintf("%0*s", decimals, remainder.String()), "0")
	if fraction == "" {
		return whole.String()
	}
	return whole.String() + "." + fraction
}

// Uint256Word encodes a uint256 as one 64-character word.
func Uint256Word(value *big.Int) string {
	return fmt.Sprintf("%064s", value.Text(16))
}

// AddressWord encodes an address as one 64-character word: 12 zero bytes then
// the 20 address bytes.
func AddressWord(address string) string {
	return fmt.Sprintf("%064s", strings.ToLower(strings.TrimPrefix(address, "0x")))
}

// BoolWord encodes a bool as one 64-character word.
func BoolWord(value bool) string {
	if value {
		return Uint256Word(big.NewInt(1))
	}
	return Uint256Word(big.NewInt(0))
}

// EncodeCall joins a selector and its words into 0x-prefixed calldata.
func EncodeCall(selector string, words ...string) string {
	return selector + strings.Join(words, "")
}

// hexBody strips 0x and rejects anything that is not whole bytes of hex.
func hexBody(data string) (string, error) {
	body := strings.TrimPrefix(strings.TrimPrefix(data, "0x"), "0X")
	if len(body)%2 != 0 {
		return "", fmt.Errorf("fyuz: expected whole bytes of hex, got %q", data)
	}
	if _, err := hex.DecodeString(body); err != nil {
		return "", fmt.Errorf("fyuz: expected hex data, got %q", data)
	}
	return body, nil
}

// DecodeUint256At reads the index-th 32-byte word of a return payload.
//
// It errors on a short payload rather than returning zero. A truncated response
// and a genuine zero are very different answers to "how many tokens do I get",
// and only one of them should let a transaction get built.
func DecodeUint256At(data string, index int) (*big.Int, error) {
	body, err := hexBody(data)
	if err != nil {
		return nil, err
	}
	start := index * 64
	if len(body) < start+64 {
		return nil, fmt.Errorf("fyuz: response has %d words, expected at least %d", len(body)/64, index+1)
	}
	value, ok := new(big.Int).SetString(body[start:start+64], 16)
	if !ok {
		return nil, fmt.Errorf("fyuz: word %d is not valid hex", index)
	}
	return value, nil
}

// DecodeBoolAt reads the index-th word as a bool. Any non-zero word is true.
func DecodeBoolAt(data string, index int) (bool, error) {
	value, err := DecodeUint256At(data, index)
	if err != nil {
		return false, err
	}
	return value.Sign() != 0, nil
}

// DecodeAddressAt reads the index-th word as an address, lower-cased.
func DecodeAddressAt(data string, index int) (string, error) {
	value, err := DecodeUint256At(data, index)
	if err != nil {
		return "", err
	}
	return "0x" + Uint256Word(value)[24:], nil
}
