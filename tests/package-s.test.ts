// Package S2 (CRITICAL) — duration is write-once. A re-save of a completed
// session must NEVER overwrite the recorded duration. Protects real history
// (e.g. the 22 July session's real 85m).
//
// Throwaway libSQL FILE DB from prisma/schema.sql — never dev.db/Turso.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { createPlannedSession, saveCompletedActuals, validatePlannedSession } from '@/lib/plannedSessions';

describe('S2 — duration write-once', () => {
  let dir: string;
  let prisma: PrismaClient;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pft-package-s-'));
    const url = `file:${join(dir, 'test.db')}`;
    const ddl = readFileSync(join(process.cwd(), 'prisma', 'schema.sql'), 'utf8');
    const boot = createClient({ url });
    await boot.executeMultiple(ddl);
    boot.close();
    prisma = new PrismaClient({ adapter: new PrismaLibSQL({ url }) });
  });
  afterAll(async () => { await prisma?.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

  async function planned(dateIso: string) {
    return createPlannedSession(prisma, validatePlannedSession({
      type: 'Foundation', date: dateIso,
      exercises: [{ name: 'Back Squat', sets: 3, reps: 5, weightKg: 100 }],
    }).value!);
  }

  it('records duration on the FIRST finish', async () => {
    const s = await planned('2026-07-22');
    await saveCompletedActuals(prisma, s.id, {
      durationMin: 85,
      strengthSets: [{ exerciseName: 'Back Squat', setNo: 1, reps: 5, weightKg: 100 }],
    }, null, null);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).durationMin).toBe(85);
  });

  it('the 22 July 85m survives a re-save that ticks a different set (regression)', async () => {
    const s = await planned('2026-07-22');
    // First finish → 85m recorded.
    await saveCompletedActuals(prisma, s.id, {
      durationMin: 85,
      strengthSets: [{ exerciseName: 'Back Squat', setNo: 1, reps: 5, weightKg: 100 }],
    }, null, null);

    // Re-open & edit: a DIFFERENT set, and the edit-session's elapsed time comes
    // through as a bogus 3-minute duration — it must be ignored.
    await saveCompletedActuals(prisma, s.id, {
      durationMin: 3,
      strengthSets: [
        { exerciseName: 'Back Squat', setNo: 1, reps: 5, weightKg: 100 },
        { exerciseName: 'Back Squat', setNo: 2, reps: 6, weightKg: 105 },
      ],
    }, null, null);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).durationMin).toBe(85);

    // And again — any number of re-saves leaves it at 85.
    await saveCompletedActuals(prisma, s.id, { durationMin: 999, strengthSets: [] }, null, null);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).durationMin).toBe(85);
  });

  it('a null new duration cannot erase a recorded one', async () => {
    const s = await planned('2026-07-23');
    await saveCompletedActuals(prisma, s.id, { durationMin: 42, strengthSets: [{ exerciseName: 'Back Squat', setNo: 1, reps: 5, weightKg: 100 }] }, null, null);
    await saveCompletedActuals(prisma, s.id, { durationMin: null, strengthSets: [{ exerciseName: 'Back Squat', setNo: 1, reps: 5, weightKg: 100 }] }, null, null);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).durationMin).toBe(42);
  });

  it('a deliberate durationOverride CAN correct the duration', async () => {
    const s = await planned('2026-07-24');
    await saveCompletedActuals(prisma, s.id, { durationMin: 85, strengthSets: [] }, null, null);
    await saveCompletedActuals(prisma, s.id, { durationMin: 72, durationOverride: true, strengthSets: [] }, null, null);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).durationMin).toBe(72);
  });

  it('a session with no recorded duration can still receive one on a later save', async () => {
    const s = await planned('2026-07-25');
    // First finish with no duration (e.g. 0-second quick log).
    await saveCompletedActuals(prisma, s.id, { durationMin: null, strengthSets: [] }, null, null);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).durationMin).toBeNull();
    // A later save that supplies one is allowed (there was nothing to protect).
    await saveCompletedActuals(prisma, s.id, { durationMin: 50, strengthSets: [] }, null, null);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).durationMin).toBe(50);
  });
});
