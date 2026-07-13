// Shared by src/middleware.ts (Edge runtime, Web Crypto) and src/lib/auth.ts
// (Node runtime). Keep this module dependency-free so both bundles can use it.

/** Name of the httpOnly cookie that proves the passphrase was entered. */
export const AUTH_COOKIE = 'pft_auth';

/**
 * Fixed payload the auth cookie value is an HMAC of. Bump the version suffix
 * to invalidate every existing cookie at once (forces everyone to /unlock).
 */
export const AUTH_PAYLOAD = 'pft-auth-v1';

/** Cookie lifetime: one year. */
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
