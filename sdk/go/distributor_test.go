package fyuz

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"testing"
)

func TestDistributorGetStatsKeepsWeiExact(t *testing.T) {
	// 1.25 BNB and a 10^29-scale largest payout: both beyond float64's exact
	// integer range once expressed in wei.
	const totalPaid = "123456789012345678901234567890"
	const largest = "999999999999999999999999999999"

	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/distributor/stats" {
			t.Errorf("path = %q", r.URL.Path)
		}
		writeJSON(t, w, 200, `{"totalPaidWei":"`+totalPaid+`","roundsSettled":12,
			"uniqueRecipients":340,"largestPayoutWei":"`+largest+`","lastRoundAt":1751371200}`)
	})

	stats, err := client.Distributor.GetStats(context.Background())
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}
	if stats.TotalPaidWei != totalPaid {
		t.Errorf("TotalPaidWei = %q, want %q", stats.TotalPaidWei, totalPaid)
	}
	if stats.LargestPayoutWei != largest {
		t.Errorf("LargestPayoutWei = %q", stats.LargestPayoutWei)
	}
	if stats.RoundsSettled != 12 || stats.UniqueRecipients != 340 {
		t.Errorf("stats = %+v", stats)
	}
	if stats.LastRoundAt == nil || *stats.LastRoundAt != 1751371200 {
		t.Errorf("LastRoundAt = %v", stats.LastRoundAt)
	}

	// Exact arithmetic is available through big.Int.
	n, err := ParseWei(stats.TotalPaidWei)
	if err != nil {
		t.Fatalf("ParseWei: %v", err)
	}
	if n.String() != totalPaid {
		t.Errorf("ParseWei round trip = %s", n)
	}

	// And the string survives a re-encode unchanged.
	blob, err := json.Marshal(stats)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var again PayoutStats
	if err := json.Unmarshal(blob, &again); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if again.TotalPaidWei != totalPaid {
		t.Errorf("after re-encode: %q", again.TotalPaidWei)
	}
}

func TestDistributorGetStatsUnsettled(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, 200, `{"totalPaidWei":"0","roundsSettled":0,"uniqueRecipients":0,
			"largestPayoutWei":"0","lastRoundAt":null}`)
	})
	stats, err := client.Distributor.GetStats(context.Background())
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}
	if stats.LastRoundAt != nil {
		t.Error("lastRoundAt null means nothing has settled")
	}
	if stats.TotalPaidWei != "0" {
		t.Errorf("TotalPaidWei = %q", stats.TotalPaidWei)
	}
}

// null is not 0: an unreadable pot must stay nil so callers can hide it.
func TestDistributorPotNullIsNotZero(t *testing.T) {
	t.Run("unknown", func(t *testing.T) {
		client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			writeJSON(t, w, 200, `{"potBnb":null,"distributeBps":9000,"roundEnd":1751371200,
				"totalPoints":null,"pointsPerUsd":1}`)
		})
		pot, err := client.Distributor.GetPot(context.Background())
		if err != nil {
			t.Fatalf("GetPot: %v", err)
		}
		if pot.PotBnb != nil {
			t.Errorf("PotBnb = %v, want nil (unknown, not zero)", *pot.PotBnb)
		}
		if pot.TotalPoints != nil {
			t.Errorf("TotalPoints = %v, want nil", *pot.TotalPoints)
		}
		if pot.DistributeBps != 9000 || pot.RoundEnd != 1751371200 || pot.PointsPerUsd != 1 {
			t.Errorf("pot = %+v", pot)
		}
	})

	t.Run("genuinely empty", func(t *testing.T) {
		client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			writeJSON(t, w, 200, `{"potBnb":0,"distributeBps":9000,"roundEnd":1,"totalPoints":0,"pointsPerUsd":1}`)
		})
		pot, err := client.Distributor.GetPot(context.Background())
		if err != nil {
			t.Fatalf("GetPot: %v", err)
		}
		if pot.PotBnb == nil || *pot.PotBnb != 0 {
			t.Errorf("PotBnb = %v, want a non-nil 0", pot.PotBnb)
		}
		if pot.TotalPoints == nil || *pot.TotalPoints != 0 {
			t.Errorf("TotalPoints = %v, want a non-nil 0", pot.TotalPoints)
		}
	})
}

func TestDistributorGetShares(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/distributor/shares" {
			t.Errorf("path = %q", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("from") != "1751000000" || q.Get("to") != "1751371200" || q.Get("limit") != "50" {
			t.Errorf("query = %q", r.URL.RawQuery)
		}
		writeJSON(t, w, 200, `{"from":1751000000,"to":1751371200,"totalPoints":2500.75,
			"holders":[{"address":"0xa","points":2000.5,"share":3435973836},
			           {"address":"0xb","points":500.25,"share":858993459}],
			"packed":"0x00aa"}`)
	})

	shares, err := client.Distributor.GetShares(context.Background(), &SharesOptions{
		From:  Int64(1751000000),
		To:    Int64(1751371200),
		Limit: Int64(50),
	})
	if err != nil {
		t.Fatalf("GetShares: %v", err)
	}
	if shares.TotalPoints != 2500.75 || len(shares.Holders) != 2 {
		t.Errorf("shares = %+v", shares)
	}
	// share is a u32 fraction of 2^32 and must not overflow or round.
	if shares.Holders[0].Share != 3435973836 {
		t.Errorf("share = %d", shares.Holders[0].Share)
	}
	if shares.Packed != "0x00aa" {
		t.Errorf("packed = %q", shares.Packed)
	}
}

func TestDistributorListRounds(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/distributor/rounds" || r.Method != http.MethodGet {
			t.Errorf("%s %q", r.Method, r.URL.Path)
		}
		if r.URL.Query().Get("limit") != "10" || r.URL.Query().Get("offset") != "5" {
			t.Errorf("query = %q", r.URL.RawQuery)
		}
		writeJSON(t, w, 200, `[
			{"roundId":12,"timeStart":1751000000,"timeEnd":1751371200,"txHash":"0xtx",
			 "potWei":"1250000000000000000","distributedWei":"1125000000000000000",
			 "winnerAddress":"0xw","winnerAmountWei":"125000000000000000","holderCount":42,
			 "vrfRandom":"87124509821374981274981274","distributedAt":1751371260},
			{"roundId":13,"timeStart":1751371200,"timeEnd":1751457600,"txHash":null,
			 "potWei":null,"distributedWei":null,"winnerAddress":null,"winnerAmountWei":null,
			 "holderCount":null,"vrfRandom":null,"distributedAt":null}
		]`)
	})

	rounds, err := client.Distributor.ListRounds(context.Background(), &ListRoundsOptions{
		Limit:  Int64(10),
		Offset: Int64(5),
	})
	if err != nil {
		t.Fatalf("ListRounds: %v", err)
	}
	if len(rounds) != 2 {
		t.Fatalf("rounds = %d", len(rounds))
	}

	settled := rounds[0]
	if !settled.Settled() {
		t.Error("round 12 should be settled")
	}
	if settled.PotWei == nil || *settled.PotWei != "1250000000000000000" {
		t.Errorf("PotWei = %v", settled.PotWei)
	}
	// vrfRandom is a decimal string, not a number and not hex.
	if settled.VrfRandom == nil || *settled.VrfRandom != "87124509821374981274981274" {
		t.Errorf("VrfRandom = %v", settled.VrfRandom)
	}
	if settled.HolderCount == nil || *settled.HolderCount != 42 {
		t.Errorf("HolderCount = %v", settled.HolderCount)
	}

	pending := rounds[1]
	if pending.Settled() {
		t.Error("round 13 is not settled")
	}
	for name, v := range map[string]*string{
		"potWei":          pending.PotWei,
		"distributedWei":  pending.DistributedWei,
		"winnerAddress":   pending.WinnerAddress,
		"winnerAmountWei": pending.WinnerAmountWei,
		"vrfRandom":       pending.VrfRandom,
		"txHash":          pending.TxHash,
	} {
		if v != nil {
			t.Errorf("%s = %q, want nil (not yet indexed, not zero)", name, *v)
		}
	}
	if pending.HolderCount != nil || pending.DistributedAt != nil {
		t.Error("unindexed numeric fields must be nil")
	}
}

// RoundDetail is flattened on the wire: the receipt fields sit next to
// "payouts", not under a "round" key.
func TestDistributorGetRoundIsFlattened(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/distributor/rounds/12" {
			t.Errorf("path = %q", r.URL.Path)
		}
		writeJSON(t, w, 200, `{
			"roundId":12,"timeStart":1751000000,"timeEnd":1751371200,"txHash":"0xtx",
			"potWei":"1250000000000000000","distributedWei":"1125000000000000000",
			"winnerAddress":"0xw","winnerAmountWei":"125000000000000000","holderCount":2,
			"vrfRandom":"42","distributedAt":1751371260,
			"payouts":[
				{"roundId":12,"address":"0xa","share":3435973836,"amountWei":"900000000000000000",
				 "username":"alice","avatar":null},
				{"roundId":12,"address":"0xb","share":858993459,"amountWei":"225000000000000000",
				 "username":null,"avatar":null}
			]
		}`)
	})

	detail, err := client.Distributor.GetRound(context.Background(), 12)
	if err != nil {
		t.Fatalf("GetRound: %v", err)
	}
	// Promoted receipt fields.
	if detail.RoundID != 12 || detail.TimeEnd != 1751371200 {
		t.Errorf("receipt = %+v", detail.RoundReceipt)
	}
	if detail.TxHash == nil || *detail.TxHash != "0xtx" {
		t.Errorf("TxHash = %v", detail.TxHash)
	}
	if len(detail.Payouts) != 2 {
		t.Fatalf("payouts = %d", len(detail.Payouts))
	}
	if detail.Payouts[0].AmountWei != "900000000000000000" {
		t.Errorf("amountWei = %q", detail.Payouts[0].AmountWei)
	}
	if detail.Payouts[1].Username != nil {
		t.Error("null username must decode to nil")
	}

	// And it re-encodes flat, without a nested "round" object.
	blob, err := json.Marshal(detail)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(blob, &raw); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if _, nested := raw["round"]; nested {
		t.Error("RoundDetail must not nest the receipt under a `round` key")
	}
	if _, ok := raw["roundId"]; !ok {
		t.Error("roundId must sit at the top level")
	}
	if _, ok := raw["payouts"]; !ok {
		t.Error("payouts must sit at the top level")
	}
}

func TestDistributorGetRoundNotFound(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusNotFound, `{"error":"Round not found"}`)
	})
	_, err := client.Distributor.GetRound(context.Background(), 999)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestDistributorGetPayouts(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/distributor/payouts/0xabc" {
			t.Errorf("path = %q", r.URL.Path)
		}
		writeJSON(t, w, 200, `{"address":"0xabc","totalWei":"1125000000000000000","roundsPaid":3,
			"payouts":[{"roundId":12,"address":"0xabc","share":3435973836,
			            "amountWei":"900000000000000000","username":null,"avatar":null}]}`)
	})

	got, err := client.Distributor.GetPayouts(context.Background(), "0xabc")
	if err != nil {
		t.Fatalf("GetPayouts: %v", err)
	}
	if got.TotalWei != "1125000000000000000" || got.RoundsPaid != 3 {
		t.Errorf("payouts = %+v", got)
	}
	bnb := WeiToBNB(mustWei(t, got.TotalWei))
	if s := bnb.FloatString(4); s != "1.1250" {
		t.Errorf("total in BNB = %s", s)
	}
}

func TestDistributorGetClaimable(t *testing.T) {
	t.Run("known", func(t *testing.T) {
		client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/distributor/claimable/0xabc" {
				t.Errorf("path = %q", r.URL.Path)
			}
			writeJSON(t, w, 200, `{"address":"0xabc","claimableWei":"5000000000000000",
				"distributorAddress":"0xdist"}`)
		})
		got, err := client.Distributor.GetClaimable(context.Background(), "0xabc")
		if err != nil {
			t.Fatalf("GetClaimable: %v", err)
		}
		if got.ClaimableWei == nil || *got.ClaimableWei != "5000000000000000" {
			t.Errorf("ClaimableWei = %v", got.ClaimableWei)
		}
		if got.DistributorAddress == nil || *got.DistributorAddress != "0xdist" {
			t.Errorf("DistributorAddress = %v", got.DistributorAddress)
		}
	})

	t.Run("rpc unreachable", func(t *testing.T) {
		client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			writeJSON(t, w, 200, `{"address":"0xabc","claimableWei":null,"distributorAddress":null}`)
		})
		got, err := client.Distributor.GetClaimable(context.Background(), "0xabc")
		if err != nil {
			t.Fatalf("GetClaimable: %v", err)
		}
		if got.ClaimableWei != nil {
			t.Error("an unreadable balance must stay nil, never 0")
		}
	})
}

func mustWei(t *testing.T, s string) *big.Int {
	t.Helper()
	n, err := ParseWei(s)
	if err != nil {
		t.Fatalf("ParseWei(%q): %v", s, err)
	}
	return n
}
