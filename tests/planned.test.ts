import { describe, it, expect } from 'vitest';
import {
  validatePlannedSession,
  tempoOrNull,
  setStyleOrNull,
  nonNegIntOrNull,
} from '@/lib/plannedSessions';

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

  it('parses per-exercise rest, tempo, duration and session warm/cool-down', () => {
    const r = validatePlannedSession({
      type: 'Power',
      date: '2026-07-06',
      warmup: '5 min bike',
      cooldown: 'Couch stretch',
      exercises: [
        { name: 'Back Squat', sets: 4, reps: 6, restSeconds: 150, tempo: '31x1' },
        { name: "Farmer's Carry", setStyle: 'duration', durationSeconds: 45, weightKg: 32 },
        { name: 'Dead Hang', durationSeconds: 30 }, // duration inferred from durationSeconds
      ],
    });
    expect(r.ok).toBe(true);
    // Legacy free-text warm/cool-down is normalised into a single structured item.
    expect(r.value?.warmup).toEqual([{ name: '5 min bike', done: false }]);
    expect(r.value?.cooldown).toEqual([{ name: 'Couch stretch', done: false }]);
    expect(r.value?.exercises[0].restSeconds).toBe(150);
    expect(r.value?.exercises[0].tempo).toBe('31X1'); // normalised upper-case
    expect(r.value?.exercises[1].setStyle).toBe('duration');
    expect(r.value?.exercises[1].durationSeconds).toBe(45);
    expect(r.value?.exercises[2].setStyle).toBe('duration'); // inferred
  });

  it('leaves rep-style movements without a duration style', () => {
    const r = validatePlannedSession({
      type: 'Foundation',
      date: '2026-07-06',
      exercises: [{ name: 'Bench Press', sets: 3, reps: 8 }],
    });
    expect(r.value?.exercises[0].setStyle).toBeNull();
    expect(r.value?.exercises[0].restSeconds).toBeNull();
    expect(r.value?.exercises[0].tempo).toBeNull();
  });
});

describe('field helpers', () => {
  it('tempoOrNull accepts 2–4 digit/X tempos and rejects junk', () => {
    expect(tempoOrNull('3030')).toBe('3030');
    expect(tempoOrNull('31x1')).toBe('31X1');
    expect(tempoOrNull('30')).toBe('30');
    expect(tempoOrNull('30301')).toBeNull(); // too long
    expect(tempoOrNull('fast')).toBeNull();
    expect(tempoOrNull(303)).toBeNull(); // not a string
    expect(tempoOrNull('')).toBeNull();
  });

  it('setStyleOrNull canonicalises known styles only', () => {
    expect(setStyleOrNull('duration')).toBe('duration');
    expect(setStyleOrNull('Duration')).toBe('duration');
    expect(setStyleOrNull('reps')).toBe('reps');
    expect(setStyleOrNull('time')).toBeNull();
    expect(setStyleOrNull(null)).toBeNull();
  });

  it('nonNegIntOrNull rejects negatives and blanks', () => {
    expect(nonNegIntOrNull('150')).toBe(150);
    expect(nonNegIntOrNull(0)).toBe(0);
    expect(nonNegIntOrNull(-5)).toBeNull();
    expect(nonNegIntOrNull('')).toBeNull();
    expect(nonNegIntOrNull('abc')).toBeNull();
  });
});
