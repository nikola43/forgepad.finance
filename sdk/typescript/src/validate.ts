/**
 * Argument validation at the SDK boundary.
 *
 * TypeScript catches most mistakes at compile time, but the SDK is also consumed
 * from plain JavaScript, where an `undefined` address would otherwise be
 * interpolated into a URL and produce a confusing 404.
 *
 * @module
 */

import { FyuzInvalidArgumentError } from './errors.js';

/**
 * Assert a required string path parameter is a non-empty string.
 *
 * @internal
 */
export function requireString(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FyuzInvalidArgumentError(`${name} must be a non-empty string`);
  }
  return value;
}

/**
 * Assert a required numeric path parameter is a finite integer.
 *
 * @internal
 */
export function requireInteger(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new FyuzInvalidArgumentError(`${name} must be an integer`);
  }
  return value;
}
