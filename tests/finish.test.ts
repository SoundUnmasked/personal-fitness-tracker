// Package H item 1 — Finish must save ONLY ticked sets.
//
// Two layers, because the bug had two halves:
//  1. tickedStrengthSets (pure): the payload builder must drop every unticked
//     row, even though rows pre-fill with values from the plan's targets.
//  2. saveCompletedActuals (real DB): finishing with 0 ticked sets must write
//     0 strength_sets rows — no ghost rows, no zero rows — while still marking
//     the session completed and storing its duration.
//
// The DB tests run against a throwaway libSQL FILE database built from
// prisma/schema.sql (same DDL turso-push applies), never against dev.db or
// Turso.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import {
  tickedStrengthSets,
  saveCompletedActuals,
  type LoggedSetRow,
} from '@/lib/plannedSessions';

const row = (over: Partial<LoggedSetRow> = {}): LoggedSetRow => ({
  kg: '', reps: '', dur: '', rpe: '', done: false, ...over,
});

describe('tickedStrengthSets (pure payload builder)', () => {
  const exercises = [{ name: 'Back Squat' }, { name: 'Pull-ups' }];

  it('returns NO rows when nothing is ticked, even though every row is pre-filled', () => {
    // This is exactly the fabrication bug: rows pre-fill kg/reps from targets,
    // so "has a value" must never be treated as "was performed".
    const sets = [
      [row({ kg: '100', reps: '6' }), row({ kg: '100', reps: '6' })],
      [row({ reps: '10' }), row({ reps: '10' }), row({ reps: '10' })],
    ];
    expect(tickedStrengthSets(exercises, sets)).toEqual([]);
  });

  it('keeps only ticked rows and numbers working sets from the ticked rows', () => {
    const sets = [
      [
        row({ kg: '60', reps: '5', done: true, warmup: true }),
        row({ kg: '100', reps: '6', done: true }),
        row({ kg: '100', reps: '6' }), // logged a value but never ticked → dropped
        row({ kg: '102.5', reps: '5', rpe: '9', done: true }),
      ],
      [row({ reps: '10' })], // untouched exercise → nothing saved
    ];
    const out = tickedStrengthSets(exercises, sets);
    expect(out).toEqual([
      { exerciseName: 'Back Squat', setNo: 0, reps: 5, weightKg: 60, durationSeconds: null, isWarmup: true, rpe: null },
      { exerciseName: 'Back Squat', setNo: 1, reps: 6, weightKg: 100, durationSeconds: null, isWarmup: false, rpe: null },
      { exerciseName: 'Back Squat', setNo: 2, reps: 5, weightKg: 102.5, durationSeconds: null, isWarmup: false, rpe: 9 },
    ]);
  });

  it('saves a ticked set even when its fields are empty (bodyweight / no values entered)', () => {
    const out = tickedStrengthSets([{ name: 'Dead Hang' }], [[row({ done: true, dur: '30' })]]);
    expect(out).toEqual([
      { exerciseName: 'Dead Hang', setNo: 1, reps: null, weightKg: null, durationSeconds: 30, isWarmup: false, rpe: null },
    ]);
  });
});

describe('saveCompletedActuals (real DB)', () => {
  let dir: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pft-finish-test-'));
    const url = `file:${join(dir, 'test.db')}`;

    // Build the schema exactly the way turso-push does: prisma/schema.sql via
    // the libSQL client.
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

  async function createPlannedSession(): Promise<number> {
    const s = await prisma.session.create({
      data: {
        date: new Date('2026-07-20'),
        type: 'Foundation',
        status: 'planned',
        title: 'Lower body',
        plannedExercises: {
          create: [{ order: 0, exerciseName: 'Back Squat', targetSets: 3, targetReps: 6, targetWeightKg: 100 }],
        },
      },
    });
    return s.id;
  }

  it('finishing with 0 ticked sets writes 0 strength_sets rows', async () => {
    const id = await createPlannedSession();
    // 0 ticked rows → tickedStrengthSets produces an empty payload.
    const payload = tickedStrengthSets(
      [{ name: 'Back Squat' }],
      [[row({ kg: '100', reps: '6' }), row({ kg: '100', reps: '6' }), row({ kg: '100', reps: '6' })]],
    );
    await saveCompletedActuals(prisma, id, { durationMin: 42, strengthSets: payload }, null, null);

    expect(await prisma.strengthSet.count({ where: { sessionId: id } })).toBe(0);
    const session = await prisma.session.findUniqueOrThrow({ where: { id } });
    expect(session.status).toBe('completed');
    expect(session.durationMin).toBe(42); // item 2: session clock is persisted
  });

  it('writes exactly the ticked rows, and a re-save replaces them (edit flow)', async () => {
    const id = await createPlannedSession();
    const first = tickedStrengthSets(
      [{ name: 'Back Squat' }],
      [[row({ kg: '100', reps: '6', done: true }), row({ kg: '100', reps: '6' })]],
    );
    await saveCompletedActuals(prisma, id, { strengthSets: first }, null, null);
    expect(await prisma.strengthSet.count({ where: { sessionId: id } })).toBe(1);

    // Re-finishing (Edit logged sets) overwrites: 0 ticked → back to 0 rows.
    await saveCompletedActuals(prisma, id, { strengthSets: [] }, null, null);
    expect(await prisma.strengthSet.count({ where: { sessionId: id } })).toBe(0);
    const session = await prisma.session.findUniqueOrThrow({ where: { id } });
    expect(session.status).toBe('completed');
  });
});
