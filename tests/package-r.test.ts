// Package R — "Edit logged sets" hydration + destructive-re-save guard.
//   fix 1: a completed session reconstructs into per-exercise rows (which the
//          logger renders pre-ticked), matching what was saved.
//   fix 2: a re-save that would remove existing recorded sets is flagged for
//          confirmation, and confirming it really does reduce the DB rows.
//
// Throwaway libSQL FILE DB from prisma/schema.sql — never dev.db/Turso.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import {
  createPlannedSession,
  saveCompletedActuals,
  reconstructCompletedRows,
  validatePlannedSession,
  tickedStrengthSets,
  type LoggedSetRow,
} from '@/lib/plannedSessions';

// The exact guard the Finish sheet applies (fix 2).
const removesRecordedHistory = (existing: number, next: number) => existing > 0 && next < existing;

describe('fix 1 — reconstructCompletedRows (pure)', () => {
  it('aligns saved sets to planned exercises, in order, with warm-up flags', () => {
    const planned = [{ exerciseName: 'Back Squat' }, { exerciseName: 'Pull-ups' }];
    const saved = [
      { exerciseName: 'Back Squat', reps: 5, weightKg: 60, durationSeconds: null, rpe: null, rpeHigh: null, isWarmup: true },
      { exerciseName: 'Back Squat', reps: 6, weightKg: 100, durationSeconds: null, rpe: 7.5, rpeHigh: 8.5, isWarmup: false },
      { exerciseName: 'Pull-ups', reps: 10, weightKg: null, durationSeconds: null, rpe: 8, rpeHigh: null, isWarmup: false },
    ];
    const rows = reconstructCompletedRows(planned, saved);
    expect(rows[0]).toEqual([
      { kg: '60', reps: '5', dur: '', rpe: '', rpeHi: '', warmup: true },
      { kg: '100', reps: '6', dur: '', rpe: '7.5', rpeHi: '8.5', warmup: false },
    ]);
    expect(rows[1]).toEqual([
      { kg: '', reps: '10', dur: '', rpe: '8', rpeHi: '', warmup: false },
    ]);
  });

  it('gives an exercise with no saved sets an empty row list', () => {
    const rows = reconstructCompletedRows([{ exerciseName: 'Bench' }, { exerciseName: 'Skipped' }], [
      { exerciseName: 'Bench', reps: 8, weightKg: 60, durationSeconds: null, rpe: null, rpeHigh: null, isWarmup: false },
    ]);
    expect(rows[0]).toHaveLength(1);
    expect(rows[1]).toEqual([]);
  });
});

describe('fix 2 — destructive re-save guard (predicate)', () => {
  it('flags a re-save that removes existing sets, incl. dropping to zero', () => {
    expect(removesRecordedHistory(3, 0)).toBe(true);  // wipe
    expect(removesRecordedHistory(3, 2)).toBe(true);  // fewer than recorded
    expect(removesRecordedHistory(3, 3)).toBe(false); // same
    expect(removesRecordedHistory(3, 5)).toBe(false); // more
    expect(removesRecordedHistory(0, 0)).toBe(false); // nothing on record (fresh log)
  });
});

describe('Package R — DB round-trip for edit', () => {
  let dir: string;
  let prisma: PrismaClient;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pft-package-r-'));
    const url = `file:${join(dir, 'test.db')}`;
    const ddl = readFileSync(join(process.cwd(), 'prisma', 'schema.sql'), 'utf8');
    const boot = createClient({ url });
    await boot.executeMultiple(ddl);
    boot.close();
    prisma = new PrismaClient({ adapter: new PrismaLibSQL({ url }) });
  });
  afterAll(async () => { await prisma?.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

  const row = (o: Partial<LoggedSetRow> = {}): LoggedSetRow => ({ kg: '', reps: '', dur: '', rpe: '', done: false, ...o });

  it('fix 1: a completed session reconstructs to exactly what was saved', async () => {
    const created = await createPlannedSession(prisma, validatePlannedSession({
      type: 'Foundation', date: '2026-07-20',
      exercises: [{ name: 'Back Squat', sets: 2, reps: 6, weightKg: 100 }],
    }).value!);
    await saveCompletedActuals(prisma, created.id, {
      strengthSets: [
        { exerciseName: 'Back Squat', setNo: 1, reps: 6, weightKg: 100, rpe: 7.5, rpeHigh: null },
        { exerciseName: 'Back Squat', setNo: 2, reps: 5, weightKg: 102.5, rpe: 7, rpeHigh: 8 },
      ],
    }, null, null);

    const reloaded = await prisma.session.findUniqueOrThrow({
      where: { id: created.id },
      include: { plannedExercises: { orderBy: { order: 'asc' } }, strengthSets: { orderBy: { id: 'asc' } } },
    });
    const rows = reconstructCompletedRows(reloaded.plannedExercises, reloaded.strengthSets);
    expect(rows[0]).toEqual([
      { kg: '100', reps: '6', dur: '', rpe: '7.5', rpeHi: '', warmup: false },
      { kg: '102.5', reps: '5', dur: '', rpe: '7', rpeHi: '8', warmup: false },
    ]);
    // The logger renders these pre-ticked; a no-op re-save (all still ticked)
    // keeps all rows.
    const grid = rows.map((rs) => rs.map((r) => row({ ...r, done: true, rpeHi: r.rpeHi })));
    expect(tickedStrengthSets([{ name: 'Back Squat' }], grid)).toHaveLength(2);
  });

  it('fix 2: confirming a shrinking re-save actually reduces DB rows', async () => {
    const created = await createPlannedSession(prisma, validatePlannedSession({
      type: 'Foundation', date: '2026-07-21',
      exercises: [{ name: 'Bench', sets: 3, reps: 8, weightKg: 60 }],
    }).value!);
    await saveCompletedActuals(prisma, created.id, {
      strengthSets: [
        { exerciseName: 'Bench', setNo: 1, reps: 8, weightKg: 60 },
        { exerciseName: 'Bench', setNo: 2, reps: 8, weightKg: 60 },
        { exerciseName: 'Bench', setNo: 3, reps: 7, weightKg: 60 },
      ],
    }, null, null);
    const existing = await prisma.strengthSet.count({ where: { sessionId: created.id } });
    expect(existing).toBe(3);

    // Editor opens with 3 pre-ticked rows; user unticks two → next payload is 1.
    const grid = [[
      row({ kg: '60', reps: '8', done: true }),
      row({ kg: '60', reps: '8', done: false }),
      row({ kg: '60', reps: '7', done: false }),
    ]];
    const next = tickedStrengthSets([{ name: 'Bench' }], grid);
    expect(next).toHaveLength(1);
    expect(removesRecordedHistory(existing, next.length)).toBe(true); // guard would fire

    // Confirmed save: history really shrinks to 1 (not silently — the guard is
    // what stands between the user and this).
    await saveCompletedActuals(prisma, created.id, { strengthSets: next }, null, null);
    expect(await prisma.strengthSet.count({ where: { sessionId: created.id } })).toBe(1);
  });
});
