package fyuz

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Version is the SDK version, reported in the User-Agent header.
const Version = "1.0.0"

const (
	// DefaultBaseURL is the production Fyuz API.
	DefaultBaseURL = "https://api.fyuz.fun"

	// DefaultTimeout bounds a single HTTP attempt, not the whole call. A call
	// that retries twice may therefore take up to three times this long; use
	// the context to bound total wall-clock time.
	DefaultTimeout = 30 * time.Second

	// DefaultMaxRetries is how many times a 429 or 5xx response is retried
	// before the error is returned to the caller.
	DefaultMaxRetries = 3

	// DefaultBaseBackoff is the first retry delay before jitter is applied.
	DefaultBaseBackoff = 250 * time.Millisecond

	// DefaultMaxBackoff caps the exponential backoff delay.
	DefaultMaxBackoff = 8 * time.Second
)

// maxHonouredRetryAfter caps how long a server-supplied Retry-After header can
// park a request. Beyond this the header is clamped rather than obeyed.
const maxHonouredRetryAfter = 60 * time.Second

// maxErrorBodyBytes bounds how much of an error response is buffered.
const maxErrorBodyBytes = 1 << 20

// Client is a Fyuz API client. It is safe for concurrent use by multiple
// goroutines and should be created once and reused, so that the underlying
// http.Client can pool connections.
//
//	client := fyuz.New()
//	king, err := client.GetKing(ctx)
type Client struct {
	baseURL     string
	httpClient  *http.Client
	userAgent   string
	timeout     time.Duration
	maxRetries  int
	baseBackoff time.Duration
	maxBackoff  time.Duration

	// Distributor groups the on-chain fee-distribution endpoints.
	//
	//	pot, err := client.Distributor.GetPot(ctx)
	Distributor *DistributorService
}

// Option configures a Client. Options are applied in order by New.
type Option func(*Client)

// WithBaseURL points the client at a different deployment. Any trailing slash
// is trimmed. Defaults to DefaultBaseURL.
func WithBaseURL(baseURL string) Option {
	return func(c *Client) {
		if baseURL != "" {
			c.baseURL = strings.TrimRight(baseURL, "/")
		}
	}
}

// WithHTTPClient supplies the http.Client used for every request, for callers
// who need custom transports, proxies or instrumentation. The client's own
// Timeout field, if set, applies on top of WithTimeout.
func WithHTTPClient(hc *http.Client) Option {
	return func(c *Client) {
		if hc != nil {
			c.httpClient = hc
		}
	}
}

// WithTimeout bounds each individual HTTP attempt. It is implemented with a
// per-attempt context, so a retried call gets a fresh budget. Pass 0 to
// disable and rely solely on the caller's context. Defaults to DefaultTimeout.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) {
		if d >= 0 {
			c.timeout = d
		}
	}
}

// WithMaxRetries sets how many times a 429 or 5xx response is retried.
// Pass 0 to disable retries entirely. Defaults to DefaultMaxRetries.
//
// 4xx responses other than 429 are never retried.
func WithMaxRetries(n int) Option {
	return func(c *Client) {
		if n >= 0 {
			c.maxRetries = n
		}
	}
}

// WithBackoff tunes the retry schedule. The delay before retry n is a uniform
// random value in [0, min(max, base*2^n)) — exponential backoff with full
// jitter. A Retry-After header, when the server sends one, wins over this
// schedule. Non-positive values leave the corresponding default in place.
func WithBackoff(base, max time.Duration) Option {
	return func(c *Client) {
		if base > 0 {
			c.baseBackoff = base
		}
		if max > 0 {
			c.maxBackoff = max
		}
	}
}

// WithUserAgent overrides the User-Agent header. The default is
// "fyuz-sdk-go/<version>"; prefer appending to it rather than replacing it so
// the Fyuz team can still identify SDK traffic.
func WithUserAgent(ua string) Option {
	return func(c *Client) {
		if ua != "" {
			c.userAgent = ua
		}
	}
}

// New creates a Client. With no options it targets the production API with a
// 30 second per-attempt timeout and 3 retries.
//
//	client := fyuz.New(fyuz.WithMaxRetries(5))
func New(opts ...Option) *Client {
	c := &Client{
		baseURL:     DefaultBaseURL,
		httpClient:  &http.Client{},
		userAgent:   "fyuz-sdk-go/" + Version,
		timeout:     DefaultTimeout,
		maxRetries:  DefaultMaxRetries,
		baseBackoff: DefaultBaseBackoff,
		maxBackoff:  DefaultMaxBackoff,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(c)
		}
	}
	c.Distributor = &DistributorService{client: c}
	return c
}

// BaseURL returns the API root this client talks to.
func (c *Client) BaseURL() string { return c.baseURL }

// get issues a GET request and decodes the JSON response into out.
func (c *Client) get(ctx context.Context, path string, query url.Values, out any) error {
	return c.do(ctx, http.MethodGet, path, query, nil, out)
}

// post issues a POST request with a JSON body and decodes the response.
func (c *Client) post(ctx context.Context, path string, query url.Values, body, out any) error {
	return c.do(ctx, http.MethodPost, path, query, body, out)
}

// do performs the request with retries and decodes the response into out.
func (c *Client) do(ctx context.Context, method, path string, query url.Values, body, out any) error {
	if ctx == nil {
		return fmt.Errorf("fyuz: nil context")
	}

	endpoint := c.baseURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}

	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			return fmt.Errorf("fyuz: encoding request body for %s %s: %w", method, endpoint, err)
		}
	}

	for attempt := 0; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}

		resp, err := c.attempt(ctx, method, endpoint, payload)
		if err != nil {
			// The caller's context ending is final, never a retry.
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			if attempt < c.maxRetries {
				if werr := c.wait(ctx, c.backoff(attempt, 0)); werr != nil {
					return werr
				}
				continue
			}
			return fmt.Errorf("fyuz: %s %s: %w", method, endpoint, err)
		}

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return decodeAndClose(resp, endpoint, out)
		}

		apiErr := newAPIError(resp, method, endpoint)
		if attempt < c.maxRetries && retryableStatus(resp.StatusCode) {
			if werr := c.wait(ctx, c.backoff(attempt, apiErr.RetryAfter)); werr != nil {
				return werr
			}
			continue
		}
		return apiErr
	}
}

// attempt performs one HTTP round trip, applying the per-attempt timeout.
func (c *Client) attempt(ctx context.Context, method, endpoint string, payload []byte) (*http.Response, error) {
	reqCtx := ctx
	var cancel context.CancelFunc
	if c.timeout > 0 {
		reqCtx, cancel = context.WithTimeout(ctx, c.timeout)
	}

	var reader io.Reader
	if payload != nil {
		reader = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(reqCtx, method, endpoint, reader)
	if err != nil {
		if cancel != nil {
			cancel()
		}
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.userAgent)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		if cancel != nil {
			cancel()
		}
		return nil, err
	}
	if cancel != nil {
		// The body must outlive this function, so the per-attempt deadline is
		// released once the body is closed.
		resp.Body = &cancelOnCloseBody{ReadCloser: resp.Body, cancel: cancel}
	}
	return resp, nil
}

// retryableStatus reports whether a status code is worth retrying. 429 and 5xx
// are transient; every other 4xx is the caller's fault and is returned as-is.
func retryableStatus(code int) bool {
	return code == http.StatusTooManyRequests || code >= 500
}

// backoff computes the delay before the next attempt: exponential growth with
// full jitter, unless the server told us exactly how long to wait.
func (c *Client) backoff(attempt int, retryAfter time.Duration) time.Duration {
	if retryAfter > 0 {
		if retryAfter > maxHonouredRetryAfter {
			return maxHonouredRetryAfter
		}
		return retryAfter
	}
	d := c.baseBackoff
	for i := 0; i < attempt && d < c.maxBackoff; i++ {
		d *= 2
	}
	if d > c.maxBackoff {
		d = c.maxBackoff
	}
	if d <= 0 {
		return 0
	}
	// Full jitter: uniform in [0, d).
	return time.Duration(rand.Int63n(int64(d)))
}

// wait sleeps for d, aborting early if the context ends.
func (c *Client) wait(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// decodeAndClose decodes a successful response body into out and drains the
// remainder so the connection can be reused. endpoint names the request in any
// error; it is passed in rather than read back off resp.Request, which a custom
// RoundTripper is free to leave nil.
func decodeAndClose(resp *http.Response, endpoint string, out any) error {
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		_ = resp.Body.Close()
	}()

	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("fyuz: decoding %s response: %w", endpoint, err)
	}
	return nil
}

// newAPIError builds an *APIError from a failed response, parsing the
// documented {"error": "..."} envelope.
func newAPIError(resp *http.Response, method, endpoint string) *APIError {
	defer func() { _ = resp.Body.Close() }()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))

	apiErr := &APIError{
		StatusCode: resp.StatusCode,
		Method:     method,
		URL:        endpoint,
		Body:       string(raw),
		RetryAfter: parseRetryAfter(resp.Header.Get("Retry-After")),
	}

	var envelope struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &envelope); err == nil {
		switch {
		case envelope.Error != "":
			apiErr.Message = envelope.Error
		case envelope.Message != "":
			apiErr.Message = envelope.Message
		}
	}
	if apiErr.Message == "" {
		apiErr.Message = strings.TrimSpace(string(raw))
	}
	if apiErr.Message == "" {
		apiErr.Message = http.StatusText(resp.StatusCode)
	}
	return apiErr
}

// parseRetryAfter accepts both forms of the header: delay-seconds and an
// HTTP-date. Anything else yields 0.
func parseRetryAfter(v string) time.Duration {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	if secs, err := strconv.ParseFloat(v, 64); err == nil {
		if secs <= 0 {
			return 0
		}
		return time.Duration(secs * float64(time.Second))
	}
	if t, err := http.ParseTime(v); err == nil {
		if d := time.Until(t); d > 0 {
			return d
		}
	}
	return 0
}

// cancelOnCloseBody ties a per-attempt context deadline to the response body's
// lifetime, so the deadline is not released before the body has been read.
type cancelOnCloseBody struct {
	io.ReadCloser
	cancel context.CancelFunc
}

// Close closes the underlying body and releases the attempt's deadline.
func (b *cancelOnCloseBody) Close() error {
	err := b.ReadCloser.Close()
	b.cancel()
	return err
}
