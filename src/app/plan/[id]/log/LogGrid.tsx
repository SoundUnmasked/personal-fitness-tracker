'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { completePlanAction } from '../../actions';
import { HR_SOURCES, DEFAULT_REST_SECONDS } from '@/lib/constants';
import { tickedStrengthSets } from '@/lib/plannedSessions';
import { fmtClock } from '@/lib/format';
import { parseTempoRegions } from '@/lib/tempo';
import NoteText from '@/components/NoteText';
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
// Strict metronome: every tempo tick is one identical flat blip.
const TICK_FREQ = 880, TICK_DUR = 0.045, TICK_PEAK = 0.2;
// Package P: region-based tempo cues. Each region has its OWN pitch so the
// lifter can follow tempo by ear — lower for the descent, higher for the lift —
// rather than a flat beat. Distinct from the rest-end chime (item 6).
const TEMPO_REGION_FREQ: Record<string, number> = { ecc: 392, bottom: 330, con: 587, top: 494 };
function playRegionCue(key: string): void { playTone(TEMPO_REGION_FREQ[key] ?? 440, 0.12, 0.26); }
function playTempoSubTick(): void { playTone(880, 0.03, 0.1); } // soft interior second
function playExplode(): void { playTone(784, 0.16, 0.32); }    // explosive concentric accent
// A clear rising two-note "starting now" cue at the end of the setup delay —
// its own pitch pair (523 -> 784), unlike rest-end (660 -> 990).
function playStartingNow(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;
  const note = (freq: number, at: number, dur: number, peak = 0.3) => {
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      const t = t0 + at;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } };
    } catch { /* audio unavailable */ }
  };
  note(523, 0, 0.14); note(784, 0.13, 0.3);
}
// Rest countdown blip (T-3/T-2/T-1): a short, low, same-pitch tick each second.
const REST_COUNT_FREQ = 620;
// Package N item 6: the rest-END cue must be clearly DIFFERENT from the tempo
// tick — it means "start your set", not "keep to tempo". A rising two-note
// chime (root -> a fifth above), which no single flat metronome blip resembles.
function playRestEndChime(): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;
  const note = (freq: number, at: number, dur: number, peak = 0.3) => {
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle'; // warmer than the metronome's default sine — extra separation
      o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      const t = t0 + at;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } };
    } catch { /* audio unavailable */ }
  };
  note(660, 0, 0.16);      // root
  note(990, 0.14, 0.32);   // a fifth up, held longer — unmistakably a chime
}

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
  planNote: string | null;   // Package O: the plan note (coach cue)
  loggedNote: string | null; // Package O: note logged last time this plan was completed
  prevWarmups: { weightKg: number | null; reps: number | null }[]; // Package O: warm-up memory
}
// Package R fix 1: recorded actuals for a COMPLETED session, aligned to
// `exercises` by index, so re-opening the logger hydrates from the DB.
export interface CompletedRow { kg: string; reps: string; dur: string; rpe: string; rpeHi: string; warmup: boolean; }
export interface CompletedActuals {
  durationMin: number | null;
  rpeOverall: number | null;
  energyPre: number | null;
  sessionNote: string;
  totalSets: number;        // existing recorded strength_sets count (fix 2 guard)
  exercises: CompletedRow[][];
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
  completed?: CompletedActuals | null; // present only when editing a completed session
}

interface SetRow { kg: string; reps: string; dur: string; rpe: string; rpeHi: string; done: boolean; prevKg: string; prevReps: string; warmup: boolean; suggested?: boolean; }
type Field = 'kg' | 'reps' | 'rpe' | 'dur';

function initSets(ex: LogExercise): SetRow[] {
  const n = Math.max(ex.targetSets ?? 1, 1);
  const kg = ex.targetWeightKg != null ? String(ex.targetWeightKg) : ex.prevKg != null ? String(ex.prevKg) : '';
  const reps = ex.targetReps != null ? String(ex.targetReps) : '';
  const dur = ex.setStyle === 'duration' && ex.durationSeconds != null ? String(ex.durationSeconds) : '';
  const prevKg = ex.prevKg != null ? String(ex.prevKg) : '';
  const prevReps = ex.prevReps != null ? String(ex.prevReps) : '';
  const working: SetRow[] = Array.from({ length: n }, () => ({ kg, reps, dur, rpe: '', rpeHi: '', done: false, prevKg, prevReps, warmup: false }));
  // Package O: warm-up memory — prepend the same NUMBER of warm-up sets this
  // movement had last time, pre-filled with those weights/reps and flagged as a
  // suggestion (never auto-applied to an exercise with no history).
  const suggestedWarmups: SetRow[] = (ex.prevWarmups ?? []).map((w) => ({
    kg: w.weightKg != null ? String(w.weightKg) : '',
    reps: w.reps != null ? String(w.reps) : '',
    dur: '', rpe: '', rpeHi: '', done: false, prevKg: '', prevReps: '', warmup: true, suggested: true,
  }));
  return [...suggestedWarmups, ...working];
}
const emptyRow = (warmup = false): SetRow => ({ kg: '', reps: '', dur: '', rpe: '', rpeHi: '', done: false, prevKg: '', prevReps: '', warmup });
// Package R fix 1: build the grid from a completed session's saved actuals,
// aligned by exercise index, with every saved set pre-TICKED so the editor
// opens on exactly what was recorded. Exercises with no saved rows fall back to
// their plan rows (unticked) so they can still be logged during the edit.
function completedToSets(plan: LogPlan): SetRow[][] {
  const c = plan.completed;
  if (!c) return plan.exercises.map(initSets);
  return plan.exercises.map((ex, ei) => {
    const prevKg = ex.prevKg != null ? String(ex.prevKg) : '';
    const prevReps = ex.prevReps != null ? String(ex.prevReps) : '';
    const rows = (c.exercises[ei] ?? []).map((r) => ({
      kg: r.kg, reps: r.reps, dur: r.dur, rpe: r.rpe, rpeHi: r.rpeHi,
      done: true, prevKg, prevReps, warmup: r.warmup, suggested: false,
    }));
    return rows.length ? rows : initSets(ex);
  });
}
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

const FIELD_LABEL: Record<Field, string> = { kg: 'Weight · kg', reps: 'Reps', rpe: 'RPE · 0-10', dur: 'Time · sec' };
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

  // Package S1: a session with a recorded completion opens in EDIT mode, not as
  // an active session. In edit mode the session clock never starts/resumes (any
  // duration shown is the STORED value, static), rest timers and tempo do not
  // auto-start, and no wake-lock/interval/notification is held — so leaving the
  // editor leaks nothing.
  const editMode = !!plan.completed;

  // Fix 1: a completed session opens on its saved actuals (pre-ticked); a
  // planned session opens on plan targets. A local draft (in-progress) still
  // overrides both, hydrated in the effect below.
  const [sets, setSets] = useState<SetRow[][]>(() => plan.completed ? completedToSets(plan) : plan.exercises.map(initSets));
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
  // Package O: per-exercise logged notes (pre-filled from last time's note, or
  // the plan note) and a session-level note. Editable mid-session via the note
  // sheet; persisted in the draft and sent on Finish.
  const [exNotes, setExNotes] = useState<string[]>(() => plan.exercises.map((e) => e.loggedNote ?? e.planNote ?? ''));
  const [sessionNote, setSessionNote] = useState(plan.completed?.sessionNote ?? '');
  const [noteTarget, setNoteTarget] = useState<number | 'session' | null>(null); // open note editor

  const restFor = (ei: number) => plan.exercises[ei]?.restSeconds ?? DEFAULT_REST_SECONDS;
  // Rest timer has two modes (item 4): 'down' = countdown to restEndAt; 'up' =
  // open-ended count-up stopwatch for unstructured work. `up` holds the count.
  const [rest, setRest] = useState(() => { const s = plan.exercises[0]?.restSeconds ?? DEFAULT_REST_SECONDS; return { running: false, remaining: s, total: s, mode: 'down' as 'down' | 'up', up: 0 }; });
  const [restEditing, setRestEditing] = useState(false); // typing an exact rest (item 3)
  // Editing a completed session starts the clock at its recorded duration so a
  // re-save preserves it (fix 1).
  const [elapsed, setElapsed] = useState(plan.completed?.durationMin != null ? plan.completed.durationMin * 60 : 0);
  const [finishing, setFinishing] = useState(false);
  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const restWasRunning = useRef(false);
  const restUpStart = useRef(0); // epoch ms anchor for the count-up mode
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
  const exNotesRef = useRef(exNotes); useEffect(() => { exNotesRef.current = exNotes; }, [exNotes]);
  const sessionNoteRef = useRef(sessionNote); useEffect(() => { sessionNoteRef.current = sessionNote; }, [sessionNote]);
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
    exNotes: exNotesRef.current,
    sessionNote: sessionNoteRef.current,
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
      // Package Q: reconcile the draft against the CURRENT plan (it may have
      // been edited mid-session — movements added/removed/reordered). Map over
      // the plan's exercises: keep the draft's rows where they exist, and give a
      // newly-added movement its fresh initial rows. Extra draft columns (a
      // removed movement) fall away because we iterate the plan, not the draft.
      const base = plan.exercises.map(initSets);
      setSets(base.map((rows, i) => {
        const dr = d.sets[i];
        return Array.isArray(dr) && dr.length ? dr.map((r) => ({ ...emptyRow(), ...r })) : rows;
      }));
      if (d.active) setActive({ ...d.active, ei: Math.min(d.active.ei, plan.exercises.length - 1) });
      // S1: in edit mode the clock is static (the stored duration), so a
      // resumed edit draft never adds time-away and never re-seeds elapsed.
      if (typeof d.elapsed === 'number' && !editMode) {
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
      if (Array.isArray(d.exNotes)) setExNotes((prev) => prev.map((n, i) => d.exNotes?.[i] ?? n));
      if (typeof d.sessionNote === 'string') setSessionNote(d.sessionNote);
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
    // S1: no wake lock in edit mode (there is no active session to keep awake).
    if (!paused && !finishing && !editMode) acquireWake(); else releaseWake();
    return () => { releaseWake(); };
  }, [paused, finishing, editMode, acquireWake, releaseWake]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible' || pausedRef.current || finishing) return;
      if (editMode) {
        // S1: on return from background, do NOT re-acquire the wake lock or
        // advance the session clock — the stored duration stays static. Only a
        // rest the user explicitly started is resynced below.
        setRest((r) => {
          if (!r.running) return r;
          if (r.mode === 'up') return { ...r, up: Math.max(0, Math.floor((Date.now() - restUpStart.current) / 1000)) };
          const rem = Math.max(0, Math.ceil((restEndAt.current - Date.now()) / 1000));
          if (rem <= 0) { if (restTimer.current) clearInterval(restTimer.current); cancelRestNotification(); return { ...r, remaining: 0, running: false }; }
          return { ...r, remaining: rem };
        });
        return;
      }
      acquireWake();
      // Item 6: on return, recompute both timers from the wall clock so they land
      // on the correct position instead of resuming from where the loop stalled.
      const c = elapsedClock.current;
      setElapsed(c.base + Math.floor((Date.now() - c.since) / 1000));
      setRest((r) => {
        if (!r.running) return r;
        if (r.mode === 'up') return { ...r, up: Math.max(0, Math.floor((Date.now() - restUpStart.current) / 1000)) };
        const rem = Math.max(0, Math.ceil((restEndAt.current - Date.now()) / 1000));
        if (rem <= 0) { if (restTimer.current) clearInterval(restTimer.current); cancelRestNotification(); return { ...r, remaining: 0, running: false }; }
        return { ...r, remaining: rem };
      });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [acquireWake, finishing, editMode]);

  // session elapsed clock — frozen while paused. Derived from wall-clock time so
  // background throttling can't make it drift (item 6): each tick recomputes
  // elapsed from a base + real elapsed since the anchor, not by incrementing.
  // S1: in edit mode the clock never runs — the stored duration is static.
  useEffect(() => {
    if (paused || editMode) return;
    elapsedClock.current = { base: elapsedRef.current, since: Date.now() };
    const recompute = () => {
      const c = elapsedClock.current;
      setElapsed(c.base + Math.floor((Date.now() - c.since) / 1000));
    };
    const t = setInterval(recompute, 1000);
    return () => clearInterval(t);
  }, [paused, editMode]);
  useEffect(() => () => {
    if (restTimer.current) clearInterval(restTimer.current);
    if (swTimer.current) clearInterval(swTimer.current);
    cancelRestNotification();
  }, []);
  useEffect(() => { if (panel === 'tempo' && !activeHasTempo) setPanel('entry'); }, [active.ei, activeHasTempo, panel]);

  // Item 5: one time format everywhere.
  const mmss = fmtClock;

  // --- ongoing rest notification (item 1) -----------------------------------
  // While a rest countdown runs we show ONE ongoing (persistent) notification
  // carrying the rest END TIME, so it stays useful even when the JS timer is
  // throttled in the background (a live countdown would freeze; an absolute end
  // time does not). It is auto-closed when rest completes/skips — we never fire
  // a separate "rest over" notification.
  function showRestNotification(endAtMs: number) {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;
    const ends = new Date(endAtMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    // `renotify`/`requireInteraction` are valid at runtime but missing from the
    // DOM lib's NotificationOptions, so widen the type here.
    const opts: NotificationOptions = {
      body: `Rest ends ${ends}`,
      tag: 'pft-rest',       // one notification, replaced not stacked
      silent: true,          // the audible cue is the in-app chime, not this
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      renotify: false,
      requireInteraction: true, // keep it up (best-effort) until we close it
    } as NotificationOptions & { renotify?: boolean; requireInteraction?: boolean };
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification('Resting between sets', opts).catch(() => {});
    }).catch(() => {});
  }
  function cancelRestNotification() {
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((reg) => reg.getNotifications({ tag: 'pft-rest' }).then((ns) => ns.forEach((n) => n.close())).catch(() => {}))
          .catch(() => {});
      }
    } catch { /* ignore */ }
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
        if (perm === 'granted' && rest.running && rest.mode === 'down' && rest.remaining > 0) showRestNotification(restEndAt.current);
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
        if (r.mode !== 'down') return r;
        if (rem === r.remaining) return r;
        // Item 6: audible 3-2-1 countdown — one blip per second for the last 3.
        if (rem > 0 && rem <= 3 && rem < r.remaining) { playTone(REST_COUNT_FREQ, 0.07, 0.18); vibrate(25); }
        if (rem <= 0) {
          if (restTimer.current) clearInterval(restTimer.current);
          if (r.remaining > 0) { playRestEndChime(); vibrate([90, 50, 90]); } // distinct end chime
          cancelRestNotification();
          return { ...r, remaining: 0, running: false };
        }
        return { ...r, remaining: rem };
      });
    }, 200);
  }
  // Count-up mode (item 4): a plain stopwatch, wall-clock anchored so it survives
  // background throttling. Open-ended; the user reads and adjusts afterwards.
  function runRestUpInterval() {
    if (restTimer.current) clearInterval(restTimer.current);
    restTimer.current = setInterval(() => {
      const up = Math.max(0, Math.floor((Date.now() - restUpStart.current) / 1000));
      setRest((r) => (r.mode === 'up' && r.running && up !== r.up ? { ...r, up } : r));
    }, 200);
  }
  function startRest(sec: number) {
    setPanel('rest');
    restEndAt.current = Date.now() + sec * 1000;
    setRest((r) => ({ ...r, running: true, remaining: sec, total: sec, mode: 'down' }));
    runRestInterval();
    maybeAskNotify();
    showRestNotification(restEndAt.current);
  }
  function restAdjust(d: number) {
    setRest((r) => {
      if (r.mode !== 'down') return r;
      const remaining = Math.max(0, r.remaining + d);
      const next = { ...r, remaining, total: Math.max(r.total, remaining) };
      if (next.running) { restEndAt.current = Date.now() + remaining * 1000; showRestNotification(restEndAt.current); }
      return next;
    });
  }
  // Item 3: set an exact rest duration by typing (seconds). Restarts the
  // countdown from the typed value when a rest is running.
  function setRestSeconds(sec: number) {
    const s = Math.max(0, Math.round(sec));
    setRest((r) => {
      const next = { ...r, mode: 'down' as const, remaining: s, total: Math.max(s, 1) };
      if (r.running && r.mode === 'down') {
        restEndAt.current = Date.now() + s * 1000;
        showRestNotification(restEndAt.current);
      }
      return next;
    });
  }
  function restToggle() {
    unlockAudio();
    if (rest.mode === 'up') {
      if (rest.running) { if (restTimer.current) clearInterval(restTimer.current); setRest((r) => ({ ...r, running: false })); }
      else { restUpStart.current = Date.now() - rest.up * 1000; setRest((r) => ({ ...r, running: true })); runRestUpInterval(); }
      return;
    }
    if (rest.running) { if (restTimer.current) clearInterval(restTimer.current); cancelRestNotification(); setRest((r) => ({ ...r, running: false })); }
    else { const sec = rest.remaining > 0 ? rest.remaining : restFor(active.ei); restEndAt.current = Date.now() + sec * 1000; setRest((r) => ({ ...r, running: true, remaining: sec, total: Math.max(r.total, sec) })); runRestInterval(); maybeAskNotify(); showRestNotification(restEndAt.current); }
  }
  // Switch between countdown and count-up. Stops the clock on switch; the user
  // presses start for the new mode.
  function setRestMode(mode: 'down' | 'up') {
    if (restTimer.current) clearInterval(restTimer.current);
    cancelRestNotification();
    setRestEditing(false);
    if (mode === 'up') {
      restUpStart.current = Date.now();
      setRest((r) => ({ ...r, mode: 'up', running: false, up: 0 }));
    } else {
      const sec = restFor(active.ei);
      setRest((r) => ({ ...r, mode: 'down', running: false, remaining: sec, total: sec }));
    }
  }
  function restSkip() { if (restTimer.current) clearInterval(restTimer.current); cancelRestNotification(); setRestEditing(false); setRest((r) => ({ ...r, running: false })); setPanel('entry'); }

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
    if (restWasRunning.current) {
      if (rest.mode === 'up') { restUpStart.current = Date.now() - rest.up * 1000; setRest((r) => ({ ...r, running: true })); runRestUpInterval(); }
      else { restEndAt.current = Date.now() + rest.remaining * 1000; setRest((r) => ({ ...r, running: true })); runRestInterval(); showRestNotification(restEndAt.current); }
    }
    if (swWasRunning.current) { setSw((s) => ({ ...s, running: true })); runSwInterval(); }
    saveSessionDraft(buildDraft(undefined, false));
  }

  // --- duration count-up ----------------------------------------------------
  function runSwInterval() {
    if (swTimer.current) clearInterval(swTimer.current);
    swTimer.current = setInterval(() => { swElapsed.current += 1; setSw({ running: true, elapsed: swElapsed.current }); }, 1000);
  }
  function writeField(ei: number, si: number, field: Field, value: string) {
    // Editing a suggested warm-up commits it (no longer a mere suggestion).
    updateSets((all) => all.map((rows, e) => e !== ei ? rows : rows.map((row, s) => s === si ? { ...row, [field]: value, suggested: false } : row)));
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
      const patch: Partial<SetRow> = { [active.field]: cur, suggested: false };
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
    // Ticking a suggested warm-up commits it.
    updateSets((all) => all.map((rows, e) => e !== ei ? rows : rows.map((r, s) => s === si ? { ...r, done: nowDone, suggested: false } : r)));
    // Ticking a set auto-starts THIS exercise's rest timer — but NEVER resets
    // one that is already counting (fix 2), warm-up rows don't start rest at all
    // (fix 7), and in EDIT mode ticking never triggers a rest timer (S1.3 — the
    // user may still tap a rest timer explicitly).
    if (nowDone && !row?.warmup && !rest.running && !editMode) startRest(restFor(ei));
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
    // rest for warm-up rows (fix 7), no auto-rest in edit mode (S1.3).
    if (!row?.warmup && !rest.running && !editMode) startRest(restFor(active.ei));
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
  // Package O: note editing (per-exercise + session), persisted to the draft.
  const setExNote = useCallback((ei: number, text: string) => {
    setExNotes((prev) => { const next = prev.map((n, i) => i === ei ? text : n); exNotesRef.current = next; saveSessionDraft(buildDraft()); return next; });
  }, [buildDraft]);
  const setSessionNoteSaved = useCallback((text: string) => {
    setSessionNote(text); sessionNoteRef.current = text; saveSessionDraft(buildDraft());
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
  // Package P: the tempo block's superset siblings — the movements in the active
  // exercise's superset that carry a tempo, so it can offer tabs to alternate.
  const tempoMembers = useMemo(() => {
    const g = groups.find((grp) => grp.items.some((it) => it.index === active.ei));
    if (!g || g.items.length < 2) return [] as { ei: number; name: string; tempo: string }[];
    return g.items.filter((it) => it.ex.tempo).map((it) => ({ ei: it.index, name: it.ex.name, tempo: it.ex.tempo as string }));
  }, [groups, active.ei]);
  const doneCount = sets.reduce((a, rows) => a + rows.filter((r) => r.done).length, 0);
  const totalCount = sets.reduce((a, rows) => a + rows.length, 0);
  const activeRows = sets[active.ei] ?? [];
  const activeRow = activeRows[active.si];
  const activeIsWarmup = !!activeRow?.warmup;
  // Distinct from the ledger's "Set" column header: this names the set you are
  // logging right now, within the current movement.
  const activeSetLabel = activeIsWarmup
    ? 'Warm-up set'
    : `Current set · ${workingNo(activeRows, active.si)} of ${workingCount(activeRows)}`;

  const restPct = rest.total ? Math.max(0, (rest.remaining / rest.total) * 100) : 0;
  // Item 2: the rest timer is "live" (worth an always-visible strip) whenever a
  // countdown is running OR the count-up stopwatch is running.
  const restLive = rest.running && (rest.mode === 'down' ? rest.remaining > 0 : true);
  const restStripText = rest.mode === 'up' ? mmss(rest.up) : mmss(rest.remaining);

  return (
    <div className="app-flat" style={{ display: 'contents' }}>
      {/* Item 2: always-visible rest strip. Fixed to the top so the remaining
          rest time stays on screen while the keypad is open, while tapping other
          sets, and while the page is scrolled. Tapping it opens the rest panel. */}
      {restLive && (
        <button
          onClick={() => { setPanel('rest'); }}
          aria-label={`Rest ${restStripText}. Open rest timer.`}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 46, maxWidth: 460, margin: '0 auto', height: 'calc(38px + env(safe-area-inset-top))', paddingTop: 'env(safe-area-inset-top)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', border: 'none', cursor: 'pointer', background: rest.mode === 'down' && rest.remaining <= 3 ? 'var(--accent)' : 'var(--accent-soft)', color: rest.mode === 'down' && rest.remaining <= 3 ? 'var(--on-accent)' : 'var(--accent)', borderBottom: '1px solid var(--accent-line)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
        >
          <span className="msr-fill" style={{ fontSize: 17 }} aria-hidden="true">{rest.mode === 'up' ? 'timer' : 'hourglass_bottom'}</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{rest.mode === 'up' ? 'Timing' : 'Rest'}</span>
          <span style={{ fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>{restStripText}</span>
          <span className="msr" style={{ fontSize: 18, opacity: 0.7 }} aria-hidden="true">expand_more</span>
        </button>
      )}

      {/* Header (offset down while the fixed rest strip is showing so its
          buttons are never covered at scroll-top). */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7, padding: '10px 2px', marginBottom: 4, marginTop: restLive ? 40 : 0 }}>
        <button className="icon-btn" onClick={() => setExitOpen(true)} aria-label="Back out of session"><span className="msr" aria-hidden="true">chevron_left</span></button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{plan.title}</div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-faint)', marginTop: 2 }}>
            {editMode ? (
              // S1: edit mode shows EDITING and, if a duration was recorded, the
              // STORED value as a static (non-accent, non-ticking) figure.
              <>{plan.type} · <span style={{ fontWeight: 600 }}>Editing</span>{plan.completed?.durationMin != null && <span style={{ color: 'var(--text-dim)' }}> · {mmss(plan.completed.durationMin * 60)}</span>}</>
            ) : (
              <>{plan.type} · <span style={{ color: paused ? 'var(--text-faint)' : 'var(--accent)', fontWeight: 600 }}>{mmss(elapsed)}</span>{paused && <span style={{ fontWeight: 600 }}> · Paused</span>}</>
            )}
          </div>
        </div>
        {/* S1: no pause/resume control in edit mode (no running clock to pause). */}
        {!editMode && (
          <button
            className="icon-btn"
            onClick={() => (paused ? resumeSession() : pauseSession())}
            aria-label={paused ? 'Resume session' : 'Pause session'}
            aria-pressed={paused}
            style={paused ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent-line)' } : undefined}
          ><span className="msr" aria-hidden="true">{paused ? 'play_arrow' : 'pause'}</span></button>
        )}
        <button className="btn-sm" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)', height: 32 }} onClick={() => setFinishing(true)}>{editMode ? 'Save' : 'Finish'}</button>
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
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />Superset {supersetLabel(groups, gi)}
              </div>
            )}
            {g.items.map(({ ex, index }, pos) => {
              const activeHere = active.ei === index;
              const done = sets[index].filter((s) => s.done).length;
              const style = ex.setStyle === 'duration' ? 'duration' : 'reps';
              const midLabel = style === 'duration' ? 'Sec' : 'Reps';
              const editing = editEx === index;
              // Item 3: hide the KG column for movements with no weight
              // (bodyweight / most timed holds) so there is no empty column.
              // Still shown when a weight is planned, already logged, has
              // history, or the user opened Edit mode to add one.
              const showKg = showKgFor(index);
              const cols = showKg
                ? '30px 56px 1fr 1fr 1fr 44px'
                : '30px 56px 1fr 1fr 44px';
              const headers = showKg ? ['Set', 'Prev', 'Kg', midLabel, 'RPE'] : ['Set', 'Prev', midLabel, 'RPE'];
              return (
                <div key={index} className="card" style={{ padding: 15, marginBottom: g.items.length > 1 ? 10 : 0, borderLeft: `3px solid ${activeHere ? 'var(--accent)' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, minWidth: 0 }}>
                      <div aria-hidden="true" style={{ flex: 'none', minWidth: 30, height: 30, padding: '0 8px', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums', background: activeHere ? 'var(--accent)' : 'var(--surface-3)', color: activeHere ? 'var(--on-accent)' : 'var(--text-2)' }}>{exerciseLabel(groups, gi, pos)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{ex.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                          {style === 'duration'
                            ? `${ex.targetSets ?? '·'} × ${ex.durationSeconds != null ? mmss(ex.durationSeconds) : 'timed'} target`
                            : `${ex.targetSets ?? '·'} × ${ex.targetReps ?? '·'} target`}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: done === sets[index].length && sets[index].length > 0 ? 'var(--text-1)' : 'var(--text-dim)' }}>{done}/{sets[index].length}</div>
                      {/* Package O: one-tap per-exercise note. Filled state gets the accent. */}
                      <button onClick={() => setNoteTarget(index)} aria-label={exNotes[index]?.trim() ? `Edit note for ${ex.name}` : `Add note for ${ex.name}`} style={{ width: 28, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: '1px solid var(--border)', background: exNotes[index]?.trim() ? 'var(--accent-soft)' : 'var(--surface)', color: exNotes[index]?.trim() ? 'var(--accent)' : 'var(--text-dim)' }}>
                        <span className="msr-fill" style={{ fontSize: 15 }} aria-hidden="true">{exNotes[index]?.trim() ? 'sticky_note_2' : 'note_add'}</span>
                      </button>
                      <button onClick={() => setEditEx(editing ? null : index)} aria-label={editing ? 'Done editing sets' : 'Edit sets'} style={{ height: 26, padding: '0 9px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: editing ? 'var(--accent-soft)' : 'var(--surface)', color: editing ? 'var(--accent)' : 'var(--text-dim)' }}>
                        {editing ? 'Done' : 'Edit'}
                      </button>
                    </div>
                  </div>

                  {/* Package O + R: inline note preview, truncated with an
                      in-place "See full note" (fix 3); the pencil opens the editor. */}
                  {exNotes[index]?.trim() && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 9 }}>
                      <span className="msr" style={{ fontSize: 14, color: 'var(--accent)', marginTop: 1 }} aria-hidden="true">sticky_note_2</span>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.35, color: 'var(--text-dim)', fontStyle: 'italic' }}>
                        <NoteText text={exNotes[index]} max={110} />
                      </div>
                      <button onClick={() => setNoteTarget(index)} aria-label={`Edit note for ${ex.name}`} style={{ flex: 'none', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 0 }}>
                        <span className="msr" style={{ fontSize: 15 }} aria-hidden="true">edit</span>
                      </button>
                    </div>
                  )}

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

                  {/* Package O: warm-up memory banner — a suggestion, not a
                      commitment. Dismiss removes the still-suggested rows. */}
                  {sets[index].some((s) => s.suggested && !s.done) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '4px 0 2px', padding: '6px 9px', borderRadius: 9, background: 'var(--last-bg)', border: '1px dashed var(--border)' }}>
                      <span className="msr" style={{ fontSize: 14, color: 'var(--text-faint)' }} aria-hidden="true">history</span>
                      <span style={{ flex: 1, fontSize: 10.5, color: 'var(--text-faint)' }}>Warm-up suggested from last time · edit, tick or dismiss</span>
                      <button onClick={() => updateSets((all) => all.map((rows, e) => e === index ? rows.filter((r) => !(r.suggested && !r.done)) : rows))} aria-label="Dismiss suggested warm-up" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-dim)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>Dismiss</button>
                    </div>
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
                      // Package O: a still-suggested warm-up (from last time) reads
                      // as a suggestion — dashed outline, dimmed — until it's
                      // ticked or edited, when it becomes a committed row.
                      style={{ display: 'grid', gridTemplateColumns: cols, gap: 7, alignItems: 'center', marginTop: 8, padding: '4px 4px', marginLeft: -4, marginRight: -4, borderRadius: 12, background: rowActive ? 'var(--accent-tint)' : st.warmup ? 'var(--last-bg)' : 'transparent', boxShadow: rowActive ? 'inset 0 0 0 1px var(--accent-line)' : st.suggested ? 'inset 0 0 0 1px var(--border)' : 'none', opacity: st.suggested && !st.done ? 0.72 : 1, transition: 'background 0.12s, opacity 0.12s', touchAction: 'pan-y' }}>
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
                        <Cell active={rowActive && active.field === 'dur'} filled={st.dur !== ''} onClick={() => tap(index, si, 'dur')} value={st.dur !== '' ? mmss(Number(st.dur) || 0) : ''} />
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
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>{activeSetLabel}</div>
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

        {/* Package O: session-level note, reachable mid-session (item 2). */}
        <button
          onClick={() => setNoteTarget('session')}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', marginTop: 12, padding: '12px 14px', borderRadius: 14, background: 'var(--last-bg)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text)' }}
        >
          <span className="msr-fill" style={{ fontSize: 18, color: 'var(--accent)' }} aria-hidden="true">edit_note</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Session note</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sessionNote.trim() || 'Add a note for the whole session'}</div>
          </div>
          <span className="msr" style={{ fontSize: 18, color: 'var(--text-faint)' }} aria-hidden="true">chevron_right</span>
        </button>
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
                      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-faint)' }}>Count-up timer</div>
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
                {/* Item 4: countdown vs open-ended count-up. */}
                <div className="seg" style={{ marginBottom: 12 }}>
                  <button className={`seg-item ${rest.mode === 'down' ? 'active' : ''}`} onClick={() => setRestMode('down')}><span className="msr">hourglass_bottom</span>Countdown</button>
                  <button className={`seg-item ${rest.mode === 'up' ? 'active' : ''}`} onClick={() => setRestMode('up')}><span className="msr">timer</span>Count-up</button>
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-faint)' }}>{rest.mode === 'up' ? 'Count-up' : 'Rest'}</div>
                  {rest.mode === 'down' && restEditing ? (
                    <RestTimeInput
                      initialSeconds={rest.remaining}
                      onCommit={(sec) => { setRestSeconds(sec); setRestEditing(false); }}
                      onCancel={() => setRestEditing(false)}
                    />
                  ) : (
                    // Item 3: tap the time to type an exact rest duration.
                    <button
                      onClick={() => { if (rest.mode === 'down') setRestEditing(true); }}
                      aria-label={rest.mode === 'down' ? 'Edit rest time' : undefined}
                      style={{ background: 'transparent', border: 'none', padding: 0, cursor: rest.mode === 'down' ? 'text' : 'default', fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: rest.mode === 'down' && rest.remaining <= 3 && rest.running ? 'var(--accent)' : 'var(--text)' }}
                    >{rest.mode === 'up' ? mmss(rest.up) : mmss(rest.remaining)}</button>
                  )}
                </div>

                {rest.mode === 'down' && (
                  <div style={{ height: 6, borderRadius: 4, background: 'var(--seg-track)', margin: '14px 0 16px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${restPct}%`, background: 'var(--accent)', borderRadius: 4, transition: 'width 0.9s linear' }} />
                  </div>
                )}

                {rest.mode === 'down' ? (
                  <>
                    <div style={{ display: 'flex', gap: 8, marginTop: rest.mode === 'down' ? 0 : 14 }}>
                      <button onClick={() => restAdjust(-15)} style={restSmBtn}>-15s</button>
                      <button onClick={restSkip} style={{ ...restSmBtn, flex: 1.6, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)' }}>Skip rest</button>
                      <button onClick={() => restAdjust(15)} style={restSmBtn}>+15s</button>
                    </div>
                    {/* Quick presets — thumb-friendly typing shortcut (item 3). */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      {[60, 90, 120, 180].map((s) => (
                        <button key={s} onClick={() => setRestSeconds(s)} style={{ ...restSmBtn, height: 38, fontSize: 12.5, background: rest.remaining === s ? 'var(--accent-soft)' : 'var(--surface)', color: rest.remaining === s ? 'var(--accent)' : 'var(--text)', border: rest.remaining === s ? '1px solid var(--accent-line)' : '1px solid var(--border)' }}>{mmss(s)}</button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button onClick={() => { restUpStart.current = Date.now(); setRest((r) => ({ ...r, up: 0, running: r.running })); }} style={restSmBtn}>Reset</button>
                    <button onClick={restSkip} style={{ ...restSmBtn, flex: 1.6, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)' }}>Done</button>
                  </div>
                )}

                <button className="btn" style={{ height: 50, marginTop: 10, borderRadius: 14 }} onClick={restToggle}>
                  <span className="msr-fill" style={{ fontSize: 20 }}>{rest.running ? 'pause' : 'play_arrow'}</span>{rest.running ? 'Pause' : rest.mode === 'up' ? 'Start count-up' : 'Start rest'}
                </button>
              </div>
            ) : (
              activeEx?.tempo ? (
                <TempoBlock
                  tempo={activeEx.tempo}
                  exerciseName={activeEx.name}
                  members={tempoMembers}
                  activeEi={active.ei}
                  onPick={(ei) => setActive((a) => ({ ...a, ei, si: Math.min(a.si, (sets[ei]?.length ?? 1) - 1) }))}
                  frozen={paused}
                />
              ) : null
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

      {/* Package O: note editor (per-exercise or session). */}
      {noteTarget !== null && (
        <NoteSheet
          title={noteTarget === 'session' ? 'Session note' : plan.exercises[noteTarget]?.name ?? 'Note'}
          subtitle={noteTarget === 'session' ? 'Anything not specific to one movement' : 'e.g. felt heavy, form broke on set 3, cycled in'}
          value={noteTarget === 'session' ? sessionNote : (exNotes[noteTarget] ?? '')}
          onSave={(text) => { if (noteTarget === 'session') setSessionNoteSaved(text); else setExNote(noteTarget, text); setNoteTarget(null); }}
          onClose={() => setNoteTarget(null)}
        />
      )}

      {finishing && (
        <FinishSheet
          plan={plan}
          sets={sets}
          warmup={warmup}
          cooldown={cooldown}
          exNotes={exNotes}
          sessionNote={sessionNote}
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
    </div>
  );
}

const restSmBtn: React.CSSProperties = { flex: 1, height: 44, border: '1px solid var(--border)', borderRadius: 13, background: 'var(--surface)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' };
const pillStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', background: 'var(--surface)', border: '1px solid var(--border)' };

// Package O: lightweight note editor sheet (per-exercise or session).
function NoteSheet({ title, subtitle, value, onSave, onClose }: {
  title: string; subtitle: string; value: string; onSave: (text: string) => void; onClose: () => void;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 78, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--panel-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTop: '1px solid var(--border)', padding: '18px 18px calc(20px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
          <div style={{ minWidth: 0 }}>
            <div className="h2" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            <div className="sub">{subtitle}</div>
          </div>
          <button className="icon-btn dim" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, flex: 'none' }}><span className="msr" aria-hidden="true">close</span></button>
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a note…"
          style={{ width: '100%', minHeight: 110, marginTop: 10, padding: '12px 13px', borderRadius: 13, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 15, lineHeight: 1.4, resize: 'vertical' }}
        />
        <button className="btn" style={{ height: 50, marginTop: 12, borderRadius: 14 }} onClick={() => onSave(text)}>
          Save note<span className="msr-fill" style={{ fontSize: 20 }} aria-hidden="true">check</span>
        </button>
      </div>
    </div>
  );
}

// Item 3: type an exact rest duration. Accepts "M:SS" or plain seconds; the
// native numeric keyboard shows because inputMode is numeric.
function parseClockInput(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    const mm = Number(m || 0), ss = Number(sec || 0);
    if (!Number.isFinite(mm) || !Number.isFinite(ss)) return null;
    return Math.max(0, Math.round(mm * 60 + ss));
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}
function RestTimeInput({ initialSeconds, onCommit, onCancel }: { initialSeconds: number; onCommit: (sec: number) => void; onCancel: () => void }) {
  const [val, setVal] = useState(fmtClock(initialSeconds));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const el = ref.current; if (el) { el.focus(); try { el.select(); } catch { /* ignore */ } } }, []);
  const commit = () => { const sec = parseClockInput(val); if (sec == null) onCancel(); else onCommit(sec); };
  return (
    <input
      ref={ref}
      inputMode="numeric"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel(); }}
      aria-label="Rest time (minutes:seconds or seconds)"
      style={{ width: 150, textAlign: 'right', background: 'transparent', border: 'none', borderBottom: '2px solid var(--accent)', color: 'var(--text)', fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', padding: 0 }}
    />
  );
}

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

// --- Region-based tempo engine (Package P) -----------------------------------
// Parsing lives in lib/tempo.ts (pure + unit-tested); this component is the
// audible/visual engine over it. Each region drives its OWN cue.
const SETUP_PRESETS = [5, 10, 15];
interface TempoDisp { ri: number; remaining: number; rep: number }

function TempoBlock({ tempo, exerciseName, members, activeEi, onPick, frozen }: {
  tempo: string;
  exerciseName: string;
  members: { ei: number; name: string; tempo: string }[]; // superset siblings with a tempo
  activeEi: number;
  onPick: (ei: number) => void;
  frozen?: boolean;
}) {
  const regions = useMemo(() => parseTempoRegions(tempo), [tempo]);
  const bounds = useMemo(() => { let acc = 0; return regions.map((r) => (acc += r.sec)); }, [regions]);
  const cycle = bounds.length ? bounds[bounds.length - 1] : 0;

  const [mode, setMode] = useState<'idle' | 'setup' | 'running'>('idle');
  const [setupDelay, setSetupDelay] = useState(10); // configurable 5-15s (item 2)
  const [setupLeft, setSetupLeft] = useState(0);
  const [disp, setDisp] = useState<TempoDisp>({ ri: 0, remaining: regions[0]?.sec ?? 0, rep: 0 });

  const rafRef = useRef<number | null>(null);
  const setupTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const setupEndRef = useRef(0);
  const startedAtRef = useRef(0);
  const accumRef = useRef(0);
  const lastSecondRef = useRef(-1);
  const lastRegionRef = useRef(-1);

  const stopRaf = () => { if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
  const stopSetup = () => { if (setupTimer.current) { clearInterval(setupTimer.current); setupTimer.current = null; } };

  const frame = useCallback(() => {
    if (!cycle) return;
    const elapsed = (accumRef.current + (performance.now() - startedAtRef.current)) / 1000;
    const rep = Math.floor(elapsed / cycle);
    const within = elapsed - rep * cycle;
    let ri = 0;
    while (ri < bounds.length - 1 && within >= bounds[ri]) ri++;
    const remaining = Math.max(0, bounds[ri] - within);

    // Region entry → that region's distinct cue (or the explosive accent).
    const globalRegion = rep * regions.length + ri;
    if (globalRegion !== lastRegionRef.current) {
      lastRegionRef.current = globalRegion;
      lastSecondRef.current = Math.floor(elapsed + 1e-6); // don't also sub-tick this instant
      const r = regions[ri];
      if (r?.explosive) playExplode(); else if (r) playRegionCue(r.key);
    } else {
      // Interior whole-second → soft sub-tick (so a 3s region is felt, not silent).
      const secondIndex = Math.floor(elapsed + 1e-6);
      if (secondIndex !== lastSecondRef.current) { lastSecondRef.current = secondIndex; playTempoSubTick(); }
    }

    const remCeil = Math.max(0, Math.ceil(remaining - 1e-6));
    setDisp((prev) => (prev.ri === ri && prev.rep === rep && prev.remaining === remCeil) ? prev : { ri, remaining: remCeil, rep });
    rafRef.current = requestAnimationFrame(frame);
  }, [bounds, cycle, regions]);

  const beginRunning = useCallback(() => {
    accumRef.current = 0;
    lastSecondRef.current = -1;
    lastRegionRef.current = -1;
    startedAtRef.current = performance.now();
    setMode('running');
    stopRaf();
    rafRef.current = requestAnimationFrame(frame);
  }, [frame]);

  // Setup delay countdown (item 2): visible number + soft ticks, then a clear
  // "starting now" cue, then the tempo begins.
  const runSetupInterval = useCallback(() => {
    stopSetup();
    setupTimer.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((setupEndRef.current - performance.now()) / 1000));
      setSetupLeft((prev) => {
        if (left !== prev && left > 0) { playTone(REST_COUNT_FREQ, 0.06, 0.16); vibrate(20); }
        return left;
      });
      if (left <= 0) { stopSetup(); playStartingNow(); vibrate([60, 40, 60]); beginRunning(); }
    }, 100);
  }, [beginRunning]);

  const start = useCallback(() => {
    if (!regions.length) return;
    unlockAudio();
    if (setupDelay > 0) {
      setMode('setup');
      setSetupLeft(setupDelay);
      setupEndRef.current = performance.now() + setupDelay * 1000;
      runSetupInterval();
    } else {
      beginRunning();
    }
  }, [regions.length, setupDelay, runSetupInterval, beginRunning]);

  const pause = useCallback(() => {
    if (mode === 'setup') { stopSetup(); setMode('idle'); return; }
    accumRef.current += performance.now() - startedAtRef.current;
    stopRaf();
    setMode('idle');
  }, [mode]);

  const reset = useCallback(() => {
    stopRaf(); stopSetup();
    setMode('idle');
    accumRef.current = 0;
    lastSecondRef.current = -1;
    lastRegionRef.current = -1;
    setDisp({ ri: 0, remaining: regions[0]?.sec ?? 0, rep: 0 });
  }, [regions]);

  // Auto-load: reset the engine whenever the loaded tempo changes (item 3 —
  // switching exercises in a superset auto-loads the new prescription).
  useEffect(() => { reset(); }, [tempo, reset]);
  useEffect(() => () => { stopRaf(); stopSetup(); }, []);
  useEffect(() => { if (frozen && mode !== 'idle') pause(); }, [frozen, mode, pause]);

  const running = mode === 'running';

  return (
    <div style={{ padding: '2px 2px 4px' }}>
      {/* Superset awareness (item 3): tabs to flip between alternating movements,
          each auto-loading its own tempo. */}
      {members.length > 1 && (
        <div className="seg" style={{ marginBottom: 10 }}>
          {members.map((m) => (
            <button key={m.ei} className={`seg-item ${m.ei === activeEi ? 'active' : ''}`} onClick={() => onPick(m.ei)}>
              {m.name.length > 12 ? m.name.slice(0, 11) + '…' : m.name} · {m.tempo}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-faint)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exerciseName.toUpperCase()} · TEMPO {tempo}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', flex: 'none' }}>Rep {disp.rep + 1}</div>
      </div>

      {regions.length === 0 ? (
        <div style={{ padding: 12, fontSize: 13, color: 'var(--text-dim)', textAlign: 'center' }}>Tempo &ldquo;{tempo}&rdquo; has no timed regions.</div>
      ) : (
        <>
          <div style={{ textAlign: 'center', margin: '10px 0 12px' }}>
            {mode === 'setup' ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-text)' }}>Get set up</div>
                <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{setupLeft}</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Tempo starts at 0</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.01em' }}>{running ? regions[disp.ri]?.label : 'Ready'}</div>
                <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{running ? disp.remaining : regions[0].sec}</div>
              </>
            )}
          </div>

          {/* Region bar — proportional segments, current region highlighted. */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {regions.map((r, i) => (
              <div key={i} style={{ flex: r.sec, minWidth: 0, textAlign: 'center', padding: '7px 4px', borderRadius: 10, background: running && i === disp.ri ? 'var(--accent)' : 'var(--seg-track)', color: running && i === disp.ri ? 'var(--on-accent)' : 'var(--text-dim)', transition: 'background 0.15s' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{r.explosive ? 'X' : r.sec}</div>
              </div>
            ))}
          </div>

          {/* Setup delay picker (item 2), shown while idle. */}
          {mode === 'idle' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-faint)', flex: 'none' }}>Setup delay</span>
              <div className="seg" style={{ flex: 1 }}>
                {SETUP_PRESETS.map((s) => (
                  <button key={s} className={`seg-item ${setupDelay === s ? 'active' : ''}`} onClick={() => setSetupDelay(s)}>{s}s</button>
                ))}
                <button className={`seg-item ${setupDelay === 0 ? 'active' : ''}`} onClick={() => setSetupDelay(0)}>Off</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={reset} style={restSmBtn}>Reset</button>
            <button className="btn" style={{ flex: 2, height: 50, borderRadius: 14, margin: 0 }} onClick={mode === 'idle' ? start : pause}>
              <span className="msr-fill" style={{ fontSize: 20 }}>{mode === 'idle' ? 'play_arrow' : 'pause'}</span>
              {mode === 'idle' ? (setupDelay > 0 ? 'Start (with setup)' : 'Start tempo') : mode === 'setup' ? 'Cancel setup' : 'Pause'}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textAlign: 'center', marginTop: 9 }}>Each region has its own cue · lower, pause, lift, hold</div>
        </>
      )}
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

function FinishSheet({ plan, sets, warmup, cooldown, exNotes, sessionNote, doneCount, totalCount, elapsed, onMarkAllDone, onClose, onSaved }: {
  plan: LogPlan;
  sets: SetRow[][];
  warmup: FlowItem[];
  cooldown: FlowItem[];
  exNotes: string[];      // Package O: per-exercise logged notes (by index)
  sessionNote: string;    // Package O: session-level note
  doneCount: number;
  totalCount: number;
  elapsed: number; // session seconds — saved as the session's duration
  onMarkAllDone: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Editing a completed session pre-fills its recorded RPE / energy (fix 1).
  const [rpeOverall, setRpe] = useState(plan.completed?.rpeOverall != null ? String(plan.completed.rpeOverall) : '');
  const [energyPre, setEnergy] = useState(plan.completed?.energyPre != null ? String(plan.completed.energyPre) : '');
  // Session note flows through here (also editable mid-session); seed from it.
  const [notes, setNotes] = useState(sessionNote);
  const [cooldownDone, setCooldown] = useState(false);
  const [distanceKm, setDistance] = useState('');
  const [avgHr, setAvgHr] = useState('');
  const [hrSource, setHrSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // Fix 2: pending destructive re-save awaiting explicit confirmation.
  const [confirmRemoval, setConfirmRemoval] = useState<{ existing: number; next: number } | null>(null);

  const showCooldownPrompt = plan.needsCooldown && cooldown.length === 0 && !plan.cooldownText;

  async function save(confirmed = false) {
    // Data truth: ONLY ticked sets are saved. Rows pre-fill from targets, so a
    // value alone proves nothing — unticked rows are dropped (no ghost rows).
    const strengthSets = tickedStrengthSets(plan.exercises, sets);

    // Fix 2: never silently destroy recorded history. If this is a re-save of a
    // completed session and it would remove any existing recorded set (fewer
    // sets than are on record, incl. dropping to zero), require an explicit
    // confirmation that states plainly what will be removed.
    const existing = plan.completed?.totalSets ?? 0;
    if (!confirmed && existing > 0 && strengthSets.length < existing) {
      setConfirmRemoval({ existing, next: strengthSets.length });
      return;
    }
    setConfirmRemoval(null);
    setSaving(true); setError(null);
    const run = plan.hasRun ? {
      distanceKm: distanceKm ? Number(distanceKm) : null,
      avgHr: avgHr ? Number(avgHr) : null,
      hrSource: hrSource || null,
    } : null;
    let res;
    try {
      // Package O: per-exercise notes keyed by planned-exercise order (= index).
      const exerciseNotes: Record<number, string | null> = {};
      exNotes.forEach((n, i) => { exerciseNotes[i] = n?.trim() ? n.trim() : null; });
      res = await completePlanAction(plan.id, {
        // Session clock → stored duration (whole minutes, ≥1 once started).
        durationMin: elapsed > 0 ? Math.max(1, Math.round(elapsed / 60)) : null,
        rpeOverall: rpeOverall ? Number(rpeOverall) : null,
        energyPre: energyPre ? Number(energyPre) : null,
        ...(showCooldownPrompt ? { cooldownDone } : {}),
        warmup, cooldown, exerciseNotes,
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

        {/* Fix 2: destructive re-save confirmation. Stated plainly, blocks the
            save until the user explicitly confirms removing recorded history. */}
        {confirmRemoval ? (
          <div className="note note-err" style={{ display: 'block', marginBottom: 0 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span className="msr-fill" aria-hidden="true">warning</span>
              <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                {confirmRemoval.next === 0
                  ? `This will delete all ${confirmRemoval.existing} recorded set${confirmRemoval.existing === 1 ? '' : 's'} for this session. Nothing is ticked, so nothing will be saved in their place.`
                  : `This will replace the ${confirmRemoval.existing} recorded set${confirmRemoval.existing === 1 ? '' : 's'} with ${confirmRemoval.next}, removing ${confirmRemoval.existing - confirmRemoval.next}. Recorded history can't be recovered.`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn-sm" onClick={() => setConfirmRemoval(null)} style={{ flex: 1, height: 46, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>Cancel</button>
              <button className="btn-sm" onClick={() => save(true)} disabled={saving} style={{ flex: 1.3, height: 46, background: 'var(--err-tint)', color: 'var(--err-text)', border: '1px solid var(--err-line)', fontWeight: 700 }}>
                {saving ? <span className="spin" /> : (confirmRemoval.next === 0 ? 'Delete recorded sets' : 'Remove & save')}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-lg" onClick={() => save()} disabled={saving}>
            {saving ? <span className="spin" /> : <>Save &amp; complete<span className="msr-fill" style={{ fontSize: 20 }}>check</span></>}
          </button>
        )}
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
