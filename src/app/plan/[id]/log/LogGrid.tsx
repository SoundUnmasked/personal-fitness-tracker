'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { completePlanAction, setSessionFlagsAction } from '../../actions';
import { HR_SOURCES, DEFAULT_REST_SECONDS } from '@/lib/constants';
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
  warmup: string | null;
  cooldown: string | null;
  warmupDone: boolean;
  cooldownDone: boolean;
  exercises: LogExercise[];
}

interface SetRow { kg: string; reps: string; dur: string; rpe: string; done: boolean; prevKg: string; prevReps: string; }
type Field = 'kg' | 'reps' | 'rpe' | 'dur';

function initSets(ex: LogExercise): SetRow[] {
  const n = Math.max(ex.targetSets ?? 1, 1);
  const kg = ex.targetWeightKg != null ? String(ex.targetWeightKg) : ex.prevKg != null ? String(ex.prevKg) : '';
  const reps = ex.targetReps != null ? String(ex.targetReps) : '';
  const dur = ex.setStyle === 'duration' && ex.durationSeconds != null ? String(ex.durationSeconds) : '';
  const prevKg = ex.prevKg != null ? String(ex.prevKg) : '';
  const prevReps = ex.prevReps != null ? String(ex.prevReps) : '';
  return Array.from({ length: n }, () => ({ kg, reps, dur, rpe: '', done: false, prevKg, prevReps }));
}

const FIELD_LABEL: Record<Field, string> = { kg: 'WEIGHT · KG', reps: 'REPS', rpe: 'RPE · 0–10', dur: 'TIME · SEC' };
const FIELD_UNIT: Record<Field, string> = { kg: 'kg', reps: 'reps', rpe: '/ 10', dur: 'sec' };
const NOTIFY_ASKED = 'pft:notify-asked';

// Field cycle order depends on whether the movement is rep- or time-based.
const fieldsForStyle = (style: 'reps' | 'duration'): Field[] =>
  style === 'duration' ? ['kg', 'dur', 'rpe'] : ['kg', 'reps', 'rpe'];

export default function LogGrid({ plan }: { plan: LogPlan }) {
  const router = useRouter();

  const [sets, setSets] = useState<SetRow[][]>(() => plan.exercises.map(initSets));
  const [active, setActive] = useState<{ ei: number; si: number; field: Field }>({ ei: 0, si: 0, field: 'kg' });
  // Item 3: no keypad on open — the panel starts hidden and only reveals the
  // keypad once the user taps a cell (tap() sets it to 'entry').
  const [panel, setPanel] = useState<'entry' | 'rest' | 'tempo' | 'hidden'>('hidden');
  const [resumed, setResumed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [continueMode, setContinueMode] = useState(false); // paused because backed-out → "Continue"
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [editEx, setEditEx] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ ei: number; si: number } | null>(null);
  const [warmupDone, setWarmupDone] = useState(plan.warmupDone);
  const [cooldownDone, setCooldownDone] = useState(plan.cooldownDone);
  const [notifyAsk, setNotifyAsk] = useState(false);

  const restFor = (ei: number) => plan.exercises[ei]?.restSeconds ?? DEFAULT_REST_SECONDS;
  const [rest, setRest] = useState(() => { const s = plan.exercises[0]?.restSeconds ?? DEFAULT_REST_SECONDS; return { running: false, remaining: s, total: s }; });
  const [elapsed, setElapsed] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const restWasRunning = useRef(false);

  // Count-up stopwatch for duration-style sets.
  const [sw, setSw] = useState({ running: false, elapsed: 0 });
  const swElapsed = useRef(0);
  const swTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const swWasRunning = useRef(false);

  const activeEx = plan.exercises[active.ei];
  const activeStyle: 'reps' | 'duration' = activeEx?.setStyle === 'duration' ? 'duration' : 'reps';
  const activeHasTempo = !!activeEx?.tempo;

  // --- draft persistence (item 4) -------------------------------------------
  // Mirror live state into refs so lifecycle handlers (pagehide / unmount) can
  // snapshot the FULL session without stale closures.
  const setsRef = useRef(sets); useEffect(() => { setsRef.current = sets; }, [sets]);
  const activeRef = useRef(active); useEffect(() => { activeRef.current = active; }, [active]);
  const elapsedRef = useRef(elapsed); useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
  const pausedRef = useRef(paused); useEffect(() => { pausedRef.current = paused; }, [paused]);
  const clearedRef = useRef(false); // set once the draft is intentionally cleared (finish)

  const buildDraft = useCallback((overrideSets?: SetRow[][], overridePaused?: boolean): SessionDraft => ({
    v: 2,
    sessionId: plan.id,
    title: plan.title,
    sets: overrideSets ?? setsRef.current,
    active: activeRef.current,
    elapsed: elapsedRef.current,
    paused: overridePaused ?? pausedRef.current,
    updatedAt: Date.now(),
  }), [plan.id, plan.title]);

  // Every set mutation saves the full draft synchronously.
  const updateSets = useCallback((updater: (prev: SetRow[][]) => SetRow[][]) => {
    setSets((prev) => { const next = updater(prev); saveSessionDraft(buildDraft(next)); return next; });
  }, [buildDraft]);

  // Hydrate a saved draft once, on mount → restore sets + active + elapsed, and
  // if it was backed-out (paused) show the "Continue session" state.
  useEffect(() => {
    requestPersistentStorage();
    const d = readSessionDraft(plan.id);
    if (d && Array.isArray(d.sets) && d.sets.length) {
      setSets(d.sets);
      if (d.active) setActive(d.active);
      if (typeof d.elapsed === 'number') setElapsed(d.elapsed);
      setResumed(true);
      if (d.paused) { setPaused(true); setContinueMode(true); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  // Save + implicitly pause when the page is hidden or torn down (real back-out
  // on mobile). visibilitychange/pagehide cover backgrounding & tab discard;
  // the unmount cleanup covers in-app client-side navigation (the back button).
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden' && !clearedRef.current) saveSessionDraft(buildDraft(undefined, true)); };
    const onPageHide = () => { if (!clearedRef.current) saveSessionDraft(buildDraft(undefined, true)); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      if (!clearedRef.current) saveSessionDraft(buildDraft(undefined, true)); // client-side nav away
    };
  }, [buildDraft]);

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
    const onVis = () => { if (document.visibilityState === 'visible' && !pausedRef.current && !finishing) acquireWake(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [acquireWake, finishing]);

  // session elapsed clock — frozen while paused
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
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
  function runRestInterval() {
    if (restTimer.current) clearInterval(restTimer.current);
    restTimer.current = setInterval(() => {
      setRest((r) => {
        const rem = r.remaining - 1;
        if (rem === 3) { playTone(REST_WARN_FREQ, 0.12, 0.22); vibrate(35); } // T-3 warning
        if (rem <= 0) {
          if (restTimer.current) clearInterval(restTimer.current);
          playTone(REST_END_FREQ, 0.34, 0.3); vibrate([80, 40, 80]);          // distinct final beep
          cancelRestNotification(); // we're in the foreground — no need for the system alert
          return { ...r, remaining: 0, running: false };
        }
        return { ...r, remaining: rem };
      });
    }, 1000);
  }
  function startRest(sec: number) {
    setPanel('rest');
    setRest({ running: true, remaining: sec, total: sec });
    runRestInterval();
    maybeAskNotify();
    scheduleRestNotification(sec);
  }
  function restAdjust(d: number) {
    setRest((r) => { const next = { ...r, remaining: Math.max(0, r.remaining + d), total: Math.max(r.total, r.remaining + d) }; if (next.running) scheduleRestNotification(next.remaining); return next; });
  }
  function restToggle() {
    unlockAudio();
    if (rest.running) { if (restTimer.current) clearInterval(restTimer.current); cancelRestNotification(); setRest((r) => ({ ...r, running: false })); }
    else { const sec = rest.remaining > 0 ? rest.remaining : restFor(active.ei); setRest((r) => ({ ...r, running: true, remaining: sec, total: Math.max(r.total, sec) })); runRestInterval(); maybeAskNotify(); scheduleRestNotification(sec); }
  }
  function restSkip() { if (restTimer.current) clearInterval(restTimer.current); cancelRestNotification(); setRest((r) => ({ ...r, running: false })); setPanel('entry'); }

  // --- pause / resume / restart (items 4/5) ---------------------------------
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
    setPaused(false); setContinueMode(false);
    if (restWasRunning.current) { setRest((r) => ({ ...r, running: true })); runRestInterval(); }
    if (swWasRunning.current) { setSw((s) => ({ ...s, running: true })); runSwInterval(); }
    saveSessionDraft(buildDraft(undefined, false));
  }
  function restartSession() {
    const fresh = plan.exercises.map(initSets);
    setSets(fresh);
    setActive({ ei: 0, si: 0, field: 'kg' });
    if (restTimer.current) { clearInterval(restTimer.current); restTimer.current = null; }
    cancelRestNotification();
    const s0 = plan.exercises[0]?.restSeconds ?? DEFAULT_REST_SECONDS;
    setRest({ running: false, remaining: s0, total: s0 });
    if (swTimer.current) { clearInterval(swTimer.current); swTimer.current = null; }
    swElapsed.current = 0; setSw({ running: false, elapsed: 0 });
    setElapsed(0);
    setResumed(false);
    setEditEx(null);
    setPanel('hidden');
    setConfirmRestart(false);
    setPaused(false); setContinueMode(false);
    // Session continues (still in progress), just cleared — keep a fresh draft.
    saveSessionDraft({ v: 2, sessionId: plan.id, title: plan.title, sets: fresh, active: { ei: 0, si: 0, field: 'kg' }, elapsed: 0, paused: false, updatedAt: Date.now() });
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

  function tap(ei: number, si: number, field: Field) {
    if (sw.running) { if (swTimer.current) clearInterval(swTimer.current); setSw((s) => ({ ...s, running: false })); }
    setActive({ ei, si, field }); setPanel('entry');
  }
  function press(v: string) {
    updateSets((all) => all.map((rows, ei) => ei !== active.ei ? rows : rows.map((row, si) => {
      if (si !== active.si) return row;
      let cur = row[active.field] || '';
      if (v === 'back') cur = cur.slice(0, -1);
      else if (v === '.') cur = cur.includes('.') ? cur : (cur === '' ? '0.' : cur + '.');
      else if (cur.replace('.', '').length < 4) cur = cur + v;
      return { ...row, [active.field]: cur };
    })));
  }
  function toggle(ei: number, si: number) {
    unlockAudio();
    // Compute the target state from the CURRENT render's state — not from a
    // variable mutated inside the setState updater. React doesn't guarantee the
    // updater runs synchronously (it depends on other pending updates, e.g. the
    // per-second clock), so reading it back on the next line was unreliable and
    // could skip the rest-timer auto-start (issue 8).
    const nowDone = !(sets[ei]?.[si]?.done ?? false);
    updateSets((all) => all.map((rows, e) => e !== ei ? rows : rows.map((row, s) => s === si ? { ...row, done: nowDone } : row)));
    // Issue 8: ticking a set done auto-starts THIS exercise's rest timer.
    if (nowDone) startRest(restFor(ei));
  }
  function next() {
    unlockAudio();
    const order = fieldsForStyle(activeStyle);
    const idx = order.indexOf(active.field);
    if (idx > -1 && idx < order.length - 1) { setActive({ ...active, field: order[idx + 1] }); return; }
    updateSets((all) => all.map((rows, e) => e !== active.ei ? rows : rows.map((row, s) => s === active.si ? { ...row, done: true } : row)));
    const exSets = sets[active.ei];
    let na = active;
    if (active.si + 1 < exSets.length) na = { ei: active.ei, si: active.si + 1, field: 'kg' };
    else if (active.ei + 1 < sets.length) na = { ei: active.ei + 1, si: 0, field: 'kg' };
    setActive(na);
    startRest(restFor(active.ei));
  }
  const addSet = (ei: number) => updateSets((all) => all.map((rows, e) => e === ei ? [...rows, { kg: '', reps: '', dur: '', rpe: '', done: false, prevKg: '', prevReps: '' }] : rows));

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
  function toggleWarmup() { const v = !warmupDone; setWarmupDone(v); setSessionFlagsAction(plan.id, { warmupDone: v }); }
  function toggleCooldown() { const v = !cooldownDone; setCooldownDone(v); setSessionFlagsAction(plan.id, { cooldownDone: v }); }

  const activeVal = sets[active.ei]?.[active.si]?.[active.field] ?? '';
  const groups = useMemo(() => groupBySuperset(plan.exercises), [plan.exercises]);
  const doneCount = sets.reduce((a, rows) => a + rows.filter((r) => r.done).length, 0);
  const totalCount = sets.reduce((a, rows) => a + rows.length, 0);
  const activeLen = sets[active.ei]?.length ?? 0;

  const cols = '30px 56px 1fr 1fr 1fr 44px';
  const restPct = rest.total ? Math.max(0, (rest.remaining / rest.total) * 100) : 0;

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7, padding: '10px 2px', marginBottom: 4 }}>
        <button className="icon-btn" onClick={() => router.push(`/plan/${plan.id}`)} aria-label="Back to session"><span className="msr" aria-hidden="true">chevron_left</span></button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{plan.title}</div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-faint)', marginTop: 2 }}>
            {plan.type} · <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{mmss(elapsed)}</span>
          </div>
        </div>
        <button className="icon-btn" onClick={pauseSession} aria-label="Pause session"><span className="msr" aria-hidden="true">pause</span></button>
        <button className="btn-sm" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)', height: 32 }} onClick={() => setFinishing(true)}>Finish</button>
      </div>

      {resumed && !paused && (
        <div className="note note-accent" style={{ marginBottom: 10 }}>
          <span className="msr-fill" aria-hidden="true">restore</span>
          Continuing your session — logged sets restored, saved as you go.
        </div>
      )}

      {plan.warmup && <FlowBlock kind="warmup" text={plan.warmup} done={warmupDone} onToggle={toggleWarmup} />}

      {/* Exercise cards */}
      <div className="stack stack-12" style={{ paddingBottom: 360, marginTop: plan.warmup ? 12 : 0 }}>
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.label && (
              <div className="eyebrow eyebrow-accent" style={{ margin: '0 2px 8px', fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />SUPERSET {g.label}
              </div>
            )}
            {g.items.map(({ ex, index }) => {
              const activeHere = active.ei === index;
              const done = sets[index].filter((s) => s.done).length;
              const style = ex.setStyle === 'duration' ? 'duration' : 'reps';
              const midLabel = style === 'duration' ? 'SEC' : 'REPS';
              const editing = editEx === index;
              return (
                <div key={index} className="card" style={{ padding: 15, marginBottom: g.items.length > 1 ? 10 : 0, borderLeft: `3px solid ${activeHere ? 'var(--accent)' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{ex.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                        {style === 'duration'
                          ? `${ex.targetSets ?? '—'} × ${ex.durationSeconds != null ? `${ex.durationSeconds}s` : 'timed'} target`
                          : `${ex.targetSets ?? '—'} × ${ex.targetReps ?? '—'} target`}
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
                    {['SET', 'PREV', 'KG', midLabel, 'RPE'].map((h, hi) => (
                      <div key={h} style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-faint)', textAlign: hi >= 2 ? 'center' : 'left' }}>{h}</div>
                    ))}
                    <div />
                  </div>

                  {sets[index].length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '8px 2px' }}>No sets — add one below.</div>
                  )}

                  {sets[index].map((st, si) => {
                    const rowActive = activeHere && active.si === si;
                    return (
                    <div key={si}
                      onTouchStart={(e) => rowTouchStart(e, index, si)}
                      onTouchEnd={rowTouchEnd}
                      style={{ display: 'grid', gridTemplateColumns: cols, gap: 7, alignItems: 'center', marginTop: 8, padding: '4px 4px', marginLeft: -4, marginRight: -4, borderRadius: 12, background: rowActive ? 'var(--accent-tint)' : 'transparent', boxShadow: rowActive ? 'inset 0 0 0 1px var(--accent-line)' : 'none', transition: 'background 0.12s', touchAction: 'pan-y' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ minWidth: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: st.done ? 'var(--on-accent)' : rowActive ? 'var(--accent)' : 'var(--text)', background: st.done ? 'var(--accent)' : rowActive ? 'var(--accent-soft)' : 'transparent' }}>{si + 1}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.15 }}>
                        {st.prevKg ? (
                          <>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}><span style={{ color: 'var(--text)', fontWeight: 600 }}>{st.prevKg}</span> kg</div>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{st.prevReps} reps</div>
                          </>
                        ) : <div style={{ fontSize: 11, color: 'var(--text-faint)' }} title="No completed history for this movement">—</div>}
                      </div>
                      <Cell active={rowActive && active.field === 'kg'} filled={st.kg !== ''} onClick={() => tap(index, si, 'kg')} value={st.kg} />
                      {style === 'duration' ? (
                        <Cell active={rowActive && active.field === 'dur'} filled={st.dur !== ''} onClick={() => tap(index, si, 'dur')} value={st.dur !== '' ? `${st.dur}s` : ''} />
                      ) : (
                        <Cell active={rowActive && active.field === 'reps'} filled={st.reps !== ''} onClick={() => tap(index, si, 'reps')} value={st.reps} />
                      )}
                      <Cell active={rowActive && active.field === 'rpe'} filled={st.rpe !== ''} onClick={() => tap(index, si, 'rpe')} value={st.rpe} />
                      {editing ? (
                        <button onClick={() => setDeleteTarget({ ei: index, si })} aria-label={`Delete set ${si + 1}`} style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, cursor: 'pointer', background: 'var(--err-tint)', color: 'var(--err-text)', border: '1px solid var(--err-line)' }}>
                          <span className="msr" aria-hidden="true">delete</span>
                        </button>
                      ) : (
                        <button onClick={() => toggle(index, si)} aria-label={st.done ? `Set ${si + 1} done` : `Mark set ${si + 1} done`} style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer', background: st.done ? 'var(--accent)' : 'transparent', color: st.done ? 'var(--on-accent)' : 'var(--text-faint)', border: st.done ? 'none' : '1.5px solid var(--border)' }}>
                          <span className="msr-fill" aria-hidden="true">check</span>
                        </button>
                      )}
                    </div>
                    );
                  })}

                  {activeHere && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '0.03em', color: 'var(--accent)' }}>SET {active.si + 1} OF {activeLen}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: 'var(--text-faint)' }}>
                        <span className="msr" style={{ fontSize: 13 }} aria-hidden="true">touch_app</span>
                        tap a cell, then use the keypad below
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 11, alignItems: 'center' }}>
                    <button onClick={() => addSet(index)} style={{ flex: 1, height: 36, borderRadius: 11, border: '1px dashed var(--border)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)', cursor: 'pointer' }}>
                      <span className="msr" aria-hidden="true">add</span>Add set
                    </button>
                    {editing && <div style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>Tap <span className="msr" style={{ fontSize: 12, verticalAlign: 'middle' }} aria-hidden="true">delete</span> to remove a set</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {plan.cooldown && <FlowBlock kind="cooldown" text={plan.cooldown} done={cooldownDone} onToggle={toggleCooldown} />}
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
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-faint)' }}>SET {active.si + 1} OF {activeLen} · {FIELD_LABEL[active.field]}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{activeVal === '' ? '0' : activeVal}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>{FIELD_UNIT[active.field]}</div>
                  </div>
                </div>

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
                <button className="btn" style={{ height: 50, marginTop: 10, borderRadius: 14 }} onClick={next}>Log set<span className="msr-fill" style={{ fontSize: 20 }}>arrow_forward</span></button>
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

      {/* Paused / Continue overlay (items 4/5) */}
      {paused && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', color: 'var(--text-faint)' }}>{continueMode ? 'SESSION IN PROGRESS' : 'PAUSED'}</div>
          <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{mmss(elapsed)}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', textAlign: 'center', maxWidth: 260 }}>{doneCount} of {totalCount} sets logged · saved automatically</div>
          <button className="btn" style={{ maxWidth: 300, width: '100%', marginTop: 6 }} onClick={resumeSession}><span className="msr-fill" style={{ fontSize: 20 }}>play_arrow</span>{continueMode ? 'Continue session' : 'Resume session'}</button>
          <button onClick={() => setConfirmRestart(true)} style={{ ...restSmBtn, maxWidth: 300, width: '100%', flex: 'none', height: 48, background: 'var(--err-tint)', color: 'var(--err-text)', border: '1px solid var(--err-line)' }}>Restart — clear progress</button>
        </div>
      )}

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

      {confirmRestart && (
        <ConfirmDialog
          icon="restart_alt"
          title="Restart this session?"
          body="This clears every set you've logged in this session and starts over. This can't be undone."
          confirmLabel="Clear & restart"
          danger
          onCancel={() => setConfirmRestart(false)}
          onConfirm={restartSession}
        />
      )}

      {finishing && (
        <FinishSheet
          plan={plan}
          sets={sets}
          progress={`${doneCount}/${totalCount}`}
          onClose={() => setFinishing(false)}
          onSaved={finishNow}
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
  return <button type="button" style={style} onClick={onClick}>{value !== '' ? value : active ? '' : '–'}</button>;
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

function FlowBlock({ kind, text, done, onToggle }: { kind: 'warmup' | 'cooldown'; text: string; done: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(true);
  const isWarm = kind === 'warmup';
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: `3px solid ${done ? 'var(--accent)' : 'var(--border)'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <button onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, color: 'var(--text)' }}>
          <span className="msr-fill" style={{ fontSize: 19, color: 'var(--accent)' }} aria-hidden="true">{isWarm ? 'local_fire_department' : 'self_improvement'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{isWarm ? 'Warm-up' : 'Cool-down'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{done ? 'Done' : isWarm ? 'Before you start' : 'After the work'}</div>
          </div>
          <span className="msr" style={{ fontSize: 20, color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} aria-hidden="true">expand_more</span>
        </button>
        <button onClick={onToggle} aria-label={done ? `Mark ${kind} not done` : `Mark ${kind} done`} aria-pressed={done} style={{ width: 40, height: 40, flex: 'none', borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer', background: done ? 'var(--accent)' : 'transparent', color: done ? 'var(--on-accent)' : 'var(--text-faint)', border: done ? 'none' : '1.5px solid var(--border)' }}>
          <span className="msr-fill" aria-hidden="true">check</span>
        </button>
      </div>
      {open && (
        <div style={{ padding: '0 14px 13px', fontSize: 13, lineHeight: 1.5, color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>{text}</div>
      )}
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
      <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textAlign: 'center', marginTop: 9 }}>Steady metronome — one tick every second</div>
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

// --- Finish wrap-up sheet ----------------------------------------------------
function FinishSheet({ plan, sets, progress, onClose, onSaved }: {
  plan: LogPlan;
  sets: SetRow[][];
  progress: string;
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

  const showCooldownPrompt = plan.needsCooldown && !plan.cooldown;

  async function save() {
    setSaving(true); setError(null);
    const strengthSets = plan.exercises.flatMap((ex, ei) =>
      sets[ei].filter((s) => s.kg || s.reps || s.rpe || s.dur).map((s, i) => ({
        exerciseName: ex.name, setNo: i + 1,
        reps: s.reps ? Number(s.reps) : null,
        weightKg: s.kg ? Number(s.kg) : null,
        durationSeconds: s.dur ? Number(s.dur) : null,
        rpe: s.rpe ? Number(s.rpe) : null,
      })),
    );
    const run = plan.hasRun ? {
      distanceKm: distanceKm ? Number(distanceKm) : null,
      avgHr: avgHr ? Number(avgHr) : null,
      hrSource: hrSource || null,
    } : null;
    const res = await completePlanAction(plan.id, {
      rpeOverall: rpeOverall ? Number(rpeOverall) : null,
      energyPre: energyPre ? Number(energyPre) : null,
      ...(showCooldownPrompt ? { cooldownDone } : {}),
      notes: notes || null, strengthSets, run,
    });
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
        <div className="sub" style={{ marginBottom: 16 }}>{progress} sets logged</div>

        {error && <div className="note note-err">{error}</div>}
        {warning && <div className="note note-accent"><span className="msr-fill">warning</span>{warning}</div>}

        <div className="row" style={{ marginBottom: 14 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Overall RPE</label>
            <input type="number" inputMode="numeric" value={rpeOverall} onChange={(e) => setRpe(e.target.value)} placeholder="1–10" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Energy before</label>
            <input type="number" inputMode="numeric" value={energyPre} onChange={(e) => setEnergy(e.target.value)} placeholder="1–5" />
          </div>
        </div>

        {plan.hasRun && (
          <>
            <div className="row" style={{ marginBottom: 14 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Distance (km)</label>
                <input type="number" inputMode="decimal" value={distanceKm} onChange={(e) => setDistance(e.target.value)} placeholder="Strava/Technogym" />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Avg HR</label>
                <input type="number" inputMode="numeric" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>HR source</label>
              <select value={hrSource} onChange={(e) => setHrSource(e.target.value)}>
                <option value="">—</option>
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
