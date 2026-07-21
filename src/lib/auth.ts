// Site-wide passphrase gate — Node-side half.
//
// The whole app (pages, API routes, server actions) is locked behind a single
// passphrase (see src/middleware.ts). This module holds the pieces that need
// node:crypto and therefore can't run in the middleware's Edge runtime:
//   - verifying the entered passphrase (constant-time, like src/lib/apiKey.ts)
//   - producing the signed cookie value the middleware later checks.
//
// The cookie value is HMAC-SHA256(APP_AUTH_SECRET, AUTH_PAYLOAD) as hex. It
// carries no user data — it simply can't be forged without the secret.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AUTH_PAYLOAD } from './authConstants';

export { AUTH_COOKIE, AUTH_PAYLOAD, AUTH_COOKIE_MAX_AGE } from './authConstants';

/** Both env vars must be present for the gate to operate. */
export function isAuthConfigured(): boolean {
  return (
    !!process.env.APP_PASSPHRASE?.trim() && !!process.env.APP_AUTH_SECRET?.trim()
  );
}

/** Constant-time check of an entered passphrase against APP_PASSPHRASE. */
export function verifyPassphrase(input: string): boolean {
  const expected = process.env.APP_PASSPHRASE?.trim();
  if (!expected) return false;
  return safeEqual(input, expected);
}

/** The signed value stored in the auth cookie (hex HMAC of AUTH_PAYLOAD). */
export function authCookieValue(): string {
  const secret = process.env.APP_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error('APP_AUTH_SECRET is not set: cannot issue auth cookie.');
  }
  return createHmac('sha256', secret).update(AUTH_PAYLOAD).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
