// Package Q — editing a planned session's contents (DB-testable logic).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { createPlannedSession, updatePlannedSession, validatePlannedSession } from '@/lib/plannedSessions';

describe('Package Q — updatePlannedSession', () => {
  let dir: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pft-package-q-'));
    const url = `file:${join(dir, 'test.db')}`;
    const ddl = readFileSync(join(process.cwd(), 'prisma', 'schema.sql'), 'utf8');
    const boot = createClient({ url });
    await boot.executeMultiple(ddl);
    boot.close();
    prisma = new PrismaClient({ adapter: new PrismaLibSQL({ url }) });
  });
  afterAll(async () => { await prisma?.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

  it('replaces movements (add/remove/reorder), targets, warm-up and cool-down', async () => {
    const created = await createPlannedSession(prisma, validatePlannedSession({
      type: 'Foundation', date: '2026-07-20', title: 'Before',
      warmup: 'Bike 5 min',
      exercises: [
        { name: 'Back Squat', sets: 4, reps: 6, weightKg: 100, restSeconds: 120, tempo: '3030' },
        { name: 'Leg Curl', sets: 3, reps: 12 },
      ],
    }).value!);

    // Edit: retitle, reorder (Row first), drop Leg Curl, add Pull-ups, retarget
    // squat, and give a multi-item cool-down.
    await updatePlannedSession(prisma, created.id, validatePlannedSession({
      type: 'Power', date: '2026-07-20', title: 'After',
      warmup: [{ name: 'Row 500m' }, { name: 'Leg swings' }],
      cooldown: [{ name: 'Couch stretch', detail: '2 min/side' }, { name: 'Hamstring stretch' }, { name: 'Child pose' }],
      exercises: [
        { name: 'Barbell Row', sets: 4, reps: 8, weightKg: 60, superset: 'A' },
        { name: 'Pull-ups', sets: 4, reps: 8, superset: 'A' },
        { name: 'Back Squat', sets: 5, reps: 3, weightKg: 120, restSeconds: 180, tempo: '20X0' },
      ],
    }).value!);

    const s = await prisma.session.findUniqueOrThrow({
      where: { id: created.id },
      include: { plannedExercises: { orderBy: { order: 'asc' } } },
    });

    expect(s.status).toBe('planned');           // still planned
    expect(s.title).toBe('After');
    expect(s.type).toBe('Power');
    expect(s.plannedExercises.map((e) => e.exerciseName)).toEqual(['Barbell Row', 'Pull-ups', 'Back Squat']);
    expect(s.plannedExercises.map((e) => e.order)).toEqual([0, 1, 2]);
    const squat = s.plannedExercises.find((e) => e.exerciseName === 'Back Squat')!;
    expect(squat.targetSets).toBe(5);
    expect(squat.targetReps).toBe(3);
    expect(squat.targetWeightKg).toBe(120);
    expect(squat.restSeconds).toBe(180);
    expect(squat.tempo).toBe('20X0');
    expect(s.plannedExercises.filter((e) => e.supersetGroup === 'A')).toHaveLength(2);
    // No orphan rows from the previous version.
    expect(s.plannedExercises).toHaveLength(3);

    // Cool-down holds the full multi-item routine.
    const cd = JSON.parse(s.cooldown!);
    expect(cd).toHaveLength(3);
    expect(cd[0]).toMatchObject({ name: 'Couch stretch', detail: '2 min/side' });
  });

  it('does not create strength_sets and leaves the session count clean', async () => {
    const created = await createPlannedSession(prisma, validatePlannedSession({
      type: 'Foundation', date: '2026-07-21', exercises: [{ name: 'Bench', sets: 3, reps: 8 }],
    }).value!);
    await updatePlannedSession(prisma, created.id, validatePlannedSession({
      type: 'Foundation', date: '2026-07-21', exercises: [{ name: 'Bench', sets: 5, reps: 5 }],
    }).value!);
    expect(await prisma.strengthSet.count({ where: { sessionId: created.id } })).toBe(0);
    expect(await prisma.plannedExercise.count({ where: { sessionId: created.id } })).toBe(1);
  });
});
