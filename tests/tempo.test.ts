import { describe, expect, it } from 'vitest';
import { cycleSeconds, parseTempo, tempoAt } from '@/lib/tempo';

describe('parseTempo', () => {
  it('parses a full 4-digit tempo', () => {
    expect(parseTempo('3030')).toEqual([
      { label: 'Lower', sec: 3 },
      { label: 'Raise', sec: 3 },
    ]);
  });

  it('keeps every non-zero phase with its position label', () => {
    expect(parseTempo('3121')).toEqual([
      { label: 'Lower', sec: 3 },
      { label: 'Bottom', sec: 1 },
      { label: 'Raise', sec: 2 },
      { label: 'Top', sec: 1 },
    ]);
  });

  it('treats X as a 1s explosive concentric', () => {
    expect(parseTempo('31X1')).toEqual([
      { label: 'Lower', sec: 3 },
      { label: 'Bottom', sec: 1 },
      { label: 'Explode', sec: 1 },
      { label: 'Top', sec: 1 },
    ]);
  });

  it('parses the session-18 tempos', () => {
    expect(parseTempo('303')).toEqual([
      { label: 'Lower', sec: 3 },
      { label: 'Raise', sec: 3 },
    ]);
    expect(parseTempo('3010')).toEqual([
      { label: 'Lower', sec: 3 },
      { label: 'Raise', sec: 1 },
    ]);
  });

  it('returns no phases for all-zero or junk input', () => {
    expect(parseTempo('0000')).toEqual([]);
    expect(parseTempo('abcd')).toEqual([]);
  });

  it('ignores anything beyond four characters', () => {
    expect(parseTempo('301099')).toEqual(parseTempo('3010'));
  });
});

describe('tempoAt', () => {
  const p303 = parseTempo('303'); // Lower 3s, Raise 3s — 6s cycle

  it('starts at the top of phase 0', () => {
    expect(tempoAt(p303, 0)).toEqual({ pi: 0, remaining: 3, rep: 0, display: 3 });
  });

  it('counts down within a phase', () => {
    expect(tempoAt(p303, 0.5)).toMatchObject({ pi: 0, rep: 0, display: 3 });
    expect(tempoAt(p303, 2.2)).toMatchObject({ pi: 0, rep: 0, display: 1 });
  });

  it('lands exactly on phase boundaries with no skip', () => {
    expect(tempoAt(p303, 3)).toMatchObject({ pi: 1, rep: 0, display: 3 });
    expect(tempoAt(p303, 5.999)).toMatchObject({ pi: 1, rep: 0, display: 1 });
  });

  it('rolls into the next rep at the cycle boundary', () => {
    expect(tempoAt(p303, 6)).toMatchObject({ pi: 0, rep: 1, display: 3 });
    expect(tempoAt(p303, 12)).toMatchObject({ pi: 0, rep: 2 });
  });

  it('recovers the exact position after a long throttled gap (screen off)', () => {
    // 47.5s into a 6s cycle: rep 7, 5.5s into the cycle -> Raise, 0.5s left.
    expect(tempoAt(p303, 47.5)).toMatchObject({ pi: 1, rep: 7, display: 1 });
  });

  it('is monotonic across a whole session: phases advance one at a time', () => {
    const seen: { rep: number; pi: number }[] = [];
    for (let i = 0; i <= 1200; i++) {
      const t = i / 20; // 0 .. 60s in exact 0.05 steps (no float accumulation)
      const pos = tempoAt(p303, t);
      const last = seen[seen.length - 1];
      if (!last || last.rep !== pos.rep || last.pi !== pos.pi) seen.push({ rep: pos.rep, pi: pos.pi });
    }
    // 10 full cycles in 60s, 2 phases each; every transition steps by exactly
    // one phase (or rolls to phase 0 of the next rep).
    expect(seen.length).toBe(21); // includes the final boundary at t=60
    seen.forEach((s, i) => {
      expect(s.pi).toBe(i % 2);
      expect(s.rep).toBe(Math.floor(i / 2));
    });
  });

  it('handles the 4s cycle of "3010" without ever showing 0', () => {
    const p = parseTempo('3010');
    for (let t = 0; t < 20; t += 0.1) {
      const pos = tempoAt(p, t);
      expect(pos.display).toBeGreaterThanOrEqual(1);
      expect(pos.remaining).toBeGreaterThan(0);
    }
    expect(tempoAt(p, 3.5)).toMatchObject({ pi: 1, rep: 0, display: 1 });
    expect(tempoAt(p, 4)).toMatchObject({ pi: 0, rep: 1, display: 3 });
  });

  it('never displays more than the phase length near boundaries (float safety)', () => {
    const p = parseTempo('3030');
    // Just past a boundary the display must be the full phase, not sec+1.
    expect(tempoAt(p, 3.0000001).display).toBe(3);
    expect(tempoAt(p, 6.0000001).display).toBe(3);
  });

  it('is defensive about empty phases and bad elapsed values', () => {
    expect(tempoAt([], 10)).toMatchObject({ pi: 0, rep: 0 });
    expect(tempoAt(p303, -1)).toMatchObject({ pi: 0, rep: 0, display: 3 });
    expect(tempoAt(p303, Number.NaN)).toMatchObject({ pi: 0, rep: 0, display: 3 });
  });

  it('cycleSeconds sums the audible phases', () => {
    expect(cycleSeconds(p303)).toBe(6);
    expect(cycleSeconds(parseTempo('31X1'))).toBe(6);
    expect(cycleSeconds([])).toBe(0);
  });
});
