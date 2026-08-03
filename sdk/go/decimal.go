package fyuz

import (
	"fmt"
	"math/big"
	"time"
)

// WeiPerBNB is 10^18, the number of wei in one BNB.
var WeiPerBNB = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)

// ParseWei parses an exact uint256 wei amount into a *big.Int.
//
// Wei values routinely exceed 2^53 and cannot be represented exactly by a
// float64, so the wire model keeps them as strings and this is the only safe
// way to do arithmetic on them.
//
//	stats, _ := client.Distributor.GetStats(ctx)
//	wei, err := fyuz.ParseWei(stats.TotalPaidWei)
//	if err != nil {
//		return err
//	}
//	fmt.Println(wei.String(), "wei paid out in total")
func ParseWei(s string) (*big.Int, error) {
	n, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return nil, fmt.Errorf("fyuz: %q is not a valid wei amount", s)
	}
	return n, nil
}

// ParseWeiPtr parses a nullable wei field. A nil input yields a nil result and
// no error: nil means "unknown", which is not the same as zero.
func ParseWeiPtr(s *string) (*big.Int, error) {
	if s == nil {
		return nil, nil
	}
	return ParseWei(*s)
}

// ParseDecimal parses a fixed-point decimal string (a market cap, price, token
// balance or BNB amount) into an exact *big.Rat.
//
//	mcap, err := fyuz.ParseDecimal(token.Marketcap) // "4472.899483094470000000"
func ParseDecimal(s string) (*big.Rat, error) {
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return nil, fmt.Errorf("fyuz: %q is not a valid decimal amount", s)
	}
	return r, nil
}

// WeiToBNB converts a wei amount to BNB as an exact rational. Use
// (*big.Rat).FloatString to render it with a fixed number of decimals.
//
//	bnb := fyuz.WeiToBNB(wei)
//	fmt.Println(bnb.FloatString(6), "BNB")
func WeiToBNB(wei *big.Int) *big.Rat {
	if wei == nil {
		return nil
	}
	return new(big.Rat).SetFrac(new(big.Int).Set(wei), WeiPerBNB)
}

// UnixTime converts one of the API's UNIX-second timestamps to a UTC time.
//
//	fmt.Println(fyuz.UnixTime(reign.StartedAt).Format(time.RFC3339))
func UnixTime(sec int64) time.Time { return time.Unix(sec, 0).UTC() }

// UnixTimePtr converts a nullable UNIX-second timestamp. A nil input yields a
// nil result rather than the epoch.
func UnixTimePtr(sec *int64) *time.Time {
	if sec == nil {
		return nil
	}
	t := UnixTime(*sec)
	return &t
}
