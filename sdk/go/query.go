package fyuz

import (
	"net/url"
	"strconv"
)

// Pointer helpers for optional parameters. Optional numeric and boolean query
// parameters are modelled as pointers so that an explicit zero ("give me
// tokens with at least 0 holders") is distinguishable from "unset".
//
//	opts := &fyuz.DiscoverOptions{MinHolders: fyuz.Int64(0)}

// String returns a pointer to v.
func String(v string) *string { return &v }

// Int64 returns a pointer to v.
func Int64(v int64) *int64 { return &v }

// Float64 returns a pointer to v.
func Float64(v float64) *float64 { return &v }

// Bool returns a pointer to v.
func Bool(v bool) *bool { return &v }

// query accumulates optional query parameters, skipping anything unset.
type query struct {
	values url.Values
}

func newQuery() *query { return &query{values: url.Values{}} }

// str adds a string parameter unless it is empty.
func (q *query) str(key, v string) {
	if v != "" {
		q.values.Set(key, v)
	}
}

// strp adds a string parameter unless the pointer is nil.
func (q *query) strp(key string, v *string) {
	if v != nil {
		q.values.Set(key, *v)
	}
}

// int64p adds an integer parameter unless the pointer is nil.
func (q *query) int64p(key string, v *int64) {
	if v != nil {
		q.values.Set(key, strconv.FormatInt(*v, 10))
	}
}

// float64p adds a number parameter unless the pointer is nil.
func (q *query) float64p(key string, v *float64) {
	if v != nil {
		q.values.Set(key, strconv.FormatFloat(*v, 'f', -1, 64))
	}
}

// boolp adds a boolean parameter unless the pointer is nil.
func (q *query) boolp(key string, v *bool) {
	if v != nil {
		q.values.Set(key, strconv.FormatBool(*v))
	}
}

// int64 adds an integer parameter unconditionally (required parameters).
func (q *query) int64(key string, v int64) {
	q.values.Set(key, strconv.FormatInt(v, 10))
}

// encoded returns the collected parameters, or nil when there are none.
func (q *query) encoded() url.Values {
	if len(q.values) == 0 {
		return nil
	}
	return q.values
}

// escapePath escapes a value for safe interpolation into a URL path segment.
func escapePath(v string) string { return url.PathEscape(v) }
