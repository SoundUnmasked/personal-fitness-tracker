// Package P — region-based tempo parsing.
import { describe, it, expect } from 'vitest';
import { parseTempoRegions, tempoCycleSeconds } from '@/lib/tempo';

describe('parseTempoRegions', () => {
  it('maps 3030 to lower + lift (zero regions dropped)', () => {
    expect(parseTempoRegions('3030')).toEqual([
      { key: 'ecc', label: 'Lower', sec: 3, explosive: false },
      { key: 'con', label: 'Lift', sec: 3, explosive: false },
    ]);
  });

  it('keeps the bottom pause for 3110', () => {
    expect(parseTempoRegions('3110').map((r) => [r.key, r.sec])).toEqual([
      ['ecc', 3], ['bottom', 1], ['con', 1],
    ]);
  });

  it('treats X in the concentric slot as an explosive 1s region', () => {
    const regions = parseTempoRegions('31X1');
    expect(regions.map((r) => r.key)).toEqual(['ecc', 'bottom', 'con', 'top']);
    const con = regions.find((r) => r.key === 'con')!;
    expect(con.explosive).toBe(true);
    expect(con.label).toBe('Explode');
    expect(con.sec).toBe(1);
    // top hold of 1s is retained
    expect(regions.find((r) => r.key === 'top')?.sec).toBe(1);
  });

  it('reads a 3-digit 303 as lower/pause(0->dropped)/lift with no top hold', () => {
    expect(parseTempoRegions('303').map((r) => r.key)).toEqual(['ecc', 'con']);
  });

  it('ignores junk characters and caps at four regions', () => {
    expect(parseTempoRegions('3-0-3-0-9').map((r) => r.key)).toEqual(['ecc', 'con']);
    expect(parseTempoRegions('abcd')).toEqual([]);
    expect(parseTempoRegions('')).toEqual([]);
  });

  it('tempoCycleSeconds sums the active regions', () => {
    expect(tempoCycleSeconds('3030')).toBe(6);
    expect(tempoCycleSeconds('3110')).toBe(5);
    expect(tempoCycleSeconds('31X1')).toBe(6); // 3+1+1+1
  });
});
