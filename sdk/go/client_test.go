package fyuz

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// newTestClient starts a local stub server and returns a client pointed at it.
// Backoff is compressed so retry tests stay fast. No test in this package ever
// touches the network.
func newTestClient(t *testing.T, handler http.HandlerFunc, opts ...Option) (*Client, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	base := []Option{
		WithBaseURL(srv.URL),
		WithBackoff(time.Millisecond, 4*time.Millisecond),
	}
	return New(append(base, opts...)...), srv
}

// writeJSON is a stub-server helper.
func writeJSON(t *testing.T, w http.ResponseWriter, status int, body string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if _, err := w.Write([]byte(body)); err != nil {
		t.Errorf("stub server write: %v", err)
	}
}

func TestNewDefaults(t *testing.T) {
	c := New()
	if c.BaseURL() != DefaultBaseURL {
		t.Errorf("BaseURL = %q, want %q", c.BaseURL(), DefaultBaseURL)
	}
	if c.timeout != DefaultTimeout {
		t.Errorf("timeout = %v, want %v", c.timeout, DefaultTimeout)
	}
	if c.maxRetries != DefaultMaxRetries {
		t.Errorf("maxRetries = %d, want %d", c.maxRetries, DefaultMaxRetries)
	}
	if c.Distributor == nil {
		t.Fatal("Distributor sub-client is nil")
	}
	if want := "fyuz-sdk-go/" + Version; c.userAgent != want {
		t.Errorf("userAgent = %q, want %q", c.userAgent, want)
	}
}

func TestWithBaseURLTrimsTrailingSlash(t *testing.T) {
	c := New(WithBaseURL("https://example.test/"))
	if c.BaseURL() != "https://example.test" {
		t.Errorf("BaseURL = %q", c.BaseURL())
	}
}

func TestRequestHeaders(t *testing.T) {
	var gotUA, gotAccept string
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		gotAccept = r.Header.Get("Accept")
		writeJSON(t, w, 200, `{"status":"ok"}`)
	})

	if _, err := client.Health(context.Background()); err != nil {
		t.Fatalf("Health: %v", err)
	}
	if want := "fyuz-sdk-go/" + Version; gotUA != want {
		t.Errorf("User-Agent = %q, want %q", gotUA, want)
	}
	if gotAccept != "application/json" {
		t.Errorf("Accept = %q", gotAccept)
	}
}

func TestWithUserAgent(t *testing.T) {
	var gotUA string
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		writeJSON(t, w, 200, `{"status":"ok"}`)
	}, WithUserAgent("acme-indexer/2.0"))

	if _, err := client.Health(context.Background()); err != nil {
		t.Fatalf("Health: %v", err)
	}
	if gotUA != "acme-indexer/2.0" {
		t.Errorf("User-Agent = %q", gotUA)
	}
}

// A 429 must be retried transparently and the caller must see only the
// eventual success.
func TestRetriesRateLimitThenSucceeds(t *testing.T) {
	var calls int32
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			writeJSON(t, w, http.StatusTooManyRequests, `{"error":"Too many requests"}`)
			return
		}
		writeJSON(t, w, 200, `[{"tokenAddress":"0xabc","name":"Test","symbol":"TST","network":"bsc","marketcap":1234.5,"priceUsd":0.001,"createdAt":1750000000,"launched":false,"volume24h":10,"buys24h":2,"sells24h":1,"holders":3,"priceChange24h":5,"graduationPct":4.1}]`)
	})

	tokens, err := client.Discover(context.Background(), nil)
	if err != nil {
		t.Fatalf("Discover after retry: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Errorf("server calls = %d, want 2", got)
	}
	if len(tokens) != 1 || tokens[0].Symbol != "TST" {
		t.Fatalf("unexpected payload: %+v", tokens)
	}
}

func TestRetriesServerErrorsThenGivesUp(t *testing.T) {
	var calls int32
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		writeJSON(t, w, http.StatusBadGateway, `{"error":"upstream down"}`)
	}, WithMaxRetries(2))

	_, err := client.Health(context.Background())
	if err == nil {
		t.Fatal("expected an error")
	}
	if got := atomic.LoadInt32(&calls); got != 3 {
		t.Errorf("server calls = %d, want 3 (1 attempt + 2 retries)", got)
	}
	if !errors.Is(err, ErrServer) {
		t.Errorf("errors.Is(err, ErrServer) = false for %v", err)
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error is not *APIError: %T", err)
	}
	if apiErr.StatusCode != http.StatusBadGateway || apiErr.Message != "upstream down" {
		t.Errorf("APIError = %+v", apiErr)
	}
}

func TestMaxRetriesZeroDisablesRetry(t *testing.T) {
	var calls int32
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		writeJSON(t, w, http.StatusTooManyRequests, `{"error":"Too many requests"}`)
	}, WithMaxRetries(0))

	_, err := client.Health(context.Background())
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("server calls = %d, want 1", got)
	}
	if !errors.Is(err, ErrRateLimited) || !IsRateLimited(err) {
		t.Fatalf("expected a rate-limit error, got %v", err)
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error is not *APIError: %T", err)
	}
	if apiErr.Message != "Too many requests" {
		t.Errorf("Message = %q, want %q", apiErr.Message, "Too many requests")
	}
	if !apiErr.RateLimited() {
		t.Error("RateLimited() = false")
	}
}

// Any 4xx other than 429 is the caller's fault and must not be retried.
func TestDoesNotRetryClientErrors(t *testing.T) {
	for _, tc := range []struct {
		status   int
		sentinel error
	}{
		{http.StatusBadRequest, ErrBadRequest},
		{http.StatusNotFound, ErrNotFound},
	} {
		var calls int32
		client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&calls, 1)
			writeJSON(t, w, tc.status, `{"error":"nope"}`)
		})

		_, err := client.GetToken(context.Background(), "bsc", "0xdead", nil)
		if got := atomic.LoadInt32(&calls); got != 1 {
			t.Errorf("status %d: server calls = %d, want 1", tc.status, got)
		}
		if !errors.Is(err, tc.sentinel) {
			t.Errorf("status %d: errors.Is failed for %v", tc.status, err)
		}
		if errors.Is(err, ErrRateLimited) {
			t.Errorf("status %d: must not match ErrRateLimited", tc.status)
		}
	}
}

func TestNotFoundHelper(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(t, w, http.StatusNotFound, `{"error":"User not found"}`)
	})
	_, err := client.GetUserProfile(context.Background(), "0xdead")
	if !IsNotFound(err) {
		t.Fatalf("IsNotFound = false for %v", err)
	}
	var apiErr *APIError
	errors.As(err, &apiErr)
	if apiErr.Message != "User not found" {
		t.Errorf("Message = %q", apiErr.Message)
	}
	if !strings.Contains(apiErr.Error(), "404") {
		t.Errorf("Error() = %q, want it to mention the status", apiErr.Error())
	}
}

func TestErrorEnvelopeFallbacks(t *testing.T) {
	t.Run("non-JSON body", func(t *testing.T) {
		client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte("plain text explosion"))
		}, WithMaxRetries(0))

		_, err := client.Health(context.Background())
		var apiErr *APIError
		if !errors.As(err, &apiErr) {
			t.Fatalf("error is not *APIError: %v", err)
		}
		if apiErr.Message != "plain text explosion" {
			t.Errorf("Message = %q", apiErr.Message)
		}
		if apiErr.Body != "plain text explosion" {
			t.Errorf("Body = %q", apiErr.Body)
		}
	})

	t.Run("empty body", func(t *testing.T) {
		client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		}, WithMaxRetries(0))

		_, err := client.Health(context.Background())
		var apiErr *APIError
		if !errors.As(err, &apiErr) {
			t.Fatalf("error is not *APIError: %v", err)
		}
		if apiErr.Message != http.StatusText(http.StatusTeapot) {
			t.Errorf("Message = %q, want the status text", apiErr.Message)
		}
	})
}

func TestHonoursRetryAfterHeader(t *testing.T) {
	var calls int32
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			w.Header().Set("Retry-After", "0.08")
			writeJSON(t, w, http.StatusTooManyRequests, `{"error":"Too many requests"}`)
			return
		}
		writeJSON(t, w, 200, `{"status":"ok"}`)
	})

	start := time.Now()
	if _, err := client.Health(context.Background()); err != nil {
		t.Fatalf("Health: %v", err)
	}
	// The compressed jittered backoff is at most 4ms, so anything close to the
	// 80ms the server asked for proves the header won.
	if elapsed := time.Since(start); elapsed < 60*time.Millisecond {
		t.Errorf("waited %v, expected the Retry-After delay to be honoured", elapsed)
	}
}

func TestParseRetryAfter(t *testing.T) {
	if got := parseRetryAfter("2"); got != 2*time.Second {
		t.Errorf("delay-seconds: %v", got)
	}
	if got := parseRetryAfter(""); got != 0 {
		t.Errorf("empty: %v", got)
	}
	if got := parseRetryAfter("garbage"); got != 0 {
		t.Errorf("garbage: %v", got)
	}
	if got := parseRetryAfter(time.Now().Add(-time.Hour).UTC().Format(http.TimeFormat)); got != 0 {
		t.Errorf("past HTTP-date: %v", got)
	}
	got := parseRetryAfter(time.Now().Add(30 * time.Second).UTC().Format(http.TimeFormat))
	if got < 25*time.Second || got > 31*time.Second {
		t.Errorf("future HTTP-date: %v", got)
	}
}

func TestBackoffIsJitteredAndBounded(t *testing.T) {
	c := New(WithBackoff(100*time.Millisecond, time.Second))
	for attempt := 0; attempt < 8; attempt++ {
		for i := 0; i < 50; i++ {
			d := c.backoff(attempt, 0)
			if d < 0 || d >= time.Second {
				t.Fatalf("attempt %d: delay %v out of bounds", attempt, d)
			}
		}
	}
	// A server-supplied delay wins over the schedule, but is capped.
	if got := c.backoff(0, 3*time.Second); got != 3*time.Second {
		t.Errorf("Retry-After not honoured: %v", got)
	}
	if got := c.backoff(0, 10*time.Minute); got != maxHonouredRetryAfter {
		t.Errorf("Retry-After not capped: %v", got)
	}
}

// A dropped connection is transient and must be retried like a 5xx.
func TestRetriesTransportErrors(t *testing.T) {
	var calls int32
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			hj, ok := w.(http.Hijacker)
			if !ok {
				t.Fatal("stub server does not support hijacking")
			}
			conn, _, err := hj.Hijack()
			if err != nil {
				t.Fatalf("hijack: %v", err)
			}
			_ = conn.Close()
			return
		}
		writeJSON(t, w, 200, `{"status":"ok"}`)
	})

	got, err := client.Health(context.Background())
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if got.Status != "ok" {
		t.Errorf("Status = %q", got.Status)
	}
	if n := atomic.LoadInt32(&calls); n != 2 {
		t.Errorf("server calls = %d, want 2", n)
	}
}

func TestContextCancellationStopsRetries(t *testing.T) {
	var calls int32
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		writeJSON(t, w, http.StatusServiceUnavailable, `{"error":"down"}`)
	}, WithMaxRetries(100), WithBackoff(20*time.Millisecond, 20*time.Millisecond))

	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()

	_, err := client.Health(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want context.DeadlineExceeded", err)
	}
	if n := atomic.LoadInt32(&calls); n > 5 {
		t.Errorf("server calls = %d, expected the retry loop to stop at the deadline", n)
	}
}

func TestPerAttemptTimeout(t *testing.T) {
	client, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		writeJSON(t, w, 200, `{"status":"ok"}`)
	}, WithTimeout(25*time.Millisecond), WithMaxRetries(0))

	start := time.Now()
	_, err := client.Health(context.Background())
	if err == nil {
		t.Fatal("expected a timeout error")
	}
	if elapsed := time.Since(start); elapsed > 150*time.Millisecond {
		t.Errorf("took %v, expected the per-attempt timeout to fire", elapsed)
	}
}

func TestWithHTTPClientIsUsed(t *testing.T) {
	var used bool
	rt := roundTripperFunc(func(r *http.Request) (*http.Response, error) {
		used = true
		return &http.Response{
			StatusCode: 200,
			Body:       http.NoBody,
			Header:     http.Header{},
			Request:    r,
		}, nil
	})
	client := New(WithHTTPClient(&http.Client{Transport: rt}))
	var out HealthStatus
	// http.NoBody decodes as EOF; we only care that the transport was used.
	_ = client.get(context.Background(), "/health", nil, &out)
	if !used {
		t.Error("custom http.Client was not used")
	}
}

// A hand-rolled RoundTripper is free to leave Response.Request nil, so an
// undecodable 2xx body must report an error rather than panic.
func TestDecodeErrorWithNilResponseRequest(t *testing.T) {
	rt := roundTripperFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader("<html>not json</html>")),
			Header:     http.Header{},
			// Request deliberately left nil.
		}, nil
	})
	client := New(WithHTTPClient(&http.Client{Transport: rt}), WithBaseURL("https://example.test"))

	var out HealthStatus
	err := client.get(context.Background(), "/health", nil, &out)
	if err == nil {
		t.Fatal("expected a decode error")
	}
	if !strings.Contains(err.Error(), "https://example.test/health") {
		t.Errorf("error = %q, want it to name the endpoint", err.Error())
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
