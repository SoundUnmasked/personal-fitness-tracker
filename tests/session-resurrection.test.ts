// Fix pack 1: session resurrection. The logger must not write a draft when
// nothing has been logged, and a discarded session must not come back. These
// exercise the pure guard (contentSignature / draftWorthKeeping) and the draft
// store lifecycle; the repo's test environment is node (no jsdom / RTL), so the
// component's mount/navigation is modelled through the same store the component
// drives, with a localStorage + window shim.

import { describe, it, expect, beforeEach } from 'vitest';
import { contentSignature, draftWorthKeeping, parseRpeInput, type SigRow } from '@/lib/sessionContent';

// Minimal localStorage + window so sessionDraft runs under node.
const store = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };

// Imported after the shim so the module's window guard sees a defined window.
import { saveDraft, clearDraft, latestDraft, type SessionDraft } from '@/lib/sessionDraft';

// A planned session opens with weight/reps pre-filled from targets: that is the
// pristine baseline, not "logged content".
function pristineSets(): SigRow[][] {
  return [
    [{ done: false, kg: '100', reps: '5', dur: '', rpe: '', rpeHi: '', warmup: false },
     { done: false, kg: '100', reps: '5', dur: '', rpe: '', rpeHi: '', warmup: false }],
    [{ done: false, kg: '60', reps: '8', dur: '', rpe: '', rpeHi: '', warmup: false }],
  ];
}
const pristineSig = () => contentSignature(pristineSets(), [], [], ['', ''], '');

// The logger's persist-on-exit decision, in one line: keep a worthwhile draft,
// otherwise clear any existing one for this session.
function persistOnExit(id: number, sig: string, elapsed: number, draft: SessionDraft) {
  if (draftWorthKeeping(pristineSig(), sig, elapsed)) saveDraft(draft);
  else clearDraft(id);
}

function draftWith(sets: SigRow[][], elapsed = 0): SessionDraft {
  return {
    v: 2, sessionId: 1, title: 'Power (Lower)',
    sets: sets.map((ex) => ex.map((r) => ({ kg: r.kg, reps: r.reps, dur: r.dur, rpe: r.rpe, rpeHi: r.rpeHi, done: r.done, prevKg: '', prevReps: '', warmup: r.warmup }))),
    active: { ei: 0, si: 0, field: 'kg' }, elapsed, paused: false, updatedAt: Date.now(),
  };
}

beforeEach(() => store.clear());

describe('draft content guard', () => {
  it('a freshly-opened planned session (pre-filled targets, nothing touched) is not worth a draft', () => {
    expect(draftWorthKeeping(pristineSig(), pristineSig(), 0)).toBe(false);
  });
  it('ticking a set makes it worth a draft', () => {
    const s = pristineSets();
    s[0][0].done = true;
    expect(draftWorthKeeping(pristineSig(), contentSignature(s, [], [], ['', ''], ''), 0)).toBe(true);
  });
  it('editing a weight makes it worth a draft', () => {
    const s = pristineSets();
    s[0][0].kg = '102.5';
    expect(draftWorthKeeping(pristineSig(), contentSignature(s, [], [], ['', ''], ''), 0)).toBe(true);
  });
  it('a clock past 30s is worth a draft even with nothing logged', () => {
    expect(draftWorthKeeping(pristineSig(), pristineSig(), 45)).toBe(true);
  });
});

describe('1c(i): open logger, leave with nothing logged, no draft persists', () => {
  it('writes no draft and clears any stale one', () => {
    persistOnExit(1, pristineSig(), 0, draftWith(pristineSets()));
    expect(latestDraft()).toBeNull();
  });
});

describe('1c(ii): log a set, discard, Back twice, nothing resurrects', () => {
  it('stays cleared and the session bar has nothing to show', () => {
    // Log a set: a real draft exists.
    const logged = pristineSets();
    logged[0][0].done = true;
    saveDraft(draftWith(logged));
    expect(latestDraft()).not.toBeNull();

    // Discard clears the local draft.
    clearDraft(1);
    expect(latestDraft()).toBeNull();

    // Back twice: two stale logger mounts, each with nothing logged, must not
    // re-write a draft (this was the resurrection loop).
    persistOnExit(1, pristineSig(), 0, draftWith(pristineSets()));
    persistOnExit(1, pristineSig(), 0, draftWith(pristineSets()));
    // latestDraft() null is exactly the SessionBar's "render nothing" condition.
    expect(latestDraft()).toBeNull();
  });
});

describe('RPE range parsing', () => {
  it('parses an exact value', () => {
    expect(parseRpeInput('6')).toEqual({ rpe: '6', rpeHi: '' });
  });
  it('parses a valid range', () => {
    expect(parseRpeInput('6-7')).toEqual({ rpe: '6', rpeHi: '7' });
  });
  it('rejects a descending or equal range without throwing', () => {
    expect(parseRpeInput('7-6')).toBeNull();
    expect(parseRpeInput('6-6')).toBeNull();
  });
  it('rejects out-of-range bounds and partial input', () => {
    expect(parseRpeInput('0')).toBeNull();
    expect(parseRpeInput('11')).toBeNull();
    expect(parseRpeInput('6-11')).toBeNull();
    expect(parseRpeInput('6-')).toBeNull();
    expect(parseRpeInput('')).toBeNull();
  });
});
