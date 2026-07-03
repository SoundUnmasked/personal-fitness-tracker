'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { completePlanAction } from '../../actions';
import { HR_SOURCES } from '@/lib/constants';

export interface LogExercise {
  name: string;
  targetSets: number | null;
  targetReps: number | null;
  targetWeightKg: number | null;
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

interface SetRow { kg: string; reps: string; rpe: string; done: boolean; prevKg: string; prevReps: string; }
type Field = 'kg' | 'reps' | 'rpe';

function initSets(ex: LogExercise): SetRow[] {
  const n = Math.max(ex.targetSets ?? 1, 1);
  const kg = ex.targetWeightKg != null ? String(ex.targetWeightKg) : ex.prevKg != null ? String(ex.prevKg) : '';
  const reps = ex.targetReps != null ? String(ex.targetReps) : '';
  const prevKg = ex.prevKg != null ? String(ex.prevKg) : '';
  const prevReps = ex.prevReps != null ? String(ex.prevReps) : '';
  return Array.from({ length: n }, () => ({ kg, reps, rpe: '', done: false, prevKg, prevReps }));
}

const FIELD_LABEL: Record<Field, string> = { kg: 'WEIGHT · KG', reps: 'REPS', rpe: 'RPE · 0–10' };
const FIELD_UNIT: Record<Field, string> = { kg: 'kg', reps: 'reps', rpe: '/ 10' };

export default function LogGrid({ plan }: { plan: LogPlan }) {
  const router = useRouter();
  const [sets, setSets] = useState<SetRow[][]>(() => plan.exercises.map(initSets));
  const [active, setActive] = useState<{ ei: number; si: number; field: Field }>({ ei: 0, si: 0, field: 'kg' });
  const [panel, setPanel] = useState<'entry' | 'rest' | 'hidden'>('entry');
  const [rest, setRest] = useState({ running: false, remaining: 90, total: 90 });
  const [elapsed, setElapsed] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // session elapsed clock
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => { if (restTimer.current) clearInterval(restTimer.current); }, []);

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;

  function beep() {
    try {
      const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const ac = new AC();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = 760; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.25);
      o.start(); o.stop(ac.currentTime + 0.26);
    } catch { /* audio not available */ }
  }

  function startRest(sec: number) {
    if (restTimer.current) clearInterval(restTimer.current);
    setPanel('rest');
    setRest({ running: true, remaining: sec, total: sec });
    restTimer.current = setInterval(() => {
      setRest((r) => {
        const rem = r.remaining - 1;
        if (rem <= 0) { if (restTimer.current) clearInterval(restTimer.current); beep(); return { ...r, remaining: 0, running: false }; }
        return { ...r, remaining: rem };
      });
    }, 1000);
  }
  function restAdjust(d: number) { setRest((r) => ({ ...r, remaining: Math.max(0, r.remaining + d), total: Math.max(r.total, r.remaining + d) })); }
  function restToggle() {
    if (rest.running) { if (restTimer.current) clearInterval(restTimer.current); setRest((r) => ({ ...r, running: false })); }
    else startRest(rest.remaining > 0 ? rest.remaining : 90);
  }
  function restSkip() { if (restTimer.current) clearInterval(restTimer.current); setRest((r) => ({ ...r, running: false })); setPanel('entry'); }

  function tap(ei: number, si: number, field: Field) { setActive({ ei, si, field }); setPanel('entry'); }
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
    let nowDone = false;
    setSets((all) => all.map((rows, e) => e !== ei ? rows : rows.map((row, s) => {
      if (s !== si) return row; nowDone = !row.done; return { ...row, done: nowDone };
    })));
    if (nowDone) startRest(90);
  }
  function next() {
    const order: Field[] = ['kg', 'reps', 'rpe'];
    const idx = order.indexOf(active.field);
    if (idx < 2) { setActive({ ...active, field: order[idx + 1] }); return; }
    // mark done + advance
    setSets((all) => all.map((rows, e) => e !== active.ei ? rows : rows.map((row, s) => s === active.si ? { ...row, done: true } : row)));
    const exSets = sets[active.ei];
    let na = active;
    if (active.si + 1 < exSets.length) na = { ei: active.ei, si: active.si + 1, field: 'kg' };
    else if (active.ei + 1 < sets.length) na = { ei: active.ei + 1, si: 0, field: 'kg' };
    setActive(na);
    startRest(90);
  }
  const addSet = (ei: number) => setSets((all) => all.map((rows, e) => e === ei ? [...rows, { kg: '', reps: '', rpe: '', done: false, prevKg: '', prevReps: '' }] : rows));

  const activeVal = sets[active.ei]?.[active.si]?.[active.field] ?? '';
  const groups = useMemo(() => groupBySuperset(plan.exercises), [plan.exercises]);
  const doneCount = sets.reduce((a, rows) => a + rows.filter((r) => r.done).length, 0);
  const totalCount = sets.reduce((a, rows) => a + rows.length, 0);

  const cols = '24px 58px 1fr 1fr 1fr 32px';
  const restPct = rest.total ? Math.max(0, (rest.remaining / rest.total) * 100) : 0;

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, padding: '10px 2px', marginBottom: 4 }}>
        <button className="icon-btn" onClick={() => router.push(`/plan/${plan.id}`)}><span className="msr">chevron_left</span></button>
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
              return (
                <div key={index} className="card" style={{ padding: 15, marginBottom: g.items.length > 1 ? 10 : 0, borderLeft: `3px solid ${activeHere ? 'var(--accent)' : 'var(--border)'}` }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{ex.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                        {ex.targetSets ?? '—'} × {ex.targetReps ?? '—'} target
                      </div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: done === sets[index].length ? 'var(--accent)' : 'var(--text-dim)' }}>{done}/{sets[index].length}</div>
                  </div>

                  {/* grid head */}
                  <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 7, alignItems: 'center', margin: '14px 0 2px' }}>
                    {['SET', 'PREV', 'KG', 'REPS', 'RPE'].map((h, hi) => (
                      <div key={h} style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-faint)', textAlign: hi >= 2 ? 'center' : 'left' }}>{h}</div>
                    ))}
                    <div />
                  </div>

                  {sets[index].map((st, si) => (
                    <div key={si} style={{ display: 'grid', gridTemplateColumns: cols, gap: 7, alignItems: 'center', marginTop: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, textAlign: 'center', color: st.done ? 'var(--accent)' : 'var(--text-dim)' }}>{si + 1}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.15 }}>
                        {st.prevKg ? (
                          <>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}><span style={{ color: 'var(--text)', fontWeight: 600 }}>{st.prevKg}</span> kg</div>
                            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{st.prevReps} reps</div>
                          </>
                        ) : <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>—</div>}
                      </div>
                      <Cell active={active.ei === index && active.si === si && active.field === 'kg'} filled={st.kg !== ''} onClick={() => tap(index, si, 'kg')} value={st.kg} />
                      <Cell active={active.ei === index && active.si === si && active.field === 'reps'} filled={st.reps !== ''} onClick={() => tap(index, si, 'reps')} value={st.reps} />
                      <Cell active={active.ei === index && active.si === si && active.field === 'rpe'} filled={st.rpe !== ''} onClick={() => tap(index, si, 'rpe')} value={st.rpe} />
                      <button onClick={() => toggle(index, si)} style={{ width: 30, height: 30, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, cursor: 'pointer', background: st.done ? 'var(--accent)' : 'transparent', color: st.done ? 'var(--on-accent)' : 'var(--text-faint)', border: st.done ? 'none' : '1.5px solid var(--border)' }}>
                        <span className="msr-fill">check</span>
                      </button>
                    </div>
                  ))}

                  <button onClick={() => addSet(index)} style={{ marginTop: 11, width: '100%', height: 36, borderRadius: 11, border: '1px dashed var(--border)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)', cursor: 'pointer' }}>
                    <span className="msr">add</span>Add set
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
            <span className="msr" style={{ fontSize: 18, color: 'var(--text-faint)' }}>keyboard_arrow_up</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
              <div className="seg" style={{ flex: 1 }}>
                <button className={`seg-item ${panel === 'entry' ? 'active' : ''}`} onClick={() => setPanel('entry')}><span className="msr">dialpad</span>Keypad</button>
                <button className={`seg-item ${panel === 'rest' ? 'active' : ''}`} onClick={() => setPanel('rest')}><span className="msr">timer</span>Rest</button>
              </div>
              <button onClick={() => setPanel('hidden')} style={{ width: 42, height: 38, flex: 'none', borderRadius: 11, background: 'var(--seg-track)', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, border: 'none', cursor: 'pointer' }}>
                <span className="msr">keyboard_arrow_down</span>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((k) => (
                    <button key={k} onClick={() => press(k)} style={{ height: 44, border: '1px solid var(--border)', borderRadius: 13, background: 'var(--key-bg)', color: 'var(--text)', fontSize: 21, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      {k === 'back' ? '⌫' : k}
                    </button>
                  ))}
                </div>
                <button className="btn" style={{ height: 50, marginTop: 10, borderRadius: 14 }} onClick={next}>Log set<span className="msr-fill" style={{ fontSize: 20 }}>arrow_forward</span></button>
              </>
            ) : (
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

function Cell({ active, filled, value, onClick }: { active: boolean; filled: boolean; value: string; onClick: () => void }) {
  const base: React.CSSProperties = { height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 11, fontSize: 16, fontWeight: 600, cursor: 'pointer' };
  let style = base;
  if (active) style = { ...base, background: 'var(--accent-soft)', border: '1.5px solid var(--accent)', color: 'var(--text)', boxShadow: '0 0 0 3px var(--accent-soft)' };
  else if (filled) style = { ...base, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' };
  else style = { ...base, background: 'var(--last-bg)', border: '1px solid var(--border)', color: 'var(--text-faint)' };
  return <div style={style} onClick={onClick}>{value !== '' ? value : active ? '' : '–'}</div>;
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
  sets: { kg: string; reps: string; rpe: string; done: boolean }[][];
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
      sets[ei].filter((s) => s.kg || s.reps || s.rpe).map((s, i) => ({
        exerciseName: ex.name, setNo: i + 1,
        reps: s.reps ? Number(s.reps) : null,
        weightKg: s.kg ? Number(s.kg) : null,
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
          <button className="icon-btn dim" onClick={onClose}><span className="msr">close</span></button>
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
