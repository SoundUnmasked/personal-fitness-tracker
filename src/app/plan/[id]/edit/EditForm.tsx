'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SESSION_TYPES, COMMON_EXERCISES, type SessionType } from '@/lib/constants';
import { updatePlanAction } from '../../actions';

export interface EditExercise {
  name: string; sets: string; reps: string; weightKg: string; restSeconds: string; tempo: string; superset: string; notes: string;
}
export interface EditFlowItem { name: string; detail: string; weightKg: string; }
export interface EditInitial {
  id: number; dateIso: string; type: string; title: string; location: string; notes: string;
  exercises: EditExercise[]; warmup: EditFlowItem[]; cooldown: EditFlowItem[];
}

const emptyExercise = (): EditExercise => ({ name: '', sets: '', reps: '', weightKg: '', restSeconds: '', tempo: '', superset: '', notes: '' });
const emptyItem = (): EditFlowItem => ({ name: '', detail: '', weightKg: '' });
const selectAllOnFocus = (e: React.FocusEvent<HTMLInputElement>) => { try { e.currentTarget.select(); } catch { /* ignore */ } };

// Move an array element up/down (returns a new array).
function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export default function EditForm({ initial }: { initial: EditInitial }) {
  const router = useRouter();
  const [type, setType] = useState<SessionType>((SESSION_TYPES as readonly string[]).includes(initial.type) ? (initial.type as SessionType) : 'Foundation');
  const [title, setTitle] = useState(initial.title);
  const [notes, setNotes] = useState(initial.notes);
  const [rows, setRows] = useState<EditExercise[]>(initial.exercises.length ? initial.exercises : [emptyExercise()]);
  const [warmup, setWarmup] = useState<EditFlowItem[]>(initial.warmup);
  const [cooldown, setCooldown] = useState<EditFlowItem[]>(initial.cooldown);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateRow = (i: number, patch: Partial<EditExercise>) => setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  async function save() {
    setSaving(true); setError(null);
    const exercises = rows.filter((r) => r.name.trim()).map((r) => ({
      name: r.name.trim(),
      sets: r.sets ? Number(r.sets) : null,
      reps: r.reps ? Number(r.reps) : null,
      weightKg: r.weightKg ? Number(r.weightKg) : null,
      restSeconds: r.restSeconds ? Number(r.restSeconds) : null,
      tempo: r.tempo.trim() || null,
      superset: r.superset.trim() || null,
      notes: r.notes.trim() || null,
    }));
    if (exercises.length === 0) { setError('Keep at least one movement.'); setSaving(false); return; }

    const toItems = (items: EditFlowItem[]) => items.filter((it) => it.name.trim()).map((it) => ({
      name: it.name.trim(), detail: it.detail.trim() || null, weightKg: it.weightKg ? Number(it.weightKg) : null, done: false,
    }));

    const res = await updatePlanAction(initial.id, {
      type, date: initial.dateIso, title: title || null, location: initial.location || null, notes: notes || null,
      warmup: toItems(warmup), cooldown: toItems(cooldown), exercises,
    });
    if (!res.ok) { setError(res.error ?? 'Could not save changes.'); setSaving(false); return; }
    router.push(`/plan/${initial.id}`);
    router.refresh();
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="page-title">Edit session</h1>
          <div className="sub">Change movements, targets, warm-up and cool-down.</div>
        </div>
        <Link href={`/plan/${initial.id}`} className="btn ghost btn-sm">Cancel</Link>
      </div>

      {error && <div className="err-note" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="field">
        <label>Session type</label>
        <div className="chips">
          {SESSION_TYPES.map((t) => (
            <span key={t} className={`chip ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>{t}</span>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lower body + sled" />
      </div>

      {/* --- Movements ------------------------------------------------------ */}
      <div className="section-head" style={{ marginTop: 8 }}><div className="h2">Movements</div><div className="sub">{rows.length}</div></div>
      {rows.map((r, i) => (
        <div className="card" key={i} style={{ padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-dim)', flex: 1 }}>Movement {i + 1}</div>
            <button aria-label="Move up" disabled={i === 0} onClick={() => setRows((rs) => move(rs, i, -1))} style={iconBtn(i === 0)}><span className="msr">arrow_upward</span></button>
            <button aria-label="Move down" disabled={i === rows.length - 1} onClick={() => setRows((rs) => move(rs, i, 1))} style={iconBtn(i === rows.length - 1)}><span className="msr">arrow_downward</span></button>
            <button aria-label="Remove movement" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} style={{ ...iconBtn(false), color: 'var(--err-text)', borderColor: 'var(--err-line)', background: 'var(--err-tint)' }}><span className="msr">delete</span></button>
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <input value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} placeholder="Movement name" list="exercise-options" />
          </div>
          <div className="row">
            <div><label>Sets</label><input type="number" inputMode="numeric" onFocus={selectAllOnFocus} value={r.sets} onChange={(e) => updateRow(i, { sets: e.target.value })} placeholder="4" /></div>
            <div><label>Reps</label><input type="number" inputMode="numeric" onFocus={selectAllOnFocus} value={r.reps} onChange={(e) => updateRow(i, { reps: e.target.value })} placeholder="6" /></div>
            <div><label>Weight</label><input type="number" inputMode="decimal" onFocus={selectAllOnFocus} value={r.weightKg} onChange={(e) => updateRow(i, { weightKg: e.target.value })} placeholder="kg" /></div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <div><label>Rest (sec)</label><input type="number" inputMode="numeric" onFocus={selectAllOnFocus} value={r.restSeconds} onChange={(e) => updateRow(i, { restSeconds: e.target.value })} placeholder="90" /></div>
            <div><label>Tempo</label><input value={r.tempo} onChange={(e) => updateRow(i, { tempo: e.target.value })} placeholder="3030" maxLength={4} /></div>
            <div><label>Superset</label><input value={r.superset} onChange={(e) => updateRow(i, { superset: e.target.value })} placeholder="A" maxLength={3} /></div>
          </div>
          <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
            <label>Note</label>
            <input value={r.notes} onChange={(e) => updateRow(i, { notes: e.target.value })} placeholder="Cue for this movement" />
          </div>
        </div>
      ))}
      <button className="btn secondary" onClick={() => setRows((rs) => [...rs, emptyExercise()])} style={{ marginBottom: 18 }}>＋ Add movement</button>

      {/* --- Warm-up / Cool-down (lightweight lists) ------------------------ */}
      <FlowEditor title="Warm-up" hint="A guide, not a strict log" items={warmup} setItems={setWarmup} />
      <FlowEditor title="Cool-down" hint="Holds a full stretching routine" items={cooldown} setItems={setCooldown} />

      <datalist id="exercise-options">
        {COMMON_EXERCISES.map((e) => <option key={e} value={e} />)}
      </datalist>

      <div className="field" style={{ marginTop: 8 }}>
        <label>Session notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything for the whole session" />
      </div>

      <button className="btn" onClick={save} disabled={saving}>
        {saving ? <span className="spin" /> : 'Save changes'}
      </button>
      <div style={{ height: 24 }} />
    </>
  );
}

// Lightweight add/remove/reorder/annotate list for warm-up and cool-down.
function FlowEditor({ title, hint, items, setItems }: {
  title: string; hint: string; items: EditFlowItem[]; setItems: React.Dispatch<React.SetStateAction<EditFlowItem[]>>;
}) {
  const update = (i: number, patch: Partial<EditFlowItem>) => setItems((its) => its.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="section-head" style={{ marginTop: 0 }}><div className="h2">{title}</div><div className="sub">{hint}</div></div>
      {items.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-faint)', padding: '4px 2px 10px' }}>No items yet.</div>}
      {items.map((it, i) => (
        <div className="card" key={i} style={{ padding: 11, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
            <input value={it.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Item, e.g. Couch stretch" style={{ flex: 1 }} />
            <button aria-label="Move up" disabled={i === 0} onClick={() => setItems((its) => move(its, i, -1))} style={iconBtn(i === 0)}><span className="msr">arrow_upward</span></button>
            <button aria-label="Move down" disabled={i === items.length - 1} onClick={() => setItems((its) => move(its, i, 1))} style={iconBtn(i === items.length - 1)}><span className="msr">arrow_downward</span></button>
            <button aria-label="Remove item" onClick={() => setItems((its) => its.filter((_, idx) => idx !== i))} style={{ ...iconBtn(false), color: 'var(--err-text)', borderColor: 'var(--err-line)', background: 'var(--err-tint)' }}><span className="msr">delete</span></button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <div style={{ flex: 2 }}><label>Detail</label><input value={it.detail} onChange={(e) => update(i, { detail: e.target.value })} placeholder="e.g. 2×10 / 30s each side" /></div>
            <div><label>Weight</label><input type="number" inputMode="decimal" onFocus={selectAllOnFocus} value={it.weightKg} onChange={(e) => update(i, { weightKg: e.target.value })} placeholder="kg" /></div>
          </div>
        </div>
      ))}
      <button className="btn secondary btn-sm" onClick={() => setItems((its) => [...its, emptyItem()])}>＋ Add {title.toLowerCase()} item</button>
    </div>
  );
}

function iconBtn(disabled: boolean): React.CSSProperties {
  return { width: 36, height: 36, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-dim)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, fontSize: 18 };
}
