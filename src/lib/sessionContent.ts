// Pure helpers for the logger's "is this session worth keeping a draft for" and
// "how should a typed RPE be parsed" decisions. Kept out of the client component
// so they can be unit-tested in a plain node environment.

// Structural shapes: the logger's SetRow and FlowItem satisfy these without any
// import coupling.
export interface SigRow {
  done: boolean;
  kg: string;
  reps: string;
  dur: string;
  rpe: string;
  rpeHi: string;
  warmup: boolean;
}
export interface SigFlow {
  done: boolean;
  loggedWeightKg?: number | null;
}

// A stable signature of the draft-worthy content of a session: ticked sets, any
// entered weight/reps/time/RPE, any ticked or weighted warm-up/cool-down item,
// and the notes. Comparing the live signature against the one captured at mount
// tells a freshly-opened logger (plan targets and plan notes pre-filled, nothing
// touched) apart from a session the athlete has actually worked.
export function contentSignature(
  sets: SigRow[][],
  warmup: SigFlow[],
  cooldown: SigFlow[],
  exNotes: string[],
  sessionNote: string,
): string {
  const rows = sets.map((ex) => ex.map((r) => [r.done ? 1 : 0, r.kg, r.reps, r.dur, r.rpe, r.rpeHi, r.warmup ? 1 : 0]));
  const flow = (items: SigFlow[]) => items.map((i) => [i.done ? 1 : 0, i.loggedWeightKg ?? '']);
  return JSON.stringify([rows, flow(warmup), flow(cooldown), exNotes, sessionNote]);
}

// A draft is worth persisting only if the athlete has logged something (the live
// signature has diverged from the pristine one) or the session clock is past 30s.
export function draftWorthKeeping(pristineSig: string, currentSig: string, elapsedSec: number): boolean {
  if (elapsedSec > 30) return true;
  return currentSig !== pristineSig;
}

// Parse a typed RPE value. "n" is an exact RPE; "n-m" is a range where m is
// greater than n. Both bounds must be 1 to 10. Anything else returns null so the
// caller can leave what the athlete typed untouched.
export function parseRpeInput(raw: string): { rpe: string; rpeHi: string } | null {
  const s = raw.trim();
  if (s === '') return null;
  const single = /^(\d{1,2})$/.exec(s);
  if (single) {
    const n = Number(single[1]);
    return n >= 1 && n <= 10 ? { rpe: String(n), rpeHi: '' } : null;
  }
  const range = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  if (range) {
    const n = Number(range[1]);
    const m = Number(range[2]);
    return n >= 1 && n <= 10 && m >= 1 && m <= 10 && m > n ? { rpe: String(n), rpeHi: String(m) } : null;
  }
  return null;
}
