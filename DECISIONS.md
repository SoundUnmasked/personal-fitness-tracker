# Decisions & Assumptions — Personal Fitness Tracker

This was built unattended overnight. Every non-trivial assumption is logged
here. Nothing requiring personal credentials was invented — all secrets are
`.env` placeholders for you to fill in.

---

# Package H — data truth and gym resilience

- **Finish saves ONLY ticked sets.** The old save filter ("row has a value")
  matched every row because rows pre-fill from targets, fabricating history and
  poisoning the "last time" pre-fills. The tick is now the sole completion
  signal (`tickedStrengthSets()` in `plannedSessions.ts`, unit + DB tested).
  Unticked rows are dropped entirely — no ghost or zero rows. A ticked row with
  empty fields IS saved (the tick is the user's assertion, e.g. bodyweight work
  with no reps typed). "Mark all as done" lives in the Finish sheet, shown only
  while sets are unticked; it ticks every row including manually added warm-ups.
- **Duration** = the logger's session clock at Finish, rounded to whole minutes
  with a 1-minute floor once the clock has run; a 0-second session stores null.
- **Timer restore fix:** the draft's elapsed was restored into React state but
  the wall-clock anchor (`elapsedClock`) kept base 0, so the first tick wiped
  the clock. The hydrate effect now re-anchors ref + base synchronously.
- **Completed view** gained "Edit logged sets" (opens the existing logger;
  re-finishing overwrites actuals — already idempotent server-side). The
  "Already logged…" notice was dead code on the planned page (the completed
  branch returns before it); it moved into `CompletedView` where it renders.
  Editing pre-fills from targets, not saved actuals, and requires re-ticking —
  accepted for this package (same data-truth rule).
- **Offline Finish:** any thrown server-action call (fetch failure) shows the
  fixed no-signal message and keeps the on-device draft so Finish can simply be
  tapped again. Deliberately NO background retry or sync queue (per brief). A
  server-side failure still returns `{ok:false}` and shows its own error.

---

# Session 2 — Resume build (planned sessions, Turso, hook, export, rule amendments)

**Context correction:** the resume brief said a prior session had already built
planned-sessions + Turso + xlsx export on this branch. It had **not** — the
branch held only Phase 1 (below). The prior work actually lived on a *different*
branch (`claude/hyrox-logger-pwa-f4gbj0`); I merged it into the designated
working branch and then built the four target features + rule amendments on top.
So this session's diff is real feature work, not a duplicate.

## Rule amendments (exact, per brief)

- **"Hard" = Power + Foundation ONLY.** Aerobic is explicitly not hard (Phase 1
  had wrongly treated Aerobic/Run as hard). `HARD_SESSION_TYPES` in
  `constants.ts` is now `['Power','Foundation']`; the back-to-back flag and its
  tests were updated. Still a flag, never a block.
- **HR priority hierarchy (not a whitelist):** `pickHrSource()` picks the
  highest-priority *available* source — COROS → Technogym → Samsung — and never
  drops HR just because the preferred device is missing. Samsung is accepted but
  returned with `unreliable: true` and a flag (Elvanse-inflated). Stored in the
  new `runs.hr_source` column. Strava-synced HR is tagged `COROS` (Strava
  receives HR from the COROS watch). Assumption: HR provenance lives on the
  `Run` row (that's where avg/max HR are); strength-only sessions don't carry an
  HR column (unchanged from Phase 1).
- **Calf loading — CORRECTED (import session).** An earlier version made
  "eccentric calf raises after every run" a mandatory per-run checkbox. That was
  wrong. Calf loading is **standalone strength work, 2–3×/week** (full range,
  concentric + eccentric) for calf DOMS on outdoor runs — not a per-run ritual.
  The per-run calf prompt has been **removed** from the run-logging flow. The
  `runs.calf_raises_done` field is **kept** (schema + logbook import still record
  whether calf work happened that day) but is no longer surfaced as a required
  prompt.
- **Cooldown** kept as `sessions.cooldown_done` and surfaced as a **visible
  prompt** on Foundation sessions. Assumption: "after every Foundation session"
  ⇒ prompt shown for type === Foundation only.
- **Distance/pace** unchanged: Strava/Technogym only, Samsung distance never
  ingested. **InBody vs Withings** unchanged: separate rows, never averaged.

## Planned sessions

- Modelled as `Session.status` (`planned` | `completed`, default `completed` so
  quick-logs and imports stay history) plus a new `PlannedExercise` child
  (target sets/reps/weight, `superset_group`, `order`). Logging actuals writes
  real `StrengthSet` rows and flips status to `completed`; the `PlannedExercise`
  rows are **retained** as the record of what was planned.
- **Two write paths, one library** (`src/lib/plannedSessions.ts`, pure +
  unit-tested): the in-app UI uses **server actions** (trusted, same-origin, no
  API key); the external hook uses the **API-key-guarded route**. This avoids
  putting a secret in client code while still exposing a documented machine door.
- **Auto previous weights:** `previousWeights()` finds, per movement, the top
  working set from the most recent *completed* day it was performed (weight-desc
  within that day). Shown as "Last time: …" and used to pre-fill weight when a
  movement has no explicit target.
- **Supersets** are grouped in the logging UI by consecutive shared tag.
- Re-saving a completed plan replaces its actuals (idempotent), so a mis-log is
  easily corrected.

## Turso / libSQL

- `provider = "sqlite"` kept (libSQL is SQLite-compatible → schema is portable);
  added `previewFeatures = ["driverAdapters"]`. At runtime `src/lib/prisma.ts`
  (and `prisma/db-client.ts` for scripts) use the **libSQL driver adapter** when
  `TURSO_DATABASE_URL` is set, else the local file. So the app runs locally
  today and targets Turso the moment the two env vars exist — no code change.
- Adapter pinned to **`@prisma/adapter-libsql@6.19.3`** to match the Prisma
  client major (npm's `latest` resolved to 7.x, which is incompatible).
- **Migrations on Turso:** rather than depend on the Prisma CLI's evolving libSQL
  migration support, `prisma/schema.sql` (generated via `prisma migrate diff`) is
  applied by `prisma/turso-push.ts` using the libSQL client, made idempotent with
  `IF NOT EXISTS`. Verified end-to-end against a local `file:` libSQL DB.

## Logbook export

- One-way only (no import), four tabs matching the logbook: Run Sessions, Gym
  Sessions (one row per set), Weekly Summary (per-ISO-week), Body Measurements
  (InBody & Withings separate). Only `completed` sessions.
- **Hand-rolled `.xlsx` writer** (`src/lib/xlsx.ts`) instead of the heavy,
  advisory-carrying `xlsx` npm package — consistent with the project's
  small-dependency philosophy. Inline strings, deflate ZIP with correct CRC32;
  validated to open in `unzip` and a Python parser. CSV is the always-safe path.

## Assorted

- Dashboard now leads with **Today & upcoming** planned sessions and an
  **Export** card; the primary CTA is *Plan a session* (quick-log demoted to
  secondary but kept). Added a **Plan** tab to the bottom nav.
- `.gitignore` already covered `.env`, `*.db`, uploads; `schema.sql` is source
  and intentionally committed.

---

# Session 1 — Phase 1 (original build)

## Stack

- **Next.js (App Router) + TypeScript.** Chosen because the brief needs a PWA, a
  server-side place to hold the Anthropic API key and OAuth client secrets, and
  server-rendered Prisma queries — all in one deployable unit. A pure static SPA
  couldn't safely hold the API keys; Next gives us route handlers for that.
- **SQLite + Prisma** (kept as specified). Single-user, local-first, the whole
  DB is one file you can back up. No hosted Postgres needed for one user. If you
  later deploy to a serverless host with an ephemeral filesystem (e.g. Vercel),
  swap the datasource to Postgres/Turso — the schema is portable (see "Hosting"
  below).
- **Plain CSS (no Tailwind/UI lib).** Reuses the existing Sound Unmasked dark
  purple palette from the repo's `index.html` for brand consistency and to keep
  the dependency surface (and audit noise) small. Mobile-first, large tap
  targets, minimal chrome — tuned for fast mid-session logging with ADHD/Autism
  in mind (one clear action per screen, no clutter).
- **No Anthropic SDK** — the vision call is a thin `fetch` to the Messages API.
  One less dependency; easy to read and test.

## Project placement

- Built in a **`personal-fitness-tracker/` subdirectory** rather than the repo root, because
  the root already contains a separate "Sound Unmasked" static site
  (`index.html` + `vercel.json`). I did not touch those files.

## Data model notes

- SQLite has **no native enum or json types**. "Enum-like" columns (session
  `type`, `source`, body-comp `source`) are `String`, with the allowed values
  centralised in `src/lib/constants.ts` and validated in the API routes. "json"
  columns (`goals`, `baselines`, `raw`) are stored as serialised JSON strings.
- `sessions` has a `(source, externalId)` unique constraint so Strava imports
  **dedupe** and re-syncing is idempotent. Added `external_id` (not in the
  original spec) purely to enable that dedupe.
- `goals` gained a `unit` field (kg/reps/s/min) so target/current values are
  interpretable. Seeded goals: Sled Pull, Wall Balls, Burpee Broad Jump,
  Roxzone, all dated 2026-12-01 (placeholder — adjust to your event date).
- `daily_checkin.date` is unique and stored at **local midnight**, so a check-in
  is one-per-day and re-opening a date **edits in place** (upsert).
- `sync_state` holds the OAuth tokens (`access/refresh/expires`) so connections
  persist. These are written only after you connect a real account.
- The InBody baseline (89.0 kg / 17.9% BF / 42.2 kg SMM, Apr 2026) is seeded
  both into `athlete_profile.baselines` and as an `InBody` row in
  `body_composition` so it shows immediately as the first checkpoint on the
  trend chart.

## Rules encoded

- **Back-to-back hard sessions** (`src/lib/rules.ts`): flags (never blocks) when
  two of {Power, Aerobic, Run} fall on the same or adjacent calendar days. The
  API returns a `warning` string; the logger shows it after saving. Assumption:
  "hard" = Power/Aerobic/Run; Foundation and Class are treated as not-hard.
- **Strava = source of truth for run distance/pace; COROS = HR.** The Strava
  mapper computes pace from Strava's distance/time and passes HR through
  untouched (Strava receives COROS HR). **Samsung Health / Galaxy Watch distance
  is ignored** because we only ingest from Strava, never from Samsung.
- **InBody vs Withings never averaged.** Stored as separate rows distinguished
  by `source`; the dashboard plots Withings as a continuous line and InBody as
  discrete checkpoint dots on shared axes.

## InBody extraction

- Vision model `claude-sonnet-4-6` (overridable via `ANTHROPIC_MODEL`). The
  prompt demands **JSON only**; `parseJsonResponse` defensively strips code
  fences / surrounding prose and coerces numeric strings.
- Flow: upload photo → Claude extracts → **you confirm/edit the values** →
  save as an InBody checkpoint. Manual entry works even without an API key, so
  the screen is useful before you add the key. The extract endpoint returns 503
  (not 500) when the key is absent, and the UI explains how to fix it.

## OAuth stubs (Strava, Withings)

- Full authorize → callback → token-exchange → refresh flows are implemented and
  wired to routes under `/api/sync/<source>/...`. They are inert until you set
  the client id/secret in `.env` (the `is…Configured()` checks gate them, and
  connect endpoints return 503 when unconfigured). No credentials are hardcoded.
- **State/CSRF:** a static `state=hyrox` is used. Fine for a single-user
  local/personal app; if you ever expose this publicly, switch to a random,
  per-request state stored in a cookie.

## Health Connect (future Android companion)

- Documented, **not built**. `/api/health-connect` advertises the planned
  payload contract and returns 501. See the comments in
  `src/app/api/health-connect/route.ts` and the README.

## PWA

- `public/manifest.webmanifest` + `public/sw.js` (network-first for navigations,
  cache-first for static assets, **never caches `/api/*`** so personal data is
  always fresh). The SW only registers in production builds to avoid caching dev
  assets. Icons generated from a simple "H" SVG via `sharp`.

## Security / secrets

- `.env` is gitignored; `.env.example` lists every key. `dev.db`, `*.db`, and
  `public/uploads/*` are gitignored so **no personal health data is committed**.
- `next@16` was used (the initial `15.1.3` had a published advisory). Remaining
  `npm audit` items are transitive within Next's own build toolchain (e.g.
  `postcss` used by the bundler); `npm audit fix --force` would downgrade Next to
  v9, so they're left as-is and noted here.

## Hosting note

- `next start` on a normal server works as-is. For Vercel, the SQLite file is
  ephemeral — migrate the Prisma datasource to Postgres or Turso (libSQL) before
  deploying there. Local install/dev is the intended Phase-1 target.

## What was deliberately NOT built (per brief)

- No training-plan or coaching content (data/logging tool only).
- No `food_log`, `supplements`, `meds` — schema is designed to add them later as
  new models without migrating existing tables.
