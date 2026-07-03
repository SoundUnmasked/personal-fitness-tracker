import { describe, it, expect } from 'vitest';
import {
  backToBackHardWarning,
  isHard,
  hasRunComponent,
  needsCooldownPrompt,
  pickHrSource,
  normalizeHrSource,
} from '@/lib/rules';

describe('isHard (amended: Power + Foundation only)', () => {
  it('treats Power and Foundation as hard', () => {
    expect(isHard('Power')).toBe(true);
    expect(isHard('Foundation')).toBe(true);
  });
  it('treats Aerobic as NOT hard (exact amendment)', () => {
    expect(isHard('Aerobic')).toBe(false);
  });
  it('treats Run and Class as not hard', () => {
    expect(isHard('Run')).toBe(false);
    expect(isHard('Class')).toBe(false);
  });
});

describe('backToBackHardWarning', () => {
  it('flags Power + Foundation on the same day', () => {
    const w = backToBackHardWarning(
      { date: '2026-06-10', type: 'Power' },
      [{ date: '2026-06-10', type: 'Foundation' }],
    );
    expect(w).toMatch(/same day/i);
  });

  it('flags two hard sessions on consecutive days', () => {
    const w = backToBackHardWarning(
      { date: '2026-06-11', type: 'Foundation' },
      [{ date: '2026-06-10', type: 'Power' }],
    );
    expect(w).toMatch(/before\/after/i);
  });

  it('does NOT flag Aerobic next to a hard session (Aerobic is not hard)', () => {
    expect(
      backToBackHardWarning(
        { date: '2026-06-11', type: 'Aerobic' },
        [{ date: '2026-06-10', type: 'Power' }],
      ),
    ).toBeNull();
    // ...and a hard candidate next to an Aerobic is also clear.
    expect(
      backToBackHardWarning(
        { date: '2026-06-11', type: 'Power' },
        [{ date: '2026-06-10', type: 'Aerobic' }],
      ),
    ).toBeNull();
  });

  it('does NOT flag hard sessions two days apart', () => {
    const w = backToBackHardWarning(
      { date: '2026-06-12', type: 'Power' },
      [{ date: '2026-06-10', type: 'Foundation' }],
    );
    expect(w).toBeNull();
  });

  it('never throws on empty history', () => {
    expect(backToBackHardWarning({ date: '2026-06-10', type: 'Power' }, [])).toBeNull();
  });
});

describe('run-component & cooldown prompts', () => {
  it('detects a run component (Run and Aerobic) for run fields', () => {
    expect(hasRunComponent('Run')).toBe(true);
    expect(hasRunComponent('Aerobic')).toBe(true);
    expect(hasRunComponent('Power')).toBe(false);
  });
  it('surfaces the cooldown prompt only for Foundation', () => {
    expect(needsCooldownPrompt('Foundation')).toBe(true);
    expect(needsCooldownPrompt('Power')).toBe(false);
    expect(needsCooldownPrompt('Run')).toBe(false);
  });
});

describe('pickHrSource (priority hierarchy, not a whitelist)', () => {
  it('prefers COROS when present', () => {
    const p = pickHrSource(['Samsung', 'COROS', 'Technogym']);
    expect(p.source).toBe('COROS');
    expect(p.unreliable).toBe(false);
    expect(p.warning).toBeNull();
  });
  it('falls back to Technogym when COROS is missing', () => {
    const p = pickHrSource(['Technogym', 'Samsung']);
    expect(p.source).toBe('Technogym');
    expect(p.unreliable).toBe(false);
  });
  it('accepts Samsung as a flagged fallback — never dropped', () => {
    const p = pickHrSource(['Samsung']);
    expect(p.source).toBe('Samsung');
    expect(p.unreliable).toBe(true);
    expect(p.warning).toMatch(/fallback/i);
  });
  it('returns null only when nothing is available', () => {
    const p = pickHrSource([null, undefined, '']);
    expect(p.source).toBeNull();
  });
  it('normalises loose device names', () => {
    expect(normalizeHrSource('Galaxy Watch')).toBe('Samsung');
    expect(normalizeHrSource('coros pace 3')).toBe('COROS');
    expect(normalizeHrSource('Technogym machine')).toBe('Technogym');
    expect(normalizeHrSource('Apple Watch')).toBeNull();
  });
});
