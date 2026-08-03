package fyuz

import (
	"errors"
	"fmt"
	"net/http"
	"time"
)

// Sentinel errors for the API failure modes worth branching on. Match them
// with errors.Is against any error returned by this package.
var (
	// ErrRateLimited matches an *APIError with HTTP status 429. The API allows
	// 120 requests per minute per client IP. The client already retries 429
	// responses with exponential backoff, so seeing this error means the
	// retries were exhausted (or WithMaxRetries(0) disabled them).
	ErrRateLimited = errors.New("fyuz: rate limited")

	// ErrNotFound matches an *APIError with HTTP status 404, returned for an
	// unknown token, profile or distributor round.
	ErrNotFound = errors.New("fyuz: not found")

	// ErrBadRequest matches an *APIError with HTTP status 400, returned when a
	// parameter is malformed (for example a shares window whose `to` is not
	// after its `from`).
	ErrBadRequest = errors.New("fyuz: bad request")

	// ErrServer matches an *APIError with any 5xx status.
	ErrServer = errors.New("fyuz: server error")
)

// APIError is returned for every non-2xx HTTP response. It carries the status
// code and the message from the API's {"error": "..."} envelope.
//
//	var apiErr *fyuz.APIError
//	if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusTooManyRequests {
//		time.Sleep(apiErr.RetryAfter)
//	}
type APIError struct {
	// StatusCode is the HTTP status of the response.
	StatusCode int

	// Message is the server-supplied explanation, taken from the JSON
	// {"error": "..."} envelope. Falls back to the HTTP status text when the
	// body is empty or is not the documented envelope.
	Message string

	// Method is the HTTP method of the failed request, e.g. "GET".
	Method string

	// URL is the full URL of the failed request.
	URL string

	// RetryAfter is the parsed Retry-After header, or zero when absent. It is
	// parsed for every non-2xx status, not just 429: a 503 from a draining load
	// balancer carries it just as often, and the retry loop honours it there too.
	RetryAfter time.Duration

	// Body is the raw response body, truncated to 1 MiB. Useful when the
	// server returned something other than the documented error envelope.
	Body string
}

// Error implements the error interface.
func (e *APIError) Error() string {
	return fmt.Sprintf("fyuz: %s %s: %d %s", e.Method, e.URL, e.StatusCode, e.Message)
}

// Is reports whether this error matches one of the package sentinels, so that
// errors.Is(err, fyuz.ErrRateLimited) works without type assertions.
func (e *APIError) Is(target error) bool {
	switch target {
	case ErrRateLimited:
		return e.StatusCode == http.StatusTooManyRequests
	case ErrNotFound:
		return e.StatusCode == http.StatusNotFound
	case ErrBadRequest:
		return e.StatusCode == http.StatusBadRequest
	case ErrServer:
		return e.StatusCode >= 500
	}
	return false
}

// RateLimited reports whether this error is a 429.
func (e *APIError) RateLimited() bool { return e.StatusCode == http.StatusTooManyRequests }

// IsRateLimited reports whether err is (or wraps) a 429 response.
func IsRateLimited(err error) bool { return errors.Is(err, ErrRateLimited) }

// IsNotFound reports whether err is (or wraps) a 404 response.
func IsNotFound(err error) bool { return errors.Is(err, ErrNotFound) }
