//! Turning revert data into something a caller can act on.
//!
//! A reverted `eth_call` comes back as a bare 4-byte selector — `0xcfa6d878`
//! and nothing else. The mapping from that to "the token graduated, trade the
//! DEX pair" exists nowhere on-chain and is not in the ABI the API serves, so
//! the table below is it. It mirrors `shared/test-vectors/trade-errors.json`,
//! which the test suite asserts against.

use crate::Error;

/// How a contract revert was classified.
///
/// The string forms match `surfaced_as` in the shared fixture, so the four SDKs
/// can be checked against one table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum RevertKind {
    /// The token left the bonding curve; the curve is closed.
    Graduated,
    /// No curve exists for this token on this chain.
    NoPool,
    /// The price moved past `minAmountOut`.
    Slippage,
    /// The deadline passed before the transaction was mined.
    Expired,
    /// The trade would move the curve further than the contract allows.
    PriceImpact,
    /// The sell exceeds `MAX_SELL_PERCENT` of the virtual reserve.
    SellTooLarge,
    /// `msg.value` was below `buyAmount + getFirstBuyFee(token)`.
    InsufficientValue,
    /// The wallet does not hold enough of the token.
    InsufficientBalance,
    /// The input rounds down to zero output.
    InsufficientInput,
    /// The curve cannot fill this trade.
    InsufficientLiquidity,
    /// The amount must be greater than zero.
    ZeroAmount,
    /// The BNB/USD feed is stale or unavailable.
    StaleFeed,
    /// Trading is paused on the contract.
    Paused,
    /// A classic `require(cond, "msg")` revert.
    RevertString,
    /// A selector this SDK version does not know.
    Unknown,
}

impl RevertKind {
    /// The `surfaced_as` string used in the shared fixture.
    pub fn as_str(self) -> &'static str {
        match self {
            RevertKind::Graduated => "graduated",
            RevertKind::NoPool => "no_pool",
            RevertKind::Slippage => "slippage",
            RevertKind::Expired => "expired",
            RevertKind::PriceImpact => "price_impact",
            RevertKind::SellTooLarge => "sell_too_large",
            RevertKind::InsufficientValue => "insufficient_value",
            RevertKind::InsufficientBalance => "insufficient_balance",
            RevertKind::InsufficientInput => "insufficient_input",
            RevertKind::InsufficientLiquidity => "insufficient_liquidity",
            RevertKind::ZeroAmount => "zero_amount",
            RevertKind::StaleFeed => "stale_feed",
            RevertKind::Paused => "paused",
            RevertKind::RevertString => "revert_string",
            RevertKind::Unknown => "unknown",
        }
    }
}

/// `AlreadyLaunched()` — the graduated-token revert.
pub const SELECTOR_ALREADY_LAUNCHED: &str = "0xcfa6d878";

const SELECTOR_ERROR_STRING: &str = "0x08c379a0";
const SELECTOR_PANIC: &str = "0x4e487b71";

/// selector, Solidity name, classification, message, retryable.
const REVERTS: &[(&str, &str, RevertKind, &str, bool)] = &[
    (
        SELECTOR_ALREADY_LAUNCHED,
        "AlreadyLaunched()",
        RevertKind::Graduated,
        "The token graduated: the bonding curve is closed and every swap entrypoint reverts. \
         Trade the DEX pair instead.",
        false,
    ),
    (
        "0x9c8787c0",
        "PoolDoesNotExist()",
        RevertKind::NoPool,
        "No bonding curve exists for this token on this chain — check the address and the network.",
        false,
    ),
    (
        "0x8199f5f3",
        "SlippageExceeded()",
        RevertKind::Slippage,
        "The price moved past minAmountOut before the transaction landed. Re-quote and retry, \
         or widen the slippage tolerance.",
        true,
    ),
    (
        "0x2b32713d",
        "SwapExpired()",
        RevertKind::Expired,
        "The deadline passed before the transaction was mined. Rebuild with a later deadline.",
        true,
    ),
    (
        "0xe96d2afe",
        "MaxPriceImpactExceeded()",
        RevertKind::PriceImpact,
        "The trade would move the curve further than the contract allows. Split it into \
         smaller trades.",
        false,
    ),
    (
        "0x9bca8aec",
        "SellAmountTooLarge()",
        RevertKind::SellTooLarge,
        "The sell exceeds MAX_SELL_PERCENT of the virtual token reserve. Sell less, or in \
         several transactions.",
        false,
    ),
    (
        "0x1985c735",
        "InsufficientEthValue()",
        RevertKind::InsufficientValue,
        "msg.value was below buyAmount + getFirstBuyFee(token). The fee is not optional and \
         is not deducted from buyAmount.",
        false,
    ),
    (
        "0xe4455cae",
        "InsufficientTokenBalance()",
        RevertKind::InsufficientBalance,
        "The wallet does not hold enough of the token to cover this sell.",
        false,
    ),
    (
        "0xf8b3bb61",
        "InsufficientInput()",
        RevertKind::InsufficientInput,
        "The input amount rounds down to zero output on the curve. Trade a larger amount.",
        false,
    ),
    (
        "0xbb55fd27",
        "InsufficientLiquidity()",
        RevertKind::InsufficientLiquidity,
        "The curve does not hold enough of the other side to fill this trade.",
        false,
    ),
    (
        "0x1f2a2005",
        "ZeroAmount()",
        RevertKind::ZeroAmount,
        "The amount must be greater than zero.",
        false,
    ),
    (
        "0x1087e109",
        "StalePriceFeed()",
        RevertKind::StaleFeed,
        "The BNB/USD feed is stale or unavailable, so the contract cannot price this call.",
        true,
    ),
    (
        "0xd93c0665",
        "EnforcedPause()",
        RevertKind::Paused,
        "Trading is paused on the contract.",
        true,
    ),
];

/// The first four bytes of some revert data, lower-cased, or `None`.
pub fn revert_selector(data: &str) -> Option<String> {
    let body = data.strip_prefix("0x").unwrap_or(data);
    (body.len() >= 8).then(|| format!("0x{}", body[..8].to_ascii_lowercase()))
}

/// The reason out of an `Error(string)` payload, when that is what this is.
fn decode_revert_string(data: &str) -> Option<String> {
    let body = data.strip_prefix("0x").unwrap_or(data);
    // selector + offset word + length word, then the bytes themselves.
    if body.len() < 8 + 128 {
        return None;
    }
    let length = usize::from_str_radix(body.get(72..136)?.trim_start_matches('0'), 16).ok()?;
    let end = 136 + length * 2;
    let chars = body.get(136..end)?;

    let bytes: Option<Vec<u8>> = (0..chars.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&chars[i..i + 2], 16).ok())
        .collect();
    Some(String::from_utf8_lossy(&bytes?).into_owned())
}

/// Classify revert data into a typed [`Error::ContractRevert`].
///
/// An unrecognised selector is reported verbatim rather than swallowed — a later
/// contract version will add errors this table does not know about, and having
/// `0xdeadbeef` in the message is at least something to search for.
pub fn revert_error(data: &str, context: &str) -> Error {
    let raw = if data.is_empty() { "0x" } else { data };

    let Some(selector) = revert_selector(raw) else {
        return Error::ContractRevert {
            kind: RevertKind::Unknown,
            message: format!(
                "{context} reverted, and the node returned no revert data. Some providers \
                 strip it; retry against a node that preserves it to learn why."
            ),
            error_name: None,
            selector: None,
            data: raw.to_string(),
            retryable: false,
            token_address: None,
        };
    };

    if selector == SELECTOR_ERROR_STRING {
        let reason = decode_revert_string(raw)
            .unwrap_or_else(|| "Error(string) with an undecodable reason".to_string());
        return Error::ContractRevert {
            kind: RevertKind::RevertString,
            message: format!("{context} reverted: {reason}"),
            error_name: Some("Error(string)".to_string()),
            selector: Some(selector),
            data: raw.to_string(),
            retryable: false,
            token_address: None,
        };
    }

    if selector == SELECTOR_PANIC {
        return Error::ContractRevert {
            kind: RevertKind::Unknown,
            message: format!(
                "{context} hit a Solidity panic — that is a contract bug, not a bad argument."
            ),
            error_name: Some("Panic(uint256)".to_string()),
            selector: Some(selector),
            data: raw.to_string(),
            retryable: false,
            token_address: None,
        };
    }

    match REVERTS.iter().find(|(sel, ..)| *sel == selector) {
        None => Error::ContractRevert {
            kind: RevertKind::Unknown,
            message: format!(
                "{context} reverted with the unrecognised selector {selector}. This SDK \
                 version does not know that error; check the contract for a newer one."
            ),
            error_name: None,
            selector: Some(selector),
            data: raw.to_string(),
            retryable: false,
            token_address: None,
        },
        Some((_, name, kind, message, retryable)) => Error::ContractRevert {
            kind: *kind,
            message: format!("{context} reverted: {message}"),
            error_name: Some((*name).to_string()),
            selector: Some(selector),
            data: raw.to_string(),
            retryable: *retryable,
            token_address: None,
        },
    }
}

/// The error returned when a token has left the curve.
///
/// The SDK refuses to build a transaction for such a token rather than let the
/// caller pay gas to discover the same thing.
pub fn graduated_error(token: &str, pair: Option<&str>) -> Error {
    let where_to = match pair {
        None => "Trade its DEX pair instead.".to_string(),
        Some(pair) => format!("Trade the DEX pair {pair} instead."),
    };
    Error::ContractRevert {
        kind: RevertKind::Graduated,
        message: format!(
            "{token} has graduated: the bonding curve is closed and every swap reverts. {where_to}"
        ),
        error_name: Some("AlreadyLaunched()".to_string()),
        selector: Some(SELECTOR_ALREADY_LAUNCHED.to_string()),
        data: SELECTOR_ALREADY_LAUNCHED.to_string(),
        retryable: false,
        token_address: Some(token.to_string()),
    }
}
