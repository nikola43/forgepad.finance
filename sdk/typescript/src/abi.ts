/**
 * The smallest ABI codec that covers this contract, and nothing more.
 *
 * Every argument the Fyuz swap entrypoints take is a static 32-byte word —
 * `address`, `uint256`, `bool` — and every value they return is too. That makes
 * encoding a selector followed by left-padded words, and decoding a walk over
 * fixed offsets. No dynamic types, no head/tail split, no ABI library.
 *
 * Selectors are **pinned constants**, not computed. Deriving one needs
 * keccak-256, which Node does not ship: `crypto.createHash('sha3-256')` is the
 * FIPS variant and produces a different digest from Ethereum's Keccak-256. The
 * values below came from `cast sig` and are asserted against
 * `shared/test-vectors/trade-calldata.json`, so a typo fails the test suite
 * rather than sending a transaction to the wrong function.
 *
 * @module
 */

import { FyuzInvalidArgumentError } from './errors.js';

/** `swapExactETHForTokens(address,uint256,uint256,uint256)` */
export const SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS = '0x6bf05b01';
/** `swapETHForExactTokens(address,uint256,uint256,uint256)` */
export const SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS = '0x0541a872';
/** `swapExactTokensForETH(address,uint256,uint256,uint256)` */
export const SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH = '0xeacad12a';
/** `getSwapOutput(address,uint256,bool)` */
export const SELECTOR_GET_SWAP_OUTPUT = '0x908235cc';
/** `getFirstBuyFee(address)` */
export const SELECTOR_GET_FIRST_BUY_FEE = '0xb3cd4902';
/** `getMaxSellableETH(address)` */
export const SELECTOR_GET_MAX_SELLABLE_ETH = '0x82bfb367';
/** `tokenPools(address)` */
export const SELECTOR_TOKEN_POOLS = '0xc3d2c3c1';
/** `approve(address,uint256)` */
export const SELECTOR_APPROVE = '0x095ea7b3';
/** `allowance(address,address)` */
export const SELECTOR_ALLOWANCE = '0xdd62ed3e';
/** `balanceOf(address)` */
export const SELECTOR_BALANCE_OF = '0x70a08231';

/** `2^256 - 1`, the unlimited-approval amount. */
export const UINT256_MAX = (1n << 256n) - 1n;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Validate an EVM address and return it lower-cased.
 *
 * EIP-55 checksums are accepted but not verified: confirming one needs
 * keccak-256, and the encoded word is identical either way. What is checked is
 * the part that can actually corrupt a transaction — that the value is 20 hex
 * bytes and not, say, a token symbol or a truncated paste.
 */
export function normalizeAddress(name: string, value: unknown): string {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) {
    throw new FyuzInvalidArgumentError(
      `${name} must be a 0x-prefixed 20-byte address, got ${JSON.stringify(value)}`,
    );
  }
  return value.toLowerCase();
}

/**
 * Parse a base-10 amount in the smallest unit (wei) into a bigint.
 *
 * Deliberately refuses anything with a decimal point. A caller passing `"0.5"`
 * means BNB, not wei, and silently reading that as 0 wei would build a
 * transaction that buys nothing — see {@link parseUnits} for the conversion.
 */
export function parseWeiAmount(name: string, value: string | bigint): bigint {
  let parsed: bigint;
  if (typeof value === 'bigint') {
    parsed = value;
  } else {
    if (!/^\d+$/.test(value)) {
      throw new FyuzInvalidArgumentError(
        `${name} must be a whole amount in wei as a base-10 string, got ${JSON.stringify(value)}` +
          (typeof value === 'string' && value.includes('.')
            ? ' — decimal input looks like whole units; convert it with parseUnits() first'
            : ''),
      );
    }
    parsed = BigInt(value);
  }
  if (parsed < 0n) throw new FyuzInvalidArgumentError(`${name} must not be negative`);
  if (parsed > UINT256_MAX) throw new FyuzInvalidArgumentError(`${name} exceeds uint256`);
  return parsed;
}

/**
 * Whole units to the smallest unit — `"0.5"` BNB to `"500000000000000000"` wei.
 *
 * String in, string out, with no float anywhere in between: `Number("0.1") * 1e18`
 * gives `100000000000000000` on a good day and `99999999999999998` on a bad one.
 */
export function parseUnits(value: string, decimals = 18): string {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new FyuzInvalidArgumentError(
      `amount must be a non-negative decimal string, got ${JSON.stringify(value)}`,
    );
  }
  const [whole = '0', fraction = ''] = value.split('.');
  if (fraction.length > decimals) {
    throw new FyuzInvalidArgumentError(
      `amount has ${fraction.length} decimal places, more than the ${decimals} this token carries — ` +
        'the extra digits would be silently truncated',
    );
  }
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0'))
    .toString();
}

/** The smallest unit back to whole units, exactly. Inverse of {@link parseUnits}. */
export function formatUnits(wei: string | bigint, decimals = 18): string {
  const value = typeof wei === 'bigint' ? wei : parseWeiAmount('wei', wei);
  const base = 10n ** BigInt(decimals);
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${value / base}.${fraction}` : `${value / base}`;
}

/** A `uint256` as one 64-character word. */
export function uint256Word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

/** An `address` as one 64-character word: 12 zero bytes then the 20 address bytes. */
export function addressWord(address: string): string {
  return address.slice(2).toLowerCase().padStart(64, '0');
}

/** A `bool` as one 64-character word. */
export function boolWord(value: boolean): string {
  return (value ? 1n : 0n).toString(16).padStart(64, '0');
}

/** Selector plus words, as `0x`-prefixed calldata. */
export function encodeCall(selector: string, words: readonly string[]): string {
  return selector + words.join('');
}

/** Strip `0x` and reject anything that is not whole bytes of hex. */
function hexBody(data: string): string {
  const body = data.startsWith('0x') || data.startsWith('0X') ? data.slice(2) : data;
  if (body.length % 2 !== 0 || (body.length > 0 && !/^[0-9a-fA-F]+$/.test(body))) {
    throw new FyuzInvalidArgumentError(`expected hex data, got ${JSON.stringify(data)}`);
  }
  return body;
}

/**
 * Read the `index`-th 32-byte word of a return payload as a `uint256`.
 *
 * Throws when the payload is short rather than returning `0n`. A truncated
 * response and a genuine zero are very different answers to "how many tokens do
 * I get", and only one of them should let a transaction get built.
 */
export function decodeUint256At(data: string, index: number): bigint {
  const body = hexBody(data);
  const start = index * 64;
  if (body.length < start + 64) {
    throw new FyuzInvalidArgumentError(
      `response has ${Math.floor(body.length / 64)} words, expected at least ${index + 1}`,
    );
  }
  return BigInt(`0x${body.slice(start, start + 64)}`);
}

/** Read the `index`-th word as a `bool`. Any non-zero word is `true`. */
export function decodeBoolAt(data: string, index: number): boolean {
  return decodeUint256At(data, index) !== 0n;
}

/** Read the `index`-th word as an `address`, lower-cased. */
export function decodeAddressAt(data: string, index: number): string {
  return `0x${uint256Word(decodeUint256At(data, index)).slice(24)}`;
}

/** How many whole 32-byte words a payload carries. */
export function wordCount(data: string): number {
  return Math.floor(hexBody(data).length / 64);
}
