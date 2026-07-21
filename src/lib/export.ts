// Logbook export — one-way (app → CSV/xlsx). Builds four "tabs" mirroring the
// logbook: Run Sessions, Gym Sessions, Weekly Summary, Body Measurements.
// Read-only; only COMPLETED sessions are exported (planned sessions are not
// history yet). There is deliberately NO spreadsheet import — export only.

import { prisma } from './prisma';
import { isoDate } from './format';
import { RUN_COMPONENT_TYPES, type SessionType } from './constants';
import { parseFlowItems } from './flowItems';

export type CellValue = string | number | null;

export interface Sheet {
  name: string;
  headers: string[];
  rows: CellValue[][];
}

function yesNo(b: boolean): string {
  return b ? 'yes' : 'no';
}

/**
 * One-line summary of a stored warm-up / cool-down column for the export.
 * Each item: name, its detail, the actual (or planned) weight, and a ✓ when
 * ticked — e.g. "Goblet squat 2×10 @20kg ✓; Band pull-aparts ✓".
 */
function flowSummary(raw: string | null): string {
  const items = parseFlowItems(raw);
  if (!items.length) return '';
  return items
    .map((it) => {
      const weight = it.loggedWeightKg ?? it.weightKg ?? null;
      const parts = [it.name];
      if (it.detail) parts.push(it.detail);
      if (weight != null) parts.push(`@${weight}kg`);
      return `${parts.join(' ')}${it.done ? ' ✓' : ''}`;
    })
    .join('; ');
}

/** Build all four export sheets from the current database. */
export async function buildExportSheets(): Promise<Sheet[]> {
  const [sessions, body] = await Promise.all([
    prisma.session.findMany({
      where: { status: 'completed' },
      orderBy: { date: 'asc' },
      include: {
        strengthSets: { orderBy: { setNo: 'asc' } },
        runs: true,
      },
    }),
    prisma.bodyComposition.findMany({ orderBy: { date: 'asc' } }),
  ]);

  const isRun = (t: string) => RUN_COMPONENT_TYPES.includes(t as SessionType);

  // --- Tab 1: Run Sessions -------------------------------------------------
  const runHeaders = [
    'Date', 'Type', 'Title', 'Distance (km)', 'Duration (min)', 'Avg pace',
    'Avg HR', 'Max HR', 'HR source', 'Calf raises done', 'Overall RPE',
    'Source', 'Notes',
  ];
  const runRows: CellValue[][] = [];
  for (const s of sessions) {
    if (!isRun(s.type) && s.runs.length === 0) continue;
    // A session may carry >1 run row; emit one line per run (usually one).
    const runs = s.runs.length ? s.runs : [null];
    for (const r of runs) {
      runRows.push([
        isoDate(s.date),
        s.type,
        s.title ?? '',
        r?.distanceKm ?? null,
        r?.durationMin ?? s.durationMin ?? null,
        r?.avgPace ?? '',
        r?.avgHr ?? null,
        r?.maxHr ?? null,
        r?.hrSource ?? '',
        r ? yesNo(r.calfRaisesDone) : '',
        s.rpeOverall ?? null,
        s.source,
        r?.notes ?? s.notes ?? '',
      ]);
    }
  }

  // --- Tab 2: Gym Sessions (one row per set) -------------------------------
  const gymHeaders = [
    'Date', 'Type', 'Title', 'Duration (min)', 'Energy pre', 'Overall RPE',
    'Cooldown done', 'Warm-up', 'Cool-down', 'Movement', 'Set', 'Warm-up set',
    'Reps', 'Weight (kg)', 'RPE', 'Notes',
  ];
  const gymRows: CellValue[][] = [];
  for (const s of sessions) {
    if (isRun(s.type) && s.strengthSets.length === 0) continue; // pure run → tab 1
    const warm = flowSummary(s.warmup);
    const cool = flowSummary(s.cooldown);
    if (s.strengthSets.length === 0) {
      // A gym-type session with no logged sets still gets a summary line.
      gymRows.push([
        isoDate(s.date), s.type, s.title ?? '', s.durationMin ?? null,
        s.energyPre ?? null, s.rpeOverall ?? null, yesNo(s.cooldownDone),
        warm, cool, '', '', '', '', '', '', s.notes ?? '',
      ]);
      continue;
    }
    for (const set of s.strengthSets) {
      gymRows.push([
        isoDate(s.date), s.type, s.title ?? '', s.durationMin ?? null,
        s.energyPre ?? null, s.rpeOverall ?? null, yesNo(s.cooldownDone),
        warm, cool, set.exerciseName, set.setNo, yesNo(set.isWarmup),
        set.reps ?? null, set.weightKg ?? null,
        set.rpe ?? null, set.notes ?? '',
      ]);
    }
  }

  // --- Tab 3: Weekly Summary ----------------------------------------------
  const weeklyHeaders = [
    'Week (ISO)', 'Week start', 'Sessions', 'Power', 'Foundation', 'Aerobic',
    'Run', 'Class', 'Hard (P+F)', 'Run distance (km)', 'Total duration (min)',
    'Avg RPE',
  ];
  const weekly = new Map<
    string,
    {
      start: Date;
      count: number;
      byType: Record<string, number>;
      hard: number;
      distance: number;
      duration: number;
      rpeSum: number;
      rpeN: number;
    }
  >();
  for (const s of sessions) {
    const { key, start } = isoWeek(s.date);
    let w = weekly.get(key);
    if (!w) {
      w = { start, count: 0, byType: {}, hard: 0, distance: 0, duration: 0, rpeSum: 0, rpeN: 0 };
      weekly.set(key, w);
    }
    w.count++;
    w.byType[s.type] = (w.byType[s.type] ?? 0) + 1;
    if (s.type === 'Power' || s.type === 'Foundation') w.hard++;
    for (const r of s.runs) w.distance += r.distanceKm ?? 0;
    w.duration += s.durationMin ?? 0;
    if (s.rpeOverall != null) {
      w.rpeSum += s.rpeOverall;
      w.rpeN++;
    }
  }
  const weeklyRows: CellValue[][] = [...weekly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, w]) => [
      key,
      isoDate(w.start),
      w.count,
      w.byType['Power'] ?? 0,
      w.byType['Foundation'] ?? 0,
      w.byType['Aerobic'] ?? 0,
      w.byType['Run'] ?? 0,
      w.byType['Class'] ?? 0,
      w.hard,
      round1(w.distance),
      Math.round(w.duration),
      w.rpeN ? round1(w.rpeSum / w.rpeN) : null,
    ]);

  // --- Tab 4: Body Measurements (InBody & Withings, never averaged) --------
  const bodyHeaders = [
    'Date', 'Source', 'Weight (kg)', 'Body fat %', 'Skeletal muscle mass (kg)',
    'Visceral fat', 'BMR', 'Notes',
  ];
  const bodyRows: CellValue[][] = body.map((b) => [
    isoDate(b.date),
    b.source,
    b.weightKg ?? null,
    b.bodyFatPct ?? null,
    b.skeletalMuscleMassKg ?? null,
    b.visceralFat ?? null,
    b.bmr ?? null,
    bodyNote(b.raw),
  ]);

  return [
    { name: 'Run Sessions', headers: runHeaders, rows: runRows },
    { name: 'Gym Sessions', headers: gymHeaders, rows: gymRows },
    { name: 'Weekly Summary', headers: weeklyHeaders, rows: weeklyRows },
    { name: 'Body Measurements', headers: bodyHeaders, rows: bodyRows },
  ];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** ISO-8601 week key ("2026-W27") and the Monday that starts it. */
function isoWeek(d: Date): { key: string; start: Date } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day);
  // ISO week number: Thursday of this week determines the year.
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((thursday.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  const key = `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  return { key, start: new Date(monday.getTime()) };
}

function bodyNote(raw: string | null): string {
  if (!raw) return '';
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return typeof o.notes === 'string' ? o.notes : '';
  } catch {
    return '';
  }
}
