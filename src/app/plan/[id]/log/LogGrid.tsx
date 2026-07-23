'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { completePlanAction } from '../../actions';
import { HR_SOURCES, DEFAULT_REST_SECONDS } from '@/lib/constants';
import { tickedStrengthSets } from '@/lib/plannedSessions';
import type { FlowItem } from '@/lib/flowItems';
import {
  saveDraft as saveSessionDraft,
  readDraft as readSessionDraft,
  clearDraft as clearSessionDraft,
  requestPersistentStorage,
  type SessionDraft,
} from '@/lib/sessionDraft';

// ---------------------------------------------------------------------------
// Audio cues (rest timer + tempo metronome).
//
// ONE shared AudioContext for the whole logger. Mobile Chrome caps live
// AudioContexts (~6) and silently refuses new ones past the limit, so we keep a
// single context, resume it on a user gesture (autoplay policy), and spin up a
// fresh short-lived oscillator+gain per cue (oscillators are one-shot).
// ---------------------------------------------------------------------------
let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') sharedAudioCtx = new AC();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}
/** Call from a user-gesture handler so the context is allowed to make sound. */
function unlockAudio(): void {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}
/** Play a short tone from a fresh node graph (safe to call rapidly). */
function playTone(freq = 760, durSec = 0.14, peak = 0.22): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durSec);
    o.start(t);
    o.stop(t + durSec + 0.02);
    o.onended = () => {
      try { o.disconnect(); g.disconnect(); } catch { /* already gone */ }
    };
  } catch {
    /* audio not available */
  }
}
function vibrate(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* no haptics */ }
}
// Fix 1: focusing a native numeric input selects its content, so the first
// keystroke replaces the old value instead of appending to it.
const selectAllOnFocus = (e: React.FocusEvent<HTMLInputElement>) => { try { e.currentTarget.select(); } catch { /* ignore */ } };
// Strict metronome: every tick is identical (item 1). No vibration in the loop.
const TICK_FREQ = 880, TICK_DUR = 0.045, TICK_PEAK = 0.2;
// Rest end-warning tones (item 2a): distinct at T-3 and at zero.
const REST_WARN_FREQ = 660, REST_END_FREQ = 990;

export interface LogExercise {
  name: string;
  targetSets: number | null;
  targetReps: number | null;
  targetWeightKg: number | null;
  restSeconds: number | null;
  setStyle: 'reps' | 'duration';
  durationSeconds: number | null;
  tempo: string | null;
  superset: string | null;
  prevKg: number | null;
  prevReps: number | null;
}
export interface LogPlan {
  id: number;
  type: string;
  title: string;
  hasRun: boolean;
  needsCooldown: boolean;
  warmup: FlowItem[];       // structured warm-up items (item 5)
  warmupText: string | null; // legacy free-text warm-up (rendered as prose)
  cooldown: FlowItem[];      // structured cool-down items
  cooldownText: string | null;
  exercises: LogExercise[];
}

interface SetRow { kg: string; reps: string; dur: string; rpe: string; rpeHi: string; done: boolean; prevKg: string; prevReps: string; warmup: boolean; }
type Field = 'kg' | 'reps' | 'rpe' | 'dur';

function initSets(ex: LogExercise): SetRow[] {
  const n = Math.max(ex.targetSets ?? 1, 1);
  const kg = ex.targetWeightKg != null ? String(ex.targetWeightKg) : ex.prevKg != null ? String(ex.prevKg) : '';
  const reps = ex.targetReps != null ? String(ex.targetReps) : '';
  const dur = ex.setStyle === 'duration' && ex.durationSeconds != null ? String(ex.durationSeconds) : '';
  const prevKg = ex.prevKg != null ? String(ex.prevKg) : '';
  const prevReps = ex.prevReps != null ? String(ex.prevReps) : '';
  return Array.from({ length: n }, () => ({ kg, reps, dur, rpe: '', rpeHi: '', done: false, prevKg, prevReps, warmup: false }));
}
const emptyRow = (warmup = false): SetRow => ({ kg: '', reps: '', dur: '', rpe: '', rpeHi: '', done: false, prevKg: '', prevReps: '', warmup });
/** RPE cell text: half-points as typed; ranges as "7-8" (fix 4). */
const rpeDisplay = (st: Pick<SetRow, 'rpe' | 'rpeHi'>): string =>
  st.rpe === '' ? '' : st.rpeHi ? `${st.rpe}-${st.rpeHi}` : st.rpe;
// Working-set number for a row = count of non-warmup rows up to and including it.
function workingNo(rows: SetRow[], si: number): number {
  let n = 0;
  for (let i = 0; i <= si; i++) if (!rows[i].warmup) n++;
  return n;
}
function workingCount(rows: SetRow[]): number { return rows.filter((r) => !r.warmup).length; }

const FIELD_LABEL: Record<Field, string> = { kg: 'WEIGHT · KG', reps: 'REPS', rpe: 'RPE · 0-10', dur: 'TIME · SEC' };
const FIELD_UNIT: Record<Field, string> = { kg: 'kg', reps: 'reps', rpe: '/ 10', dur: 'sec' };
// Fix 9: the primary keypad button cycles fields before it logs, so its label
// always states what pressing it will actually do.
const NEXT_WORD: Record<Field, string> = { kg: 'weight', reps: 'reps', rpe: 'RPE', dur: 'time' };
const NOTIFY_ASKED = 'pft:notify-asked';

// Field cycle order depends on whether the movement is rep- or time-based, and
// whether it carries weight (item 3: no KG field for bodyweight movements).
const fieldsForStyle = (style: 'reps' | 'duration', showKg: boolean): Field[] => {
  const base: Field[] = style === 'duration' ? ['dur', 'rpe'] : ['reps', 'rpe'];
  return showKg ? ['kg', ...base] : base;
};

export default function LogGrid({ plan }: { plan: LogPlan }) {
  const router = useRouter();

  const [sets, setSets] = useState<SetRow[][]>(() => plan.exercises.map(initSets));
  const [active, setActive] = useState<{ ei: number; si: number; field: Field }>({ ei: 0, si: 0, field: 'kg' });
  // Item 3: no keypad on open — the panel starts hidden and only reveals the
  // keypad once the user taps a cell (tap() sets it to 'entry').
  const [panel, setPanel] = useState<'entry' | 'rest' | 'tempo' | 'hidden'>('hidden');
  const [resumeToast, setResumeToast] = useState(false); // brief "Resumed" confirmation
  const [paused, setPaused] = useState(false);           // single-tap pause toggle (header)
  const [exitOpen, setExitOpen] = useState(false);       // back-out choices sheet (item 3)
  const [editEx, setEditEx] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ei: number; si: number } | null>(null);
  const [warmup, setWarmup] = useState<FlowItem[]>(() => plan.warmup.map((i) => ({ ...i })));
  const [cooldown, setCooldown] = useState<FlowItem[]>(() => plan.cooldown.map((i) => ({ ...i })));
  const [notifyAsk, setNotifyAsk] = useState(false);

  const restFor = (ei: number) => plan.exercises[ei]?.restSeconds ?? DEFAULT_REST_SECONDS;
  const [rest, setRest] = useState(() => { const s = plan.exercises[0]?.restSeconds ?? DEFAULT_REST_SECONDS; return { running: false, remaining: s, total: s }; });
  const [elapsed, setElapsed] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const restWasRunning = useRef(false);
  // Item 6: wall-clock anchors so timers survive the JS loop being throttled or
  // suspended when the tab is backgrounded. The session clock is derived from
  // (base seconds + real time since an anchor); the rest timer counts down to an
  // absolute end time. On return to the foreground we recompute from these,
  // landing on the correct position rather than resuming from where the loop stalled.
  const elapsedClock = useRef<{ base: number; since: number }>({ base: 0, since: 0 });
  const restEndAt = useRef(0); // epoch ms when the current rest reaches zero

  // Count-up stopwatch for duration-style sets.
  const [sw, setSw] = useState({ running: false, elapsed: 0 });
  const swElapsed = useRef(0);
  const swTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const swWasRunning = useRef(false);

  const activeEx = plan.exercises[active.ei];
  const activeHasTempo = !!activeEx?.tempo;
  // Item 3: whether an exercise shows a KG field (weight planned/logged/history,
  // or Edit mode open to add one). Shared by the grid columns and the field cycle.
  const showKgFor = (ei: number): boolean => {
    const ex = plan.exercises[ei];
    if (!ex) return true;
    return ex.targetWeightKg != null || editEx === ei || (sets[ei]?.some((s) => s.kg !== '' || s.prevKg !== '') ?? false);
  };
  // Field cycle for a SPECIFIC row: warm-up rows drop RPE (fix 7 — warm-ups
  // only need weight and reps/time).
  const fieldsForRowAt = (ei: number, si: number): Field[] => {
    const base = fieldsForStyle(plan.exercises[ei]?.setStyle === 'duration' ? 'duration' : 'reps', showKgFor(ei));
    return sets[ei]?.[si]?.warmup ? base.filter((f) => f !== 'rpe') : base;
  };

  // --- draft persistence (item 4) -------------------------------------------
  // Mirror live state into refs so lifecycle handlers (pagehide / unmount) can
  // snapshot the FULL session without stale closures.
  const setsRef = useRef(sets); useEffect(() => { setsRef.current = sets; }, [sets]);
  const activeRef = useRef(active); useEffect(() => { activeRef.current = active; }, [active]);
  const elapsedRef = useRef(elapsed); useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
  const pausedRef = useRef(paused); useEffect(() => { pausedRef.current = paused; }, [paused]);
  const warmupRef = useRef(warmup); useEffect(() => { warmupRef.current = warmup; }, [warmup]);
  const cooldownRef = useRef(cooldown); useEffect(() => { cooldownRef.current = cooldown; }, [cooldown]);
  const clearedRef = useRef(false); // set once the draft is intentionally cleared (finish)
  // Disposition for the NEXT nav-away save: null → default (implicitly pause),
  // false → keep running (item 3 "Keep session running"). Reset after each use.
  const exitPausedRef = useRef<boolean | null>(null);

  const buildDraft = useCallback((overrideSets?: SetRow[][], overridePaused?: boolean): SessionDraft => ({
    v: 2,
    sessionId: plan.id,
    title: plan.title,
    sets: overrideSets ?? setsRef.current,
    warmup: warmupRef.current,
    cooldown: cooldownRef.current,
    active: activeRef.current,
    elapsed: elapsedRef.current,
    paused: overridePaused ?? pausedRef.current,
    updatedAt: Date.now(),
  }), [plan.id, plan.title]);

  // Every set mutation saves the full draft synchronously.
  const updateSets = useCallback((updater: (prev: SetRow[][]) => SetRow[][]) => {
    setSets((prev) => { const next = updater(prev); saveSessionDraft(buildDraft(next)); return next; });
  }, [buildDraft]);
  const saveNow = useCallback(() => { saveSessionDraft(buildDraft()); }, [buildDraft]);

  // Hydrate a saved draft once, on mount → restore everything. Item 4b: if it
  // was implicitly paused (backed-out / "save & come back"), RESUME on entry
  // and show a brief "Resumed" toast rather than a pause interstitial.
  useEffect(() => {
    requestPersistentStorage();
    const d = readSessionDraft(plan.id);
    if (d && Array.isArray(d.sets) && d.sets.length) {
      setSets(d.sets.map((rows) => rows.map((r) => ({ ...emptyRow(), ...r }))));
      if (d.active) setActive(d.active);
      if (typeof d.elapsed === 'number') {
        // Restore the session clock AND re-anchor its wall-clock base
        // synchronously. The ticking effect captured base=0 from elapsedRef
        // before this state update lands, so without re-anchoring the first
        // tick recomputes from 0 and wipes the restored value back to 0:00.
        //
        // Fix 6: a draft left RUNNING (accidental back-out, "keep running")
        // also counts the time spent away — the clock genuinely kept going.
        // Explicitly paused drafts restore frozen at their saved value.
        const away = !d.paused && typeof d.updatedAt === 'number'
          ? Math.max(0, Math.floor((Date.now() - d.updatedAt) / 1000))
          : 0;
        const el = d.elapsed + away;
        setElapsed(el);
        elapsedRef.current = el;
        elapsedClock.current = { base: el, since: Date.now() };
      }
      if (Array.isArray(d.warmup)) setWarmup(d.warmup);
      if (Array.isArray(d.cooldown)) setCooldown(d.cooldown);
      // Auto-resume (never open into a paused interstitial). Only flash the
      // "Resumed" confirmation when the draft had been implicitly paused
      // (backed-out / "save & come back") — item 4b.
      if (d.paused) {
        setResumeToast(true);
        setTimeout(() => setResumeToast(false), 2600);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  // Save when the page is hidden or torn down (real back-out on mobile).
  // visibilitychange/pagehide cover backgrounding & tab discard; the unmount
  // cleanup covers in-app client-side navigation (the back button).
  //
  // Fix 6: an ACCIDENTAL exit no longer force-pauses the session — the draft
  // keeps the session's actual pause state, so the timer is still "running"
  // and re-entry adds the time spent away. Only the explicit pause toggle and
  // "Save and come back later" (exitPausedRef=true) freeze the clock.
  useEffect(() => {
    const dispositionPaused = () => exitPausedRef.current ?? pausedRef.current;
    const onHide = () => { if (document.visibilityState === 'hidden' && !clearedRef.current) saveSessionDraft(buildDraft(undefined, dispositionPaused())); };
    const onPageHide = () => { if (!clearedRef.current) saveSessionDraft(buildDraft(undefined, dispositionPaused())); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      if (!clearedRef.current) saveSessionDraft(buildDraft(undefined, dispositionPaused())); // client-side nav away
    };
  }, [buildDraft]);

  // Fix 6: Android's Back gesture is how people dismiss the keypad, and it was
  // navigating out of the whole session. While a bottom panel is open we park a
  // sentinel entry on the history stack; Back then pops the sentinel and we
  // just close the panel — no navigation, timers untouched. With the panel
  // closed, Back behaves normally (and the draft save above keeps the clock
  // running through any accidental exit).
  const panelStateRef = useRef(panel);
  useEffect(() => { panelStateRef.current = panel; }, [panel]);
  const backTrapArmed = useRef(false);
  useEffect(() => {
    if (panel !== 'hidden' && !backTrapArmed.current) {
      // Clone the router's own state into the sentinel entry — a foreign state
      // object desyncs Next's history index and makes the NEXT real Back
      // overshoot by an entry.
      try { window.history.pushState({ ...(window.history.state ?? {}), pftKeypad: true }, ''); backTrapArmed.current = true; } catch { /* history unavailable */ }
    }
  }, [panel]);
  useEffect(() => {
    const onPop = () => {
      backTrapArmed.current = false;
      if (panelStateRef.current !== 'hidden') setPanel('hidden');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // --- screen wake lock (item 2c) -------------------------------------------
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const acquireWake = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeRef.current) {
        wakeRef.current = await (navigator as Navigator & { wakeLock: { request: (t: 'screen') => Promise<WakeLockSentinel> } }).wakeLock.request('screen');
        // eslint-disable-next-line no-console
        console.log('[wakelock] acquired');
        wakeRef.current.addEventListener?.('release', () => { console.log('[wakelock] released (by system)'); wakeRef.current = null; });
      }
    } catch { /* unsupported / denied — fail silently */ }
  }, []);
  const releaseWake = useCallback(async () => {
    try { if (wakeRef.current) { await wakeRef.current.release(); wakeRef.current = null; console.log('[wakelock] released'); } }
    catch { /* ignore */ }
  }, []);

  // Hold the wake lock while the session is active and not paused; drop it when
  // paused. Re-acquire when the tab becomes visible again (the OS drops it on hide).
  useEffect(() => {
    if (!paused && !finishing) acquireWake(); else releaseWake();
    return () => { releaseWake(); };
  }, [paused, finishing, acquireWake, releaseWake]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible' || pausedRef.current || finishing) return;
      acquireWake();
      // Item 6: on return, recompute both timers from the wall clock so they land
      // on the correct position instead of resuming from where the loop stalled.
      const c = elapsedClock.current;
      setElapsed(c.base + Math.floor((Date.now() - c.since) / 1000));
      setRest((r) => {
        if (!r.running) return r;
        const rem = Math.max(0, Math.ceil((restEndAt.current - Date.now()) / 1000));
        if (rem <= 0) { if (restTimer.current) clearInterval(restTimer.current); cancelRestNotification(); return { ...r, remaining: 0, running: false }; }
        return { ...r, remaining: rem };
      });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [acquireWake, finishing]);

  // session elapsed clock — frozen while paused. Derived from wall-clock time so
  // background throttling can't make it drift (item 6): each tick recomputes
  // elapsed from a base + real elapsed since the anchor, not by incrementing.
  useEffect(() => {
    if (paused) return;
    elapsedClock.current = { base: elapsedRef.current, since: Date.now() };
    const recompute = () => {
      const c = elapsedClock.current;
      setElapsed(c.base + Math.floor((Date.now() - c.since) / 1000));
    };
    const t = setInterval(recompute, 1000);
    return () => clearInterval(t);
  }, [paused]);
  useEffect(() => () => {
    if (restTimer.current) clearInterval(restTimer.current);
    if (swTimer.current) clearInterval(swTimer.current);
    cancelRestNotification();
  }, []);
  useEffect(() => { if (panel === 'tempo' && !activeHasTempo) setPanel('entry'); }, [active.ei, activeHasTempo, panel]);

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;

  // --- rest-end notifications (item 2b) -------------------------------------
  const restNotifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelRestNotification() {
    if (restNotifyTimer.current) { clearTimeout(restNotifyTimer.current); restNotifyTimer.current = null; }
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((reg) => reg.getNotifications({ tag: 'pft-rest' }).then((ns) => ns.forEach((n) => n.close())).catch(() => {}))
          .catch(() => {});
      }
    } catch { /* ignore */ }
  }
  function scheduleRestNotification(seconds: number) {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
    cancelRestNotification();
    const title = 'Rest complete';
    const opts = { body: 'Time for your next set.', tag: 'pft-rest', icon: '/icons/icon-192.png' };
    // Prefer an OS-scheduled trigger (fires even if the app is backgrounded/
    // closed) where supported; otherwise a setTimeout (foreground / wake-locked).
    const hasTrigger = 'TimestampTrigger' in window && 'serviceWorker' in navigator;
    if (hasTrigger) {
      navigator.serviceWorker.ready.then((reg) => {
        try {
          // @ts-expect-error — Notification Triggers is experimental
          reg.showNotification(title, { ...opts, showTrigger: new window.TimestampTrigger(Date.now() + seconds * 1000) }).catch(() => {});
        } catch { /* fall through to timeout below */ }
      }).catch(() => {});
    } else {
      restNotifyTimer.current = setTimeout(() => { try { new Notification(title, opts); } catch { /* ignore */ } }, seconds * 1000);
    }
  }
  // Ask for permission gracefully (once) the first time a rest starts.
  function maybeAskNotify() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      let asked = false;
      try { asked = localStorage.getItem(NOTIFY_ASKED) === '1'; } catch { /* ignore */ }
      if (!asked) setNotifyAsk(true);
    }
  }
  function enableNotifications() {
    setNotifyAsk(false);
    try { localStorage.setItem(NOTIFY_ASKED, '1'); } catch { /* ignore */ }
    if ('Notification' in window) {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted' && rest.running && rest.remaining > 0) scheduleRestNotification(rest.remaining);
      }).catch(() => {});
    }
  }
  function dismissNotifyAsk() {
    setNotifyAsk(false);
    try { localStorage.setItem(NOTIFY_ASKED, '1'); } catch { /* ignore */ }
  }

  // --- rest timer -----------------------------------------------------------
  // Deadline-based (item 6): the countdown is derived from an absolute end time
  // (restEndAt), so a throttled/suspended background tab can't make it drift —
  // every tick and every foreground resync recomputes from the wall clock.
  function runRestInterval() {
    if (restTimer.current) clearInterval(restTimer.current);
    restTimer.current = setInterval(() => {
      const rem = Math.max(0, Math.ceil((restEndAt.current - Date.now()) / 1000));
      setRest((r) => {
        if (rem === r.remaining) return r;
        if (rem === 3 && r.remaining > 3) { playTone(REST_WARN_FREQ, 0.12, 0.22); vibrate(35); } // T-3 warning
        if (rem <= 0) {
          if (restTimer.current) clearInterval(restTimer.current);
          if (r.remaining > 0) { playTone(REST_END_FREQ, 0.34, 0.3); vibrate([80, 40, 80]); } // distinct final beep
          cancelRestNotification();
          return { ...r, remaining: 0, running: false };
        }
        return { ...r, remaining: rem };
      });
    }, 250);
  }
  function startRest(sec: number) {
    setPanel('rest');
    restEndAt.current = Date.now() + sec * 1000;
    setRest({ running: true, remaining: sec, total: sec });
    runRestInterval();
    maybeAskNotify();
    scheduleRestNotification(sec);
  }
  function restAdjust(d: number) {
    setRest((r) => {
      const remaining = Math.max(0, r.remaining + d);
      const next = { ...r, remaining, total: Math.max(r.total, remaining) };
      if (next.running) { restEndAt.current = Date.now() + remaining * 1000; scheduleRestNotification(remaining); }
      return next;
    });
  }
  function restToggle() {
    unlockAudio();
    if (rest.running) { if (restTimer.current) clearInterval(restTimer.current); cancelRestNotification(); setRest((r) => ({ ...r, running: false })); }
    else { const sec = rest.remaining > 0 ? rest.remaining : restFor(active.ei); restEndAt.current = Date.now() + sec * 1000; setRest((r) => ({ ...r, running: true, remaining: sec, total: Math.max(r.total, sec) })); runRestInterval(); maybeAskNotify(); scheduleRestNotification(sec); }
  }
  function restSkip() { if (restTimer.current) clearInterval(restTimer.current); cancelRestNotification(); setRest((r) => ({ ...r, running: false })); setPanel('entry'); }

  // --- pause / resume (single-tap toggle in the header, L1) ------------------
  function pauseSession() {
    unlockAudio();
    restWasRunning.current = rest.running;
    if (rest.running && restTimer.current) { clearInterval(restTimer.current); restTimer.current = null; cancelRestNotification(); setRest((r) => ({ ...r, running: false })); }
    swWasRunning.current = sw.running;
    if (sw.running && swTimer.current) { clearInterval(swTimer.current); swTimer.current = null; setSw((s) => ({ ...s, running: false })); }
    setPaused(true);
    saveSessionDraft(buildDraft(undefined, true));
  }
  function resumeSession() {
    setPaused(false);
    if (restWasRunning.current) { restEndAt.current = Date.now() + rest.remaining * 1000; setRest((r) => ({ ...r, running: true })); runRestInterval(); }
    if (swWasRunning.current) { setSw((s) => ({ ...s, running: true })); runSwInterval(); }
    saveSessionDraft(buildDraft(undefined, false));
  }

  // --- duration count-up ----------------------------------------------------
  function runSwInterval() {
    if (swTimer.current) clearInterval(swTimer.current);
    swTimer.current = setInterval(() => { swElapsed.current += 1; setSw({ running: true, elapsed: swElapsed.current }); }, 1000);
  }
  function writeField(ei: number, si: number, field: Field, value: string) {
    updateSets((all) => all.map((rows, e) => e !== ei ? rows : rows.map((row, s) => s === si ? { ...row, [field]: value } : row)));
  }
  function durToggle() {
    if (sw.running) {
      if (swTimer.current) clearInterval(swTimer.current);
      setSw({ running: false, elapsed: swElapsed.current });
      writeField(active.ei, active.si, 'dur', String(swElapsed.current));
    } else {
      swElapsed.current = 0;
      setSw({ running: true, elapsed: 0 });
      runSwInterval();
    }
  }

  // Fix 1: entering a cell arms "replace mode" — the first keystroke replaces
  // the whole pre-filled value (select-all semantics), so re-typing 30 over 40
  // gives 30, not 4030. Any later keystroke appends as before.
  const entryFresh = useRef(false);

  function tap(ei: number, si: number, field: Field) {
    if (sets[ei]?.[si]?.warmup && field === 'rpe') return; // fix 7: no RPE on warm-up rows
    if (sw.running) { if (swTimer.current) clearInterval(swTimer.current); setSw((s) => ({ ...s, running: false })); }
    entryFresh.current = true;
    setActive({ ei, si, field }); setPanel('entry');
  }
  function press(v: string) {
    const fresh = entryFresh.current;
    entryFresh.current = false;
    updateSets((all) => all.map((rows, ei) => ei !== active.ei ? rows : rows.map((row, si) => {
      if (si !== active.si) return row;
      // First keystroke after entering the cell starts from empty (fix 1);
      // backspace on a fresh cell clears it, like deleting a selection.
      let cur = fresh ? '' : (row[active.field] || '');
      if (v === 'back') cur = fresh ? '' : cur.slice(0, -1);
      else if (v === '.') cur = cur.includes('.') ? cur : (cur === '' ? '0.' : cur + '.');
      else if (cur.replace('.', '').length < 4) cur = cur + v;
      // Editing the RPE value abandons any "7 or 8" range (fix 4).
      const patch: Partial<SetRow> = { [active.field]: cur };
      if (active.field === 'rpe') patch.rpeHi = '';
      return { ...row, ...patch };
    })));
  }
  // Fix 4: one-tap "unsure" — records the current RPE as a range "v or v+1".
  // Tapping again returns to the exact value.
  function toggleRpeRange() {
    const row = sets[active.ei]?.[active.si];
    if (!row || row.rpe === '') return;
    const hi = row.rpeHi ? '' : String(Math.min(10, Number(row.rpe) + 1));
    updateSets((all) => all.map((rows, e) => e !== active.ei ? rows : rows.map((r, s) => s === active.si ? { ...r, rpeHi: hi } : r)));
  }
  function toggle(ei: number, si: number) {
    unlockAudio();
    // Compute the target state from the CURRENT render's state — not from a
    // variable mutated inside the setState updater. React doesn't guarantee the
    // updater runs synchronously (it depends on other pending updates, e.g. the
    // per-second clock), so reading it back on the next line was unreliable and
    // could skip the rest-timer auto-start (issue 8).
    const row = sets[ei]?.[si];
    const nowDone = !(row?.done ?? false);
    updateSets((all) => all.map((rows, e) => e !== ei ? rows : rows.map((r, s) => s === si ? { ...r, done: nowDone } : r)));
    // Ticking a set auto-starts THIS exercise's rest timer — but NEVER resets
    // one that is already counting (fix 2), and warm-up rows don't start rest
    // at all (fix 7).
    if (nowDone && !row?.warmup && !rest.running) startRest(restFor(ei));
  }
  function next() {
    unlockAudio();
    const order = fieldsForRowAt(active.ei, active.si);
    const idx = order.indexOf(active.field);
    if (idx > -1 && idx < order.length - 1) { entryFresh.current = true; setActive({ ...active, field: order[idx + 1] }); return; }
    const row = sets[active.ei]?.[active.si];
    updateSets((all) => all.map((rows, e) => e !== active.ei ? rows : rows.map((r, s) => s === active.si ? { ...r, done: true } : r)));
    const exSets = sets[active.ei];
    let na = active;
    if (active.si + 1 < exSets.length) na = { ei: active.ei, si: active.si + 1, field: fieldsForRowAt(active.ei, active.si + 1)[0] };
    else if (active.ei + 1 < sets.length) na = { ei: active.ei + 1, si: 0, field: fieldsForRowAt(active.ei + 1, 0)[0] };
    entryFresh.current = true;
    setActive(na);
    // Same rest rules as toggle(): don't clobber a running timer (fix 2), no
    // rest for warm-up rows (fix 7).
    if (!row?.warmup && !rest.running) startRest(restFor(active.ei));
  }
  const addSet = (ei: number) => updateSets((all) => all.map((rows, e) => e === ei ? [...rows, emptyRow(false)] : rows));

  // One tap for "everything went as planned": tick every set so Finish saves
  // the whole session. Offered from the Finish sheet when sets are unticked.
  const markAllDone = useCallback(() => {
    unlockAudio();
    updateSets((all) => all.map((rows) => rows.map((r) => r.done ? r : { ...r, done: true })));
  }, [updateSets]);

  // Item 6: warm-up (ramp-up) sets sit ABOVE set 1 and never consume a working
  // set number. Keep them physically leading in the row array so array order ==
  // visual order and workingNo()/workingCount() stay correct.
  function reorderWarmupFirst(rows: SetRow[]): SetRow[] {
    return [...rows.filter((r) => r.warmup), ...rows.filter((r) => !r.warmup)];
  }
  const addWarmupSet = (ei: number) => {
    const warmCount = (sets[ei] ?? []).filter((r) => r.warmup).length;
    updateSets((all) => all.map((rows, e) => {
      if (e !== ei) return rows;
      return [...rows.slice(0, warmCount), emptyRow(true), ...rows.slice(warmCount)];
    }));
    // The insert lands at `warmCount`; shift the active pointer so it keeps
    // pointing at the SAME working set the user was logging (item 6: adding a
    // warm-up row above set 1 must not renumber or hijack focus from set 1).
    setActive((a) => (a.ei === ei && a.si >= warmCount) ? { ...a, si: a.si + 1 } : a);
  };
  function toggleRowWarmup(ei: number, si: number) {
    updateSets((all) => all.map((rows, e) => {
      if (e !== ei) return rows;
      return reorderWarmupFirst(rows.map((r, s) => s === si ? { ...r, warmup: !r.warmup } : r));
    }));
    // Reordering can shift indices — keep the active pointer in range.
    setActive((a) => a.ei !== ei ? a : { ...a, si: Math.min(a.si, (sets[ei]?.length ?? 1) - 1) });
  }

  // Item 5: warm-up / cool-down item ticks + logged weights, persisted live via
  // the draft store (no server round-trip until finish).
  const patchWarmup = useCallback((i: number, patch: Partial<FlowItem>) => {
    setWarmup((prev) => { const next = prev.map((it, idx) => idx === i ? { ...it, ...patch } : it); warmupRef.current = next; saveSessionDraft(buildDraft()); return next; });
  }, [buildDraft]);
  const patchCooldown = useCallback((i: number, patch: Partial<FlowItem>) => {
    setCooldown((prev) => { const next = prev.map((it, idx) => idx === i ? { ...it, ...patch } : it); cooldownRef.current = next; saveSessionDraft(buildDraft()); return next; });
  }, [buildDraft]);

  function deleteSet(ei: number, si: number) {
    const preLen = sets[ei]?.length ?? 0;
    updateSets((all) => all.map((rows, e) => e !== ei ? rows : rows.filter((_, s) => s !== si)));
    setDeleteTarget(null);
    setActive((a) => {
      if (a.ei !== ei) return a;
      const newLen = preLen - 1;
      return a.si >= newLen ? { ...a, si: Math.max(0, newLen - 1) } : a;
    });
  }

  const touchRef = useRef<{ x: number; y: number; ei: number; si: number } | null>(null);
  function rowTouchStart(e: React.TouchEvent, ei: number, si: number) {
    const t = e.touches[0]; touchRef.current = { x: t.clientX, y: t.clientY, ei, si };
  }
  function rowTouchEnd(e: React.TouchEvent) {
    const p = touchRef.current; touchRef.current = null;
    if (!p) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - p.x, dy = t.clientY - p.y;
    if (dx <= -50 && Math.abs(dx) > Math.abs(dy) * 1.5) setDeleteTarget({ ei: p.ei, si: p.si });
  }

  function finishNow() { clearedRef.current = true; clearSessionDraft(plan.id); releaseWake(); cancelRestNotification(); router.push('/'); }

  // --- back-out sheet actions (item 3) --------------------------------------
  function keepRunning() {
    // Leave the session running (timers keep ticking conceptually; mini-bar
    // shows it as live). Save NOT paused, then navigate away.
    exitPausedRef.current = false;
    saveSessionDraft(buildDraft(undefined, false));
    setExitOpen(false);
    router.push(`/plan/${plan.id}`);
  }
  function saveAndComeBack() {
    // Implicitly pause (freeze timers), save a paused draft, leave. Mini-bar
    // stays visible; re-entry auto-resumes with a "Resumed" flash.
    exitPausedRef.current = true;
    pauseSession();
    setExitOpen(false);
    router.push(`/plan/${plan.id}`);
  }
  function endSaveFinish() { setExitOpen(false); setFinishing(true); }
  // Discard = throw away THIS attempt's local draft only. Nothing in the DB is
  // touched (actuals are only ever written on Finish), which is why a single
  // clearly-labelled red action needs no extra confirmation step.
  function endDiscard() {
    clearedRef.current = true;
    clearSessionDraft(plan.id);
    releaseWake();
    cancelRestNotification();
    setExitOpen(false);
    router.push(`/plan/${plan.id}`);
  }

  const activeVal = sets[active.ei]?.[active.si]?.[active.field] ?? '';
  // Fix 9: what the primary button will do next for THIS row's field cycle.
  const activeOrder = fieldsForRowAt(active.ei, active.si);
  const activeFieldIdx = activeOrder.indexOf(active.field);
  const nextField: Field | null =
    activeFieldIdx > -1 && activeFieldIdx < activeOrder.length - 1 ? activeOrder[activeFieldIdx + 1] : null;
  const groups = useMemo(() => groupBySuperset(plan.exercises), [plan.exercises]);
  const doneCount = sets.reduce((a, rows) => a + rows.filter((r) => r.done).length, 0);
  const totalCount = sets.reduce((a, rows) => a + rows.length, 0);
  const activeRows = sets[active.ei] ?? [];
  const activeRow = activeRows[active.si];
  const activeIsWarmup = !!activeRow?.warmup;
  const activeSetLabel = activeIsWarmup
    ? 'WARM-UP SET'
    : `SET ${workingNo(activeRows, active.si)} OF ${workingCount(activeRows)}`;

  const restPct = rest.total ? Math.max(0, (rest.remaining / rest.total) * 100) : 0;

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7, padding: '10px 2px', marginBottom: 4 }}>
        <button className="icon-btn" onClick={() => setExitOpen(true)} aria-label="Back out of session"><span className="msr" aria-hidden="true">chevron_left</span></button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{plan.title}</div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-faint)', marginTop: 2 }}>
            {plan.type} · <span style={{ color: paused ? 'var(--text-faint)' : 'var(--accent)', fontWeight: 600 }}>{mmss(elapsed)}</span>
            {paused && <span style={{ fontWeight: 700, letterSpacing: '0.05em' }}> · PAUSED</span>}
          </div>
        </div>
        <button
          className="icon-btn"
          onClick={() => (paused ? resumeSession() : pauseSession())}
          aria-label={paused ? 'Resume session' : 'Pause session'}
          aria-pressed={paused}
          style={paused ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent-line)' } : undefined}
        ><span className="msr" aria-hidden="true">{paused ? 'play_arrow' : 'pause'}</span></button>
        <button className="btn-sm" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)', height: 32 }} onClick={() => setFinishing(true)}>Finish</button>
      </div>

      {resumeToast && (
        <div className="note note-accent" style={{ marginBottom: 10 }} role="status">
          <span className="msr-fill" aria-hidden="true">restore</span>
          Resumed. Logged sets restored, saved as you go.
        </div>
      )}

      {plan.warmupText
        ? <FlowProse kind="warmup" text={plan.warmupText} />
        : warmup.length > 0 && <WarmCoolList kind="warmup" items={warmup} onPatch={patchWarmup} />}

      {/* Exercise cards. Item 4: reserve the tall keypad space ONLY while the
          panel is open; when it is collapsed ("Tap a set to log"), reserve just
          enough to clear that short bar so the page ends cleanly. */}
      <div className="stack stack-12" style={{ paddingBottom: panel === 'hidden' ? 104 : 360, marginTop: warmup.length > 0 ? 12 : 0 }}>
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.label && (
              <div className="eyebrow eyebrow-accent" style={{ margin: '0 2px 8px', fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />SUPERSET {supersetLabel(groups, gi)}
              </div>
            )}
            {g.items.map(({ ex, index }, pos) => {
              const activeHere = active.ei === index;
              const done = sets[index].filter((s) => s.done).length;
              const style = ex.setStyle === 'duration' ? 'duration' : 'reps';
              const midLabel = style === 'duration' ? 'SEC' : 'REPS';
              const editing = editEx === index;
              // Item 3: hide the KG column for movements with no weight
              // (bodyweight / most timed holds) so there is no empty column.
              // Still shown when a weight is planned, already logged, has
              // history, or the user opened Edit mode to add one.
              const showKg = showKgFor(index);
              const cols = showKg
                ? '30px 56px 1fr 1fr 1fr 44px'
                : '30px 56px 1fr 1fr 44px';
              const headers = showKg ? ['SET', 'PREV', 'KG', midLabel, 'RPE'] : ['SET', 'PREV', midLabel, 'RPE'];
              return (
                <div key={index} className="card" style={{ padding: 15, marginBottom: g.items.length > 1 ? 10 : 0, borderLeft: `3px solid ${activeHere ? 'var(--accent)' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, minWidth: 0 }}>
                      <div aria-hidden="true" style={{ flex: 'none', minWidth: 30, height: 30, padding: '0 8px', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums', background: activeHere ? 'var(--accent)' : 'var(--accent-soft)', color: activeHere ? 'var(--on-accent)' : 'var(--accent)' }}>{exerciseLabel(groups, gi, pos)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{ex.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                          {style === 'duration'
                            ? `${ex.targetSets ?? '·'} × ${ex.durationSeconds != null ? `${ex.durationSeconds}s` : 'timed'} target`
                            : `${ex.targetSets ?? '·'} × ${ex.targetReps ?? '·'} target`}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: done === sets[index].length && sets[index].length > 0 ? 'var(--accent)' : 'var(--text-dim)' }}>{done}/{sets[index].length}</div>
                      <button onClick={() => setEditEx(editing ? null : index)} aria-label={editing ? 'Done editing sets' : 'Edit sets'} style={{ height: 26, padding: '0 9px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: editing ? 'var(--accent-soft)' : 'var(--surface)', color: editing ? 'var(--accent)' : 'var(--text-dim)' }}>
                        {editing ? 'Done' : 'Edit'}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    <span style={pillStyle}><span className="msr" style={{ fontSize: 13 }} aria-hidden="true">timer</span>Rest {mmss(ex.restSeconds ?? DEFAULT_REST_SECONDS)}</span>
                    {ex.tempo && (
                      <button style={{ ...pillStyle, cursor: 'pointer', color: 'var(--accent)', borderColor: 'var(--accent-line)', background: 'var(--accent-soft)' }} onClick={() => { setActive((a) => ({ ...a, ei: index, si: Math.min(a.si, sets[index].length - 1) })); setPanel('tempo'); }}>
                        <span className="msr" style={{ fontSize: 13 }} aria-hidden="true">speed</span>Tempo {ex.tempo}
                      </button>
                    )}
                    {style === 'duration' && (
                      <span style={pillStyle}><span className="msr" style={{ fontSize: 13 }} aria-hidden="true">hourglass_top</span>Timed</span>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 7, alignItems: 'center', margin: '14px 0 2px' }}>
                    {headers.map((h, hi) => (
                      <div key={h} style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-faint)', textAlign: hi >= 2 ? 'center' : 'left' }}>{h}</div>
                    ))}
                    <div />
                  </div>

                  {sets[index].length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '8px 2px' }}>No sets. Add one below.</div>
                  )}

                  {sets[index].map((st, si) => {
                    const rowActive = activeHere && active.si === si;
                    const wNo = workingNo(sets[index], si);
                    const badgeBg = st.done ? 'var(--accent)' : st.warmup ? 'transparent' : rowActive ? 'var(--accent-soft)' : 'transparent';
                    const badgeColor = st.done ? 'var(--on-accent)' : st.warmup ? 'var(--text-faint)' : rowActive ? 'var(--accent)' : 'var(--text)';
                    return (
                    <div key={si}
                      onTouchStart={(e) => rowTouchStart(e, index, si)}
                      onTouchEnd={rowTouchEnd}
                      style={{ display: 'grid', gridTemplateColumns: cols, gap: 7, alignItems: 'center', marginTop: 8, padding: '4px 4px', marginLeft: -4, marginRight: -4, borderRadius: 12, background: rowActive ? 'var(--accent-tint)' : st.warmup ? 'var(--last-bg)' : 'transparent', boxShadow: rowActive ? 'inset 0 0 0 1px var(--accent-line)' : 'none', transition: 'background 0.12s', touchAction: 'pan-y' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {editing ? (
                          <button onClick={() => toggleRowWarmup(index, si)} aria-label={st.warmup ? `Make set ${wNo} a working set` : 'Mark as warm-up set'} aria-pressed={st.warmup} style={{ minWidth: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: st.warmup ? 11 : 16, fontWeight: 800, letterSpacing: st.warmup ? '0.03em' : undefined, cursor: 'pointer', border: st.warmup ? '1px solid var(--accent-line)' : '1px dashed var(--border)', background: st.warmup ? 'var(--accent-soft)' : 'transparent', color: st.warmup ? 'var(--accent)' : 'var(--text-dim)' }}>
                            {st.warmup ? 'WU' : wNo}
                          </button>
                        ) : (
                          // Fix 8: warm-up rows are labelled with plain "WU" text —
                          // the old icon glyph rendered blank when the icon font
                          // hadn't loaded (real-phone report).
                          <div style={{ minWidth: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: st.warmup ? 11 : 16, fontWeight: 800, letterSpacing: st.warmup ? '0.03em' : undefined, fontVariantNumeric: 'tabular-nums', color: st.warmup && !st.done ? 'var(--accent)' : badgeColor, background: badgeBg }}>
                            {st.warmup ? 'WU' : wNo}
                          </div>
                        )}
                      </div>
                      {/* Fix 5: PREV shows what was lifted AND for how many reps;
                          bodyweight history shows its reps alone. A reps label is
                          only rendered when there is a number to put next to it. */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.15 }}>
                        {st.prevKg || st.prevReps ? (
                          <>
                            {st.prevKg && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}><span style={{ color: 'var(--text)', fontWeight: 600 }}>{st.prevKg}</span> kg</div>}
                            {st.prevReps && <div style={{ fontSize: 11, color: st.prevKg ? 'var(--text-faint)' : 'var(--text-dim)' }}>{!st.prevKg ? <span style={{ color: 'var(--text)', fontWeight: 600 }}>{st.prevReps}</span> : st.prevReps} reps</div>}
                          </>
                        ) : <div style={{ fontSize: 11, color: 'var(--text-faint)' }} title="No completed history for this movement">·</div>}
                      </div>
                      {showKg && <Cell active={rowActive && active.field === 'kg'} filled={st.kg !== ''} onClick={() => tap(index, si, 'kg')} value={st.kg} />}
                      {style === 'duration' ? (
                        <Cell active={rowActive && active.field === 'dur'} filled={st.dur !== ''} onClick={() => tap(index, si, 'dur')} value={st.dur !== '' ? `${st.dur}s` : ''} />
                      ) : (
                        <Cell active={rowActive && active.field === 'reps'} filled={st.reps !== ''} onClick={() => tap(index, si, 'reps')} value={st.reps} />
                      )}
                      {st.warmup
                        ? <div aria-hidden="true" /> /* fix 7: warm-up rows have no RPE */
                        : <Cell active={rowActive && active.field === 'rpe'} filled={st.rpe !== ''} onClick={() => tap(index, si, 'rpe')} value={rpeDisplay(st)} />}
                      {editing ? (
                        <button onClick={() => setDeleteTarget({ ei: index, si })} aria-label={st.warmup ? 'Delete warm-up set' : `Delete set ${wNo}`} style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, cursor: 'pointer', background: 'var(--err-tint)', color: 'var(--err-text)', border: '1px solid var(--err-line)' }}>
                          <span className="msr" aria-hidden="true">delete</span>
                        </button>
                      ) : (
                        <button onClick={() => toggle(index, si)} aria-label={`${st.done ? '' : 'Mark '}${st.warmup ? 'warm-up set' : `set ${wNo}`} done`} style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer', background: st.done ? 'var(--accent)' : 'transparent', color: st.done ? 'var(--on-accent)' : 'var(--text-faint)', border: st.done ? 'none' : '1.5px solid var(--border)' }}>
                          <span className="msr-fill" aria-hidden="true">check</span>
                        </button>
                      )}
                    </div>
                    );
                  })}

                  {activeHere && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '0.03em', color: 'var(--accent)' }}>{activeSetLabel}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text-faint)' }}>
                        <span className="msr" style={{ fontSize: 13 }} aria-hidden="true">touch_app</span>
                        tap a cell, then use the keypad below
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 11, alignItems: 'center' }}>
                    <button onClick={() => addWarmupSet(index)} aria-label="Add warm-up set" style={{ height: 36, padding: '0 12px', borderRadius: 11, border: '1px dashed var(--accent-line)', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: 'var(--accent)', cursor: 'pointer', flex: 'none' }}>
                      <span className="msr" style={{ fontSize: 16 }} aria-hidden="true">whatshot</span>Warm-up
                    </button>
                    <button onClick={() => addSet(index)} style={{ flex: 1, height: 36, borderRadius: 11, border: '1px dashed var(--border)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)', cursor: 'pointer' }}>
                      <span className="msr" aria-hidden="true">add</span>Add set
                    </button>
                  </div>
                  {editing && <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 8 }}>Tap a set number to mark it a warm-up set · tap <span className="msr" style={{ fontSize: 12, verticalAlign: 'middle' }} aria-hidden="true">delete</span> to remove a set</div>}
                </div>
              );
            })}
          </div>
        ))}

        {plan.cooldownText
          ? <FlowProse kind="cooldown" text={plan.cooldownText} />
          : cooldown.length > 0 && <WarmCoolList kind="cooldown" items={cooldown} onPatch={patchCooldown} />}
      </div>

      {/* Bottom entry panel */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, maxWidth: 460, margin: '0 auto', padding: '10px 16px calc(22px + env(safe-area-inset-bottom))', background: 'var(--panel-bg)', borderTop: '1px solid var(--border)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}>
        {notifyAsk && (
          <div className="note note-accent" style={{ marginBottom: 10 }}>
            <span className="msr-fill" aria-hidden="true">notifications_active</span>
            <div style={{ flex: 1 }}>
              Allow notifications so your rest timer can alert you even if the screen is off.
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={enableNotifications} className="btn-sm" style={{ background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', height: 34 }}>Enable</button>
                <button onClick={dismissNotifyAsk} className="btn-sm" style={{ background: 'var(--surface)', color: 'var(--text-dim)', border: '1px solid var(--border)', height: 34 }}>Not now</button>
              </div>
            </div>
          </div>
        )}
        {panel === 'hidden' ? (
          <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setPanel('entry')}>
            <div style={{ width: 34, height: 4, borderRadius: 3, background: 'var(--border)' }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-faint)' }}>Tap a set to log</div>
            <span className="msr" style={{ fontSize: 18, color: 'var(--text-faint)' }} aria-hidden="true">keyboard_arrow_up</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
              <div className="seg" style={{ flex: 1 }}>
                <button className={`seg-item ${panel === 'entry' ? 'active' : ''}`} onClick={() => setPanel('entry')}><span className="msr">dialpad</span>Keypad</button>
                <button className={`seg-item ${panel === 'rest' ? 'active' : ''}`} onClick={() => setPanel('rest')}><span className="msr">timer</span>Rest</button>
                {activeHasTempo && <button className={`seg-item ${panel === 'tempo' ? 'active' : ''}`} onClick={() => setPanel('tempo')}><span className="msr">speed</span>Tempo</button>}
              </div>
              <button onClick={() => setPanel('hidden')} aria-label="Hide keypad" style={{ width: 42, height: 38, flex: 'none', borderRadius: 11, background: 'var(--seg-track)', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, border: 'none', cursor: 'pointer' }}>
                <span className="msr" aria-hidden="true">keyboard_arrow_down</span>
              </button>
            </div>

            {panel === 'entry' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11, padding: '0 2px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-faint)' }}>{activeSetLabel} · {FIELD_LABEL[active.field]}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>
                      {activeVal === '' ? '0' : activeVal}
                      {active.field === 'rpe' && activeRow?.rpeHi ? `-${activeRow.rpeHi}` : ''}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>{FIELD_UNIT[active.field]}</div>
                  </div>
                </div>

                {/* Fix 4: one-tap honest uncertainty — "7 or 8" instead of a forced number. */}
                {active.field === 'rpe' && (
                  <button
                    onClick={toggleRpeRange}
                    disabled={activeVal === ''}
                    aria-pressed={!!activeRow?.rpeHi}
                    style={{ width: '100%', height: 44, marginBottom: 10, borderRadius: 13, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--accent-line)', background: activeRow?.rpeHi ? 'var(--accent)' : 'var(--accent-soft)', color: activeRow?.rpeHi ? 'var(--on-accent)' : 'var(--accent)', opacity: activeVal === '' ? 0.5 : 1 }}
                  >
                    {activeRow?.rpeHi
                      ? `Logged as ${activeVal} or ${activeRow.rpeHi} · tap for exactly ${activeVal}`
                      : activeVal === ''
                        ? 'Unsure? Enter an RPE first'
                        : `Unsure? Log as ${activeVal} or ${Math.min(10, Number(activeVal) + 1)}`}
                  </button>
                )}

                {active.field === 'dur' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '10px 12px', borderRadius: 13, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <span className="msr-fill" style={{ fontSize: 20, color: sw.running ? 'var(--accent)' : 'var(--text-dim)' }} aria-hidden="true">timer</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-faint)' }}>COUNT-UP TIMER</div>
                      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{mmss(sw.running ? sw.elapsed : (Number(activeVal) || 0))}</div>
                    </div>
                    <button onClick={durToggle} className="btn-sm" style={{ height: 40, minWidth: 96, background: sw.running ? 'var(--accent)' : 'var(--accent-soft)', color: sw.running ? 'var(--on-accent)' : 'var(--accent)', border: sw.running ? 'none' : '1px solid var(--accent-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                      <span className="msr-fill" style={{ fontSize: 18 }} aria-hidden="true">{sw.running ? 'stop' : 'play_arrow'}</span>{sw.running ? 'Stop' : 'Start'}
                    </button>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((k) => (
                    <button key={k} onClick={() => press(k)} style={{ height: 44, border: '1px solid var(--border)', borderRadius: 13, background: 'var(--key-bg)', color: 'var(--text)', fontSize: 21, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      {k === 'back' ? '⌫' : k}
                    </button>
                  ))}
                </div>
                <button className="btn" style={{ height: 50, marginTop: 10, borderRadius: 14 }} onClick={next}>
                  {nextField ? `Next: ${NEXT_WORD[nextField]}` : 'Log set'}
                  <span className="msr-fill" style={{ fontSize: 20 }}>{nextField ? 'arrow_forward' : 'check'}</span>
                </button>
              </>
            ) : panel === 'rest' ? (
              <div style={{ padding: '2px 2px 4px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-faint)' }}>REST</div>
                  <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: rest.remaining <= 3 && rest.running ? 'var(--accent)' : 'var(--text)' }}>{mmss(rest.remaining)}</div>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: 'var(--seg-track)', margin: '14px 0 16px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${restPct}%`, background: 'var(--accent)', borderRadius: 4, transition: 'width 0.9s linear' }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => restAdjust(-15)} style={restSmBtn}>−15s</button>
                  <button onClick={restSkip} style={{ ...restSmBtn, flex: 1.6, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)' }}>Skip rest</button>
                  <button onClick={() => restAdjust(15)} style={restSmBtn}>+15s</button>
                </div>
                <button className="btn" style={{ height: 50, marginTop: 10, borderRadius: 14 }} onClick={restToggle}>
                  <span className="msr-fill" style={{ fontSize: 20 }}>{rest.running ? 'pause' : 'play_arrow'}</span>{rest.running ? 'Pause' : 'Start rest'}
                </button>
              </div>
            ) : (
              activeEx?.tempo ? <TempoPlayer tempo={activeEx.tempo} frozen={paused} /> : null
            )}
          </>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          icon="delete"
          title={`Remove set ${deleteTarget.si + 1}?`}
          body="This removes the set row and any values logged for it. This can't be undone."
          confirmLabel="Remove set"
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteSet(deleteTarget.ei, deleteTarget.si)}
        />
      )}

      {finishing && (
        <FinishSheet
          plan={plan}
          sets={sets}
          warmup={warmup}
          cooldown={cooldown}
          doneCount={doneCount}
          totalCount={totalCount}
          elapsed={elapsed}
          onMarkAllDone={markAllDone}
          onClose={() => setFinishing(false)}
          onSaved={finishNow}
        />
      )}

      {exitOpen && (
        <ExitSheet
          elapsed={mmss(elapsed)}
          progress={`${doneCount} of ${totalCount}`}
          onClose={() => setExitOpen(false)}
          onKeepRunning={keepRunning}
          onSaveLater={saveAndComeBack}
          onSaveFinish={endSaveFinish}
          onDiscard={endDiscard}
        />
      )}
    </>
  );
}

const restSmBtn: React.CSSProperties = { flex: 1, height: 44, border: '1px solid var(--border)', borderRadius: 13, background: 'var(--surface)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' };
const pillStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', background: 'var(--surface)', border: '1px solid var(--border)' };

function Cell({ active, filled, value, onClick }: { active: boolean; filled: boolean; value: string; onClick: () => void }) {
  const base: React.CSSProperties = { height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 11, fontSize: 16, fontWeight: 600, cursor: 'pointer' };
  let style = base;
  if (active) style = { ...base, background: 'var(--accent-soft)', border: '1.5px solid var(--accent)', color: 'var(--text)', boxShadow: '0 0 0 3px var(--accent-soft)' };
  else if (filled) style = { ...base, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' };
  else style = { ...base, background: 'var(--last-bg)', border: '1px dashed var(--border)', color: 'var(--text-faint)' };
  return <button type="button" style={style} onClick={onClick}>{value !== '' ? value : active ? '' : '·'}</button>;
}

function ConfirmDialog({ icon, title, body, confirmLabel, danger, onCancel, onConfirm }: {
  icon: string; title: string; body: string; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 340, background: 'var(--panel-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid var(--border)', borderRadius: 22, padding: 20, textAlign: 'center' }}>
        <div style={{ width: 46, height: 46, margin: '0 auto 12px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: danger ? 'var(--err-tint)' : 'var(--accent-soft)' }}>
          <span className="msr-fill" style={{ fontSize: 22, color: danger ? 'var(--err-text)' : 'var(--accent)' }} aria-hidden="true">{icon}</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.4 }}>{body}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCancel} style={{ ...restSmBtn, height: 46 }}>Cancel</button>
          <button onClick={onConfirm} style={{ ...restSmBtn, height: 46, flex: 1.3, background: danger ? 'var(--err-tint)' : 'var(--accent)', color: danger ? 'var(--err-text)' : 'var(--on-accent)', border: danger ? '1px solid var(--err-line)' : 'none' }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// --- Structured warm-up / cool-down list (item 5) ----------------------------
// Condensed collapsible list: one tickable line per item; weighted items get a
// compact weight input. Ticks + weights are pushed straight to the draft store
// via onPatch, so they persist immediately.
function WarmCoolList({ kind, items, onPatch }: {
  kind: 'warmup' | 'cooldown';
  items: FlowItem[];
  onPatch: (i: number, patch: Partial<FlowItem>) => void;
}) {
  const [open, setOpen] = useState(true);
  const isWarm = kind === 'warmup';
  const doneCount = items.filter((i) => i.done).length;
  // Item 5: lighter than the exercise cards (muted surface, thin border, no
  // accent bar) so warm-up / cool-down read as bookends, not work sets.
  return (
    <div style={{ padding: 0, overflow: 'hidden', borderRadius: 14, background: 'var(--last-bg)', border: '1px solid var(--border)' }}>
      <button onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '11px 14px', color: 'var(--text)' }}>
        <span className="msr-fill" style={{ fontSize: 18, color: 'var(--accent)' }} aria-hidden="true">{isWarm ? 'local_fire_department' : 'self_improvement'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{isWarm ? 'Warm-up' : 'Cool-down'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{doneCount}/{items.length} done · {isWarm ? 'before you start' : 'after the work'}</div>
        </div>
        <span className="msr" style={{ fontSize: 20, color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} aria-hidden="true">expand_more</span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 10px' }}>
          {items.map((it, i) => {
            const weighted = it.weightKg != null || it.loggedWeightKg != null;
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', borderTop: '1px solid var(--border)' }}>
                <button
                  onClick={() => onPatch(i, { done: !it.done })}
                  aria-label={it.done ? `Mark ${it.name} not done` : `Mark ${it.name} done`}
                  aria-pressed={it.done}
                  style={{ width: 30, height: 30, flex: 'none', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, cursor: 'pointer', background: it.done ? 'var(--accent)' : 'transparent', color: it.done ? 'var(--on-accent)' : 'var(--text-faint)', border: it.done ? 'none' : '1.5px solid var(--border)' }}
                >
                  <span className="msr-fill" aria-hidden="true">check</span>
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', textDecoration: it.done ? 'line-through' : 'none', textDecorationColor: 'var(--text-faint)' }}>{it.name}</div>
                  {it.detail && <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{it.detail}</div>}
                </div>
                {weighted && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={it.loggedWeightKg ?? ''}
                      placeholder={it.weightKg != null ? String(it.weightKg) : '·'}
                      onChange={(e) => { const v = e.target.value; onPatch(i, { loggedWeightKg: v === '' ? null : Number(v) }); }}
                      onFocus={selectAllOnFocus}
                      aria-label={`${it.name} weight in kg`}
                      style={{ width: 58, height: 34, textAlign: 'center', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14, fontWeight: 600 }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>kg</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Legacy free-text warm-up / cool-down (item 5) ---------------------------
// Old plans stored warm-up / cool-down as plain text. Render it as readable
// prose (line breaks preserved), in the same light bookend style as the list.
function FlowProse({ kind, text }: { kind: 'warmup' | 'cooldown'; text: string }) {
  const [open, setOpen] = useState(true);
  const isWarm = kind === 'warmup';
  return (
    <div style={{ padding: 0, overflow: 'hidden', borderRadius: 14, background: 'var(--last-bg)', border: '1px solid var(--border)' }}>
      <button onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '11px 14px', color: 'var(--text)' }}>
        <span className="msr-fill" style={{ fontSize: 18, color: 'var(--accent)' }} aria-hidden="true">{isWarm ? 'local_fire_department' : 'self_improvement'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{isWarm ? 'Warm-up' : 'Cool-down'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{isWarm ? 'before you start' : 'after the work'}</div>
        </div>
        <span className="msr" style={{ fontSize: 20, color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} aria-hidden="true">expand_more</span>
      </button>
      {open && (
        <div style={{ padding: '2px 15px 12px', fontSize: 13, lineHeight: 1.6, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>{text}</div>
      )}
    </div>
  );
}

// --- Back-out sheet (item 3) --------------------------------------------------
// Three top-level choices; "End session" reveals two sub-choices. Discard acts
// immediately: it is red, clearly labelled, and only clears the LOCAL draft
// (actuals are only written on Finish), so no extra confirmation step (L1).
// All tap targets are ≥44px for mid-workout use, matching the logger's large
// buttons.
function ExitSheet({ elapsed, progress, onClose, onKeepRunning, onSaveLater, onSaveFinish, onDiscard }: {
  elapsed: string;
  progress: string;
  onClose: () => void;
  onKeepRunning: () => void;
  onSaveLater: () => void;
  onSaveFinish: () => void;
  onDiscard: () => void;
}) {
  const [view, setView] = useState<'main' | 'end'>('main');
  const Choice = ({ icon, title, body, onClick, danger }: { icon: string; title: string; body: string; onClick: () => void; danger?: boolean }) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', minHeight: 60, textAlign: 'left', padding: '15px 16px', borderRadius: 15, border: `1px solid ${danger ? 'var(--err-line)' : 'var(--border)'}`, background: danger ? 'var(--err-tint)' : 'var(--surface)', cursor: 'pointer', color: danger ? 'var(--err-text)' : 'var(--text)' }}>
      <span className="msr-fill" style={{ fontSize: 24, color: danger ? 'var(--err-text)' : 'var(--accent)', flex: 'none' }} aria-hidden="true">{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, color: danger ? 'var(--err-text)' : 'var(--text-faint)', marginTop: 2, lineHeight: 1.35 }}>{body}</div>
      </div>
    </button>
  );
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 75, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--panel-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTop: '1px solid var(--border)', padding: '18px 18px calc(26px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div className="h2">{view === 'end' ? 'End session' : 'Leave session?'}</div>
          <button className="icon-btn dim" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44 }}><span className="msr" aria-hidden="true">close</span></button>
        </div>
        <div className="sub" style={{ marginBottom: 16 }}>{elapsed} elapsed · {progress} sets logged</div>

        {view === 'main' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Choice icon="play_circle" title="Keep session running" body="Timers keep running. A bar keeps this session one tap away." onClick={onKeepRunning} />
            <Choice icon="bookmark" title="Save and come back later" body="Pauses and saves your progress. Resume any time from the session bar." onClick={onSaveLater} />
            <Choice icon="stop_circle" title="End session" body="Finish and save, or discard this attempt." onClick={() => setView('end')} />
          </div>
        )}

        {view === 'end' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Choice icon="check_circle" title="Save and finish" body="Keeps every logged set and marks the session complete." onClick={onSaveFinish} />
            <Choice icon="delete" title="Discard this attempt" body="Clears the sets logged on this phone for this attempt. Nothing already saved is touched." danger onClick={onDiscard} />
            {/* flex:'none' — restSmBtn's flex:1 collapses the height inside this column flexbox */}
            <button onClick={() => setView('main')} style={{ ...restSmBtn, flex: 'none', height: 50, marginTop: 2 }}>Back</button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Tempo metronome ---------------------------------------------------------
interface TempoPhase { label: string; sec: number; }
function parseTempo(tempo: string): TempoPhase[] {
  const labels = ['Lower', 'Bottom', 'Raise', 'Top'];
  const out: TempoPhase[] = [];
  tempo.toUpperCase().slice(0, 4).split('').forEach((c, i) => {
    const sec = c === 'X' ? 1 : Number(c);
    if (!Number.isFinite(sec) || sec <= 0) return;
    out.push({ label: c === 'X' && i === 2 ? 'Explode' : labels[i], sec });
  });
  return out;
}

interface TempoDisp { pi: number; remaining: number; rep: number }

function TempoPlayer({ tempo, frozen }: { tempo: string; frozen?: boolean }) {
  const phases = useMemo(() => parseTempo(tempo), [tempo]);
  const bounds = useMemo(() => { let acc = 0; return phases.map((p) => (acc += p.sec)); }, [phases]);
  const cycle = bounds.length ? bounds[bounds.length - 1] : 0;

  const [running, setRunning] = useState(false);
  const [disp, setDisp] = useState<TempoDisp>({ pi: 0, remaining: phases[0]?.sec ?? 0, rep: 0 });

  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const accumRef = useRef(0);
  const lastSecondRef = useRef(-1);

  const stopRaf = () => { if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };

  // Absolute-timestamp rAF engine (kept exactly as-is). Item 1: the metronome
  // fires ONE IDENTICAL tick every whole second — same pitch, same volume, like
  // a real metronome. No pitch change on phase boundaries. No vibration.
  const frame = useCallback(() => {
    if (!cycle) return;
    const elapsed = (accumRef.current + (performance.now() - startedAtRef.current)) / 1000;
    const rep = Math.floor(elapsed / cycle);
    const within = elapsed - rep * cycle;
    let pi = 0;
    while (pi < bounds.length - 1 && within >= bounds[pi]) pi++;
    const remaining = Math.max(0, bounds[pi] - within);

    const secondIndex = Math.floor(elapsed + 1e-6);
    if (secondIndex !== lastSecondRef.current) {
      lastSecondRef.current = secondIndex;
      playTone(TICK_FREQ, TICK_DUR, TICK_PEAK); // identical every second
    }

    const remCeil = Math.max(0, Math.ceil(remaining - 1e-6));
    setDisp((prev) => (prev.pi === pi && prev.rep === rep && prev.remaining === remCeil) ? prev : { pi, remaining: remCeil, rep });
    rafRef.current = requestAnimationFrame(frame);
  }, [bounds, cycle]);

  const start = useCallback(() => {
    if (!phases.length) return;
    unlockAudio();
    startedAtRef.current = performance.now();
    setRunning(true);
    stopRaf();
    rafRef.current = requestAnimationFrame(frame);
  }, [frame, phases.length]);

  const pause = useCallback(() => {
    accumRef.current += performance.now() - startedAtRef.current;
    stopRaf();
    setRunning(false);
  }, []);

  const reset = useCallback(() => {
    stopRaf();
    setRunning(false);
    accumRef.current = 0;
    lastSecondRef.current = -1;
    setDisp({ pi: 0, remaining: phases[0]?.sec ?? 0, rep: 0 });
  }, [phases]);

  useEffect(() => { reset(); }, [tempo, reset]);
  useEffect(() => () => stopRaf(), []);
  useEffect(() => { if (frozen && running) pause(); }, [frozen, running, pause]);

  if (!phases.length) {
    return <div style={{ padding: 12, fontSize: 13, color: 'var(--text-dim)', textAlign: 'center' }}>Tempo “{tempo}” has no timed phases.</div>;
  }
  const st = disp;
  const cur = phases[st.pi];

  return (
    <div style={{ padding: '2px 2px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-faint)' }}>TEMPO · {tempo}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>Rep {st.rep + 1}</div>
      </div>
      <div style={{ textAlign: 'center', margin: '8px 0 12px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.01em' }}>{running ? cur.label : 'Ready'}</div>
        <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{running ? st.remaining : phases[0].sec}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {phases.map((p, i) => (
          <div key={i} style={{ flex: p.sec, minWidth: 0, textAlign: 'center', padding: '7px 4px', borderRadius: 10, background: running && i === st.pi ? 'var(--accent)' : 'var(--seg-track)', color: running && i === st.pi ? 'var(--on-accent)' : 'var(--text-dim)', transition: 'background 0.15s' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{p.sec}s</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={reset} style={restSmBtn}>Reset</button>
        <button className="btn" style={{ flex: 2, height: 50, borderRadius: 14, margin: 0 }} onClick={running ? pause : start}>
          <span className="msr-fill" style={{ fontSize: 20 }}>{running ? 'pause' : 'play_arrow'}</span>{running ? 'Pause' : 'Start tempo'}
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textAlign: 'center', marginTop: 9 }}>Steady metronome: one tick every second</div>
    </div>
  );
}

interface Group { label: string | null; items: { ex: LogExercise; index: number }[]; }
function groupBySuperset(exercises: LogExercise[]): Group[] {
  const groups: Group[] = [];
  exercises.forEach((ex, index) => {
    const tag = ex.superset?.trim() || null;
    const last = groups[groups.length - 1];
    if (tag && last && last.label === tag) last.items.push({ ex, index });
    else groups.push({ label: tag, items: [{ ex, index }] });
  });
  return groups;
}

// Item 2: superset header label derived purely from ON-SCREEN position — the
// block's 1-based number plus a letter per exercise (e.g. "6A / 6B"). Never
// echoes the pushed plan's raw tag, which may not match the rendered list.
function supersetLabel(groups: Group[], gi: number): string {
  const num = gi + 1;
  return groups[gi].items.map((_, i) => `${num}${String.fromCharCode(65 + i)}`).join(' / ');
}

// Per-card position label (item 2): the block number, plus a letter suffix for
// each exercise inside a superset (so cards read "1", "2", "6A", "6B" and match
// the "SUPERSET 6A / 6B" header exactly).
function exerciseLabel(groups: Group[], gi: number, pos: number): string {
  const num = gi + 1;
  return groups[gi].items.length > 1 ? `${num}${String.fromCharCode(65 + pos)}` : `${num}`;
}

// --- Finish wrap-up sheet ----------------------------------------------------
// Shown offline / when the server action can't be reached. The draft is left
// untouched on-device, so tapping Finish again simply retries the same save.
const OFFLINE_FINISH_MSG =
  'No signal. Your session is saved on this phone. Tap Finish again when you’re back online.';

function FinishSheet({ plan, sets, warmup, cooldown, doneCount, totalCount, elapsed, onMarkAllDone, onClose, onSaved }: {
  plan: LogPlan;
  sets: SetRow[][];
  warmup: FlowItem[];
  cooldown: FlowItem[];
  doneCount: number;
  totalCount: number;
  elapsed: number; // session seconds — saved as the session's duration
  onMarkAllDone: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rpeOverall, setRpe] = useState('');
  const [energyPre, setEnergy] = useState('');
  const [notes, setNotes] = useState('');
  const [cooldownDone, setCooldown] = useState(false);
  const [distanceKm, setDistance] = useState('');
  const [avgHr, setAvgHr] = useState('');
  const [hrSource, setHrSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const showCooldownPrompt = plan.needsCooldown && cooldown.length === 0 && !plan.cooldownText;

  async function save() {
    setSaving(true); setError(null);
    // Data truth: ONLY ticked sets are saved. Rows pre-fill from targets, so a
    // value alone proves nothing — unticked rows are dropped (no ghost rows).
    const strengthSets = tickedStrengthSets(plan.exercises, sets);
    const run = plan.hasRun ? {
      distanceKm: distanceKm ? Number(distanceKm) : null,
      avgHr: avgHr ? Number(avgHr) : null,
      hrSource: hrSource || null,
    } : null;
    let res;
    try {
      res = await completePlanAction(plan.id, {
        // Session clock → stored duration (whole minutes, ≥1 once started).
        durationMin: elapsed > 0 ? Math.max(1, Math.round(elapsed / 60)) : null,
        rpeOverall: rpeOverall ? Number(rpeOverall) : null,
        energyPre: energyPre ? Number(energyPre) : null,
        ...(showCooldownPrompt ? { cooldownDone } : {}),
        warmup, cooldown,
        notes: notes || null, strengthSets, run,
      });
    } catch {
      // The action call never reached the server (offline / no signal). The
      // draft is still on-device, so a later Finish retries cleanly.
      setError(OFFLINE_FINISH_MSG);
      setSaving(false);
      return;
    }
    if (!res.ok) { setError(res.error ?? 'Could not save'); setSaving(false); return; }
    if (res.warning) { setWarning(res.warning); setTimeout(onSaved, 2200); return; }
    onSaved();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '88vh', overflowY: 'auto', background: 'var(--panel-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTop: '1px solid var(--border)', padding: '18px 18px calc(26px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div className="h2">Finish session</div>
          <button className="icon-btn dim" onClick={onClose} aria-label="Close"><span className="msr" aria-hidden="true">close</span></button>
        </div>
        <div className="sub" style={{ marginBottom: 16 }}>{doneCount} of {totalCount} sets ticked · only ticked sets are saved</div>

        {doneCount < totalCount && (
          <div className="card card-tinted" style={{ padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--text-dim)' }}>
              {totalCount - doneCount} unticked set{totalCount - doneCount === 1 ? '' : 's'} won&apos;t be saved.
              Did everything as planned?
            </div>
            <button
              className="btn-sm"
              onClick={onMarkAllDone}
              style={{ marginTop: 10, height: 38, width: '100%', background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <span className="msr-fill" style={{ fontSize: 18 }} aria-hidden="true">done_all</span>
              Mark all as done
            </button>
          </div>
        )}

        {error && <div className="note note-err">{error}</div>}
        {warning && <div className="note note-accent"><span className="msr-fill">warning</span>{warning}</div>}

        <div className="row" style={{ marginBottom: 14 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Overall RPE</label>
            <input type="number" inputMode="decimal" step={0.5} value={rpeOverall} onChange={(e) => setRpe(e.target.value)} onFocus={selectAllOnFocus} placeholder="1-10" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Energy before</label>
            <input type="number" inputMode="numeric" value={energyPre} onChange={(e) => setEnergy(e.target.value)} onFocus={selectAllOnFocus} placeholder="1-5" />
          </div>
        </div>

        {plan.hasRun && (
          <>
            <div className="row" style={{ marginBottom: 14 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Distance (km)</label>
                <input type="number" inputMode="decimal" value={distanceKm} onChange={(e) => setDistance(e.target.value)} onFocus={selectAllOnFocus} placeholder="Strava/Technogym" />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Avg HR</label>
                <input type="number" inputMode="numeric" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} onFocus={selectAllOnFocus} />
              </div>
            </div>
            <div className="field">
              <label>HR source</label>
              <select value={hrSource} onChange={(e) => setHrSource(e.target.value)}>
                <option value="">·</option>
                {HR_SOURCES.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            {hrSource === 'Samsung' && (
              <div className="note note-accent" style={{ marginTop: -4 }}>
                <span className="msr-fill">info</span>Samsung/Galaxy HR is the least-reliable fallback (Elvanse-inflated). Logged &amp; flagged; distance from Samsung is never used.
              </div>
            )}
          </>
        )}

        {showCooldownPrompt && (
          <PromptCheck checked={cooldownDone} onChange={setCooldown} label="10-minute cooldown done" />
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it feel?" />
        </div>

        <button className="btn btn-lg" onClick={save} disabled={saving}>
          {saving ? <span className="spin" /> : <>Save &amp; complete<span className="msr-fill" style={{ fontSize: 20 }}>check</span></>}
        </button>
      </div>
    </div>
  );
}

function PromptCheck({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="card card-tinted" style={{ marginTop: 12, padding: '12px 14px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, color: 'var(--text)', fontSize: 14 }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 'auto' }} />
        {label}
      </label>
    </div>
  );
}
