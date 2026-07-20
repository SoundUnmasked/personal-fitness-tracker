// Allowed values for the "enum-like" string columns (SQLite has no enums).
// Keeping them here means the UI, API validation and tests share one source.

export const SESSION_TYPES = [
  'Foundation',
  'Power',
  'Aerobic',
  'Run',
  'Class',
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

/// Session lifecycle status. A `planned` session is a template to open at the
/// gym; logging actuals against it flips it to `completed` (into history).
export const SESSION_STATUSES = ['planned', 'completed'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/// Session types considered "hard" for the back-to-back warning rule.
/// AMENDMENT (exact, per brief): "hard" = Power and Foundation ONLY.
/// Aerobic is explicitly NOT hard. Run and Class are not hard either.
export const HARD_SESSION_TYPES: SessionType[] = ['Power', 'Foundation'];

/// Session types that include a run component — used to surface the run
/// fields (distance, HR + HR source) when logging.
/// NOTE: calf loading is NOT a per-run prompt (corrected). It is programmed as
/// standalone strength work 2–3×/week; the `runs.calf_raises_done` field is
/// kept for history but is not a mandatory checkbox on every run.
export const RUN_COMPONENT_TYPES: SessionType[] = ['Run', 'Aerobic'];

/// Session types that require the 10-minute cooldown prompt.
export const COOLDOWN_PROMPT_TYPES: SessionType[] = ['Foundation'];

// `manual`   — typed in the app (quick-log or logging a plan's actuals)
// `strava`   — imported from Strava
// `plan-api` — created via the external POST /api/planned-sessions hook
export const SESSION_SOURCES = ['manual', 'strava', 'plan-api'] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

// ---------------------------------------------------------------------------
// Heart-rate source PRIORITY HIERARCHY (not a whitelist).
// Pick the highest-priority source that is actually available; never drop an
// HR reading just because the preferred device is missing. Samsung/Galaxy is a
// legitimate fallback but is the least reliable (Elvanse-inflated) and is
// always flagged. Distance/pace, by contrast, is Strava/Technogym ONLY —
// Samsung distance is never ingested (see DISTANCE_SOURCES).
// ---------------------------------------------------------------------------
export const HR_SOURCES = ['COROS', 'Technogym', 'Samsung'] as const;
export type HrSource = (typeof HR_SOURCES)[number];

/// Priority order, most trusted first. Index = rank.
export const HR_SOURCE_PRIORITY: HrSource[] = ['COROS', 'Technogym', 'Samsung'];

/// HR sources considered unreliable — logged, but flagged in the UI/exports.
export const UNRELIABLE_HR_SOURCES: HrSource[] = ['Samsung'];

/// Distance / pace may ONLY come from these. Samsung distance is not ingested.
export const DISTANCE_SOURCES = ['Strava', 'Technogym'] as const;
export type DistanceSource = (typeof DISTANCE_SOURCES)[number];

export const BODY_COMP_SOURCES = ['InBody', 'Withings'] as const;
export type BodyCompSource = (typeof BODY_COMP_SOURCES)[number];

// How a planned movement is logged. "reps" (the default) uses the kg/reps grid;
// "duration" is time-based (Dead Hang, Farmer's Carry) — logged with a hold time
// and a count-up timer. Weight stays optional either way.
export const SET_STYLES = ['reps', 'duration'] as const;
export type SetStyle = (typeof SET_STYLES)[number];

/** Default rest between sets (seconds) when a movement doesn't specify one. */
export const DEFAULT_REST_SECONDS = 90;

export const SYNC_SOURCES = ['strava', 'withings'] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

export const DEFAULT_LOCATION = 'Third Space Wimbledon';

// Common strength & functional exercises offered as quick-pick chips in the
// logger. (Includes some Hyrox-station movements because they're real exercises
// in this training — not because the app is Hyrox-themed.)
export const COMMON_EXERCISES = [
  'SkiErg',
  'Sled Push',
  'Sled Pull',
  'Burpee Broad Jump',
  'Rowing',
  'Farmers Carry',
  'Sandbag Lunges',
  'Wall Balls',
  'Back Squat',
  'Deadlift',
  'Bench Press',
  'Overhead Press',
  'Pull-ups',
  'Romanian Deadlift',
];
