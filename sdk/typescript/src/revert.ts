/**
 * Turning revert data into something a human can act on.
 *
 * A reverted `eth_call` comes back as a bare 4-byte selector — `0xcfa6d878` and
 * nothing else. The mapping from that to "the token graduated, trade the DEX
 * pair" exists nowhere on-chain and is not in the ABI the API serves, so the
 * table below is it. It mirrors `shared/test-vectors/trade-errors.json`, which
 * the test suite asserts against.
 *
 * @module
 */

import { FyuzContractRevertError, type RevertKind } from './errors.js';

interface RevertEntry {
  errorName: string;
  kind: RevertKind;
  message: string;
  retryable: boolean;
}

/** `Error(string)` — the classic `require(cond, "msg")` revert. */
const SELECTOR_ERROR_STRING = '0x08c379a0';
/** `Panic(uint256)` — a compiler-inserted assertion. */
const SELECTOR_PANIC = '0x4e487b71';

/** `AlreadyLaunched()`. Exported because the graduated case is handled specially. */
export const SELECTOR_ALREADY_LAUNCHED = '0xcfa6d878';

const REVERTS: Readonly<Record<string, RevertEntry>> = {
  [SELECTOR_ALREADY_LAUNCHED]: {
    errorName: 'AlreadyLaunched()',
    kind: 'graduated',
    message:
      'The token graduated: the bonding curve is closed and every swap entrypoint reverts. ' +
      'Trade the DEX pair instead.',
    retryable: false,
  },
  '0x9c8787c0': {
    errorName: 'PoolDoesNotExist()',
    kind: 'no_pool',
    message:
      'No bonding curve exists for this token on this chain — check the address and the network.',
    retryable: false,
  },
  '0x8199f5f3': {
    errorName: 'SlippageExceeded()',
    kind: 'slippage',
    message:
      'The price moved past minAmountOut before the transaction landed. ' +
      'Re-quote and retry, or widen the slippage tolerance.',
    retryable: true,
  },
  '0x2b32713d': {
    errorName: 'SwapExpired()',
    kind: 'expired',
    message: 'The deadline passed before the transaction was mined. Rebuild with a later deadline.',
    retryable: true,
  },
  '0xe96d2afe': {
    errorName: 'MaxPriceImpactExceeded()',
    kind: 'price_impact',
    message:
      'The trade would move the curve further than the contract allows. Split it into smaller trades.',
    retryable: false,
  },
  '0x9bca8aec': {
    errorName: 'SellAmountTooLarge()',
    kind: 'sell_too_large',
    message:
      'The sell exceeds MAX_SELL_PERCENT of the virtual token reserve. ' +
      'Sell less, or in several transactions.',
    retryable: false,
  },
  '0x1985c735': {
    errorName: 'InsufficientEthValue()',
    kind: 'insufficient_value',
    message:
      'msg.value was below buyAmount + getFirstBuyFee(token). ' +
      'The fee is not optional and is not deducted from buyAmount.',
    retryable: false,
  },
  '0xe4455cae': {
    errorName: 'InsufficientTokenBalance()',
    kind: 'insufficient_balance',
    message: 'The wallet does not hold enough of the token to cover this sell.',
    retryable: false,
  },
  '0xf8b3bb61': {
    errorName: 'InsufficientInput()',
    kind: 'insufficient_input',
    message: 'The input amount rounds down to zero output on the curve. Trade a larger amount.',
    retryable: false,
  },
  '0xbb55fd27': {
    errorName: 'InsufficientLiquidity()',
    kind: 'insufficient_liquidity',
    message: 'The curve does not hold enough of the other side to fill this trade.',
    retryable: false,
  },
  '0x1f2a2005': {
    errorName: 'ZeroAmount()',
    kind: 'zero_amount',
    message: 'The amount must be greater than zero.',
    retryable: false,
  },
  '0x1087e109': {
    errorName: 'StalePriceFeed()',
    kind: 'stale_feed',
    message: 'The BNB/USD feed is stale or unavailable, so the contract cannot price this call.',
    retryable: true,
  },
  '0xd93c0665': {
    errorName: 'EnforcedPause()',
    kind: 'paused',
    message: 'Trading is paused on the contract.',
    retryable: true,
  },
};

/** The first four bytes of some revert data, lower-cased, or `undefined` if absent. */
export function revertSelector(data: string | undefined | null): string | undefined {
  if (typeof data !== 'string') return undefined;
  const body = data.startsWith('0x') ? data.slice(2) : data;
  if (body.length < 8) return undefined;
  return `0x${body.slice(0, 8).toLowerCase()}`;
}

/** The reason out of an `Error(string)` payload, when that is what this is. */
function decodeRevertString(data: string): string | undefined {
  const body = data.startsWith('0x') ? data.slice(2) : data;
  // selector + offset word + length word, then the bytes themselves.
  if (body.length < 8 + 128) return undefined;
  const length = Number(BigInt(`0x${body.slice(72, 136)}`));
  const chars = body.slice(136, 136 + length * 2);
  if (chars.length < length * 2) return undefined;
  const bytes = Uint8Array.from(
    chars.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
  return new TextDecoder().decode(bytes);
}

/**
 * Classify revert data into a typed error.
 *
 * An unrecognised selector is reported verbatim rather than swallowed — a later
 * contract version will add errors this table does not know about, and
 * `0xdeadbeef` in the message is at least something to search for.
 */
export function revertError(data: string | undefined | null, context: string): FyuzContractRevertError {
  const raw = typeof data === 'string' ? data : '0x';
  const selector = revertSelector(raw);

  if (selector === undefined) {
    return new FyuzContractRevertError(
      `${context} reverted, and the node returned no revert data. ` +
        'Some providers strip it; retry against a node that preserves it to learn why.',
      { kind: 'unknown', data: raw },
    );
  }

  if (selector === SELECTOR_ERROR_STRING) {
    const reason = decodeRevertString(raw);
    return new FyuzContractRevertError(
      `${context} reverted: ${reason ?? 'Error(string) with an undecodable reason'}`,
      { kind: 'revert_string', errorName: 'Error(string)', selector, data: raw },
    );
  }

  if (selector === SELECTOR_PANIC) {
    return new FyuzContractRevertError(
      `${context} hit a Solidity panic — that is a contract bug, not a bad argument.`,
      { kind: 'unknown', errorName: 'Panic(uint256)', selector, data: raw },
    );
  }

  const entry = REVERTS[selector];
  if (entry === undefined) {
    return new FyuzContractRevertError(
      `${context} reverted with the unrecognised selector ${selector}. ` +
        'This SDK version does not know that error; check the contract for a newer one.',
      { kind: 'unknown', selector, data: raw },
    );
  }

  return new FyuzContractRevertError(`${context} reverted: ${entry.message}`, {
    kind: entry.kind,
    errorName: entry.errorName,
    selector,
    data: raw,
    retryable: entry.retryable,
  });
}
