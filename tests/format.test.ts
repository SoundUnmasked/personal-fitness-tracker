import { describe, it, expect } from 'vitest';
import {
  paceFromSeconds,
  paceFromDistance,
  timeOfDayBucket,
  isoDate,
} from '@/lib/format';

describe('paceFromSeconds', () => {
  it('formats m:ss /km', () => {
    expect(paceFromSeconds(312)).toBe('5:12 /km');
    expect(paceFromSeconds(300)).toBe('5:00 /km');
    expect(paceFromSeconds(65)).toBe('1:05 /km');
  });
});

describe('paceFromDistance', () => {
  it('derives pace from distance + duration', () => {
    // 10 km in 50 min -> 5:00 /km
    expect(paceFromDistance(10, 50)).toBe('5:00 /km');
  });
  it('returns null on missing data', () => {
    expect(paceFromDistance(0, 50)).toBeNull();
    expect(paceFromDistance(10, 0)).toBeNull();
  });
});

describe('timeOfDayBucket', () => {
  it('buckets hours correctly', () => {
    expect(timeOfDayBucket(7)).toBe('Morning');
    expect(timeOfDayBucket(13)).toBe('Afternoon');
    expect(timeOfDayBucket(19)).toBe('Evening');
    expect(timeOfDayBucket(2)).toBe('Night');
  });
});

describe('isoDate', () => {
  it('formats YYYY-MM-DD', () => {
    expect(isoDate(new Date(2026, 5, 6))).toBe('2026-06-06');
  });
});
