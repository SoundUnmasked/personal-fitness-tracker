// Metronome / timer audio for the logger. Client-side only.
//
// Mobile Chrome constraints this module exists to satisfy (session-18 bug:
// sound died after ~one tempo cycle):
//   - A page gets a hard cap of ~6 AudioContexts; creating one per beep
//     silently stops producing sound once the cap is hit. So: ONE shared
//     context for the whole page, created lazily.
//   - Autoplay policy: the context starts (and after backgrounding, returns)
//     in the "suspended" state and may only be resumed from a user gesture.
//     Call unlockAudio() in every tap handler that precedes beeps; beep()
//     additionally tries a resume in case the OS suspended us mid-set.
//   - Each tone is a fresh, short-lived oscillator+gain pair. Source nodes
//     are single-use by spec; the nodes disconnect themselves when done.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx && ctx.state !== 'closed') return ctx;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Create/resume the shared context. Must be called from a user gesture
 * (tap on Start, a set tick, etc) or mobile Chrome will keep it suspended.
 */
export function unlockAudio(): void {
  const ac = getContext();
  if (ac && ac.state === 'suspended') {
    void ac.resume().catch(() => {});
  }
}

export type BeepKind = 'phase' | 'cycle' | 'end';

// cycle (new rep) is pitched above the plain phase click; end is a longer,
// lower "done" tone for the rest timer.
const TONE: Record<BeepKind, { freq: number; dur: number; gain: number }> = {
  phase: { freq: 760, dur: 0.25, gain: 0.2 },
  cycle: { freq: 980, dur: 0.28, gain: 0.24 },
  end: { freq: 620, dur: 0.5, gain: 0.24 },
};

/** Play one short tone through the shared context. Safe to call anywhere. */
export function beep(kind: BeepKind = 'phase'): void {
  const ac = getContext();
  if (!ac) return;
  // Best effort mid-set recovery; without a gesture this may be a no-op.
  if (ac.state === 'suspended') void ac.resume().catch(() => {});
  try {
    const t = TONE[kind];
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = t.freq;
    o.connect(g);
    g.connect(ac.destination);
    const now = ac.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(t.gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t.dur);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
    o.start(now);
    o.stop(now + t.dur + 0.01);
  } catch {
    /* audio unavailable — timers still run silently */
  }
}
