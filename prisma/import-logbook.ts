/**
 * Import real logbook history into the database.
 *
 * Source: prisma/logbook_data.json  (runs, gym_sessions, body_measurements).
 *
 * IDEMPOTENCY: skip-if-exists (non-destructive). A session is skipped when a
 * session with the same calendar date AND title already exists; a body-comp row
 * is skipped when an InBody row already exists on the same date. So this can be
 * re-run safely (e.g. after migrating to the cloud DB) without duplicating, and
 * it won't wipe anything you add manually. Re-run with:  npm run import
 *
 * FIDELITY: structured set parsing is best-effort. The full original `detail`
 * and `notes` for every movement are always preserved verbatim in the set's
 * notes, so nothing is lost even where the structured weight/reps are coarse.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePrismaClient } from './db-client';

const prisma = makePrismaClient();

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

interface ParsedDate {
  date: Date | null;
  fuzzy: boolean; // true when approximate (~) or month-only
  note?: string;
}

/** Parse human date strings: "26 Apr 2026", "~23 Apr 2026", "Dec 2024". */
function parseDate(raw: string): ParsedDate {
  if (!raw) return { date: null, fuzzy: true, note: 'empty date' };
  let s = raw.trim();
  let fuzzy = false;
  if (s.startsWith('~')) {
    fuzzy = true;
    s = s.slice(1).trim();
  }
  // DD Mon YYYY
  let m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon !== undefined) {
      return { date: new Date(Number(m[3]), mon, Number(m[1]), 12, 0, 0), fuzzy };
    }
  }
  // Mon YYYY  -> default day to the 1st
  m = s.match(/^([A-Za-z]{3,})\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon !== undefined) {
      return {
        date: new Date(Number(m[2]), mon, 1, 12, 0, 0),
        fuzzy: true,
        note: 'month/year only — defaulted to the 1st',
      };
    }
  }
  return { date: null, fuzzy: true, note: `unparseable date "${raw}"` };
}

/** "1:18:37" -> 78.6 min, "45:09" -> 45.15 min, "~2hrs" -> 120, takes first token. */
function parseDurationMin(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.replace(/~/g, '').trim();
  const hrs = s.match(/(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/i);
  if (hrs) return Number(hrs[1]) * 60;
  const t = s.match(/(\d+):(\d{1,2})(?::(\d{1,2}))?/);
  if (t) {
    const a = Number(t[1]);
    const b = Number(t[2]);
    const c = t[3] !== undefined ? Number(t[3]) : null;
    return c !== null ? a * 60 + b + c / 60 : a + b / 60; // H:M:S vs M:S
  }
  return null;
}

/** HR provenance from a source string, by priority: COROS > Technogym > Samsung. */
function parseHrSource(raw: string): string | null {
  const s = raw.toLowerCase();
  if (s.includes('coros')) return 'COROS';
  if (s.includes('technogym') || s.includes('machine')) return 'Technogym';
  if (s.includes('galaxy') || s.includes('samsung')) return 'Samsung';
  return null;
}

function parseFirstInt(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  return m ? Math.round(Number(m[0])) : null;
}

function parseFloatNum(raw: string | null): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const m = String(raw).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

interface RpeInfo {
  value: number | null;
  text: string;
  isRange: boolean;
}
/** "8-9/10 (R3)" -> {value:9, text:"8-9/10 (R3)", isRange:true}. */
function parseRpe(raw: string | null): RpeInfo | null {
  if (!raw) return null;
  const text = raw.trim();
  const before = text.split('/')[0]; // drop "/10"
  const range = before.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) {
    const mid = (Number(range[1]) + Number(range[2])) / 2;
    return { value: clampRpe(Math.round(mid)), text, isRange: true };
  }
  const single = before.match(/\d+/);
  return single
    ? { value: clampRpe(Number(single[0])), text, isRange: false }
    : { value: null, text, isRange: false };
}
function clampRpe(n: number): number {
  return Math.min(Math.max(n, 1), 10);
}

/** Per-set weights when the weight string lists them with "/", else [single]. */
function parseWeights(raw: string | null): number[] {
  if (!raw) return [];
  const cleaned = raw.replace(/\([^)]*\)/g, ''); // drop "(WU 30kg)" etc.
  const parts = cleaned.split('/');
  const out: number[] = [];
  for (const p of parts) {
    const m = p.match(/-?\d+(?:\.\d+)?/);
    if (m) out.push(Number(m[0]));
  }
  return out;
}

/** Rep target from a movement name token like "x8" / "x10/leg" (not time). */
function parseRepsFromName(name: string): number | null {
  if (/[x×]\s*\d+\s*(?:sec|secs|s\b|min|mins|m\b)/i.test(name)) return null;
  const m = name.match(/[x×]\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

interface Block {
  label: string | null;
  name: string;
}
function splitBlock(movement: string): Block {
  const m = movement.match(
    /^\s*(BLOCK\s+[A-Z]+|Warm-?up|Warm\s*up|Finish|Cool-?down)\s*[—–-]\s*(.+)$/i,
  );
  if (m) return { label: m[1].replace(/\s+/g, ' ').trim(), name: m[2].trim() };
  return { label: null, name: movement.trim() };
}

function joinNotes(parts: (string | null | undefined)[]): string | null {
  const out = parts.filter((p): p is string => !!p && p.trim() !== '');
  return out.length ? out.join(' · ') : null;
}

function dayRange(d: Date): { gte: Date; lt: Date } {
  const gte = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
  const lt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0);
  return { gte, lt };
}

// ---------------------------------------------------------------------------
// Types of the source JSON (loose — fields are strings)
// ---------------------------------------------------------------------------
interface RunRec {
  date: string; week?: string; day?: string; session_type: string;
  distance_km?: string; time?: string; avg_pace?: string; avg_hr?: string;
  max_hr?: string; elevation_m?: string | null; rpe?: string; source?: string;
  notes?: string;
}
interface MovementRec {
  movement: string; weight?: string | null; detail?: string | null;
  rpe?: string | null; notes?: string | null;
}
interface GymRec {
  date: string; week?: string; day?: string; session_type: string;
  duration?: string | null; calories?: string | null; avg_hr?: string | null;
  rpe?: string | null; movements: MovementRec[];
}
interface BodyRec {
  date: string; source: string; weight_kg?: string; smm_kg?: string;
  body_fat_pct?: string; inbody_score?: string | null; notes?: string;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
const flags: string[] = [];
let sessionsCreated = 0;
let sessionsSkipped = 0;
let setsCreated = 0;
let runsCreated = 0;
let scansCreated = 0;
let scansSkipped = 0;

async function sessionExists(date: Date, title: string): Promise<boolean> {
  const { gte, lt } = dayRange(date);
  const found = await prisma.session.findFirst({
    where: { date: { gte, lt }, title },
    select: { id: true },
  });
  return !!found;
}

async function importRuns(runs: RunRec[]) {
  for (const r of runs) {
    const pd = parseDate(r.date);
    if (!pd.date) {
      flags.push(`RUN skipped — ${pd.note} (${r.session_type})`);
      continue;
    }
    if (pd.fuzzy) flags.push(`RUN ${r.date}: ${pd.note ?? 'approximate date'} — kept`);

    const title = r.session_type;
    if (await sessionExists(pd.date, title)) {
      sessionsSkipped++;
      continue;
    }

    const type = /aerobic/i.test(r.session_type) ? 'Aerobic' : 'Run';
    const isStrava = /strava/i.test(r.source ?? '');
    const durMin = parseDurationMin(r.time ?? null);
    const rpe = parseRpe(r.rpe ?? null);
    // HR provenance from the priority hierarchy (COROS > Technogym > Samsung),
    // read from the `source` string. Distance still comes from Strava/Technogym.
    const hrSource = parseHrSource(r.source ?? '');
    if (hrSource === 'Samsung') flags.push(`RUN ${r.date}: HR source Samsung/Galaxy (fallback, Elvanse-inflated) — flagged`);
    // Historical record only: whether calf work happened to be logged that day.
    // (Calf loading is standalone 2–3×/week strength work, NOT a per-run ritual.)
    const calf = /eccentric calf raise|calf raises/i.test(r.notes ?? '');
    if (rpe?.isRange) flags.push(`RUN ${r.date}: RPE range "${rpe.text}" -> stored ${rpe.value}`);

    const runNote = joinNotes([
      r.source ? `Source: ${r.source}` : null,
      rpe ? `RPE ${rpe.text}` : null,
      r.elevation_m ? `Elevation ${r.elevation_m}m` : null,
      r.week || r.day ? `${r.week ?? ''} ${r.day ?? ''}`.trim() : null,
    ]);

    await prisma.session.create({
      data: {
        date: pd.date,
        type,
        title,
        durationMin: durMin !== null ? Math.round(durMin) : null,
        energyPre: null,
        rpeOverall: rpe?.value ?? null,
        source: isStrava ? 'strava' : 'manual',
        notes: r.notes ?? null,
        runs: {
          create: {
            distanceKm: parseFloatNum(r.distance_km ?? null),
            durationMin: durMin,
            avgPace: r.avg_pace ?? null,
            avgHr: parseFirstInt(r.avg_hr ?? null),
            maxHr: parseFirstInt(r.max_hr ?? null),
            hrSource,
            calfRaisesDone: calf,
            notes: runNote,
          },
        },
      },
    });
    sessionsCreated++;
    runsCreated++;
  }
}

async function importGym(gyms: GymRec[]) {
  for (const g of gyms) {
    const pd = parseDate(g.date);
    if (!pd.date) {
      flags.push(`GYM skipped — ${pd.note} (${g.session_type})`);
      continue;
    }
    const title = g.session_type;
    if (await sessionExists(pd.date, title)) {
      sessionsSkipped++;
      continue;
    }

    const type = /power/i.test(g.session_type)
      ? 'Power'
      : /foundation/i.test(g.session_type)
        ? 'Foundation'
        : 'Foundation';
    const rpe = parseRpe(g.rpe ?? null);
    const durMin = parseDurationMin(g.duration ?? null);

    // Metrics that have no dedicated column are preserved in session notes.
    const sessionNotes = joinNotes([
      g.avg_hr ? `Avg HR ${g.avg_hr}` : null,
      g.calories ? `${g.calories}` : null,
      g.duration ? `Duration ${g.duration}` : null,
      rpe ? `RPE ${rpe.text}` : null,
      g.week || g.day ? `${g.week ?? ''} ${g.day ?? ''}`.trim() : null,
    ]);

    // Build strength_sets from movements.
    const setData: {
      exerciseName: string; setNo: number; reps: number | null;
      weightKg: number | null; rpe: number | null; notes: string | null;
    }[] = [];

    for (const mv of g.movements) {
      const { label, name } = splitBlock(mv.movement);
      const notCompleted = /not completed/i.test(name) || /not completed/i.test(mv.detail ?? '');
      const exerciseName = notCompleted
        ? `${label ? label + ' — ' : ''}not completed`.trim()
        : name;
      if (notCompleted) flags.push(`GYM ${g.date}: "${mv.movement}" marked NOT COMPLETED — kept with note`);

      const weights = parseWeights(mv.weight ?? null);
      const repsName = parseRepsFromName(name);
      const mvRpe = parseRpe(mv.rpe ?? null);

      const fullNote = joinNotes([
        label ? `[${label}]` : null,
        mv.detail ?? null,
        mv.notes ?? null,
        mv.weight ? `Load: ${mv.weight}` : null,
      ]);

      if (weights.length >= 2) {
        // Clear per-set progression -> one row per weight.
        weights.forEach((w, i) => {
          setData.push({
            exerciseName,
            setNo: i + 1,
            reps: repsName,
            weightKg: w,
            rpe: i === 0 ? mvRpe?.value ?? null : null,
            notes: i === 0 ? fullNote : null,
          });
        });
      } else {
        setData.push({
          exerciseName,
          setNo: 1,
          reps: repsName,
          weightKg: weights[0] ?? null,
          rpe: mvRpe?.value ?? null,
          notes: fullNote,
        });
      }
    }

    await prisma.session.create({
      data: {
        date: pd.date,
        type,
        title,
        durationMin: durMin !== null ? Math.round(durMin) : null,
        rpeOverall: rpe?.value ?? null,
        source: 'manual',
        notes: sessionNotes,
        strengthSets: { create: setData },
      },
    });
    sessionsCreated++;
    setsCreated += setData.length;
  }
}

async function importBody(rows: BodyRec[]) {
  for (const b of rows) {
    const pd = parseDate(b.date);
    if (!pd.date) {
      flags.push(`BODY skipped — ${pd.note}`);
      continue;
    }
    if (pd.fuzzy) flags.push(`BODY ${b.date}: ${pd.note ?? 'approximate date'} — kept`);

    const source = /inbody/i.test(b.source) ? 'InBody' : b.source;
    const { gte, lt } = dayRange(pd.date);
    const exists = await prisma.bodyComposition.findFirst({
      where: { source, date: { gte, lt } },
      select: { id: true },
    });
    if (exists) {
      scansSkipped++;
      continue;
    }

    await prisma.bodyComposition.create({
      data: {
        date: pd.date,
        source,
        weightKg: parseFloatNum(b.weight_kg ?? null),
        bodyFatPct: parseFloatNum(b.body_fat_pct ?? null),
        skeletalMuscleMassKg: parseFloatNum(b.smm_kg ?? null),
        // No notes/score columns on body_composition -> preserved in raw.
        raw: JSON.stringify(b),
      },
    });
    scansCreated++;
  }
}

async function main() {
  const file = join(process.cwd(), 'prisma', 'logbook_data.json');
  const data = JSON.parse(readFileSync(file, 'utf8')) as {
    runs: RunRec[];
    gym_sessions: GymRec[];
    body_measurements: BodyRec[];
  };

  await importRuns(data.runs ?? []);
  await importGym(data.gym_sessions ?? []);
  await importBody(data.body_measurements ?? []);

  console.log('\n========== Logbook import summary ==========');
  console.log(`Sessions created : ${sessionsCreated}  (skipped existing: ${sessionsSkipped})`);
  console.log(`  ├─ runs        : ${runsCreated}`);
  console.log(`  └─ strength sets: ${setsCreated}`);
  console.log(`Body-comp scans  : ${scansCreated}  (skipped existing: ${scansSkipped})`);
  if (flags.length) {
    console.log(`\n⚠ ${flags.length} thing(s) to eyeball:`);
    for (const f of flags) console.log(`   - ${f}`);
  } else {
    console.log('\nNo parse warnings.');
  }
  console.log('============================================\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
