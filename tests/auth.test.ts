import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  AUTH_PAYLOAD,
  authCookieValue,
  isAuthConfigured,
  verifyPassphrase,
} from '@/lib/auth';

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.APP_PASSPHRASE = 'correct horse battery staple';
  process.env.APP_AUTH_SECRET = 'test-secret';
});

afterAll(() => {
  process.env.APP_PASSPHRASE = ORIGINAL.APP_PASSPHRASE;
  process.env.APP_AUTH_SECRET = ORIGINAL.APP_AUTH_SECRET;
});

describe('isAuthConfigured', () => {
  it('is true when both env vars are set', () => {
    expect(isAuthConfigured()).toBe(true);
  });

  it('is false when either env var is missing or blank', () => {
    process.env.APP_PASSPHRASE = '';
    expect(isAuthConfigured()).toBe(false);
    process.env.APP_PASSPHRASE = 'x';
    process.env.APP_AUTH_SECRET = '   ';
    expect(isAuthConfigured()).toBe(false);
  });
});

describe('verifyPassphrase', () => {
  it('accepts the exact passphrase and rejects everything else', () => {
    expect(verifyPassphrase('correct horse battery staple')).toBe(true);
    expect(verifyPassphrase('wrong')).toBe(false);
    expect(verifyPassphrase('')).toBe(false);
    // different length must not throw (timingSafeEqual needs equal lengths)
    expect(verifyPassphrase('correct horse battery staple!')).toBe(false);
  });

  it('rejects everything when APP_PASSPHRASE is unset (fail closed)', () => {
    delete process.env.APP_PASSPHRASE;
    expect(verifyPassphrase('anything')).toBe(false);
    expect(verifyPassphrase('')).toBe(false);
  });
});

describe('authCookieValue', () => {
  it('is the hex HMAC-SHA256 of the payload under APP_AUTH_SECRET', () => {
    const expected = createHmac('sha256', 'test-secret')
      .update(AUTH_PAYLOAD)
      .digest('hex');
    expect(authCookieValue()).toBe(expected);
  });

  it('matches what the middleware computes via Web Crypto', async () => {
    // The middleware verifies the cookie with crypto.subtle on the Edge
    // runtime; assert the two implementations agree on the same token.
    const enc = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode('test-secret'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await globalThis.crypto.subtle.sign(
      'HMAC',
      key,
      enc.encode(AUTH_PAYLOAD),
    );
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(authCookieValue()).toBe(hex);
  });

  it('throws when APP_AUTH_SECRET is unset', () => {
    delete process.env.APP_AUTH_SECRET;
    expect(() => authCookieValue()).toThrow();
  });
});
