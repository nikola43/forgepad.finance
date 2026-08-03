//! The smallest ABI codec that covers this contract, and nothing more.
//!
//! Every argument the Fyuz swap entrypoints take is a static 32-byte word —
//! `address`, `uint256`, `bool` — and so is every value they return. That makes
//! encoding a selector followed by left-padded words, and decoding a walk over
//! fixed offsets. No dynamic types, no head/tail split, no ABI crate.
//!
//! Selectors are **pinned constants**, not computed. Deriving one needs
//! keccak-256, which this crate deliberately does not carry. The values below
//! came from `cast sig` and are asserted against
//! `shared/test-vectors/trade-calldata.json`, so a typo fails the test suite
//! rather than sending a transaction to the wrong function.
//!
//! # Why a hand-rolled [`U256`]
//!
//! `u128` is not enough. An ERC-20 `allowance` is `2^256 - 1` for every wallet
//! that has ever approved unlimited spending — the common case — and a `u128`
//! decoder would fail on the most ordinary value there is. [`U256`] is a
//! big-endian `[u8; 32]` with just the four operations this crate performs:
//! parse, format, add/sub, and multiply-then-divide by a small factor for
//! slippage.

use std::cmp::Ordering;
use std::fmt;

use crate::Error;

/// `swapExactETHForTokens(address,uint256,uint256,uint256)`
pub const SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS: &str = "0x6bf05b01";
/// `swapETHForExactTokens(address,uint256,uint256,uint256)`
pub const SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS: &str = "0x0541a872";
/// `swapExactTokensForETH(address,uint256,uint256,uint256)`
pub const SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH: &str = "0xeacad12a";
/// `getSwapOutput(address,uint256,bool)`
pub const SELECTOR_GET_SWAP_OUTPUT: &str = "0x908235cc";
/// `getFirstBuyFee(address)`
pub const SELECTOR_GET_FIRST_BUY_FEE: &str = "0xb3cd4902";
/// `getMaxSellableETH(address)`
pub const SELECTOR_GET_MAX_SELLABLE_ETH: &str = "0x82bfb367";
/// `tokenPools(address)`
pub const SELECTOR_TOKEN_POOLS: &str = "0xc3d2c3c1";
/// `approve(address,uint256)`
pub const SELECTOR_APPROVE: &str = "0x095ea7b3";
/// `allowance(address,address)`
pub const SELECTOR_ALLOWANCE: &str = "0xdd62ed3e";
/// `balanceOf(address)`
pub const SELECTOR_BALANCE_OF: &str = "0x70a08231";

fn invalid(message: impl Into<String>) -> Error {
    Error::InvalidArgument {
        message: message.into(),
    }
}

/// A 256-bit unsigned integer, stored big-endian.
///
/// Only the operations this crate needs are implemented. It is not a
/// general-purpose numeric type and makes no attempt to be one — reach for
/// `primitive-types` or `ruint` if you need arithmetic beyond this.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct U256([u8; 32]);

impl U256 {
    /// Zero.
    pub const ZERO: U256 = U256([0u8; 32]);

    /// `2^256 - 1`, the unlimited-approval amount.
    pub const MAX: U256 = U256([0xffu8; 32]);

    /// From a small value.
    pub fn from_u64(value: u64) -> Self {
        let mut bytes = [0u8; 32];
        bytes[24..].copy_from_slice(&value.to_be_bytes());
        U256(bytes)
    }

    /// From its big-endian bytes.
    pub fn from_be_bytes(bytes: [u8; 32]) -> Self {
        U256(bytes)
    }

    /// Its big-endian bytes.
    pub fn to_be_bytes(self) -> [u8; 32] {
        self.0
    }

    /// Whether this is zero.
    pub fn is_zero(self) -> bool {
        self.0.iter().all(|&byte| byte == 0)
    }

    /// Parse a base-10 string.
    ///
    /// Rejects anything with a decimal point: a caller passing `"0.5"` means
    /// whole units, not wei, and silently reading that as zero would build a
    /// transaction that buys nothing. Use [`parse_units`] for the conversion.
    pub fn from_dec_str(name: &str, value: &str) -> Result<Self, Error> {
        if value.is_empty() {
            return Err(invalid(format!("{name} must not be empty")));
        }
        if value.contains('.') {
            return Err(invalid(format!(
                "{name} must be a whole amount in wei, got {value:?} — decimal input \
                 looks like whole units, convert it with parse_units first"
            )));
        }

        let mut acc = U256::ZERO;
        for character in value.chars() {
            let digit = character
                .to_digit(10)
                .ok_or_else(|| invalid(format!("{name} must be base-10 digits, got {value:?}")))?;
            acc = acc
                .mul_small(10)
                .and_then(|scaled| scaled.add_small(digit))
                .ok_or_else(|| invalid(format!("{name} exceeds uint256")))?;
        }
        Ok(acc)
    }

    /// Parse one 64-character hex word.
    pub fn from_hex_word(word: &str) -> Result<Self, Error> {
        let trimmed = word.strip_prefix("0x").unwrap_or(word);
        if trimmed.len() != 64 {
            return Err(invalid(format!(
                "expected a 32-byte word, got {} hex characters",
                trimmed.len()
            )));
        }
        let mut bytes = [0u8; 32];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&trimmed[index * 2..index * 2 + 2], 16)
                .map_err(|_| invalid(format!("word is not valid hex: {word}")))?;
        }
        Ok(U256(bytes))
    }

    /// Render as one 64-character hex word, ready to concatenate into calldata.
    pub fn to_hex_word(self) -> String {
        self.0.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    /// `self + other`, or `None` on overflow.
    pub fn checked_add(self, other: Self) -> Option<Self> {
        let mut out = [0u8; 32];
        let mut carry = 0u16;
        for index in (0..32).rev() {
            let sum = u16::from(self.0[index]) + u16::from(other.0[index]) + carry;
            out[index] = sum as u8;
            carry = sum >> 8;
        }
        (carry == 0).then_some(U256(out))
    }

    /// `self - other`, or `None` when it would go negative.
    pub fn checked_sub(self, other: Self) -> Option<Self> {
        let mut out = [0u8; 32];
        let mut borrow = 0i16;
        for index in (0..32).rev() {
            let diff = i16::from(self.0[index]) - i16::from(other.0[index]) - borrow;
            if diff < 0 {
                out[index] = (diff + 256) as u8;
                borrow = 1;
            } else {
                out[index] = diff as u8;
                borrow = 0;
            }
        }
        (borrow == 0).then_some(U256(out))
    }

    /// `self * factor`, or `None` on overflow.
    pub fn mul_small(self, factor: u32) -> Option<Self> {
        let mut out = [0u8; 32];
        let mut carry = 0u64;
        for index in (0..32).rev() {
            let product = u64::from(self.0[index]) * u64::from(factor) + carry;
            out[index] = product as u8;
            carry = product >> 8;
        }
        (carry == 0).then_some(U256(out))
    }

    /// `self + digit`, or `None` on overflow.
    fn add_small(self, digit: u32) -> Option<Self> {
        self.checked_add(U256::from_u64(u64::from(digit)))
    }

    /// `(self / divisor, self % divisor)`. Panics only on a zero divisor, which
    /// is never reachable from this crate's call sites.
    pub fn div_rem_small(self, divisor: u32) -> (Self, u32) {
        assert!(divisor != 0, "division by zero");
        let mut out = [0u8; 32];
        let mut remainder = 0u64;
        for (slot, &byte) in out.iter_mut().zip(self.0.iter()) {
            let current = (remainder << 8) | u64::from(byte);
            *slot = (current / u64::from(divisor)) as u8;
            remainder = current % u64::from(divisor);
        }
        (U256(out), remainder as u32)
    }
}

impl fmt::Display for U256 {
    /// Base-10, exactly. This is the representation to log and to hand onward.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_zero() {
            return f.write_str("0");
        }
        let mut digits = Vec::new();
        let mut value = *self;
        while !value.is_zero() {
            let (quotient, remainder) = value.div_rem_small(10);
            digits.push(b'0' + remainder as u8);
            value = quotient;
        }
        digits.reverse();
        f.write_str(&String::from_utf8(digits).expect("ascii digits"))
    }
}

impl PartialOrd for U256 {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for U256 {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.cmp(&other.0)
    }
}

/// Validate an EVM address and return it lower-cased.
///
/// EIP-55 checksums are accepted but not verified: confirming one needs
/// keccak-256, and the encoded word is identical either way. What is checked is
/// the part that can actually corrupt a transaction — that the value is 20 hex
/// bytes and not, say, a token symbol or a truncated paste.
pub fn normalize_address(name: &str, value: &str) -> Result<String, Error> {
    let body = value.strip_prefix("0x").ok_or_else(|| {
        invalid(format!(
            "{name} must be a 0x-prefixed 20-byte address, got {value:?}"
        ))
    })?;
    if body.len() != 40 || !body.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(invalid(format!(
            "{name} must be a 0x-prefixed 20-byte address, got {value:?}"
        )));
    }
    Ok(value.to_ascii_lowercase())
}

/// Whole units to the smallest unit — `"0.5"` BNB to `500000000000000000` wei.
///
/// String in, [`U256`] out, with no float anywhere in between: `0.1 * 1e18` in
/// `f64` gives `100000000000000000` on a good day and `99999999999999998` on a
/// bad one.
pub fn parse_units(value: &str, decimals: u32) -> Result<U256, Error> {
    let (whole, fraction) = match value.split_once('.') {
        Some((whole, fraction)) => (whole, fraction),
        None => (value, ""),
    };
    if fraction.len() > decimals as usize {
        return Err(invalid(format!(
            "amount {value:?} has {} decimal places, more than the {decimals} this token \
             carries — the extra digits would be silently truncated",
            fraction.len()
        )));
    }
    if !whole.chars().all(|c| c.is_ascii_digit())
        || !fraction.chars().all(|c| c.is_ascii_digit())
        || (whole.is_empty() && fraction.is_empty())
    {
        return Err(invalid(format!(
            "amount must be a non-negative decimal string, got {value:?}"
        )));
    }

    let padded = format!(
        "{}{}{}",
        if whole.is_empty() { "0" } else { whole },
        fraction,
        "0".repeat(decimals as usize - fraction.len())
    );
    U256::from_dec_str("amount", &padded)
}

/// The smallest unit back to whole units, exactly. Inverse of [`parse_units`].
pub fn format_units(value: U256, decimals: u32) -> String {
    // Done on the decimal digits rather than by dividing: the split point is
    // just a string offset once the value is base-10, and that avoids a second
    // big-integer division path to get wrong.
    let digits = value.to_string();
    let decimals = decimals as usize;

    let (whole, fraction) = if digits.len() > decimals {
        digits.split_at(digits.len() - decimals)
    } else {
        ("0", digits.as_str())
    };

    let padded = format!(
        "{}{}",
        "0".repeat(decimals.saturating_sub(fraction.len())),
        fraction
    );
    let trimmed = padded.trim_end_matches('0');

    if trimmed.is_empty() {
        whole.to_string()
    } else {
        format!("{whole}.{trimmed}")
    }
}

/// An `address` as one 64-character word: 12 zero bytes then the 20 address bytes.
pub fn address_word(address: &str) -> String {
    let body = address.strip_prefix("0x").unwrap_or(address);
    format!("{:0>64}", body.to_ascii_lowercase())
}

/// A `uint256` as one 64-character word.
pub fn uint256_word(value: U256) -> String {
    value.to_hex_word()
}

/// A `bool` as one 64-character word.
pub fn bool_word(value: bool) -> String {
    U256::from_u64(u64::from(value)).to_hex_word()
}

/// Selector plus words, as `0x`-prefixed calldata.
pub fn encode_call(selector: &str, words: &[String]) -> String {
    let mut out = String::from(selector);
    for word in words {
        out.push_str(word);
    }
    out
}

/// Strip `0x` and reject anything that is not whole bytes of hex.
fn hex_body(data: &str) -> Result<&str, Error> {
    let body = data.strip_prefix("0x").unwrap_or(data);
    if body.len() % 2 != 0 || !body.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(invalid(format!("expected hex data, got {data:?}")));
    }
    Ok(body)
}

/// Read the `index`-th 32-byte word of a return payload as a `uint256`.
///
/// Errors on a short payload rather than yielding zero. A truncated response and
/// a genuine zero are very different answers to "how many tokens do I get", and
/// only one of them should let a transaction get built.
pub fn decode_uint256_at(data: &str, index: usize) -> Result<U256, Error> {
    let body = hex_body(data)?;
    let start = index * 64;
    if body.len() < start + 64 {
        return Err(invalid(format!(
            "response has {} words, expected at least {}",
            body.len() / 64,
            index + 1
        )));
    }
    U256::from_hex_word(&body[start..start + 64])
}

/// Read the `index`-th word as a `bool`. Any non-zero word is `true`.
pub fn decode_bool_at(data: &str, index: usize) -> Result<bool, Error> {
    Ok(!decode_uint256_at(data, index)?.is_zero())
}

/// Read the `index`-th word as an `address`, lower-cased.
pub fn decode_address_at(data: &str, index: usize) -> Result<String, Error> {
    let word = decode_uint256_at(data, index)?.to_hex_word();
    Ok(format!("0x{}", &word[24..]))
}
