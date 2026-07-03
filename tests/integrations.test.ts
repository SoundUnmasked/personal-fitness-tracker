import { describe, it, expect } from 'vitest';
import { mapActivityToRun } from '@/lib/strava';
import { mapMeasureGroup } from '@/lib/withings';

describe('strava mapActivityToRun', () => {
  const base = {
    id: 12345,
    name: 'Morning Run',
    type: 'Run',
    sport_type: 'Run',
    start_date_local: '2026-06-10T07:00:00Z',
    distance: 10000, // 10 km
    moving_time: 3000, // 50 min
    elapsed_time: 3100,
    average_heartrate: 152,
    max_heartrate: 175,
  };

  it('maps a run with Strava distance/pace as source of truth', () => {
    const r = mapActivityToRun(base)!;
    expect(r.type).toBe('Run');
    expect(r.source).toBe('strava');
    expect(r.run.distanceKm).toBe(10);
    expect(r.run.durationMin).toBeCloseTo(50, 1);
    expect(r.run.avgPace).toBe('5:00 /km');
    expect(r.run.avgHr).toBe(152); // HR passed through (COROS)
    expect(r.run.hrSource).toBe('COROS'); // Strava HR = COROS (top of hierarchy)
    expect(r.externalId).toBe('12345');
  });

  it('ignores non-run activities', () => {
    expect(mapActivityToRun({ ...base, sport_type: 'Ride', type: 'Ride' })).toBeNull();
  });

  it('handles missing HR gracefully', () => {
    const { average_heartrate, max_heartrate, ...noHr } = base;
    void average_heartrate;
    void max_heartrate;
    const r = mapActivityToRun(noHr)!;
    expect(r.run.avgHr).toBeNull();
    expect(r.run.maxHr).toBeNull();
    expect(r.run.hrSource).toBeNull(); // no HR → no source
  });
});

describe('withings mapMeasureGroup', () => {
  it('applies unit exponents and maps to body comp', () => {
    const grp = {
      date: 1_780_000_000,
      measures: [
        { type: 1, value: 885, unit: -1 }, // 88.5 kg
        { type: 6, value: 175, unit: -1 }, // 17.5 %
        { type: 76, value: 420, unit: -1 }, // 42.0 kg muscle mass
      ],
    };
    const m = mapMeasureGroup(grp);
    expect(m.source).toBe('Withings');
    expect(m.weightKg).toBe(88.5);
    expect(m.bodyFatPct).toBe(17.5);
    expect(m.skeletalMuscleMassKg).toBe(42);
  });

  it('returns null for absent measures', () => {
    const m = mapMeasureGroup({ date: 1_780_000_000, measures: [] });
    expect(m.weightKg).toBeNull();
    expect(m.bodyFatPct).toBeNull();
  });
});
