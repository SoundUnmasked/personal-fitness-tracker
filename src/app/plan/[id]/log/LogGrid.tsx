'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { completePlanAction } from '../../actions';
import { HR_SOURCES, DEFAULT_REST_SECONDS } from '@/lib/constants';
import { beep, unlockAudio } from '@/lib/beeper';
import { parseTempo, tempoAt } from '@/lib/tempo';

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

// Field cycle order depends on whether the movement is rep- or time-based.
const fieldsForStyle = (style: 'reps' | 'duration'): Field[] =>
  style === 'duration' ? ['kg', 'dur', 'rpe'] : ['kg', 'reps', 'rpe'];

export default function LogGrid({ plan }: { plan: LogPlan }) {
  const router = useRouter();
  const [sets, setSets] = useState<SetRow[][]>(() => plan.exercises.map(initSets));
  const [active, setActive] = useState<{ ei: number; si: number; field: Field }>({ ei: 0, si: 0, field: 'kg' });
  const [panel, setPanel] = useState<'entry' | 'rest' | 'tempo' | 'hidden'>('entry');
  const restFor = (ei: number) => plan.exercises[ei]?.restSeconds ?? DEFAULT_REST_SECONDS;
  const [rest, setRest] = useState(() => { const s = plan.exercises[0]?.restSeconds ?? DEFAULT_REST_SECONDS; return { running: false, remaining: s, total: s }; });
  const [elapsed, setElapsed] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Count-up stopwatch for duration-style sets.
  const [sw, setSw] = useState({ running: false, elapsed: 0 });
  const swElapsed = useRef(0);
  const swTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeEx = plan.exercises[active.ei];
  const activeStyle: 'reps' | 'duration' = activeEx?.setStyle === 'duration' ? 'duration' : 'reps';
  const activeHasTempo = !!activeEx?.tempo;

  // session elapsed clock
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => {
    if (restTimer.current) clearInterval(restTimer.current);
    if (swTimer.current) clearInterval(swTimer.current);
  }, []);
  // If we switch to a movement without a tempo while the Tempo panel is open,
  // fall back to the keypad.
  useEffect(() => { if (panel === 'tempo' && !activeHasTempo) setPanel('entry'); }, [active.ei, activeHasTempo, panel]);

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;

  // Rest countdown against an absolute deadline (Date.now()-based) rather than
  // chained 1s decrements: mobile Chrome throttles background timers, and a
  // deadline recomputed on every tick stays correct however late ticks arrive.
  const restEndsAt = useRef<number | null>(null);

  function startRest(sec: number) {
    if (restTimer.current) clearInterval(restTimer.current);
    // Every path here starts from a tap, which is our chance to unlock audio
    // for the end-of-rest tone (mobile Chrome autoplay policy).
    unlockAudio();
    setPanel('rest');
    setRest({ running: true, remaining: sec, total: sec });
    restEndsAt.current = Date.now() + sec * 1000;
    restTimer.current = setInterval(() => {
      const endsAt = restEndsAt.current;
      if (endsAt == null) return;
      const rem = Math.ceil((endsAt - Date.now()) / 1000);
      if (rem <= 0) {
        if (restTimer.current) clearInterval(restTimer.current);
        restEndsAt.current = null;
        beep('end');
        setRest((r) => ({ ...r, remaining: 0, running: false }));
      } else {
        setRest((r) => (r.remaining === rem ? r : { ...r, remaining: rem }));
      }
    }, 250);
  }
  function restAdjust(d: number) {
    if (restEndsAt.current != null) {
      restEndsAt.current = Math.max(Date.now(), restEndsAt.current + d * 1000);
    }
    setRest((r) => { const rem = Math.max(0, r.remaining + d); return { ...r, remaining: rem, total: Math.max(r.total, rem) }; });
  }
  function restToggle() {
    if (rest.running) {
      if (restTimer.current) clearInterval(restTimer.current);
      restEndsAt.current = null;
      setRest((r) => ({ ...r, running: false }));
    } else startRest(rest.remaining > 0 ? rest.remaining : restFor(active.ei));
  }
  function restSkip() {
    if (restTimer.current) clearInterval(restTimer.current);
    restEndsAt.current = null;
    setRest((r) => ({ ...r, running: false }));
    setPanel('entry');
  }

  // --- duration count-up ----------------------------------------------------
  function writeField(ei: number, si: number, field: Field, value: string) {
    setSets((all) => all.map((rows, e) => e !== ei ? rows : rows.map((row, s) => s === si ? { ...row, [field]: value } : row)));
  }
  function durToggle() {
    if (sw.running) {
      if (swTimer.current) clearInterval(swTimer.current);
      setSw({ running: false, elapsed: swElapsed.current });
      writeField(active.ei, active.si, 'dur', String(swElapsed.current));
    } else {
      if (swTimer.current) clearInterval(swTimer.current);
      swElapsed.current = 0;
      setSw({ running: true, elapsed: 0 });
      swTimer.current = setInterval(() => {
        swElapsed.current += 1;
        setSw({ running: true, elapsed: swElapsed.current });
      }, 1000);
    }
  }

  function tap(ei: number, si: number, field: Field) {
    if (sw.running) { if (swTimer.current) clearInterval(swTimer.current); setSw((s) => ({ ...s, running: false })); }
    setActive({ ei, si, field }); setPanel('entry');
  }
  function press(v: string) {
    setSets((all) => all.map((rows, ei) => ei !== active.ei ? rows : rows.map((row, si) => {
      if (si !== active.si) return row;
      let cur = row[active.field] || '';
      if (v === 'back') cur = cur.slice(0, -1);
      else if (v === '.') cur = cur.includes('.') ? cur : (cur === '' ? '0.' : cur + '.');
      else if (cur.replace('.', '').length < 4) cur = cur + v;
      return { ...row, [active.field]: cur };
    })));
  }
  function toggle(ei: number, si: number) {
    // Decide from current state, NOT inside the setSets updater: React may run
    // updaters lazily, so a flag mutated in there is not reliably visible on
    // the next line (live-use bug: tick sometimes failed to start the rest
    // timer). Ticking a set done always auto-starts that exercise's rest.
    const nowDone = !sets[ei][si].done;
    setSets((all) => all.map((rows, e) => e !== ei ? rows : rows.map((row, s) => (s === si ? { ...row, done: nowDone } : row))));
    if (nowDone) startRest(restFor(ei));
  }
  function next() {
    const order = fieldsForStyle(activeStyle);
    const idx = order.indexOf(active.field);
    if (idx > -1 && idx < order.length - 1) { setActive({ ...active, field: order[idx + 1] }); return; }
    // mark done + advance
    setSets((all) => all.map((rows, e) => e !== active.ei ? rows : rows.map((row, s) => s === active.si ? { ...row, done: true } : row)));
    const exSets = sets[active.ei];
    let na = active;
    if (active.si + 1 < exSets.length) na = { ei: active.ei, si: active.si + 1, field: 'kg' };
    else if (active.ei + 1 < sets.length) na = { ei: active.ei + 1, si: 0, field: 'kg' };
    setActive(na);
    startRest(restFor(active.ei));
  }
  const addSet = (ei: number) => setSets((all) => all.map((rows, e) => e === ei ? [...rows, { kg: '', reps: '', dur: '', rpe: '', done: false, prevKg: '', prevReps: '' }] : rows));

  const activeVal = sets[active.ei]?.[active.si]?.[active.field] ?? '';
  const groups = useMemo(() => groupBySuperset(plan.exercises), [plan.exercises]);
  const doneCount = sets.reduce((a, rows) => a + rows.filter((r) => r.done).length, 0);
  const totalCount = sets.reduce((a, rows) => a + rows.length, 0);

  // Last column holds the set-done toggle — 44px so the most-tapped control
  // in the gym meets the minimum comfortable touch-target size.
  const cols = '24px 58px 1fr 1fr 1fr 44px';
  const restPct = rest.total ? Math.max(0, (rest.remaining / rest.total) * 100) : 0;

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, padding: '10px 2px', marginBottom: 4 }}>
        <button className="icon-btn" onClick={() => router.push(`/plan/${plan.id}`)} aria-label="Back to session"><span className="msr" aria-hidden="true">chevron_left</span></button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{plan.title}</div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-faint)', marginTop: 2 }}>
            {plan.type} · <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{mmss(elapsed)}</span>
          </div>
        </div>
        <button className="btn-sm" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)', height: 32 }} onClick={() => setFinishing(true)}>Finish</button>
      </div>

      {/* Exercise cards */}
      <div className="stack stack-12" style={{ paddingBottom: 360 }}>
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
                    <div style={{ fontSize: 12, fontWeight: 600, color: done === sets[index].length ? 'var(--accent)' : 'var(--text-dim)' }}>{done}/{sets[index].length}</div>
                  </div>

                  {/* per-exercise rest / tempo / style pills */}
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

                  {/* grid head */}
                  <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 7, alignItems: 'center', margin: '14px 0 2px' }}>
                    {['SET', 'PREV', 'KG', midLabel, 'RPE'].map((h, hi) => (
                      <div key={h} style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-faint)', textAlign: hi >= 2 ? 'center' : 'left' }}>{h}</div>
                    ))}
                    <div />
                  </div>

                  {sets[index].map((st, si) => {
                    const rowActive = activeHere && active.si === si;
                    return (
                    <div key={si} style={{ display: 'grid', gridTemplateColumns: cols, gap: 7, alignItems: 'center', marginTop: 8, padding: '4px 4px', marginLeft: -4, marginRight: -4, borderRadius: 12, background: rowActive ? 'var(--accent-tint)' : 'transparent', boxShadow: rowActive ? 'inset 0 0 0 1px var(--accent-line)' : 'none', transition: 'background 0.12s' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, textAlign: 'center', color: st.done ? 'var(--accent)' : rowActive ? 'var(--accent)' : 'var(--text-dim)' }}>{si + 1}</div>
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
                      <button onClick={() => toggle(index, si)} aria-label={st.done ? `Set ${si + 1} done` : `Mark set ${si + 1} done`} style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer', background: st.done ? 'var(--accent)' : 'transparent', color: st.done ? 'var(--on-accent)' : 'var(--text-faint)', border: st.done ? 'none' : '1.5px solid var(--border)' }}>
                        <span className="msr-fill" aria-hidden="true">check</span>
                      </button>
                    </div>
                    );
                  })}

                  {activeHere && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.02em', color: 'var(--accent)' }}>
                      <span className="msr" style={{ fontSize: 14 }} aria-hidden="true">touch_app</span>
                      Tap a cell, then use the keypad below to log
                    </div>
                  )}

                  <button onClick={() => addSet(index)} style={{ marginTop: 11, width: '100%', height: 36, borderRadius: 11, border: '1px dashed var(--border)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)', cursor: 'pointer' }}>
                    <span className="msr" aria-hidden="true">add</span>Add set
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom entry panel */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, maxWidth: 460, margin: '0 auto', padding: '10px 16px calc(22px + env(safe-area-inset-bottom))', background: 'var(--panel-bg)', borderTop: '1px solid var(--border)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}>
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
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-faint)' }}>SET {active.si + 1} · {FIELD_LABEL[active.field]}</div>
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
              activeEx?.tempo ? <TempoPlayer tempo={activeEx.tempo} /> : null
            )}
          </>
        )}
      </div>

      {finishing && (
        <FinishSheet
          plan={plan}
          sets={sets}
          progress={`${doneCount}/${totalCount}`}
          onClose={() => setFinishing(false)}
          onSaved={() => router.push('/')}
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

// --- Tempo metronome ---------------------------------------------------------
// Driven by requestAnimationFrame against performance.now(): every frame
// recomputes the exact position from absolute elapsed time (tempoAt), so
// phases can neither drift nor be skipped — the session-18 glitch came from
// chaining 1s setInterval decrements, which mobile Chrome throttles. Audio
// goes through the shared beeper (one AudioContext, fresh nodes per tone).
function TempoPlayer({ tempo }: { tempo: string }) {
  const phases = useMemo(() => parseTempo(tempo), [tempo]);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState(() => ({ pi: 0, display: phases[0]?.sec ?? 0, rep: 0 }));
  const raf = useRef<number | null>(null);
  const startedAt = useRef(0); // performance.now() when the current run began
  const pausedElapsed = useRef(0); // seconds accumulated across earlier runs
  const lastCue = useRef<{ rep: number; pi: number } | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const stopLoop = useCallback(() => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);

  const frame = useCallback(() => {
    const elapsed = pausedElapsed.current + (performance.now() - startedAt.current) / 1000;
    const pos = tempoAt(phases, elapsed);
    // Cue once per phase entry: haptic + click, higher pitch on a new rep.
    // Keyed on (rep, pi) so a phase crossed while the tab was throttled cues
    // exactly once on the frame we land in it, never twice.
    const last = lastCue.current;
    if (!last || last.rep !== pos.rep || last.pi !== pos.pi) {
      lastCue.current = { rep: pos.rep, pi: pos.pi };
      try { navigator.vibrate?.(pos.pi === 0 ? [70, 40, 70] : 45); } catch { /* no haptics */ }
      beep(pos.pi === 0 ? 'cycle' : 'phase');
    }
    // Only re-render when a displayed value actually changes; rendering at
    // frame rate is what made the countdown look jittery.
    setView((v) => (v.pi === pos.pi && v.display === pos.display && v.rep === pos.rep ? v : { pi: pos.pi, display: pos.display, rep: pos.rep }));
    raf.current = requestAnimationFrame(frame);
  }, [phases]);

  // Keep the screen awake while the metronome runs: with the screen off,
  // Chrome freezes rAF and suspends audio, so cues would stop. The lock
  // auto-releases when the page hides; re-acquire when we come back.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const acquire = async () => {
      try {
        const lock = (await navigator.wakeLock?.request('screen')) ?? null;
        if (cancelled) { void lock?.release().catch(() => {}); return; }
        wakeLock.current = lock;
      } catch { wakeLock.current = null; /* unsupported or denied: timer still correct, cues resume on return */ }
    };
    void acquire();
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void wakeLock.current?.release().catch(() => {});
      wakeLock.current = null;
    };
  }, [running]);

  useEffect(() => () => stopLoop(), [stopLoop]);
  // Reset when the movement (tempo) changes.
  useEffect(() => {
    setRunning(false);
    stopLoop();
    pausedElapsed.current = 0;
    lastCue.current = null;
    setView({ pi: 0, display: phases[0]?.sec ?? 0, rep: 0 });
  }, [tempo, phases, stopLoop]);

  function toggle() {
    if (running) {
      pausedElapsed.current += (performance.now() - startedAt.current) / 1000;
      setRunning(false);
      stopLoop();
    } else {
      if (!phases.length) return;
      unlockAudio(); // user gesture: create/resume the shared AudioContext
      startedAt.current = performance.now();
      setRunning(true);
      stopLoop();
      raf.current = requestAnimationFrame(frame);
    }
  }
  function reset() {
    setRunning(false);
    stopLoop();
    pausedElapsed.current = 0;
    lastCue.current = null;
    setView({ pi: 0, display: phases[0]?.sec ?? 0, rep: 0 });
  }

  if (!phases.length) {
    return <div style={{ padding: 12, fontSize: 13, color: 'var(--text-dim)', textAlign: 'center' }}>Tempo “{tempo}” has no timed phases.</div>;
  }
  const cur = phases[view.pi] ?? phases[0];

  return (
    <div style={{ padding: '2px 2px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-faint)' }}>TEMPO · {tempo}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>Rep {view.rep + 1}</div>
      </div>
      <div style={{ textAlign: 'center', margin: '8px 0 12px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.01em' }}>{running ? cur.label : 'Ready'}</div>
        <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{running ? view.display : phases[0].sec}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {phases.map((p, i) => (
          <div key={i} style={{ flex: p.sec, minWidth: 0, textAlign: 'center', padding: '7px 4px', borderRadius: 10, background: running && i === view.pi ? 'var(--accent)' : 'var(--seg-track)', color: running && i === view.pi ? 'var(--on-accent)' : 'var(--text-dim)', transition: 'background 0.15s' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.label}</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{p.sec}s</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={reset} style={restSmBtn}>Reset</button>
        <button className="btn" style={{ flex: 2, height: 50, borderRadius: 14, margin: 0 }} onClick={toggle}>
          <span className="msr-fill" style={{ fontSize: 20 }}>{running ? 'pause' : 'play_arrow'}</span>{running ? 'Pause' : 'Start tempo'}
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textAlign: 'center', marginTop: 9 }}>Haptic + tone cue on each phase change</div>
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
      cooldownDone, notes: notes || null, strengthSets, run,
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

        {plan.needsCooldown && (
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
