package fyuz

import "context"

// defaultIterPageSize is the page size the iterator asks for when the caller
// did not pick one. Larger than the API default of 20 to cut round trips.
const defaultIterPageSize = 100

// maxServerPageSize is the largest pageSize the API honours: it clamps the
// parameter to 1..100. Asking for more comes back as a page shorter than
// requested, which the iterator would otherwise read as the last page.
const maxServerPageSize = 100

// TokenIterator walks every page of ListTokens, fetching the next page only
// when the current one is exhausted.
//
// It follows the bufio.Scanner idiom: loop on Next, read Token, check Err
// afterwards.
//
//	it := client.IterateTokens(&fyuz.ListTokensOptions{
//		OrderType: "marketcap",
//		OrderFlag: fyuz.SortDesc,
//	})
//	for it.Next(ctx) {
//		t := it.Token()
//		fmt.Println(t.TokenSymbol, t.Marketcap)
//	}
//	if err := it.Err(); err != nil {
//		return err
//	}
//
// A TokenIterator is not safe for concurrent use.
type TokenIterator struct {
	client   *Client
	opts     ListTokensOptions
	page     int64
	pageSize int64

	items   []Token
	idx     int
	current Token

	fetched int64
	total   int64
	started bool
	done    bool
	err     error
}

// IterateTokens returns an iterator that walks every page of the token list
// matching opts. Pass nil for no filters.
//
// PageNumber in opts sets the starting page; PageSize sets the rows per
// request and defaults to 100. The server clamps pageSize to 100, so a larger
// value is capped here rather than sent, which would make every page look
// short and cut the walk off after the first request.
func (c *Client) IterateTokens(opts *ListTokensOptions) *TokenIterator {
	it := &TokenIterator{
		client:   c,
		page:     1,
		pageSize: defaultIterPageSize,
	}
	if opts != nil {
		it.opts = *opts
		if opts.PageNumber != nil && *opts.PageNumber > 0 {
			it.page = *opts.PageNumber
		}
		if opts.PageSize != nil && *opts.PageSize > 0 {
			it.pageSize = *opts.PageSize
			if it.pageSize > maxServerPageSize {
				it.pageSize = maxServerPageSize
			}
		}
	}
	return it
}

// Next advances to the next token, fetching another page when needed. It
// returns false when the list is exhausted or a request failed; check Err to
// tell those apart.
//
// The context bounds each underlying request, so a cancelled context stops the
// walk.
func (it *TokenIterator) Next(ctx context.Context) bool {
	if it.err != nil {
		return false
	}
	for it.idx >= len(it.items) {
		if it.done {
			return false
		}
		if !it.fetch(ctx) {
			return false
		}
	}
	it.current = it.items[it.idx]
	it.idx++
	return true
}

// fetch pulls the next page. It reports whether any items were loaded.
func (it *TokenIterator) fetch(ctx context.Context) bool {
	opts := it.opts
	page := it.page
	size := it.pageSize
	opts.PageNumber = &page
	opts.PageSize = &size

	res, err := it.client.ListTokens(ctx, &opts)
	if err != nil {
		it.err = err
		it.done = true
		return false
	}

	it.started = true
	it.total = res.TokenCount
	it.items = res.TokenList
	it.idx = 0
	it.page++
	it.fetched += int64(len(res.TokenList))

	if len(res.TokenList) == 0 {
		it.done = true
		return false
	}
	// A short page, or having seen every row the server counted, means this
	// was the last page.
	if int64(len(res.TokenList)) < size || (res.TokenCount > 0 && it.fetched >= res.TokenCount) {
		it.done = true
	}
	return true
}

// Token returns the token the last call to Next advanced to. It is only valid
// after Next returned true.
func (it *TokenIterator) Token() Token { return it.current }

// Err returns the error that stopped the walk, or nil if it ran to completion.
func (it *TokenIterator) Err() error { return it.err }

// TotalCount returns the server's count of matching rows, available after the
// first successful fetch and -1 before that.
func (it *TokenIterator) TotalCount() int64 {
	if !it.started {
		return -1
	}
	return it.total
}

// Fetched returns how many tokens have been read from the API so far.
func (it *TokenIterator) Fetched() int64 { return it.fetched }
