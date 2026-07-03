// Shared auth helper for machine-facing endpoints (the planning→app hook).
// Uses a constant-time compare so the key can't be timing-probed.
import { timingSafeEqual } from 'node:crypto';

export interface KeyCheck {
  ok: boolean;
  status: number; // HTTP status to return when !ok
  error?: string;
}

/**
 * Verify the caller presented the planned-sessions API key.
 * - If PLANNED_SESSIONS_API_KEY is unset → 503 (endpoint not configured yet).
 *   This is the state on first run before you add the key; the in-app UI does
 *   NOT use this endpoint (it uses trusted same-origin server actions), so
 *   refusing here is safe.
 * - Accepts the key via `x-api-key: <key>` or `Authorization: Bearer <key>`.
 */
export function checkPlannedSessionsKey(headers: Headers): KeyCheck {
  const expected = process.env.PLANNED_SESSIONS_API_KEY?.trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error:
        'Endpoint not configured. Set PLANNED_SESSIONS_API_KEY in .env to enable the planning hook.',
    };
  }

  const provided =
    headers.get('x-api-key')?.trim() ||
    headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';

  if (!provided || !safeEqual(provided, expected)) {
    return { ok: false, status: 401, error: 'Invalid or missing API key.' };
  }
  return { ok: true, status: 200 };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
