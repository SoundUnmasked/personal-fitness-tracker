// Package M — logger correctness fixes with testable logic:
//   fix 3: a ticked set with no positive reps/weight/duration is never written
//   fix 4: RPE stores half-points and "7 or 8" ranges without rounding
//   fix 5: previousWeights includes bodyweight history (reps without weight)
//
// DB tests run against a throwaway libSQL FILE database built from
// prisma/schema.sql — never dev.db, never Turso.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import {
  tickedStrengthSets,
  isEmptyTickedSet,
  saveCompletedActuals,
  previousWeights,
  type LoggedSetRow,
} from '@/lib/plannedSessions';

const row = (over: Partial<LoggedSetRow> = {}): LoggedSetRow => ({
  kg: '', reps: '', dur: '', rpe: '', done: false, ...over,
});

describe('fix 3 — a set needs reps or duration; weight alone is not enough', () => {
  it('drops a ticked set with no positive reps and no positive duration', () => {
    for (const s of [
      row({ done: true }),                            // everything empty
      row({ done: true, reps: '0', kg: '0' }),        // explicit zeros
      row({ done: true, reps: '0', kg: '', dur: '0' }),
    ]) {
      expect(isEmptyTickedSet(s)).toBe(true);
      expect(tickedStrengthSets([{ name: 'Back Squat' }], [[s]])).toEqual([]);
    }
  });

  it('drops a ticked 60kg x 0-rep set — a loaded bar with 0 reps is not a completed set', () => {
    const s = row({ done: true, kg: '60', reps: '0' });
    expect(isEmptyTickedSet(s)).toBe(true);
    expect(tickedStrengthSets([{ name: 'Back Squat' }], [[s]])).toEqual([]);
  });

  it('keeps a ticked bodyweight set with positive reps (weight legitimately absent)', () => {
    const out = tickedStrengthSets([{ name: 'Pull-ups' }], [[row({ done: true, reps: '10' })]]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ exerciseName: 'Pull-ups', reps: 10, weightKg: null });
  });

  it('keeps a ticked timed set with a positive duration', () => {
    const out = tickedStrengthSets([{ name: 'Dead Hang' }], [[row({ done: true, dur: '45' })]]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ durationSeconds: 45 });
  });

  it('keeps a ticked weighted set with positive reps', () => {
    const out = tickedStrengthSets([{ name: 'Back Squat' }], [[row({ done: true, kg: '100', reps: '6' })]]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ weightKg: 100, reps: 6 });
  });

  it('numbers working sets AFTER dropping empty rows (no gaps)', () => {
    const out = tickedStrengthSets(
      [{ name: 'Back Squat' }],
      [[
        row({ done: true, kg: '100', reps: '6' }),
        row({ done: true, kg: '60', reps: '0' }),  // loaded bar, 0 reps → dropped
        row({ done: true, kg: '100', reps: '5' }),
      ]],
    );
    expect(out.map((s) => s.setNo)).toEqual([1, 2]);
  });
});

describe('fix 4 — RPE half-points and ranges (pure)', () => {
  it('carries half-point RPE and a range upper bound into the payload', () => {
    const out = tickedStrengthSets(
      [{ name: 'Back Squat' }],
      [[row({ done: true, kg: '100', reps: '6', rpe: '7.5', rpeHi: '8.5' })]],
    );
    expect(out[0]).toMatchObject({ rpe: 7.5, rpeHigh: 8.5 });
  });
});

describe('DB — RPE storage and previous weights', () => {
  let dir: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pft-package-m-'));
    const url = `file:${join(dir, 'test.db')}`;
    const ddl = readFileSync(join(process.cwd(), 'prisma', 'schema.sql'), 'utf8');
    const bootstrap = createClient({ url });
    await bootstrap.executeMultiple(ddl);
    bootstrap.close();
    prisma = new PrismaClient({ adapter: new PrismaLibSQL({ url }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it('fix 4 — stores RPE 7.5 and a 7–8 range without rounding (round-trip)', async () => {
    const s = await prisma.session.create({
      data: { date: new Date('2026-07-20'), type: 'Foundation', status: 'planned' },
    });
    await saveCompletedActuals(prisma, s.id, {
      rpeOverall: 8.5,
      strengthSets: [
        { exerciseName: 'Back Squat', setNo: 1, reps: 6, weightKg: 100, rpe: 7.5, rpeHigh: null },
        { exerciseName: 'Back Squat', setNo: 2, reps: 6, weightKg: 100, rpe: 7, rpeHigh: 8 },
      ],
    }, null, null);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: s.id }, include: { strengthSets: { orderBy: { setNo: 'asc' } } } });
    expect(session.rpeOverall).toBe(8.5); // was rounded to 9 by intOrNull before
    expect(session.strengthSets[0].rpe).toBe(7.5); // was rounded to 8 before
    expect(session.strengthSets[0].rpeHigh).toBeNull();
    expect(session.strengthSets[1].rpe).toBe(7);
    expect(session.strengthSets[1].rpeHigh).toBe(8);
  });

  it('fix 5 — previousWeights returns bodyweight history (reps, no weight)', async () => {
    await prisma.session.create({
      data: {
        date: new Date('2026-07-10'), type: 'Foundation', status: 'completed',
        strengthSets: { create: [
          { exerciseName: 'Pull-ups', setNo: 1, reps: 8, weightKg: null },
          { exerciseName: 'Pull-ups', setNo: 2, reps: 10, weightKg: null },
        ] },
      },
    });
    const prev = await previousWeights(prisma, ['Pull-ups'], new Date('2026-07-20'));
    // Bodyweight-only history used to be filtered out entirely ("No previous
    // record"); now it reports its reps with weight null.
    expect(prev['Pull-ups']).toBeDefined();
    expect(prev['Pull-ups'].weightKg).toBeNull();
    expect(prev['Pull-ups'].reps).toBeGreaterThan(0);
  });

  it('fix 5 — weighted sets still outrank bodyweight sets on the same day', async () => {
    await prisma.session.create({
      data: {
        date: new Date('2026-07-12'), type: 'Foundation', status: 'completed',
        strengthSets: { create: [
          { exerciseName: 'Split Squat', setNo: 1, reps: 12, weightKg: null },
          { exerciseName: 'Split Squat', setNo: 2, reps: 8, weightKg: 24 },
        ] },
      },
    });
    const prev = await previousWeights(prisma, ['Split Squat'], new Date('2026-07-20'));
    expect(prev['Split Squat']).toMatchObject({ weightKg: 24, reps: 8 });
  });
});
