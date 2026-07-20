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
  warmup?: string | null; // structured warm-up text
  cooldown?: string | null; // structured cool-down text
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
      warmup: strOrNull(b.warmup),
      cooldown: strOrNull(b.cooldown),
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
      warmup: input.warmup ?? null,
      cooldown: input.cooldown ?? null,
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
      weightKg: { not: null },
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
  rpe?: number | null;
  notes?: string | null;
}

export interface CompletePlanInput {
  durationMin?: number | null;
  energyPre?: number | null;
  rpeOverall?: number | null;
  cooldownDone?: boolean;
  notes?: string | null;
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
