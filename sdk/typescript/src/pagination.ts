/**
 * Auto-pagination for `GET /tokens`, the API's one paginated endpoint.
 *
 * The generators here take a page fetcher rather than a client so they stay
 * trivially testable; {@link FyuzClient.iterateTokens} and
 * {@link FyuzClient.iterateTokenPages} are thin wrappers over them.
 *
 * @module
 */

import type { RequestOptions } from './http.js';
import type { Token, TokenPage } from './models/token.js';
import type { ListTokensParams } from './params.js';

/** Page size used when the caller does not pick one. */
export const DEFAULT_PAGE_SIZE = 20;

/** Largest page the API will serve; larger requests are clamped down to this server-side. */
export const MAX_PAGE_SIZE = 100;

/** Fetches one page of tokens — in practice `client.listTokens`. */
export type TokenPageFetcher = (
  params: ListTokensParams,
  options?: RequestOptions,
) => Promise<TokenPage>;

/**
 * Walk the token list page by page, starting at `params.pageNumber` (default 1).
 *
 * Iteration stops on a short page, an empty page, or once `tokenCount` rows have
 * been seen — whichever comes first, so a stale count can never spin forever.
 * Pages are fetched lazily: `break` out of the loop and no further request is made.
 *
 * "Short" is measured against the size of the *first* page the server actually
 * returned, not against the requested `pageSize`: the server clamps `pageSize` to
 * {@link MAX_PAGE_SIZE}, so trusting the request would end iteration after one page
 * whenever the caller asks for more rows than the cap.
 *
 * @internal
 */
export async function* paginateTokenPages(
  fetchPage: TokenPageFetcher,
  params: ListTokensParams = {},
  options?: RequestOptions,
): AsyncGenerator<TokenPage, void, undefined> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  let pageNumber = params.pageNumber ?? 1;
  let seen = 0;
  let effectivePageSize: number | undefined;

  for (;;) {
    const page = await fetchPage({ ...params, pageNumber, pageSize }, options);
    yield page;

    const received = page.tokenList?.length ?? 0;
    effectivePageSize ??= received;
    seen += received;
    if (received === 0 || received < effectivePageSize) return;
    if (typeof page.tokenCount === 'number' && seen >= page.tokenCount) return;
    pageNumber += 1;
  }
}

/**
 * Walk the token list and yield individual tokens, fetching pages as needed.
 *
 * @internal
 */
export async function* paginateTokens(
  fetchPage: TokenPageFetcher,
  params: ListTokensParams = {},
  options?: RequestOptions,
): AsyncGenerator<Token, void, undefined> {
  for await (const page of paginateTokenPages(fetchPage, params, options)) {
    for (const token of page.tokenList ?? []) yield token;
  }
}
