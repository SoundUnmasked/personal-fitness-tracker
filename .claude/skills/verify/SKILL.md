---
name: verify
description: Build, run and drive this app locally to verify changes end-to-end.
---

# Verify — Personal Fitness Tracker

Next.js 16 App Router PWA, Prisma + SQLite locally (Turso in prod).

## Build & run

```bash
npm run build                                   # prisma generate && next build
DATABASE_URL="file:./dev.db" npx prisma db push --skip-generate   # create local DB
DATABASE_URL="file:./dev.db" \
  APP_PASSPHRASE="open-sesame-42" APP_AUTH_SECRET="e2e-test-secret" \
  PLANNED_SESSIONS_API_KEY="hook-key-123" \
  NODE_ENV=production npx next start -p 3100 &
```

Omit `APP_PASSPHRASE`/`APP_AUTH_SECRET` to observe the fail-closed 503
(production only; in dev the gate is off when unset).

## Driving the passphrase gate (src/middleware.ts)

- `GET /` unauthenticated → 307 to `/unlock`; `/api/*` → 401 JSON.
- Exempt without auth: `/unlock`, `/sw.js`, `/manifest.webmanifest`,
  `/fonts/*`, `/icons/*`, `/_next/static/*`, and `POST /api/planned-sessions`
  (has its own `x-api-key` check).
- Unlock without a browser: fetch `/unlock`, grep the hidden
  `$ACTION_ID_…` input name, then
  `curl -X POST /unlock -F "$ACTION=" -F "passphrase=…"` → 303 + `Set-Cookie:
  pft_auth=…`. Send that cookie on later requests.
- Cookie value = hex HMAC-SHA256(`APP_AUTH_SECRET`, `pft-auth-v1`)
  (see `src/lib/auth.ts`), so it can also be computed directly.

## Browser / screenshots

`playwright-core` is NOT a project dep — install with `npm i --no-save
playwright-core`. Chromium binary: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
(launch with `executablePath` + `--no-sandbox`). Run driver scripts with
`createRequire('/path/to/repo/package.json')` if the script lives outside
the repo. `colorScheme: 'light' | 'dark'` in `newContext` switches the theme
(the app follows `prefers-color-scheme` unless localStorage overrides).

## Gotchas

- Test data: create a planned session via
  `POST /api/planned-sessions` with the API key, then open `/plan/<id>/log`.
- Kill stale servers by name: the process is `next-server (v16.2.9)`
  (`pgrep -af next-server`), not "next start".
- With middleware present, Next caps request bodies at 10 MB
  (`middlewareClientMaxBodySize`) — bodies above that are truncated before
  route handlers see them.
