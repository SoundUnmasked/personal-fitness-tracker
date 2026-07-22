// Planned-sessions domain logic. Kept framework-free and (mostly) pure so it can
// be shared by the in-app server actions AND the external POST /api/planned-sessions
// hook, and unit-tested without a database.

import type { PrismaClient, Prisma } from '@prisma/client';
import {
  SESSION_TYPES,
  DEFAULT_LOCATION,
  SET_STYLES,
  type SessionType,
  type SetStyle,
} from './constants';
import { normalizeFlowInput, serializeFlowItems, type FlowItem } from './flowItems';

// ---------------------------------------------------------------------------
// The JSON contract for a planned session (also documented in the README).
// ---------------------------------------------------------------------------
export interface PlannedExerciseInput {
  name: string;
  sets?: number | null; // target number of sets
  reps?: number | null; // target reps per set
  weightKg?: number | null; // target working weight
  restSeconds?: number | null; // rest between sets (logger falls back to 90s)
  setStyle?: SetStyle | null; // "reps" (default) | "duration" (time-based)
  durationSeconds?: number | null; // target hold/carry time for duration style
  tempo?: string | null; // lifting tempo, e.g. "3030" / "31X1"
  superset?: string | null; // group tag — movements sharing a tag are a superset
  notes?: string | null;
}

export interface PlannedSessionInput {
  type: SessionType;
  date: string; // ISO date ("2026-07-02") or datetime
  title?: string | null;
  location?: string | null;
  notes?: string | null;
  warmup?: FlowItem[] | null; // structured warm-up items
  cooldown?: FlowItem[] | null; // structured cool-down items
  exercises: PlannedExerciseInput[];
}

export interface ValidationResult {
  ok: boolean;
  value?: PlannedSessionInput;
  error?: string;
}

/**
 * Validate & normalise an untrusted JSON body into a PlannedSessionInput.
 * Pure — no DB, no framework. Returns a friendly error string on failure.
 */
export function validatePlannedSession(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Body must be a JSON object.' };
  }
  const b = body as Record<string, unknown>;

  const type = String(b.type ?? '');
  if (!SESSION_TYPES.includes(type as SessionType)) {
    return { ok: false, error: `type must be one of: ${SESSION_TYPES.join(', ')}` };
  }

  if (!b.date || Number.isNaN(new Date(String(b.date)).getTime())) {
    return { ok: false, error: 'date is required and must be a valid date.' };
  }

  const rawExercises = Array.isArray(b.exercises) ? b.exercises : [];
  const exercises: PlannedExerciseInput[] = [];
  for (const [i, raw] of rawExercises.entries()) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: `exercises[${i}] must be an object.` };
    }
    const e = raw as Record<string, unknown>;
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    if (!name) {
      return { ok: false, error: `exercises[${i}].name is required.` };
    }
    const durationSeconds = nonNegIntOrNull(e.durationSeconds);
    // If a duration target is given but no explicit style, treat it as duration.
    const setStyle =
      setStyleOrNull(e.setStyle) ?? (durationSeconds != null ? 'duration' : null);
    exercises.push({
      name,
      sets: intOrNull(e.sets),
      reps: intOrNull(e.reps),
      weightKg: floatOrNull(e.weightKg),
      restSeconds: nonNegIntOrNull(e.restSeconds),
      setStyle,
      durationSeconds,
      tempo: tempoOrNull(e.tempo),
      superset: strOrNull(e.superset),
      notes: strOrNull(e.notes),
    });
  }
  if (exercises.length === 0) {
    return { ok: false, error: 'At least one exercise is required.' };
  }

  return {
    ok: true,
    value: {
      type: type as SessionType,
      date: String(b.date),
      title: strOrNull(b.title),
      location: strOrNull(b.location),
      notes: strOrNull(b.notes),
      warmup: normalizeFlowInput(b.warmup),
      cooldown: normalizeFlowInput(b.cooldown),
      exercises,
    },
  };
}

/** Persist a validated planned session (status = "planned"). */
export async function createPlannedSession(
  prisma: PrismaClient,
  input: PlannedSessionInput,
  source: 'manual' | 'plan-api' = 'manual',
) {
  return prisma.session.create({
    data: {
      date: new Date(input.date),
      type: input.type,
      status: 'planned',
      title: input.title ?? null,
      location: input.location ?? DEFAULT_LOCATION,
      notes: input.notes ?? null,
      warmup: serializeFlowItems(input.warmup),
      cooldown: serializeFlowItems(input.cooldown),
      source,
      plannedExercises: {
        create: input.exercises.map((e, i) => ({
          order: i,
          exerciseName: e.name,
          targetSets: e.sets ?? null,
          targetReps: e.reps ?? null,
          targetWeightKg: e.weightKg ?? null,
          restSeconds: e.restSeconds ?? null,
          setStyle: e.setStyle ?? null,
          durationSeconds: e.durationSeconds ?? null,
          tempo: e.tempo ?? null,
          supersetGroup: e.superset ?? null,
          notes: e.notes ?? null,
        })),
      },
    },
    include: { plannedExercises: { orderBy: { order: 'asc' } } },
  });
}

// ---------------------------------------------------------------------------
// Reschedule / duplicate / delete — shared by the in-app server actions AND the
// external x-api-key endpoints so both behave identically.
// ---------------------------------------------------------------------------

/** True for a "YYYY-MM-DD" (or full ISO) string that parses to a real date. */
export function isValidDateIso(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(new Date(s).getTime());
}

/**
 * UTC day window for a date string. Date-only inputs are stored at UTC midnight
 * (matching createPlannedSession's `new Date("YYYY-MM-DD")`), so a session "on"
 * that day falls in [startOfDay, startOfNextDay).
 */
export function dayRangeUtc(dateIso: string): { start: Date; end: Date } {
  const d = new Date(dateIso);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export interface ClashInfo { id: number; title: string | null; type: string; date: string }

/** Any OTHER session already on the target calendar day (for clash warnings). */
export async function findDateClash(
  prisma: PrismaClient,
  dateIso: string,
  excludeId: number,
): Promise<ClashInfo | null> {
  const { start, end } = dayRangeUtc(dateIso);
  const s = await prisma.session.findFirst({
    where: { id: { not: excludeId }, date: { gte: start, lt: end } },
    select: { id: true, title: true, type: true, date: true },
    orderBy: { date: 'asc' },
  });
  return s ? { id: s.id, title: s.title, type: s.type, date: s.date.toISOString() } : null;
}

/** Move a session to a new date (caller enforces status/validation rules). */
export async function moveSessionDate(prisma: PrismaClient, id: number, dateIso: string) {
  return prisma.session.update({ where: { id }, data: { date: dayRangeUtc(dateIso).start } });
}

/**
 * Delete a session and every child row (planned exercises, strength sets, runs)
 * in one transaction.
 *
 * FK note (Package G.1): the schema DOES declare `ON DELETE CASCADE` on all
 * three child tables (see prisma/schema.sql, applied to Turso by turso-push.ts).
 * But SQLite/libSQL only ENFORCES foreign keys when `PRAGMA foreign_keys = ON`
 * is set on the connection, which is not guaranteed with the libSQL driver
 * adapter used against Turso. So we do NOT rely on cascade: we delete each child
 * table explicitly, then the session. This is correct whether or not FK
 * enforcement (and therefore cascade) is active. Children are removed before the
 * parent so it holds even under strict FK enforcement.
 */
export async function deleteSessionCascade(prisma: PrismaClient, id: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.strengthSet.deleteMany({ where: { sessionId: id } });
    await tx.run.deleteMany({ where: { sessionId: id } });
    await tx.plannedExercise.deleteMany({ where: { sessionId: id } });
    await tx.session.delete({ where: { id } });
  });
}

/**
 * Copy a session's PLAN (exercises, targets, tempo, warm-up, cool-down) onto a
 * new date as a fresh `planned` session. Logged actuals are never copied.
 */
export async function duplicateSession(prisma: PrismaClient, id: number, dateIso: string) {
  const src = await prisma.session.findUnique({
    where: { id },
    include: { plannedExercises: { orderBy: { order: 'asc' } } },
  });
  if (!src) return null;
  return prisma.session.create({
    data: {
      date: dayRangeUtc(dateIso).start,
      type: src.type,
      status: 'planned',
      title: src.title,
      location: src.location,
      notes: src.notes,
      warmup: src.warmup,
      cooldown: src.cooldown,
      source: 'duplicate',
      plannedExercises: {
        create: src.plannedExercises.map((e, i) => ({
          order: i,
          exerciseName: e.exerciseName,
          targetSets: e.targetSets,
          targetReps: e.targetReps,
          targetWeightKg: e.targetWeightKg,
          restSeconds: e.restSeconds,
          setStyle: e.setStyle,
          durationSeconds: e.durationSeconds,
          tempo: e.tempo,
          supersetGroup: e.supersetGroup,
          notes: e.notes,
        })),
      },
    },
    include: { plannedExercises: { orderBy: { order: 'asc' } } },
  });
}

// ---------------------------------------------------------------------------
// Previous weights — progression visibility next to each movement.
// ---------------------------------------------------------------------------
export interface PreviousWeight {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  date: string; // ISO
}

/**
 * For each exercise name, find the most recent COMPLETED set (top working set
 * by weight on the most recent day it was performed). Used to pre-fill / show
 * "last time" next to each planned movement.
 *
 * Bodyweight history counts (fix 5): sets with no weight are included, so a
 * movement only ever done unweighted still reports its previous reps. Within a
 * day, weighted sets outrank unweighted ones (SQLite sorts NULL last on DESC).
 */
export async function previousWeights(
  prisma: PrismaClient,
  names: string[],
  beforeDate?: Date,
): Promise<Record<string, PreviousWeight>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return {};

  const rows = await prisma.strengthSet.findMany({
    where: {
      exerciseName: { in: unique },
      isWarmup: false, // warm-up (ramp-up) sets never count as a "last time" top set
      session: {
        status: 'completed',
        ...(beforeDate ? { date: { lt: beforeDate } } : {}),
      },
    },
    include: { session: { select: { date: true } } },
    orderBy: [{ session: { date: 'desc' } }, { weightKg: 'desc' }],
    take: unique.length * 30,
  });

  const out: Record<string, PreviousWeight> = {};
  const seenDay: Record<string, number> = {};
  for (const r of rows) {
    const name = r.exerciseName;
    const day = Math.floor(r.session.date.getTime() / 86_400_000);
    // Keep only rows from the single most-recent day the exercise was done,
    // and within that day the heaviest set (rows are already weight-desc).
    if (out[name] && seenDay[name] !== day) continue;
    if (!out[name]) {
      seenDay[name] = day;
      out[name] = {
        weightKg: r.weightKg,
        reps: r.reps,
        rpe: r.rpe,
        date: r.session.date.toISOString(),
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Logging actuals against a plan → marks it completed.
// ---------------------------------------------------------------------------
export interface ActualSetInput {
  exerciseName: string;
  setNo?: number;
  reps?: number | null;
  weightKg?: number | null;
  durationSeconds?: number | null; // logged time for duration-style sets
  isWarmup?: boolean; // warm-up (ramp-up) set — excluded from working-set numbering
  rpe?: number | null; // 1-10, half-points allowed
  rpeHigh?: number | null; // upper bound when RPE was a range ("7 or 8")
  notes?: string | null;
}

export interface CompletePlanInput {
  durationMin?: number | null;
  energyPre?: number | null;
  rpeOverall?: number | null;
  cooldownDone?: boolean;
  notes?: string | null;
  warmup?: FlowItem[] | null;   // logged warm-up items (done + loggedWeightKg)
  cooldown?: FlowItem[] | null; // logged cool-down items
  strengthSets: ActualSetInput[];
  run?: {
    distanceKm?: number | null;
    durationMin?: number | null;
    avgPace?: string | null;
    avgHr?: number | null;
    maxHr?: number | null;
    hrSource?: string | null;
    calfRaisesDone?: boolean;
    notes?: string | null;
  } | null;
}

/** Helpers exported for reuse by API routes / actions. */
export function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isNaN(n) ? null : n;
}
export function floatOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
export function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
/** Like intOrNull but clamps negatives to null (seconds are never negative). */
export function nonNegIntOrNull(v: unknown): number | null {
  const n = intOrNull(v);
  return n != null && n >= 0 ? n : null;
}
/** Canonical set style ("reps" | "duration"), else null. */
export function setStyleOrNull(v: unknown): SetStyle | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return (SET_STYLES as readonly string[]).includes(s) ? (s as SetStyle) : null;
}
/** Tempo like "3030" / "31X1" (2–4 chars, digits or X); else null. */
export function tempoOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toUpperCase();
  return /^[0-9X]{2,4}$/.test(s) ? s : null;
}

export type SessionWithChildren = Prisma.SessionGetPayload<{
  include: { plannedExercises: true; strengthSets: true; runs: true };
}>;

// ---------------------------------------------------------------------------
// Finish → strength-set payload. Only sets the user explicitly TICKED are
// saved. Every logger row pre-fills its values from the plan's targets, so
// "has a value" is meaningless as a completion signal — an untouched session
// would save a full workout that never happened and poison the "last time"
// pre-fills. The tick is the user's assertion that the set was performed.
// ---------------------------------------------------------------------------

/** The logger's per-set row shape (values are keypad strings). */
export interface LoggedSetRow {
  kg: string;
  reps: string;
  dur: string;
  rpe: string;
  rpeHi?: string; // upper bound when RPE was logged as a range ("7 or 8")
  done: boolean;
  warmup?: boolean;
}

/**
 * True when a ticked row holds no actual work (Package M fix 3): no positive
 * reps AND no positive duration. "0 reps means the set was not done", and a
 * loaded bar with 0 reps is not a completed set either — positive WEIGHT alone
 * does NOT qualify. Such rows are dropped, never written. A ticked bodyweight
 * set with positive reps, or a timed set with positive duration, is kept.
 */
export function isEmptyTickedSet(s: Pick<LoggedSetRow, 'reps' | 'dur'>): boolean {
  const pos = (v: string) => v !== '' && Number(v) > 0;
  return !pos(s.reps) && !pos(s.dur);
}

/**
 * Build the strength-set payload for a finishing session from the logger's
 * rows. Pure. Includes ONLY ticked (`done`) rows; unticked rows are dropped
 * entirely — no ghost rows, no zero rows. Ticked rows with no positive reps
 * AND no positive duration are also dropped (fix 3) BEFORE numbering — a set
 * needs reps or time to count, weight alone is not enough — so saved working
 * sets count 1..n with no gaps; warm-up rows carry setNo 0 + the flag.
 */
export function tickedStrengthSets(
  exercises: { name: string }[],
  rows: LoggedSetRow[][],
): ActualSetInput[] {
  return exercises.flatMap((ex, ei) => {
    let workNo = 0;
    return (rows[ei] ?? [])
      .filter((s) => s.done && !isEmptyTickedSet(s))
      .map((s) => {
        if (!s.warmup) workNo += 1;
        return {
          exerciseName: ex.name,
          setNo: s.warmup ? 0 : workNo,
          reps: s.reps ? Number(s.reps) : null,
          weightKg: s.kg ? Number(s.kg) : null,
          durationSeconds: s.dur ? Number(s.dur) : null,
          isWarmup: Boolean(s.warmup),
          rpe: s.rpe ? Number(s.rpe) : null,
          rpeHigh: s.rpeHi ? Number(s.rpeHi) : null,
        };
      });
  });
}

/** Run actuals resolved by the caller (HR provenance already picked). */
export interface CompletedRunData {
  distanceKm: number | null;
  durationMin: number | null;
  avgPace: string | null;
  avgHr: number | null;
  maxHr: number | null;
  hrSource: string | null;
  calfRaisesDone: boolean;
  notes: string | null;
}

/**
 * Persist a finished session's actuals and flip it to `completed`. Replaces any
 * prior actuals in the same transaction (idempotent re-save), so re-finishing —
 * e.g. after "Edit logged sets" — overwrites cleanly.
 */
export async function saveCompletedActuals(
  prisma: PrismaClient,
  sessionId: number,
  raw: CompletePlanInput,
  runData: CompletedRunData | null,
  fallbackNotes: string | null,
): Promise<void> {
  const sets: ActualSetInput[] = Array.isArray(raw.strengthSets) ? raw.strengthSets : [];
  await prisma.$transaction(async (tx) => {
    await tx.strengthSet.deleteMany({ where: { sessionId } });
    await tx.run.deleteMany({ where: { sessionId } });

    await tx.session.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        durationMin: intOrNull(raw.durationMin),
        energyPre: intOrNull(raw.energyPre),
        // Float, not int: 7.5 must survive (fix 4 — intOrNull rounded it to 8).
        rpeOverall: floatOrNull(raw.rpeOverall),
        // cooldownDone is persisted live from the logger's cool-down block, so
        // only overwrite it when the finish step explicitly sends a value.
        ...(raw.cooldownDone !== undefined ? { cooldownDone: Boolean(raw.cooldownDone) } : {}),
        // Persist logged warm-up / cool-down items (ticks + actual weights).
        ...(raw.warmup !== undefined ? { warmup: serializeFlowItems(raw.warmup) } : {}),
        ...(raw.cooldown !== undefined ? { cooldown: serializeFlowItems(raw.cooldown) } : {}),
        notes: strOrNull(raw.notes) ?? fallbackNotes,
        strengthSets: {
          create: sets
            .filter((s) => s.exerciseName?.trim())
            .map((s, i) => ({
              exerciseName: s.exerciseName.trim(),
              setNo: s.setNo ?? i + 1,
              reps: intOrNull(s.reps),
              weightKg: floatOrNull(s.weightKg),
              durationSeconds: nonNegIntOrNull(s.durationSeconds),
              isWarmup: Boolean(s.isWarmup),
              // Float, not int: half-point RPEs survive (fix 4).
              rpe: floatOrNull(s.rpe),
              rpeHigh: floatOrNull(s.rpeHigh),
              notes: strOrNull(s.notes),
            })),
        },
        runs: runData ? { create: runData } : undefined,
      },
    });
  });
}
