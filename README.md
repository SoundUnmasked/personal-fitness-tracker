# Personal Fitness Tracker

A personal, mobile-friendly **PWA** for planning and logging general health &
fitness data — strength, runs, body composition and daily check-ins. Built for
one user; training for a sub-1:30 Hyrox is **one goal among several**, not the
theme of the app. Designed to be **fast to use mid-session**: one clear action
per screen, big tap targets, minimal clutter. It is a **data/logging tool** — it
does not generate training plans or coaching content.

**The core loop:** plan a session → it shows up in the app as a ready-to-go
planned workout (movements listed, target weights pre-filled, last-time weights
shown) → at the gym you open it and fill in actual weights/reps/RPE/notes →
saving marks it **completed**, and it flows into history + metrics. One shared
database. No re-typing.

All data lives in **one database** (local SQLite for dev; **Turso/libSQL** in the
cloud) via Prisma. 

---

## ✅ What changed this session (resume build)

The previous session built **Phase 1** (below). This session added the four
things the brief asked for and amended the rules:

| Area | Status |
|---|---|
| **Planned sessions** — `planned`→`completed` lifecycle, target sets/reps/weight, supersets, Today/Upcoming view, log-actuals-with-pre-fill, **auto-show previous weights** | ✅ built |
| **Turso/libSQL** — Prisma driver adapter, local-file fallback, one-shot cloud schema push + seed | ✅ built |
| **Planning→app hook** — `POST /api/planned-sessions`, API-key secured, JSON contract documented | ✅ built |
| **Logbook export** — one-way app→CSV/xlsx with the four logbook tabs | ✅ built |
| **Rule amendments** — hard = **Power+Foundation only** (Aerobic not hard); HR **priority hierarchy** (COROS→Technogym→Samsung, flagged) with stored `hr_source`; visible **cooldown** prompt on Foundation | ✅ built |

**Already present from Phase 1** (kept, not rebuilt): installable PWA, quick
strength logger, daily check-in, InBody photo upload + Claude-vision extraction,
Strava/Withings OAuth sync stubs, dashboard (body-comp trend + energy chart),
logbook importer. 42 unit tests pass; production build is clean.

See **`DECISIONS.md`** for assumptions and rationale.

---

## 🎨 Design — "Cobalt · Electric"

The app is skinned to the Claude Design mockups: a single blue accent
(OKLCH hue 255), **deep-charcoal dark mode** (not pure black) and a clean light
mode. The whole UI consumes one theme defined in `src/app/globals.css` (CSS
variables for both modes), with **Geist / Geist Mono / Material Symbols Rounded**
**self-hosted** under `public/fonts` so the PWA renders correctly **offline** at
the gym (no CDN dependency).

- **Light / dark / auto** — toggle in **Profile → Appearance**. Choice persists
  (localStorage) and is applied before first paint (no flash); "Auto" follows
  the OS.
- **Navigation** — a bottom tab bar (Home · Plan · **+** · Metrics · Profile);
  the centre **+** opens Capture. Full-screen flows (log, check-in, capture) hide
  the bar and use their own footer.

### Screen map (mockup → route)

| Mockup | Route | Notes |
|---|---|---|
| Home | `/` | Readiness-led command centre; greeting uses your name |
| **Calendar** | `/plan` | Week strip + **full history grouped by month** + upcoming |
| Session detail | `/plan/[id]` | Completed → read-only detail (sets, HR, notes); planned → preview → **Start** |
| LogSession | `/plan/[id]/log` | Grid logger (KG/Reps/RPE, keypad, rest timer) |
| Plan chooser | `/plan/new` | **Plan with AI** (opens claude.ai) or **Plan in app** (`/plan/new/manual`) |
| DailyCheckin | `/checkin` | Sliders + live readiness |
| Metrics | `/metrics` | Body-comp chart, tiles, goals, export |
| UploadCapture | `/inbody` | Photo → Claude extract → save |
| Profile | `/profile` | Identity (**editable name**), data sources, appearance |

**Planning is AI-first (interim):** "Plan a session" offers *Plan with AI*
(opens Claude — you plan in chat) and *Plan in app* (the manual form). End-state:
Claude pushes plans straight in via `POST /api/planned-sessions` and they appear
in the Calendar. That endpoint is intact.

### Placeholder data (needs real sources later)

Everything is wired to **real** data except where a source isn't collected yet.
These degrade gracefully (tasteful empty/placeholder — never broken):

- **Readiness** is computed from your latest **daily check-in** (subjective
  sleep/energy/freshness/mood). It's honest-labelled "wearable HRV/sleep not
  linked yet". When objective wearable data arrives (Health Connect / Samsung
  phase), blend it into `src/lib/readiness.ts`.
- **HRV** tile on Home — placeholder ("link wearable").
- **VO₂ max / resting HR / weekly running volume** on Metrics — shown as a
  "coming with wearables" card, not fake numbers.
- **Name** is real and **editable** in Profile (defaults to "Oliver Leonard");
  the Home greeting uses it. The **Health Connect / Samsung** row is a
  coming-soon placeholder until that integration exists.

Real today: sessions, planned sessions, previous weights, check-ins (+readiness),
InBody/Withings body-comp, goals, sleep hours, body weight/fat/muscle, export.

---

## Run it locally (tomorrow, before any keys)

Requires **Node 20+** (built/tested on Node 22). It runs on the **local SQLite
file** until you add Turso keys — no cloud account needed to start.

```bash
cd personal-fitness-tracker
npm install
cp .env.example .env         # keep DATABASE_URL as-is; TURSO_* blank for now
npm run setup                # prisma generate + db push + seed
npm run dev                  # http://localhost:3000
```

> **Note on `npm install` in a restricted network:** Prisma downloads its query
> engine on install. If that step is blocked, packages still land with
> `npm install --ignore-scripts`; then run `npx prisma generate` once network is
> available. On a normal machine plain `npm install` is fine.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (hot reload) |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Run the unit tests (Vitest, 42 tests) |
| `npm run db:studio` | Browse/edit the DB in Prisma Studio |
| `npm run db:seed` | Seed athlete profile, goals, sync rows (idempotent) |
| `npm run import` | Import `prisma/logbook_data.json` history (idempotent) |
| `npm run setup` | generate + push schema + seed (**local SQLite**) |
| `npm run setup:turso` | generate + push schema to **Turso** + seed |
| `npm run db:push:turso` | Apply the schema to Turso only |

> The PWA service worker only registers in a **production** build (`npm run build
> && npm start`), so to test "install to home screen" use the prod server.

---

## Using it

1. **Plan a session** — Dashboard → *Plan a session* (or the **Plan** tab).
   Pick a type + date, add movements with optional target sets/reps/weight, and
   give two movements the same **superset tag** (e.g. “A”) to pair them.
2. **Open it at the gym** — Dashboard *Today & upcoming*, or the **Plan** tab →
   tap the session. Targets and **last time's weights** are pre-filled next to
   each movement. Enter your actual reps/weight/RPE per set.
   - **Run/Aerobic** sessions show a run block (distance, HR + **HR source**).
   - **Foundation** sessions show a visible **“10-minute cooldown done”** checkbox.
3. **Save & complete** — the plan flips to `completed`, its sets become history
   and feed the dashboard/metrics. A **flag** (never a block) appears if two
   hard (Power/Foundation) sessions land on consecutive days.
4. **Quick log from scratch** still works — Dashboard → *Quick log* (unchanged).
5. **Export** — Dashboard → *Export logbook* → Excel (.xlsx) or CSV.

---

## ☑️ Checklist for you (the morning after)

Everything below needs **your** credentials/decisions — I stubbed it all and
left placeholders. Paste values into `.env` (never commit it).

### Get it running
- [ ] `npm install` then `npm run setup` then `npm run dev` (works immediately on
      local SQLite — do this first to see the app).

### Move to the cloud DB (Turso)
- [ ] **Create the Turso database.** Install the CLI, then:
      `turso db create fitness-tracker`
- [ ] **Copy the URL + token into `.env`:**
      `turso db show fitness-tracker --url` → `TURSO_DATABASE_URL` (`libsql://…`)
      `turso db tokens create fitness-tracker` → `TURSO_AUTH_TOKEN`
- [ ] **Create the schema + seed on Turso:** `npm run setup:turso` then
      `npm run db:seed`. (The app + all scripts auto-target Turso once the two
      env vars are set — no code change.)
- [ ] **Re-import your logbook history into Turso:** put your real
      `prisma/logbook_data.json` back (it's gitignored), then `npm run import`
      (idempotent — safe to re-run).

### Keys for the integrations (optional, when you want them)
- [ ] **Planned-sessions hook** — set `PLANNED_SESSIONS_API_KEY`
      (`openssl rand -hex 32`) to enable `POST /api/planned-sessions`. Until set,
      the endpoint returns 503; the in-app planner works regardless.
- [ ] **Anthropic API key** (`ANTHROPIC_API_KEY`) — enables InBody photo
      extraction. Manual InBody entry already works without it.
- [ ] **Strava** (`STRAVA_CLIENT_ID`/`SECRET`) — run auto-sync. Strava tags HR as
      COROS automatically.
- [ ] **Withings** (`WITHINGS_CLIENT_ID`/`SECRET`) — body-composition trend.
- [ ] Then open `/sync`, connect each, *Sync now*.

### On your phone
- [ ] Add to home screen (use a prod build), confirm fullscreen.
- [ ] Plan a session on the desktop/laptop, then open + log it on the phone.

---

## The planning→app hook — JSON contract

`POST /api/planned-sessions` — creates a **planned** session that then appears in
the app ready to open. This is the "door"; the planning tool that calls it is out
of scope (build that separately).

**Auth:** send the shared secret as a header (either form):

```
x-api-key: <PLANNED_SESSIONS_API_KEY>
# or
Authorization: Bearer <PLANNED_SESSIONS_API_KEY>
```

**Request body:**

```jsonc
{
  "type": "Foundation",          // required: Foundation | Power | Aerobic | Run | Class
  "date": "2026-07-02",          // required: ISO date or datetime
  "title": "Lower body + sled",  // optional
  "location": "Third Space Wimbledon", // optional (defaults to this)
  "notes": "tempo focus",        // optional
  // optional structured warm-up: array of items. Each item is
  // { name, detail?, weightKg? } — weighted items get a weight field in the
  // logger. A plain string is still accepted (stored as one item) for
  // backwards compatibility.
  "warmup": [
    { "name": "Assault bike", "detail": "3 min easy" },
    { "name": "Goblet squat", "detail": "2×10", "weightKg": 20 }
  ],
  "cooldown": "Couch stretch 2×60s",       // optional: array (as above) or legacy string
  "exercises": [                 // required: at least one
    {
      "name": "Back Squat",      // required
      "sets": 4,                 // optional target sets
      "reps": 6,                 // optional target reps
      "weightKg": 100,           // optional target working weight
      "restSeconds": 150,        // optional rest between sets (logger falls back to 90s)
      "tempo": "31X1",           // optional lifting tempo (2–4 chars, digits or X)
      "superset": "A",           // optional: same tag = one superset
      "notes": "brace hard"      // optional
    },
    { "name": "Pull-ups", "sets": 3, "reps": 10, "superset": "A" },
    {
      "name": "Farmer's Carry",  // time-based movement
      "setStyle": "duration",    // optional: "reps" (default) | "duration"
      "durationSeconds": 45,     // optional target hold/carry time (implies duration style)
      "weightKg": 32,            // duration movements may still carry weight
      "sets": 3,
      "restSeconds": 90
    }
  ]
}
```

**Per-exercise extras** (all optional): `restSeconds` drives the logger's rest
timer (default 90s); `tempo` (e.g. `"3030"`, `"31X1"`) enables a tempo metronome
in the logger; `setStyle: "duration"` (or simply providing `durationSeconds`)
makes a movement time-based — the logger shows a hold-time field with a count-up
timer instead of reps, while `weightKg` still applies (e.g. Farmer's Carry).
Session-level `warmup` / `cooldown` are structured item lists that render as
their own collapsible blocks; in the logger each item is tickable, weighted
items take a logged weight, and both ticks and weights persist as you go. Legacy
plain-string values still render (as a single item). During a main exercise you
can also mark individual set rows as **warm-up sets** — they sit above set 1 and
never consume a working-set number.

**Responses:**

| Status | Meaning |
|---|---|
| `201` | Created. Body: `{ "session": { … }, "message": "Planned session created." }` |
| `400` | Invalid body (bad `type`/`date`, no exercises, missing exercise name…). Body: `{ "error": "…" }` |
| `401` | Missing/invalid API key. |
| `503` | `PLANNED_SESSIONS_API_KEY` not set — endpoint disabled. |

**Example:**

```bash
curl -X POST http://localhost:3000/api/planned-sessions \
  -H "content-type: application/json" \
  -H "x-api-key: $PLANNED_SESSIONS_API_KEY" \
  -d '{"type":"Power","date":"2026-07-06","title":"Deadlift day",
       "exercises":[{"name":"Deadlift","sets":5,"reps":3,"weightKg":140}]}'
```

**Other endpoints** (same `x-api-key` auth):

| Method / path | Purpose |
|---|---|
| `GET /api/planned-sessions?scope=upcoming\|all` | List planned sessions (id, date, title). Used by the delete/push CLIs. |
| `PATCH /api/planned-sessions/:id` | Move a planned session's date. Body `{ "date": "YYYY-MM-DD", "force"?: true }`. Responds `409` with a `clash` if the day is occupied and `force` is not set; `409` if the session is completed. |
| `DELETE /api/planned-sessions/:id` | Delete a session (planned or completed) and all of its children. |

### CLI helpers

Payload files live in `sessions/` (gitignored). See `sessions/README.md`.

```bash
export PLANNED_SESSIONS_API_KEY=...          # the x-api-key
export PFT_API_URL=http://localhost:3000     # target app (default)

npx tsx scripts/push-session.ts sessions/<file>.json --dry-run  # validate only
npx tsx scripts/push-session.ts sessions/<file>.json            # create
npx tsx scripts/delete-session.ts --list                        # ids + dates
npx tsx scripts/delete-session.ts <id>                          # delete by id
```

In the app itself, the session detail screen and every Calendar row expose a
"Move", "Duplicate to another date" and "Delete" action (overflow button).
Completed sessions cannot be moved and warn before their logged data is deleted.

---

## Logbook export

`GET /api/export` — one-way (app → file). **No import counterpart** (no two-way
spreadsheet sync, by design).

| Query | Result |
|---|---|
| `?format=xlsx` (default) | One `.xlsx` workbook, four tabs |
| `?format=csv` | One combined `.csv` (tabs separated by `# Sheet:` markers) |
| `?format=csv&tab=run\|gym\|weekly\|body` | A single tab as `.csv` |

Tabs mirror the logbook: **Run Sessions**, **Gym Sessions** (one row per set),
**Weekly Summary** (per-ISO-week counts, hard-session count, run distance, avg
RPE), **Body Measurements** (InBody & Withings as separate rows — never
averaged). Only `completed` sessions are exported. The `.xlsx` writer is
hand-rolled (no heavy dependency) and validated to open in Excel/LibreOffice.

---

## Data rules encoded (with this session's exact amendments)

- **No back-to-back hard sessions** — "hard" = **Power and Foundation only**
  (Aerobic is **not** hard). Flags (never blocks) when two land on the same or
  consecutive days. `src/lib/rules.ts` · `src/lib/constants.ts`.
- **Calf loading is standalone strength work, 2–3×/week** (full range, concentric
  + eccentric) — addressing calf DOMS on outdoor runs. It is **not** a per-run
  ritual/prompt (corrected from an earlier version). The `runs.calf_raises_done`
  field is kept for history but there is **no mandatory calf checkbox** on the run
  log; programme calf work as its own movements instead.
- **10-minute cooldown after Foundation** — stored as `sessions.cooldown_done`
  and surfaced as a **visible prompt** on Foundation sessions.
- **HR is a priority hierarchy, not a whitelist** — 1) COROS, 2) Technogym
  machine, 3) Samsung/Galaxy (fallback, least reliable, Elvanse-inflated). The
  chosen source is stored in `runs.hr_source`; Samsung is accepted but flagged.
  Strava-synced HR is tagged COROS automatically. `pickHrSource()` in
  `src/lib/rules.ts`.
- **Distance/pace = Strava (outdoor) or Technogym (treadmill) only** — Samsung
  distance is never ingested.
- **InBody vs Withings** — separate `body_composition` rows, never averaged.

---

## How it's structured

```
personal-fitness-tracker/
├─ prisma/
│  ├─ schema.prisma        # one data model (Session.status, PlannedExercise, Run.hr_source …)
│  ├─ schema.sql           # generated DDL, applied to Turso by turso-push.ts
│  ├─ turso-push.ts        # create the schema on Turso/libSQL
│  ├─ db-client.ts         # shared PrismaClient factory (Turso adapter or local file)
│  ├─ seed.ts              # athlete profile, goals, sync rows (idempotent)
│  └─ import-logbook.ts    # import real history from logbook_data.json (idempotent)
├─ src/
│  ├─ app/
│  │  ├─ page.tsx          # Dashboard (Today & upcoming, export, trends)
│  │  ├─ plan/             # Plan list, /plan/new (create), /plan/[id] (log actuals)
│  │  │  └─ actions.ts     # server actions: create / complete / delete plan
│  │  ├─ log/strength/     # Quick strength logger (from scratch)
│  │  ├─ checkin/  inbody/  sync/
│  │  └─ api/
│  │     ├─ planned-sessions/ # the planning→app hook (POST) + list (GET)
│  │     ├─ export/           # CSV/xlsx logbook export
│  │     └─ sessions, checkin, body-composition, inbody, sync/*, health-connect
│  ├─ components/          # BottomNav, Scale, charts, SyncControls
│  └─ lib/                 # prisma, constants, rules, plannedSessions, apiKey,
│                          #   export, csv, xlsx, format, strava, withings, dashboard
├─ tests/                  # Vitest (rules, planned, export, integrations, format, anthropic)
└─ public/                 # manifest.webmanifest, sw.js, icons
```

---

## Nothing left unfinished for the target state

All four target features + rule amendments are built, unit-tested and verified
end-to-end (including the full Turso/libSQL path via a local `file:` libSQL DB,
and the `.xlsx` opening in a real reader). The only things that genuinely need
**you** are the credentialed/manual steps in the checklist above (create the
Turso DB, paste keys, re-import your private logbook history). See `DECISIONS.md`
for the assumptions made along the way.
