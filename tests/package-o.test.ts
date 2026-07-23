// Package O — per-exercise notes + warm-up memory (DB-testable logic).
//   previousWarmups: mirror the most recent prior session's warm-up sets.
//   saveCompletedActuals: per-exercise logged notes persist on PlannedExercise.
//
// Throwaway libSQL FILE DB built from prisma/schema.sql — never dev.db/Turso.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { previousWarmups, saveCompletedActuals } from '@/lib/plannedSessions';

describe('Package O — warm-up memory + per-exercise notes', () => {
  let dir: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pft-package-o-'));
    const url = `file:${join(dir, 'test.db')}`;
    const ddl = readFileSync(join(process.cwd(), 'prisma', 'schema.sql'), 'utf8');
    const boot = createClient({ url });
    await boot.executeMultiple(ddl);
    boot.close();
    prisma = new PrismaClient({ adapter: new PrismaLibSQL({ url }) });
  });
  afterAll(async () => { await prisma?.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

  it('previousWarmups mirrors the most recent prior session ONLY, in order', async () => {
    // Older session: two warm-ups. More recent: three warm-ups — the recent wins.
    await prisma.session.create({ data: {
      date: new Date('2026-07-01'), type: 'Foundation', status: 'completed',
      strengthSets: { create: [
        { exerciseName: 'Back Squat', setNo: 0, isWarmup: true, weightKg: 40, reps: 8 },
        { exerciseName: 'Back Squat', setNo: 0, isWarmup: true, weightKg: 60, reps: 5 },
        { exerciseName: 'Back Squat', setNo: 1, isWarmup: false, weightKg: 100, reps: 6 },
      ] },
    } });
    await prisma.session.create({ data: {
      date: new Date('2026-07-08'), type: 'Foundation', status: 'completed',
      strengthSets: { create: [
        { exerciseName: 'Back Squat', setNo: 0, isWarmup: true, weightKg: 50, reps: 8 },
        { exerciseName: 'Back Squat', setNo: 0, isWarmup: true, weightKg: 70, reps: 5 },
        { exerciseName: 'Back Squat', setNo: 0, isWarmup: true, weightKg: 90, reps: 3 },
        { exerciseName: 'Back Squat', setNo: 1, isWarmup: false, weightKg: 105, reps: 6 },
      ] },
    } });

    const wu = await previousWarmups(prisma, ['Back Squat'], new Date('2026-07-20'));
    expect(wu['Back Squat']).toEqual([
      { weightKg: 50, reps: 8 },
      { weightKg: 70, reps: 5 },
      { weightKg: 90, reps: 3 },
    ]);
  });

  it('never returns warm-ups for an exercise with no warm-up history', async () => {
    await prisma.session.create({ data: {
      date: new Date('2026-07-05'), type: 'Foundation', status: 'completed',
      strengthSets: { create: [
        { exerciseName: 'Leg Press', setNo: 1, isWarmup: false, weightKg: 200, reps: 10 },
      ] },
    } });
    const wu = await previousWarmups(prisma, ['Leg Press', 'Never Done'], new Date('2026-07-20'));
    expect(wu['Leg Press']).toBeUndefined();
    expect(wu['Never Done']).toBeUndefined();
  });

  it('respects beforeDate (does not mirror a session on/after the target day)', async () => {
    const wu = await previousWarmups(prisma, ['Back Squat'], new Date('2026-07-08'));
    // Only the 2026-07-01 session is strictly before 07-08.
    expect(wu['Back Squat']).toEqual([
      { weightKg: 40, reps: 8 },
      { weightKg: 60, reps: 5 },
    ]);
  });

  it('per-exercise logged notes persist on the PlannedExercise row', async () => {
    const s = await prisma.session.create({ data: {
      date: new Date('2026-07-15'), type: 'Foundation', status: 'planned',
      plannedExercises: { create: [
        { order: 0, exerciseName: 'Back Squat', targetSets: 3, targetReps: 6 },
        { order: 1, exerciseName: 'Pull-ups', targetSets: 3, targetReps: 10 },
      ] },
    } });
    await saveCompletedActuals(prisma, s.id, {
      exerciseNotes: { 0: 'felt heavy, form broke on set 3', 1: '' },
      strengthSets: [{ exerciseName: 'Back Squat', setNo: 1, reps: 6, weightKg: 100 }],
    }, null, null);

    const pes = await prisma.plannedExercise.findMany({ where: { sessionId: s.id }, orderBy: { order: 'asc' } });
    expect(pes[0].loggedNote).toBe('felt heavy, form broke on set 3');
    expect(pes[1].loggedNote).toBeNull(); // empty string clears to null
    // The plan note column is untouched by logged notes.
    expect(pes[0].notes).toBeNull();
  });
});
