/**
 * Loader for the cross-language fixtures in `sdk/shared/test-vectors`.
 *
 * The same files back the Go, Python and Rust suites, so a change to the wire
 * contract fails all four at once instead of letting the clients drift apart.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One `expect.exact_strings` entry: the value, plus why it is dangerous. */
export interface ExactString {
  value: string;
  why: string;
}

export interface TokenVector {
  wire: { tokenList: Record<string, unknown>[]; tokenCount: number };
  expect: {
    exact_strings: Record<string, ExactString>;
    must_be_null: { fields: string[]; why: string };
    scalars: Record<string, number>;
  };
}

export interface ErrorCase {
  name: string;
  status: number;
  body: string;
  classification: 'api' | 'not_found' | 'rate_limited';
  retryable: boolean;
  message: string | null;
}

export interface ErrorVector {
  cases: ErrorCase[];
}

export interface TradeSideVector {
  cases: { wire: string; side: string }[];
  wire_template: { trades: Record<string, unknown>[]; tokens: unknown[] };
}

export interface CalldataVector {
  contract: { bsc: string; chainId: number };
  selectors: Record<string, string>;
  fixture_args: {
    token: string;
    spender: string;
    owner: string;
    deadline: number;
    uint256_max: string;
  };
  cases: {
    name: string;
    builder: string;
    function: string;
    args: Record<string, string | number | boolean>;
    calldata: string;
    note?: string;
  }[];
  address_casing: { mixed_case_input: string; encoded_word: string };
}

export interface TradeErrorVector {
  graduated_selector: string;
  revertible: {
    selector: string;
    error: string;
    surfaced_as: string;
    message: string;
    retryable: boolean;
  }[];
  decode_cases: {
    name: string;
    revert_data: string;
    expect: {
      surfaced_as: string;
      error?: string;
      message?: string;
      message_contains?: string;
    };
  }[];
}

/**
 * Find `sdk/shared/test-vectors` by walking up from this file.
 *
 * These tests execute from `build/test/`, not from source, so the directory
 * depth differs between the checkout and the compiled output. Walking beats
 * hard-coding a `../../..` that silently breaks whenever the build layout moves.
 */
function findVectorDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (;;) {
    const candidate = join(dir, 'shared', 'test-vectors');
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('could not locate sdk/shared/test-vectors above ' + import.meta.url);
    }
    dir = parent;
  }
}

const VECTOR_DIR = findVectorDir();

/** Read and parse one fixture. */
export function loadVector<T>(name: string): T {
  return JSON.parse(readFileSync(join(VECTOR_DIR, name), 'utf8')) as T;
}
