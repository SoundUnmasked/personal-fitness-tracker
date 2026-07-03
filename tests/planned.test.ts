import { describe, it, expect } from 'vitest';
import { validatePlannedSession } from '@/lib/plannedSessions';

describe('validatePlannedSession', () => {
  const good = {
    type: 'Foundation',
    date: '2026-07-02',
    title: 'Lower body + sled',
    exercises: [
      { name: 'Back Squat', sets: 4, reps: 6, weightKg: 100, superset: 'A' },
      { name: 'Pull-ups', sets: 3, reps: 10, superset: 'A' },
    ],
  };

  it('accepts a well-formed plan and normalises fields', () => {
    const r = validatePlannedSession(good);
    expect(r.ok).toBe(true);
    expect(r.value?.type).toBe('Foundation');
    expect(r.value?.exercises).toHaveLength(2);
    expect(r.value?.exercises[0].weightKg).toBe(100);
    expect(r.value?.exercises[0].superset).toBe('A');
  });

  it('rejects an invalid session type', () => {
    const r = validatePlannedSession({ ...good, type: 'Cardio' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/type must be/i);
  });

  it('rejects a missing/invalid date', () => {
    expect(validatePlannedSession({ ...good, date: 'not-a-date' }).ok).toBe(false);
    expect(validatePlannedSession({ ...good, date: undefined }).ok).toBe(false);
  });

  it('requires at least one exercise', () => {
    const r = validatePlannedSession({ ...good, exercises: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/at least one exercise/i);
  });

  it('requires each exercise to have a name', () => {
    const r = validatePlannedSession({
      ...good,
      exercises: [{ sets: 3 }],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/name is required/i);
  });

  it('coerces numeric strings and blanks to null', () => {
    const r = validatePlannedSession({
      type: 'Power',
      date: '2026-07-03',
      exercises: [{ name: 'Deadlift', sets: '5', reps: '', weightKg: '140' }],
    });
    expect(r.ok).toBe(true);
    expect(r.value?.exercises[0].sets).toBe(5);
    expect(r.value?.exercises[0].reps).toBeNull();
    expect(r.value?.exercises[0].weightKg).toBe(140);
  });

  it('rejects a non-object body', () => {
    expect(validatePlannedSession(null).ok).toBe(false);
    expect(validatePlannedSession('nope').ok).toBe(false);
  });
});
