//! Auto-pagination for `GET /tokens`.

use std::collections::VecDeque;

use crate::client::FyuzClient;
use crate::error::Result;
use crate::models::Token;
use crate::params::ListTokensParams;

/// Walks every page of `GET /tokens`, one request at a time.
///
/// Built with [`FyuzClient::token_pages`]. The pager starts at the page in the
/// [`ListTokensParams`] it was given (or page 1) and stops as soon as the
/// server's `tokenCount` is covered or a page comes back empty — so it
/// terminates even if the total shifts while you are walking it.
///
/// This is a plain async iterator rather than a `futures::Stream`: the crate
/// has no `futures` dependency, and `while let Some(..) = pager.next_*().await?`
/// reads the same.
///
/// ```no_run
/// # async fn demo() -> Result<(), fyuz::Error> {
/// use fyuz::{FyuzClient, ListTokensParams, SortDirection};
///
/// let client = FyuzClient::new()?;
/// let mut pager = client.token_pages(
///     &ListTokensParams::new()
///         .order_type("marketcap")
///         .order_flag(SortDirection::Desc)
///         .page_size(100),
/// );
///
/// // Page at a time…
/// while let Some(page) = pager.next_page().await? {
///     println!("{} tokens (of {:?} total)", page.len(), pager.total_count());
/// }
/// # Ok(())
/// # }
/// ```
///
/// ```no_run
/// # async fn demo() -> Result<(), fyuz::Error> {
/// # use fyuz::{FyuzClient, ListTokensParams};
/// # let client = FyuzClient::new()?;
/// // …or token at a time, with paging handled underneath.
/// let mut pager = client.token_pages(&ListTokensParams::new());
/// while let Some(token) = pager.next_token().await? {
///     println!("{}", token.token_symbol);
/// }
/// # Ok(())
/// # }
/// ```
#[derive(Debug)]
pub struct TokenPager {
    client: FyuzClient,
    params: ListTokensParams,
    next_page_number: i64,
    fetched: i64,
    total: Option<i64>,
    buffer: VecDeque<Token>,
    exhausted: bool,
}

impl TokenPager {
    pub(crate) fn new(client: FyuzClient, params: ListTokensParams) -> Self {
        let next_page_number = params.page_number.unwrap_or(1).max(1);
        Self {
            client,
            params,
            next_page_number,
            fetched: 0,
            total: None,
            buffer: VecDeque::new(),
            exhausted: false,
        }
    }

    /// Total matching rows, as reported by the last page fetched. `None` before
    /// the first request.
    pub fn total_count(&self) -> Option<i64> {
        self.total
    }

    /// Rows yielded so far.
    pub fn fetched_count(&self) -> i64 {
        self.fetched
    }

    /// Fetch the next page. Returns `None` once every page has been walked.
    pub async fn next_page(&mut self) -> Result<Option<Vec<Token>>> {
        if self.exhausted {
            return Ok(None);
        }

        let params = self.params.clone().page_number(self.next_page_number);
        let page = self.client.list_tokens(&params).await?;

        self.total = Some(page.token_count);
        self.next_page_number += 1;
        self.fetched += page.token_list.len() as i64;

        if page.token_list.is_empty() {
            self.exhausted = true;
            return Ok(None);
        }

        if self.fetched >= page.token_count {
            self.exhausted = true;
        }

        Ok(Some(page.token_list))
    }

    /// Yield the next token, fetching a page whenever the buffer runs dry.
    pub async fn next_token(&mut self) -> Result<Option<Token>> {
        loop {
            if let Some(token) = self.buffer.pop_front() {
                return Ok(Some(token));
            }
            match self.next_page().await? {
                Some(page) => self.buffer.extend(page),
                None => return Ok(None),
            }
        }
    }

    /// Walk every remaining page and collect the lot.
    ///
    /// Bounded by the server's `tokenCount`; on a busy deployment that is still
    /// thousands of rows and dozens of requests, so prefer
    /// [`next_page`](Self::next_page) if you can stream instead.
    pub async fn collect_all(&mut self) -> Result<Vec<Token>> {
        let mut all = Vec::new();
        all.extend(self.buffer.drain(..));
        while let Some(page) = self.next_page().await? {
            all.extend(page);
        }
        Ok(all)
    }
}
