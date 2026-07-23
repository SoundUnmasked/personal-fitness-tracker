# Decisions & Assumptions — Personal Fitness Tracker

This was built unattended overnight. Every non-trivial assumption is logged
here. Nothing requiring personal credentials was invented — all secrets are
`.env` placeholders for you to fill in.

---

# Package O — per-exercise notes and warm-up memory

- **Per-exercise notes (item 1).** New additive column
  `planned_exercises.logged_note` (registered in turso-push ADDITIVE_COLUMNS;
  NOT applied to Turso here). Kept separate from the existing plan note
  (`notes`, the coach cue shown on the preview). Written during logging via a
  one-tap note button on each exercise card (and an inline preview of the
  note); shown once per exercise on the completed view. Pre-filled from last
  time's logged note, falling back to the plan note. Persisted per
  planned-exercise `order` in `saveCompletedActuals` (empty clears to null).
- **Session-level notes (item 2).** Already persisted via the Finish sheet
  (`Session.notes`); Package O also makes it reachable mid-session through a
  "Session note" button, sharing the same note-sheet editor and the draft. The
  Finish sheet seeds its notes field from it.
- **Warm-up memory (item 3).** New `previousWarmups()` reader (no column —
  reads existing `is_warmup` sets). When an exercise had warm-up sets in its
  most recent completed session, the logger pre-populates the SAME NUMBER of
  warm-up rows with those weights/reps, flagged `suggested`. Rules honoured:
  mirrors the most recent prior session only (never a fixed default), never
  applied to an exercise with no history, always editable and removable (a
  "Warm-up suggested from last time" banner with Dismiss; a dashed, dimmed row
  style until ticked/edited, at which point it commits and reads as normal).
- **No Turso migration run.** `logged_note` is additive and registered for the
  owner to apply via `npm run db:push:turso`.

---

# Package N — timer system rework

- **Ongoing rest notification (item 1).** While a countdown runs we show ONE
  persistent notification (tag `pft-rest`) whose body is the rest END TIME, not
  a live countdown — a live countdown would freeze when the JS timer is
  throttled in the background, whereas an absolute end time stays useful. It's
  `silent` (the audible cue is the in-app chime) and closed on
  complete/skip/pause/finish. We deleted the old end-of-rest notification and
  the dead `TimestampTrigger`/`showTrigger` path (Notification Triggers was
  removed from Chromium). **Honest limits:** because web pages can't run a
  reliable background timer, when the app is backgrounded the notification may
  linger a few seconds past the true end until you refocus the app (which
  closes it); and permission-denied degrades to in-app-only silently.
- **Always-visible rest strip (item 2).** A fixed top strip shows the remaining
  rest whenever a countdown/count-up is running, so it stays visible with the
  keypad open, while tapping other sets, and while scrolled. Tapping it opens
  the rest panel; the header is offset down while it shows.
- **Typed rest (item 3).** Tap the big rest time to type an exact duration
  ("M:SS" or plain seconds via `parseClockInput`); plus 60/90/120/180 quick
  presets. -15/+15 kept.
- **Count-up timer (item 4).** The rest panel has Countdown/Count-up modes.
  Count-up is a wall-clock-anchored open-ended stopwatch; it does not capture
  the lag between finishing and pressing start (accepted — the user adjusts).
- **One time format (item 5).** New `fmtClock`/`fmtClockFromMinutes` in
  `lib/format.ts` render every time as `M:SS` (rolling to `H:MM:SS` past an
  hour). Applied to the session clock, rest timers, the count-up, logged set
  durations, session/run durations, and plan target times. No more "45s" /
  "1 min" / "45m".
- **Countdown + distinct end sound (item 6).** Audible 3-2-1 blips (one low
  same-pitch tick per second for the last three), then a rising two-note
  triangle-wave CHIME at zero — deliberately unlike the tempo metronome's
  single flat sine tick, because it means "start your set", not "keep tempo".
  **Honest limit:** WebAudio is suspended when the app is backgrounded, so the
  end sound is reliable only when the logger is foreground (screen may be off
  under the wake lock). Reported plainly; the notification is the background
  affordance.
- **Stale-draft prompt (item 7).** `SessionBar` now shows the draft age, and a
  draft older than 24h flips to a warning treatment ("Discard this old
  session?") with a one-tap discard (clears the local draft only; no DB rows
  touched) and a Resume option, so stale state can't pass for live.

---

# Package M — logger correctness bug fixes

- **Entry replaces, never appends (fix 1).** Tapping into a keypad cell arms
  "fresh entry": the first keystroke replaces the whole pre-filled value
  (backspace clears it), like select-all in a native field. Native numeric
  inputs (finish sheet, warm-up weights, manual plan form) get
  select-all-on-focus for the same effect.
- **Rest timer is never clobbered (fix 2).** Ticking a set (or "Log set")
  starts a rest timer ONLY if none is running; an active countdown is left
  alone.
- **Empty ticked sets are dropped (fix 3).** A ticked strength set is written
  ONLY if it has positive reps OR positive duration — a loaded bar with 0 reps
  (positive weight, 0 reps) is NOT a completed set and is dropped. Working-set
  numbers are assigned after the drop (no gaps). This supersedes Package H's
  "a ticked row with empty fields IS saved". (Original Package M shipped the
  looser "reps OR weight OR duration" rule; tightened by follow-up per the
  user's decision that weight alone must not qualify.)
- **RPE half-points + honest uncertainty (fix 4).** `rpe`/`rpe_overall`
  became Float in schema.prisma — NO DDL anywhere: SQLite INTEGER affinity
  already stores 7.5 as REAL, so existing local + Turso tables are untouched
  (schema.sql updated for fresh installs only). The rounding lived in
  `intOrNull` on the save path; now `floatOrNull`. Ranges: new additive
  `strength_sets.rpe_high REAL` column (registered in turso-push
  ADDITIVE_COLUMNS; owner applies it to Turso whenever they next run
  db:push:turso) — `rpe` holds the lower bound. Input stays keypad-first: a
  one-tap "Unsure? Log as 7 or 8" toggle under the RPE keypad sets/clears the
  +1 upper bound; typing a new RPE clears it. Displayed as "7-8" (hyphen —
  repo bans en dashes in UI strings).
- **Previous includes bodyweight history (fix 5).** `previousWeights` no
  longer requires a weight; within a day weighted sets still outrank
  bodyweight ones (SQLite sorts NULL last on DESC). The PREV cell shows
  weight AND reps, reps alone for bodyweight, and never a bare "reps" label.
- **Back never kills the session (fix 6).** While a bottom panel (keypad /
  rest / tempo) is open, a sentinel history entry makes Android's Back
  gesture close the panel instead of navigating. Separately, non-explicit
  exits (accidental back-out, backgrounding) now save the draft with its REAL
  pause state instead of force-pausing, and rehydrating a running draft adds
  the wall-clock time spent away — the session clock behaves as if it never
  stopped. Only the pause toggle and "Save and come back later" freeze it.
  Consequence: a running draft left overnight keeps counting (it is honestly
  shown as "in progress" in the mini-bar the whole time).
- **Warm-up rows (fixes 7+8).** No RPE cell and no rest-timer auto-start on
  warm-up rows; their field cycle is weight → reps (or time). The row badge is
  plain-text "WU" — the old icon glyph rendered blank when the icon font
  hadn't loaded (real-phone report). Read-only views no longer render an
  unticked warm-up as "0/8 done": the checklist is a guide, so progress is
  shown only once something was ticked.
- **The primary keypad button says what it does (fix 9).** It still cycles
  fields, but is labelled "Next: reps" / "Next: RPE" / "Next: time" until the
  final field, where it reads "Log set" (with a check icon). Label always
  matches action.

---

# Package L1 — interaction polish

- **Pause is a single-tap toggle.** The full-screen PAUSED interstitial is gone;
  the header button flips pause/resume (icon + tint change, clock dims and
  shows "· PAUSED"). Consequence: the interstitial's "Restart: clear progress"
  action lost its only entry point and was removed with its confirm dialog —
  the same outcome is one tap further away via Discard (clears the draft) and
  re-opening the logger fresh. The exit options are unchanged and live only on
  the back/exit flow.
- **Discard confirms once, not twice**, and is now LOCAL-ONLY: it clears the
  on-device draft and never calls the server. This matches the brief's stated
  model ("discard only clears the local draft; no DB rows are touched") and is
  what makes single-tap discard safe. Behaviour change vs the old
  `discardSessionAction` path: discarding while re-logging a COMPLETED session
  now leaves the saved actuals and completed status untouched (cancel-edit
  semantics) instead of deleting them and reverting the session to planned.
  `discardSessionAction` is kept in `actions.ts` (unused by the UI) for
  tooling; sheet copy updated to say nothing saved is touched.
- **Exit sheet touch targets:** every control ≥44px (choices min 60px, Back
  50px, close 44px, 12px spacing), consistent with the logger's large buttons.
- **"+" tab = daily loop** via a new `/today` redirect page (today's planned
  session → `/plan/<id>`, else `/plan/new`), evaluated per tap (force-dynamic,
  same local-midnight window as Home). Scan capture moved behind an
  "Add a scan" button on Metrics; the capture page's decorative type chips
  (incl. the equally decorative "InBody scan" chip — none of them did
  anything) were deleted, and its close/save now return to Metrics instead of
  Home, matching the new entry point. The FAB press state no longer jumps
  (`translateY(-24px)` removed; plain in-place scale).

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
