package fyuz

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

// A JSON-RPC client just large enough to read the bonding curve.
//
// eth_call against a view function is an HTTP POST with a JSON body. That is the
// whole requirement, so this is a file rather than a dependency on go-ethereum.

// DefaultRPCTimeout is the per-call timeout for RPC requests.
const DefaultRPCTimeout = 15 * time.Second

// RPCError is a JSON-RPC level failure: a node error object, a non-2xx status,
// or a body that was not a JSON-RPC response.
type RPCError struct {
	// Method that failed, e.g. "eth_call".
	Method string
	// Code is the JSON-RPC error code, when the node sent a well-formed error.
	Code int
	// Message is the node's text.
	Message string
	// Data is the node's error.data, untouched. For a reverted eth_call this is
	// where the revert payload lives — on the providers that put it there.
	Data json.RawMessage
}

func (e *RPCError) Error() string {
	return fmt.Sprintf("fyuz: RPC %s failed: %s", e.Method, e.Message)
}

// RPCClient is a minimal JSON-RPC transport.
type RPCClient struct {
	url        string
	httpClient *http.Client
	headers    map[string]string
	nextID     atomic.Int64
}

// NewRPCClient builds a JSON-RPC client. A nil httpClient gets one with
// DefaultRPCTimeout.
func NewRPCClient(url string, httpClient *http.Client, headers map[string]string) *RPCClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: DefaultRPCTimeout}
	}
	return &RPCClient{url: url, httpClient: httpClient, headers: headers}
}

// URL is the endpoint this client posts to.
func (c *RPCClient) URL() string { return c.url }

type rpcResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	} `json:"error"`
}

// Request invokes a JSON-RPC method and unmarshals the result into out.
func (c *RPCClient) Request(ctx context.Context, method string, params []any, out any) error {
	payload, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      c.nextID.Add(1),
		"method":  method,
		"params":  params,
	})
	if err != nil {
		return fmt.Errorf("fyuz: encoding RPC %s: %w", method, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("fyuz: building RPC %s: %w", method, err)
	}
	req.Header.Set("Content-Type", "application/json")
	for name, value := range c.headers {
		req.Header.Set(name, value)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("fyuz: RPC %s could not reach %s: %w", method, c.url, err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("fyuz: reading RPC %s response: %w", method, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &RPCError{
			Method:  method,
			Message: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, truncate(string(body), 256)),
		}
	}

	var decoded rpcResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return &RPCError{
			Method:  method,
			Message: fmt.Sprintf("body is not JSON: %s", truncate(string(body), 256)),
		}
	}
	if decoded.Error != nil {
		return &RPCError{
			Method:  method,
			Code:    decoded.Error.Code,
			Message: decoded.Error.Message,
			Data:    decoded.Error.Data,
		}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(decoded.Result, out); err != nil {
		return fmt.Errorf("fyuz: decoding RPC %s result: %w", method, err)
	}
	return nil
}

// CallMsg is the subset of an eth_call message this SDK sends.
type CallMsg struct {
	To   string
	Data string
	// From is the caller address. Some view functions behave differently without one.
	From string
	// Block is a block tag or number. Empty means "latest".
	Block string
}

// CallResult is either return data or revert data.
//
// Reverts are extremely common here — quoting a graduated token reverts by
// design — so they are a return value rather than an error. The caller decides
// what a revert means and builds the error with the right context.
type CallResult struct {
	OK     bool
	Data   string
	Revert string
}

// Call runs eth_call, separating a revert from a transport failure.
func (c *RPCClient) Call(ctx context.Context, msg CallMsg) (CallResult, error) {
	payload := map[string]string{"to": msg.To, "data": msg.Data}
	if msg.From != "" {
		payload["from"] = msg.From
	}
	block := msg.Block
	if block == "" {
		block = "latest"
	}

	var data string
	err := c.Request(ctx, "eth_call", []any{payload, block}, &data)
	if err == nil {
		return CallResult{OK: true, Data: data}, nil
	}

	var rpcErr *RPCError
	if ok := asRPCError(err, &rpcErr); ok {
		if revert, found := extractRevertData(rpcErr); found {
			return CallResult{OK: false, Revert: revert}, nil
		}
	}
	return CallResult{}, err
}

// CallOrError runs eth_call and turns a revert into an error, for calls that
// should never revert.
func (c *RPCClient) CallOrError(ctx context.Context, msg CallMsg, context string) (string, error) {
	result, err := c.Call(ctx, msg)
	if err != nil {
		return "", err
	}
	if !result.OK {
		return "", NewRevertError(result.Revert, context)
	}
	return result.Data, nil
}

func asRPCError(err error, target **RPCError) bool {
	for err != nil {
		if rpcErr, ok := err.(*RPCError); ok {
			*target = rpcErr
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

var hexRunPattern = regexp.MustCompile(`0x[0-9a-fA-F]{8,}`)

// extractRevertData digs the revert payload out of a node error.
//
// Every provider spells this differently: geth puts the hex straight in
// error.data, others nest it as error.data.data, and some drop it into the
// message text and nothing else. All three are tried, in decreasing order of how
// much they can be trusted, before falling back to "0x" — which says "it
// reverted, and this node would not tell us why".
func extractRevertData(err *RPCError) (string, bool) {
	if len(err.Data) > 0 {
		var direct string
		if json.Unmarshal(err.Data, &direct) == nil && strings.HasPrefix(direct, "0x") {
			return direct, true
		}
		var nested struct {
			Data string `json:"data"`
		}
		if json.Unmarshal(err.Data, &nested) == nil && strings.HasPrefix(nested.Data, "0x") {
			return nested.Data, true
		}
	}
	if match := hexRunPattern.FindString(err.Message); match != "" {
		return match, true
	}
	if strings.Contains(strings.ToLower(err.Message), "revert") {
		return "0x", true
	}
	return "", false
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
