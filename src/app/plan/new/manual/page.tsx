'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  SESSION_TYPES,
  COMMON_EXERCISES,
  DEFAULT_LOCATION,
  type SessionType,
} from '@/lib/constants';
import { isoDate } from '@/lib/format';
import { createPlanAction } from '../../actions';

interface PlanRow {
  name: string;
  sets: string;
  reps: string;
  weightKg: string;
  superset: string;
  notes: string;
}

const emptyRow = (): PlanRow => ({
  name: '',
  sets: '',
  reps: '',
  weightKg: '',
  superset: '',
  notes: '',
});

export default function NewPlanPage() {
  const router = useRouter();
  const [date, setDate] = useState(isoDate(new Date()));
  const [type, setType] = useState<SessionType>('Foundation');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<PlanRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (i: number, patch: Partial<PlanRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  async function save() {
    setSaving(true);
    setError(null);
    const exercises = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        sets: r.sets ? Number(r.sets) : null,
        reps: r.reps ? Number(r.reps) : null,
        weightKg: r.weightKg ? Number(r.weightKg) : null,
        superset: r.superset.trim() || null,
        notes: r.notes.trim() || null,
      }));

    if (exercises.length === 0) {
      setError('Add at least one movement.');
      setSaving(false);
      return;
    }

    const res = await createPlanAction({
      type,
      date,
      title: title || null,
      location,
      notes: notes || null,
      exercises,
    });
    if (!res.ok) {
      setError(res.error ?? 'Could not save plan.');
      setSaving(false);
      return;
    }
    router.push('/plan');
  }

  return (
    <>
      <div className="topbar">
        <div>
          <h1 className="page-title">Plan a session</h1>
          <div className="sub">
            Build it now; open it at the gym with targets pre-filled.
          </div>
        </div>
        <Link href="/plan" className="btn ghost btn-sm">
          Cancel
        </Link>
      </div>

      {error && <div className="err-note">{error}</div>}

      <div className="field">
        <label>Session type</label>
        <div className="chips">
          {SESSION_TYPES.map((t) => (
            <span
              key={t}
              className={`chip ${type === t ? 'active' : ''}`}
              onClick={() => setType(t)}
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Title (optional)</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Lower body + sled"
          />
        </div>
      </div>

      <div className="field">
        <label>Location</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>

      <div className="section-label">Planned movements</div>
      <p className="page-sub" style={{ marginTop: 0 }}>
        Targets are optional. Give two movements the same superset tag (e.g.
        “A”) to pair them.
      </p>

      {rows.map((r, i) => (
        <div className="card" key={i}>
          <h2>
            Movement {i + 1}
            {rows.length > 1 && (
              <button className="btn ghost btn-sm" onClick={() => removeRow(i)}>
                Remove
              </button>
            )}
          </h2>
          <div className="field">
            <input
              value={r.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Movement name"
              list="exercise-options"
            />
            <div className="chips" style={{ marginTop: '0.5rem' }}>
              {COMMON_EXERCISES.slice(0, 8).map((name) => (
                <span key={name} className="chip" onClick={() => update(i, { name })}>
                  {name}
                </span>
              ))}
            </div>
          </div>
          <div className="row">
            <div>
              <label>Sets</label>
              <input
                type="number"
                inputMode="numeric"
                value={r.sets}
                onChange={(e) => update(i, { sets: e.target.value })}
                placeholder="4"
              />
            </div>
            <div>
              <label>Reps</label>
              <input
                type="number"
                inputMode="numeric"
                value={r.reps}
                onChange={(e) => update(i, { reps: e.target.value })}
                placeholder="6"
              />
            </div>
            <div>
              <label>Weight (kg)</label>
              <input
                type="number"
                inputMode="decimal"
                value={r.weightKg}
                onChange={(e) => update(i, { weightKg: e.target.value })}
                placeholder="kg"
              />
            </div>
            <div>
              <label>Superset</label>
              <input
                value={r.superset}
                onChange={(e) => update(i, { superset: e.target.value })}
                placeholder="A"
                maxLength={3}
              />
            </div>
          </div>
        </div>
      ))}
      <button className="btn secondary" onClick={addRow} style={{ marginBottom: '1rem' }}>
        ＋ Add movement
      </button>

      <datalist id="exercise-options">
        {COMMON_EXERCISES.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>

      <div className="field">
        <label>Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Focus, cues, anything to remember"
        />
      </div>

      <button className="btn" onClick={save} disabled={saving}>
        {saving ? <span className="spin" /> : 'Save plan'}
      </button>
      <div style={{ height: '1rem' }} />
    </>
  );
}
