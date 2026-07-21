// Tempo metronome domain logic. Pure and unit-tested — the React side
// (TempoPlayer in LogGrid) only renders what these functions compute.
//
// Tempo notation, up to 4 digits: eccentric(lower) / pause(bottom) /
// concentric(raise) / pause(top). "X" = explosive (treated as ~1s).
// 0-second phases are skipped entirely.

export interface TempoPhase {
  label: string;
  sec: number;
}

const LABELS = ['Lower', 'Bottom', 'Raise', 'Top'];

export function parseTempo(tempo: string): TempoPhase[] {
  const out: TempoPhase[] = [];
  tempo
    .toUpperCase()
    .slice(0, 4)
    .split('')
    .forEach((c, i) => {
      const sec = c === 'X' ? 1 : Number(c);
      if (!Number.isFinite(sec) || sec <= 0) return; // skip 0-second phases
      out.push({ label: c === 'X' && i === 2 ? 'Explode' : LABELS[i], sec });
    });
  return out;
}

/** Total seconds of one rep (one full pass through the phases). */
export function cycleSeconds(phases: TempoPhase[]): number {
  return phases.reduce((a, p) => a + p.sec, 0);
}

export interface TempoPosition {
  /** Index into phases of the phase we are currently in. */
  pi: number;
  /** Seconds remaining in the current phase (float, > 0). */
  remaining: number;
  /** Completed full cycles before this one (0-based rep counter). */
  rep: number;
  /** Whole seconds to display, counting down sec..1 (never 0). */
  display: number;
}

/**
 * Where the metronome is after `elapsedSec` seconds of running time.
 *
 * Computed from absolute elapsed time rather than by chaining ticks, so the
 * caller can be driven by requestAnimationFrame (or wake from a throttled
 * background tab) and always land on the exact right phase with no drift and
 * no skipped/doubled phases.
 */
export function tempoAt(phases: TempoPhase[], elapsedSec: number): TempoPosition {
  const cycle = cycleSeconds(phases);
  if (!phases.length || cycle <= 0 || !Number.isFinite(elapsedSec) || elapsedSec < 0) {
    return { pi: 0, remaining: phases[0]?.sec ?? 0, rep: 0, display: phases[0]?.sec ?? 0 };
  }
  const rep = Math.floor(elapsedSec / cycle);
  let pos = elapsedSec - rep * cycle; // 0 <= pos < cycle
  for (let pi = 0; pi < phases.length; pi++) {
    if (pos < phases[pi].sec) {
      const remaining = phases[pi].sec - pos;
      // ceil, but guard the exact-boundary float case so a fresh phase of N
      // seconds displays N (not N+epsilon rounded oddly) and never 0.
      const display = Math.min(phases[pi].sec, Math.max(1, Math.ceil(remaining - 1e-9)));
      return { pi, remaining, rep, display };
    }
    pos -= phases[pi].sec;
  }
  // Floating point landed exactly on the cycle boundary: start of next rep.
  return { pi: 0, remaining: phases[0].sec, rep: rep + 1, display: phases[0].sec };
}
