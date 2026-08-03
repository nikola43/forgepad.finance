/**
 * SDK version metadata.
 *
 * @module
 */

/** Version of this SDK. Kept in sync with `package.json`. */
export const VERSION = '1.0.0';

/**
 * Value sent in the `User-Agent` header.
 *
 * Browsers silently drop `User-Agent` on `fetch` (it is a forbidden header
 * name); the SDK sets it anyway so Node and server-side callers are identifiable.
 */
export const USER_AGENT = `fyuz-sdk-typescript/${VERSION}`;
