package fyuz

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Conformance tests, driven by ../shared/test-vectors. The same fixtures back
// the TypeScript, Python and Rust suites, so a change to the wire contract
// fails all four at once instead of letting the clients drift apart.
//
// `go test` runs with the package directory as the working directory, so this
// relative path is stable.
const vectorDir = "../shared/test-vectors"

type expectedString struct {
	Value string `json:"value"`
	Why   string `json:"why"`
}

type tokenVector struct {
	Wire   json.RawMessage `json:"wire"`
	Expect struct {
		ExactStrings map[string]expectedString `json:"exact_strings"`
		MustBeNull   struct {
			Fields []string `json:"fields"`
			Why    string   `json:"why"`
		} `json:"must_be_null"`
		Scalars map[string]int64 `json:"scalars"`
	} `json:"expect"`
}

type tradeSideVector struct {
	Cases []struct {
		Wire string `json:"wire"`
		Side string `json:"side"`
	} `json:"cases"`
	WireTemplate map[string]any `json:"wire_template"`
}

type errorVector struct {
	Cases []struct {
		Name           string  `json:"name"`
		Status         int     `json:"status"`
		Body           string  `json:"body"`
		Classification string  `json:"classification"`
		Retryable      bool    `json:"retryable"`
		Message        *string `json:"message"`
	} `json:"cases"`
}

func loadVector(t *testing.T, name string, out any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(vectorDir, name))
	if err != nil {
		t.Fatalf("read shared vector %s: %v", name, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("parse shared vector %s: %v", name, err)
	}
}

// fieldByJSONTag finds a struct field by its `json:"..."` tag, so the
// assertions below can be driven straight off the shared fixture's wire names
// instead of restating the Go field names.
func fieldByJSONTag(v reflect.Value, tag string) (reflect.Value, bool) {
	typ := v.Type()
	for i := 0; i < typ.NumField(); i++ {
		name, _, _ := strings.Cut(typ.Field(i).Tag.Get("json"), ",")
		if name == tag {
			return v.Field(i), true
		}
	}
	return reflect.Value{}, false
}

// conformanceToken serves the shared wire payload once and returns the parsed token.
func conformanceToken(t *testing.T, vector tokenVector) Token {
	t.Helper()

	client, server := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(vector.Wire)
	})
	defer server.Close()

	page, err := client.ListTokens(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListTokens: %v", err)
	}
	if len(page.TokenList) != 1 {
		t.Fatalf("tokenList length = %d, want 1", len(page.TokenList))
	}
	if want := vector.Expect.Scalars["tokenCount"]; page.TokenCount != want {
		t.Errorf("tokenCount = %d, want %d", page.TokenCount, want)
	}
	return page.TokenList[0]
}

// TestConformanceDecimalsSurviveExactly is the invariant the whole SDK is built
// around: a decimal the server sent arrives byte-identical. Every value in the
// fixture is one a float-parsing client would corrupt.
func TestConformanceDecimalsSurviveExactly(t *testing.T) {
	var vector tokenVector
	loadVector(t, "token.json", &vector)

	if len(vector.Expect.ExactStrings) == 0 {
		t.Fatal("fixture has no exact_strings; the test would pass vacuously")
	}

	token := conformanceToken(t, vector)
	value := reflect.ValueOf(token)

	for tag, expected := range vector.Expect.ExactStrings {
		field, ok := fieldByJSONTag(value, tag)
		if !ok {
			t.Errorf("no Token field carries json tag %q", tag)
			continue
		}
		if field.Kind() != reflect.String {
			t.Errorf("%s is %s, want string — decimals must not be parsed into a number", tag, field.Kind())
			continue
		}
		if got := field.String(); got != expected.Value {
			t.Errorf("%s = %q, want %q\n%s", tag, got, expected.Value, expected.Why)
		}
	}
}

// TestConformanceNullIsNotZero guards the second invariant: a null on the wire
// stays nil, because it means "unknown", not "zero". A nil PairAddress in
// particular means the token is still on the bonding curve and no DEX pool
// exists to look up.
func TestConformanceNullIsNotZero(t *testing.T) {
	var vector tokenVector
	loadVector(t, "token.json", &vector)

	if len(vector.Expect.MustBeNull.Fields) == 0 {
		t.Fatal("fixture has no must_be_null fields; the test would pass vacuously")
	}

	token := conformanceToken(t, vector)
	value := reflect.ValueOf(token)

	for _, tag := range vector.Expect.MustBeNull.Fields {
		field, ok := fieldByJSONTag(value, tag)
		if !ok {
			t.Errorf("no Token field carries json tag %q", tag)
			continue
		}
		if field.Kind() != reflect.Ptr {
			t.Errorf("%s is %s, want a pointer so null is representable", tag, field.Kind())
			continue
		}
		if !field.IsNil() {
			t.Errorf("%s = %v, want nil\n%s", tag, field.Elem(), vector.Expect.MustBeNull.Why)
		}
	}
}

func TestConformanceScalarsRoundTrip(t *testing.T) {
	var vector tokenVector
	loadVector(t, "token.json", &vector)

	token := conformanceToken(t, vector)

	if want := vector.Expect.Scalars["id"]; token.ID != want {
		t.Errorf("id = %d, want %d", token.ID, want)
	}
	if want := vector.Expect.Scalars["poolType"]; token.PoolType != want {
		t.Errorf("poolType = %d, want %d", token.PoolType, want)
	}
	if want := vector.Expect.Scalars["replies"]; token.Replies != want {
		t.Errorf("replies = %d, want %d", token.Replies, want)
	}
}

// TestConformanceTradeSideCasing pins both halves of the trade-side contract:
// the value the server sent is passed through untouched, and TradeType.Is folds
// the casing so a caller can tell a buy from a sell without knowing which
// endpoint the trade came from.
func TestConformanceTradeSideCasing(t *testing.T) {
	var vector tradeSideVector
	loadVector(t, "trade-side.json", &vector)

	if len(vector.Cases) == 0 {
		t.Fatal("fixture has no cases; the test would pass vacuously")
	}

	for _, testCase := range vector.Cases {
		t.Run(testCase.Wire, func(t *testing.T) {
			trades, ok := vector.WireTemplate["trades"].([]any)
			if !ok || len(trades) == 0 {
				t.Fatal("fixture wire_template has no trades")
			}
			trade, ok := trades[0].(map[string]any)
			if !ok {
				t.Fatal("fixture wire_template trade is not an object")
			}
			trade["type"] = testCase.Wire

			body, err := json.Marshal(vector.WireTemplate)
			if err != nil {
				t.Fatalf("re-encode wire template: %v", err)
			}

			client, server := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write(body)
			})
			defer server.Close()

			feed, err := client.GetRecentTrades(context.Background(), nil)
			if err != nil {
				t.Fatalf("GetRecentTrades: %v", err)
			}
			if len(feed.Trades) != 1 {
				t.Fatalf("trades length = %d, want 1", len(feed.Trades))
			}

			got := feed.Trades[0].Type
			if string(got) != testCase.Wire {
				t.Errorf("Type = %q, want %q — the SDK must not rewrite what the server sent", got, testCase.Wire)
			}
			if !got.Is(TradeType(testCase.Side)) {
				t.Errorf("TradeType(%q).Is(%q) = false, want true", got, testCase.Side)
			}
		})
	}
}

// TestConformanceErrorClassification checks that each status maps to the error
// the shared fixture says it should, and that only the retryable ones are
// retried.
func TestConformanceErrorClassification(t *testing.T) {
	var vector errorVector
	loadVector(t, "http-errors.json", &vector)

	if len(vector.Cases) == 0 {
		t.Fatal("fixture has no cases; the test would pass vacuously")
	}

	const maxRetries = 2

	for _, testCase := range vector.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			attempts := 0
			client, server := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
				attempts++
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(testCase.Status)
				_, _ = w.Write([]byte(testCase.Body))
			}, WithMaxRetries(maxRetries), WithBackoff(0, 0))
			defer server.Close()

			_, err := client.Health(context.Background())
			if err == nil {
				t.Fatalf("status %d returned no error", testCase.Status)
			}

			var apiErr *APIError
			if !errorAs(err, &apiErr) {
				t.Fatalf("error is %T, want *APIError: %v", err, err)
			}
			if apiErr.StatusCode != testCase.Status {
				t.Errorf("StatusCode = %d, want %d", apiErr.StatusCode, testCase.Status)
			}

			switch testCase.Classification {
			case "not_found":
				if !IsNotFound(err) {
					t.Errorf("IsNotFound = false, want true")
				}
			case "rate_limited":
				if !IsRateLimited(err) {
					t.Errorf("IsRateLimited = false, want true")
				}
				if !apiErr.RateLimited() {
					t.Errorf("APIError.RateLimited() = false, want true")
				}
			case "api":
				if IsNotFound(err) || IsRateLimited(err) {
					t.Errorf("status %d classified as not-found or rate-limited", testCase.Status)
				}
			default:
				t.Fatalf("fixture uses unknown classification %q", testCase.Classification)
			}

			if testCase.Message != nil {
				if apiErr.Message != *testCase.Message {
					t.Errorf("Message = %q, want %q", apiErr.Message, *testCase.Message)
				}
			} else if strings.TrimSpace(apiErr.Message) == "" {
				// A non-JSON body still has to produce something a human can read.
				t.Errorf("Message is empty for a body the SDK could not parse")
			}

			want := 1
			if testCase.Retryable {
				want = maxRetries + 1
			}
			if attempts != want {
				t.Errorf("attempts = %d, want %d (retryable=%v)", attempts, want, testCase.Retryable)
			}
		})
	}
}

// errorAs is errors.As, wrapped so this file does not shadow the sentinel
// helpers already exported by the package.
func errorAs(err error, target **APIError) bool {
	for err != nil {
		if apiErr, ok := err.(*APIError); ok {
			*target = apiErr
			return true
		}
		unwrapper, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = unwrapper.Unwrap()
	}
	return false
}
