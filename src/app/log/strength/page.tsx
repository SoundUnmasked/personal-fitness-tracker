'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  SESSION_TYPES,
  COMMON_EXERCISES,
  DEFAULT_LOCATION,
  type SessionType,
} from '@/lib/constants';
import { isoDate } from '@/lib/format';
import Scale from '@/components/Scale';

interface SetRow {
  reps: string;
  weightKg: string;
  rpe: string;
}
interface Exercise {
  name: string;
  sets: SetRow[];
}

const emptySet = (): SetRow => ({ reps: '', weightKg: '', rpe: '' });

export default function StrengthLogger() {
  const router = useRouter();
  const [date, setDate] = useState(isoDate(new Date()));
  const [type, setType] = useState<SessionType>('Foundation');
  const [title, setTitle] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [energyPre, setEnergyPre] = useState<number | null>(null);
  const [rpeOverall, setRpeOverall] = useState<number | null>(null);
  const [cooldownDone, setCooldownDone] = useState(false);
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([
    { name: '', sets: [emptySet()] },
  ]);

  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function updateExercise(i: number, patch: Partial<Exercise>) {
    setExercises((xs) => xs.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function updateSet(ei: number, si: number, patch: Partial<SetRow>) {
    setExercises((xs) =>
      xs.map((x, idx) =>
        idx === ei
          ? { ...x, sets: x.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) }
          : x,
      ),
    );
  }
  const addExercise = () =>
    setExercises((xs) => [...xs, { name: '', sets: [emptySet()] }]);
  const addSet = (ei: number) =>
    setExercises((xs) =>
      xs.map((x, i) => (i === ei ? { ...x, sets: [...x.sets, emptySet()] } : x)),
    );
  const removeExercise = (ei: number) =>
    setExercises((xs) => xs.filter((_, i) => i !== ei));

  async function save() {
    setSaving(true);
    setError(null);
    setWarning(null);

    const strengthSets = exercises
      .filter((e) => e.name.trim())
      .flatMap((e) =>
        e.sets.map((s, i) => ({
          exerciseName: e.name.trim(),
          setNo: i + 1,
          reps: s.reps ? Number(s.reps) : null,
          weightKg: s.weightKg ? Number(s.weightKg) : null,
          rpe: s.rpe ? Number(s.rpe) : null,
        })),
      );

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          type,
          title: title || null,
          durationMin: durationMin || null,
          location,
          energyPre,
          rpeOverall,
          cooldownDone,
          notes: notes || null,
          strengthSets,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setWarning(data.warning ?? null);
      setDone(true);
      // Give a moment to read any warning, then return to dashboard.
      setTimeout(() => router.push('/'), data.warning ? 2200 : 700);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Log strength session</h1>
      <p className="page-sub">Quick to fill mid-session. Only the type is required.</p>

      {error && <div className="err-note">{error}</div>}
      {warning && <div className="warn">⚠ {warning}</div>}
      {done && !warning && <div className="ok-note">Saved ✓</div>}

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
          <label>Duration (min)</label>
          <input
            type="number"
            inputMode="numeric"
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
            placeholder="60"
          />
        </div>
      </div>

      <div className="field">
        <label>Title (optional)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lower body + sled" />
      </div>

      <div className="field">
        <label>Location</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>

      <div className="field">
        <label>Energy before (1–5)</label>
        <Scale max={5} value={energyPre} onChange={setEnergyPre} />
      </div>

      {/* Exercises */}
      <div className="section-label">Exercises</div>
      {exercises.map((ex, ei) => (
        <div className="card" key={ei}>
          <h2>
            Exercise {ei + 1}
            {exercises.length > 1 && (
              <button className="btn ghost btn-sm" onClick={() => removeExercise(ei)}>
                Remove
              </button>
            )}
          </h2>
          <div className="field">
            <input
              value={ex.name}
              onChange={(e) => updateExercise(ei, { name: e.target.value })}
              placeholder="Exercise name"
              list="exercise-options"
            />
            <div className="chips" style={{ marginTop: '0.5rem' }}>
              {COMMON_EXERCISES.slice(0, 8).map((name) => (
                <span key={name} className="chip" onClick={() => updateExercise(ei, { name })}>
                  {name}
                </span>
              ))}
            </div>
          </div>

          {ex.sets.map((s, si) => (
            <div className="row" key={si} style={{ marginBottom: '0.5rem', alignItems: 'flex-end' }}>
              <div>
                {si === 0 && <label>Reps</label>}
                <input
                  type="number"
                  inputMode="numeric"
                  value={s.reps}
                  onChange={(e) => updateSet(ei, si, { reps: e.target.value })}
                  placeholder="reps"
                />
              </div>
              <div>
                {si === 0 && <label>Weight (kg)</label>}
                <input
                  type="number"
                  inputMode="decimal"
                  value={s.weightKg}
                  onChange={(e) => updateSet(ei, si, { weightKg: e.target.value })}
                  placeholder="kg"
                />
              </div>
              <div>
                {si === 0 && <label>RPE</label>}
                <input
                  type="number"
                  inputMode="numeric"
                  value={s.rpe}
                  onChange={(e) => updateSet(ei, si, { rpe: e.target.value })}
                  placeholder="1-10"
                />
              </div>
            </div>
          ))}
          <button className="btn ghost btn-sm" onClick={() => addSet(ei)}>
            ＋ Add set
          </button>
        </div>
      ))}
      <button className="btn secondary" onClick={addExercise} style={{ marginBottom: '1rem' }}>
        ＋ Add exercise
      </button>

      <datalist id="exercise-options">
        {COMMON_EXERCISES.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>

      {/* Wrap-up */}
      <div className="section-label">Wrap-up</div>
      <div className="field">
        <label>Overall RPE (1–10)</label>
        <Scale max={10} value={rpeOverall} onChange={setRpeOverall} />
      </div>
      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={cooldownDone}
            onChange={(e) => setCooldownDone(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Cooldown done
        </label>
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it feel?" />
      </div>

      <button className="btn" onClick={save} disabled={saving}>
        {saving ? <span className="spin" /> : 'Save session'}
      </button>
      <div style={{ height: '1rem' }} />
    </>
  );
}
