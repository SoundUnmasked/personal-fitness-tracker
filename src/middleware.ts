// Site-wide passphrase gate (SEC-1). Every request — pages, API routes and
// server actions — must carry the signed auth cookie issued by /unlock.
//
// Runs on the Edge runtime, so cookie verification uses Web Crypto (the token
// itself is issued by src/lib/auth.ts with node:crypto — same HMAC, same hex).
//
// Exempt: /unlock (+ its server action POST), the PWA shell assets that must
// load before/without auth (manifest, sw.js, fonts, icons, /_next/static), and
// POST /api/planned-sessions, which keeps its own PLANNED_SESSIONS_API_KEY
// check so the external planning hook keeps working.
//
// FAIL CLOSED: in production, if APP_PASSPHRASE / APP_AUTH_SECRET are not set
// the app answers 503 rather than serving unprotected. In development the gate
// is off until both vars are set, so a fresh clone still runs.
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, AUTH_PAYLOAD } from '@/lib/authConstants';

// Static-asset prefixes are excluded in the matcher below; these need
// method-aware or exact-path logic, so they are checked in code.
function isExempt(req: NextRequest): boolean {
  const { pathname } = req.nextUrl;
  if (pathname === '/unlock') return true; // page + its server action POST
  if (pathname === '/manifest.webmanifest' || pathname === '/sw.js') return true;
  // The machine-facing planning endpoints carry their own PLANNED_SESSIONS_API_KEY
  // check (see src/lib/apiKey.ts), so they bypass the passphrase cookie gate:
  //   GET/POST /api/planned-sessions            — list / create
  //   GET/DELETE/PATCH /api/planned-sessions/:id — preview / delete / move date
  if (pathname === '/api/planned-sessions' && (req.method === 'POST' || req.method === 'GET')) return true;
  if (/^\/api\/planned-sessions\/\d+$/.test(pathname) && ['GET', 'DELETE', 'PATCH'].includes(req.method)) return true;
  return false;
}

// HMAC-SHA256(APP_AUTH_SECRET, AUTH_PAYLOAD) as hex — computed once per
// isolate. Must match authCookieValue() in src/lib/auth.ts exactly.
let tokenPromise: Promise<string> | null = null;
function expectedToken(secret: string): Promise<string> {
  if (!tokenPromise) {
    tokenPromise = (async () => {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(AUTH_PAYLOAD));
      return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    })();
  }
  return tokenPromise;
}

/** Constant-time string compare (both sides are fixed-length hex HMACs). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function middleware(req: NextRequest) {
  if (isExempt(req)) return NextResponse.next();

  const passphrase = process.env.APP_PASSPHRASE?.trim();
  const secret = process.env.APP_AUTH_SECRET?.trim();
  const isApi = req.nextUrl.pathname.startsWith('/api/');

  if (!passphrase || !secret) {
    // Not configured. Production fails closed; development runs ungated.
    if (process.env.NODE_ENV !== 'production') return NextResponse.next();
    const msg =
      'App locked: APP_PASSPHRASE and APP_AUTH_SECRET must be configured.';
    return isApi
      ? NextResponse.json({ error: msg }, { status: 503 })
      : new NextResponse(msg, {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value ?? '';
  if (cookie && safeEqual(cookie, await expectedToken(secret))) {
    return NextResponse.next();
  }

  // Unauthenticated: API callers get a machine-readable 401; everything else
  // (page loads, server actions from stale sessions) goes to the unlock form.
  if (isApi) {
    return NextResponse.json(
      { error: 'Unauthorized. Unlock the app first.' },
      { status: 401 },
    );
  }
  return NextResponse.redirect(new URL('/unlock', req.url));
}

export const config = {
  // Skip Next's static output and the self-hosted font/icon assets entirely —
  // everything else (pages, /api/*, server actions) runs through the gate.
  matcher: ['/((?!_next/static|_next/image|fonts/|icons/|favicon.ico).*)'],
};
