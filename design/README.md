# Handoff: Personal Fitness Tracker — visual redesign

> **These are static design comps, not application code. Use them as a reference for values, layout and copy only. Do not copy markup or CSS into the app. The app is an existing Next.js PWA and is being restyled, not rebuilt.**

## Overview
A full visual redesign of a personal fitness tracker PWA used one-handed, mid-set, in a dim gym. The goal was to replace a cheap, pale, over-rounded look with a restrained, instrument-like dark UI in the reference class of shipped logging apps (Strong, Hevy, Strava). This bundle covers the approved direction, the craft specification, and every screen restyled to it.

## About the design files
The files in this bundle are **static design comps in HTML** — reference for values, layout and copy only. Do not copy their markup or CSS. Restyle the existing Next.js PWA to match them, using its established components and patterns.

Two source files, both single-file HTML "canvas" documents (multiple 390x844 phone frames laid out side by side, each with a focal-point note). **Which screens live where:**

- **`Fitness Redesign - Direction v2.dc.html`** — the **active logging grid** (shown in two states: native keyboard open, and resting) and the **planned session preview**. Also holds a 2× detail crop of the current-set component. These two screens live *only* here.
- **`Fitness Redesign - App Pass.dc.html`** — **everything else**: Home, Plan, Metrics, Profile, Session complete, Edit session, Passphrase unlock, Empty / Error / Offline states, plus the token sheet.

No superseded/older prototype screens are included in this bundle by design — they predate the craft spec and would conflict. Use only the two files above.

(`support.js` is included only so the HTML opens in a browser; it is the mockup runtime, not part of the app.)

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii and states. Recreate pixel-accurately using the codebase's libraries. All hex values, sizes and rules below are authoritative.

---

## Design tokens

### Colour — flat surface ramp (no gradients, no glow)
Depth comes from stacked flat surfaces + space, never from light spill, bloom or coloured shadow.

| Token | Hex | Use |
|---|---|---|
| Background | `#0C0E11` | Screen base |
| Surface 1 | `#14171B` | Rows, list cards, tiles |
| Surface 2 | `#1C2026` | Raised / current item, keypad accessory, bottom sheet |
| Surface 3 | `#262B32` | Input fields, pressed |
| Hairline | `#2E343B` | 1px separators only, low usage |
| Text primary | `#F1F3F5` | Numbers, titles |
| Text secondary | `#98A0A8` | Supporting text |
| Text tertiary | `#666E76` | Timestamps, faint labels, disabled |
| Accent | `#3E6FD9` | See accent budget |
| Accent text | `#7CA0EA` | Accent used as small text/label on dark (live word, connected links, active tab) |
| Amber (status only) | `#D9A441` | Offline/paused, always paired with icon + word |
| Red (status only) | `#C9524B` | Errors only, always paired with icon + word |

**Accent budget: under 10% of visible pixels.** Permitted only on: the primary action button, the live/current-state indicator, the current day, the active nav item, and progress fills. Numbers are white, section labels are grey — never accent. Status colours are never decoration and must be double-coded with an icon or word so they read without colour.

### Typography — one face, tabular figures
Single family: **Geist** (fallback `system-ui, -apple-system, sans-serif`). Heavier weight for numbers. **Enable tabular figures everywhere** (`font-feature-settings: 'tnum' 1; font-variant-numeric: tabular-nums`) so digits do not shift width as values change.

| Role | Size | Weight | Tracking | Line-height |
|---|---|---|---|---|
| Hero number (current set, big timer) | 56px | 600 | -0.03em | 1.0–1.1 |
| Screen title | 28px | 600 | -0.02em | 1.1 |
| Section heading | 17px | 600 | -0.01em | 1.1 |
| Body / list row | 15px | 450 | 0 | 1.4 |
| Secondary detail | 13px | 450 | 0 | 1.4 |
| Smallest label | 12px | 500 | 0 | 1.4 |

Do not use more than four steps of this scale on a single screen.

### Spacing & shape
- 4px base unit; all spacing in multiples of 4.
- Screen padding 20px.
- Vertical rhythm: 24px between sections, 12px within a group.
- Radii, three values only: **16px** cards/tiles, **10px** inputs/rows, **12px** buttons. (Device frame in mockups is 46px; that is the phone bezel, not app chrome.)
- Borders: avoid. Separate with surface elevation or space. Where a hairline is unavoidable, 1px at `#2E343B`. The one allowed border is a dashed `#2E343B` outline on an **empty/placeholder** slot.

### Number formatting (consistency is critical)
1. Sets by reps: `4 × 5` (sets first).
2. Weight and reps: `100 kg × 5` (weight first, unit lowercase with a space).
3. Never place both formats adjacent without a distinguishing label.
4. Use the true multiplication sign `×` (U+00D7), never the letter x.
5. RPE ranges use a plain hyphen: `7-8`.
6. Duration: `24:15` for live timers, `52 min` for estimates.
7. Weights show a decimal only when one exists: `100 kg`, `22.5 kg`.
8. Decrement controls use a real minus `−` (U+2212). **Em dashes and en dashes are banned everywhere** — use a hyphen, colon or middot.

---

## Data truth — the standing rule
**If a field, feature, connection or label cannot be confirmed to exist, it does not go in the UI.** Show an empty state or omit the element. This project repeatedly had to remove plausible-but-fake fitness-app furniture.

**Fields that exist:** planned sessions, exercises, sets, reps, weight (kg), RPE (may be a range like `7-8`), rest time, tempo, session duration, notes, warm-up (a guide, not logged), session history for "last time" values, and periodic **InBody scans** (weight, body-fat %, skeletal muscle mass, scan date). Body composition comes from periodic scans every few weeks — never a daily reading.

**Explicitly forbidden (do not add):** readiness score / any score out of 100, HRV, step count, calorie ring, VO₂max, resting HR, daily body weight, day-streak / consecutive-day / consistency counters. None exist in this app. A streak also works against the programme (planned deloads and rest days are correct, not failures).

**Training cycle:** 12 weeks — Base (1–4), Pace (5–8), Accelerate (9–10), Reset (11–12), deloads at weeks 4 and 8. Week label format: **"Pace, week 6"** (phase is Base / Pace / Accelerate / Reset).

**Session names — use only these (from the real logbook):** `Power (Upper)`, `Power (Lower)`, `Foundation (Run and Circuit)`, `Zone 2 Run`. If a screen needs another, use a clearly-marked placeholder — never invent a plausible name.

**Connected sources:** default every source to **"Not connected"** unless a connection is confirmed. Current true state: Strava = not connected (scaffolding only), InBody = manual upload. Do not show Apple Health (wrong platform for a web app). No Face ID. No quick-add/centre nav button. No reminders unless confirmed.

---

## Screens

Navigation is a **four-tab bar** (no centre button): Home, Plan, Metrics, Profile. Active tab uses accent icon + label; inactive `#666E76`. 82px tall, 1px top hairline `#2E343B`.

### Active logging grid — the working screen  *(see Direction v2)*
The most-used screen; primary actions in the bottom third for the thumb. Header: back chevron, session name `Power (Lower)` + `Set 6 of 22`, a **Live** indicator (accent dot, pulse opacity animation, word "Live" in accent — no glow), and the session clock `24:15`.
- **Current-set card** is the single focal point on Surface 2, radius 16: label `Set 3 of 4` (12px grey), then the hero readout `100 kg × 5` at 56px white. The active field (reps) is white with a 2px accent bottom border (the only accent). RPE is an empty Surface-3 field (blank, never a dash). `Last time 95 kg × 5` in grey.
- **Ledger** of the other sets, subordinate: done sets = filled `check_circle` (grey) + values + RPE; upcoming = `radio_button_unchecked` (grey) + "Upcoming". States differ by **icon shape, weight and size, not colour**. Sets read 1, 2, 3, 4 in sequence — the hero card sits in position 3 so no integer is skipped.
- **Two states documented:**
  - *Keyboard open (entering):* the phone's **native decimal keyboard** (`inputmode="decimal"`) — no custom numpad. The current-set card stays fully visible above it. A Surface-2 accessory bar above the keyboard holds the label "Reps" and the accent **Log set 3** button.
  - *Resting (keyboard closed):* the current-set card becomes the **rest timer** — `1:28` at 56px, an accent progress bar, and controls `−15s` / `Skip rest` / `+15s` (Surface 3), plus "Up next — Set 4 · 100 kg × 5". This is the most important element while resting, so it takes the card, not a thin bar.

### Planned session preview — the pre-session read  *(see Direction v2)*
Answers "what am I about to do, and how hard". Title `Power (Lower)` 28px; eyebrow date; "Strength block, week 3" sub. One raised Surface-2 card leads with **how hard**: `RPE 8-9` at 56px (top-set effort, a real field), with 6 exercises / 22 sets / 52 min below. "The plan" is a light-separated list (no boxes): exercise 1, a superset bracket over 2 and 3 (accent left border, label "Superset: alternate"), then `4-6` grouped — numbered 1,2,3,4-6 with no gap. Single accent button **Start session** in the bottom third.

### Home — the dashboard  *(App Pass)*
Answers, at a glance: where am I in the plan, how is the week, what is today. Built only from real fields; tiles hide when data is missing (never zeros or placeholder numbers).
- Greeting: `Wed 23 Jul` + "Morning, Oliver" + avatar `O` (Surface 2 circle).
- **Cycle position** (highest, Surface 2): "Training cycle" / "Week 6 of 12"; phase name **Pace** at 24px; a 12-week segmented bar grouped Base / Pace / Accel / Reset (done weeks `#464C55`, current week accent, upcoming Surface 3); caption "Deloads at weeks 4 and 8".
- **This week** strip (quiet): 7 day cells, done = `check_circle` grey, today = accent dot, planned = grey dot, rest = short dash. "2 done · 4 planned" via gap (no dot-chain).
- **Body composition** (Surface 1): "Scanned 12 Jul"; three values — Weight 78.4 kg (−1.2 kg), Body fat 15.1% (−0.9%), Muscle 38.6 kg (+0.3 kg). Changes are grey, since the previous scan. If only one scan, show values with no change; if none, hide the tile.
- **Recent milestone** (Surface 1, single line, shown only if a top set in the last 3 sessions beat all previous): trophy + "New best — Trap-bar deadlift, 100 kg × 5". Hidden otherwise, never empty.
- **Connected data slot** (empty state, dashed hairline): bed icon, "Sleep", "Connect Strava to show last night", a "Connect" chip. No numbers, no fake trend.
- **Today** (anchored low): "Today" / `Power (Lower)` 28px / "6 exercises  52 min  top RPE 8-9" (gap-separated) / exercise chips / accent **Open session** button.

### Plan  *(App Pass)*
Header "Plan" + "Pace, week 6". Two sections, **Upcoming** and **Completed**, as light-separated Surface-1 rows: date block, session name, type + duration, and a status (today = accent "Log" + accent left border; done = `check_circle` grey + "Done"; planned = "Planned"). Uses only the four real session names.

### Metrics  *(App Pass)*
Header "Progress" + "From your logged sessions". Only real, logged-derived data: **Top sets** per movement (name, quiet grey sparkline of real progression with an accent latest point, current best e.g. `100 kg × 5`); **Session volume** (weekly, `8,750 kg this week`, 6 grey bars with the current week accent); **Run pace** (5K `22:40`, 10K `47:20`, Threshold `4:35 /km`, with "faster" deltas); **Body composition** InBody scans shown as discrete dated readings (24 May / 14 Jun / 12 Jul), "Every few weeks, not daily". No invented metrics.

### Profile  *(App Pass)*
Header "Profile". Identity: avatar `O`, "Oliver", "Pace, week 6", edit. Two stat tiles: **Sessions this week (3)**, **Total sessions logged (86)** — no streak. Grouped rows (Surface 1, accent icon in a Surface-2 square, chevron):
- **Training:** Current plan → "Pace, week 6"; Goal → "Broad athleticism".
- **Connected sources:** Strava → "Not connected" (grey); InBody → "Manual upload".
- **Security:** Passphrase → "Set".
- **Preferences:** Units → "Metric · kg"; Appearance → "Dark".
- Sign out.

### Session complete  *(App Pass)*
Shown after finishing. Surface-2 check badge (accent icon, not a full accent fill), "Session logged", `Power (Lower)`, date. Stat card: Duration `58:24`, **Working sets 20**, Volume `8,750 kg`. "Logged" list of exercises with `4 of 4` style completion. **Only ticked sets count** — warm-up appears as "Warm-up — guide only" with no fraction, so it never reads as "0 of 8" or a failure. Accent **Save session**; grey "Discard".

### Edit a completed session  *(App Pass)*
Distinct from an active session: **no running clock**. Header "Edit session" + "Wed 23 Jul · Power (Lower)" + delete icon. A locked banner shows the **recorded duration `58:24` as fixed — it cannot be edited**. Set values are editable Surface-3 fields. **Save routes through a confirmation bottom sheet** ("Save changes to this session? This overwrites the original logged record. The recorded duration of 58:24 stays fixed." → Cancel / Save changes) because the save is destructive.

### Passphrase unlock  *(App Pass)*
The entry gate: calm, generous space. App mark, "Welcome back", "Enter your passphrase to continue", a single masked field with a visibility toggle, and one accent **Unlock** button. No Face ID, no other action.

### Empty / Error / Offline states  *(App Pass)*
- **Empty (no sessions yet):** centered icon, "No sessions yet", a calm prompt, accent "Plan a session". No zeros; home simply hides tiles it cannot fill.
- **Error (failed load):** "Couldn't load your training", reassurance that logged sessions are safe, accent "Try again", grey "Work offline". Not alarmist; not red-for-its-own-sake.
- **Offline:** an **amber** banner paired with a `cloud_off` icon and the word "Offline" (reads without colour). Cached sessions stay usable; a note says changes sync on reconnect.

---

## Interactions & behavior
- **Live indicator / rest / resting card:** pulse via opacity only (no glow). Rest timer counts down with an accent progress fill; ±15s and skip.
- **Set entry:** tap a value → native decimal keyboard; Log advances to the next field/set.
- **Icons:** Material Symbols Rounded, used sparingly for utility only (identity comes from type + surface, not icons).
- **Destructive save (edit session):** always confirm; never overwrite the recorded duration.
- **Graceful degradation:** every tile/section hides when its data is missing — no zeros, no placeholder numbers.

## Assets
No raster assets. Fonts: **Geist** and **Material Symbols Rounded** (Google Fonts). Icons: Material Symbols Rounded. Avatar is a text monogram. Replace the mockup icon set with the codebase's own consistent set if one exists.

## Files
- `Fitness Redesign - App Pass.dc.html` — Home, Plan, Metrics, Profile, Session complete, Edit session, Passphrase, Empty/Error/Offline, token sheet.
- `Fitness Redesign - Direction v2.dc.html` — active logging grid (2 states), planned session preview, 2× current-set detail crop.
- `screens/*.png` — one PNG per screen (2× of 390×844).
- `token_sheet.png` — the colour / type / radii token reference.

## Open questions — confirm against the real codebase/backend before building
1. Which data sources are actually connectable? (Strava shown as "Not connected"; InBody is manual upload.) Only show sources that can truly connect.
2. Confirm the exact InBody fields available (weight, body-fat %, skeletal muscle mass assumed).
3. Session names beyond the four real ones — use a marked placeholder until confirmed.
4. Confirm there is no quick-add and no reminders feature (both removed as unconfirmed); re-add only if they exist.
5. Volume/milestone derivations (e.g. "new best", weekly kg) must be computed from real logged sets.
