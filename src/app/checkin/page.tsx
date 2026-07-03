'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isoDate } from '@/lib/format';
import { computeReadiness } from '@/lib/readiness';
import Ring from '@/components/Ring';

// Slider dimensions map to the existing 1–5 data model.
const DIMS = [
  { key: 'sleep', icon: 'bedtime', title: 'Sleep quality', words: ['Poor', 'Fair', 'OK', 'Good', 'Great'] },
  { key: 'energy', icon: 'bolt', title: 'Energy', words: ['Drained', 'Low', 'Steady', 'Good', 'High'] },
  { key: 'freshness', icon: 'spa', title: 'Freshness', words: ['Trashed', 'Stiff', 'OK', 'Fresh', 'Peak'] },
  { key: 'mood', icon: 'mood', title: 'Mood & stress', words: ['Low', 'Meh', 'Neutral', 'Good', 'Great'] },
] as const;
type DimKey = (typeof DIMS)[number]['key'];

export default function CheckinPage() {
  const router = useRouter();
  const [date] = useState(isoDate(new Date()));
  const [vals, setVals] = useState<Record<DimKey, number>>({ sleep: 3, energy: 3, freshness: 3, mood: 3 });
  const [sleepHours, setSleepHours] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Time-based label computed AFTER mount to avoid a server/client hydration
  // mismatch (server timezone vs the phone's local time).
  const [dateLabel, setDateLabel] = useState('');
  useEffect(() => {
    const n = new Date();
    const part = n.getHours() < 12 ? 'MORNING' : n.getHours() < 18 ? 'AFTERNOON' : 'EVENING';
    setDateLabel(`${n.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()} · ${part}`);
  }, []);

  // Pre-fill from an existing check-in for today (edit in place).
  useEffect(() => {
    let active = true;
    fetch(`/api/checkin?date=${date}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        const c = d.checkin;
        if (c) {
          setVals({
            sleep: c.sleepQuality ?? 3,
            energy: c.energyMorning ?? 3,
            freshness: c.soreness != null ? 6 - c.soreness : 3,
            mood: c.mood ?? 3,
          });
          setSleepHours(c.sleepHours != null ? String(c.sleepHours) : '');
          setNotes(c.notes ?? '');
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => { active = false; };
  }, [date]);

  const readiness = computeReadiness({
    sleepQuality: vals.sleep,
    energyMorning: vals.energy,
    energyAfternoon: vals.energy,
    energyEvening: vals.energy,
    soreness: 6 - vals.freshness,
    mood: vals.mood,
  });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          date,
          sleepHours: sleepHours || null,
          sleepQuality: vals.sleep,
          energyMorning: vals.energy,
          energyAfternoon: vals.energy,
          energyEvening: vals.energy,
          soreness: 6 - vals.freshness,
          mood: vals.mood,
          notes: notes || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      router.push('/');
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, padding: '10px 2px 8px' }}>
        <button className="icon-btn" onClick={() => router.push('/')}><span className="msr">close</span></button>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-faint)' }}>~10 seconds</div>
      </div>

      <div style={{ marginTop: 4 }}>
        <div className="eyebrow eyebrow-accent" style={{ minHeight: 14 }}>{dateLabel}</div>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', marginTop: 8 }}>How are you feeling today?</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--text-dim)', marginTop: 8 }}>
          A few quick sliders. This is the part only you can answer — it fine-tunes today&apos;s readiness. (Wearable sleep/HRV will feed in later.)
        </div>
      </div>

      {error && <div className="note note-err" style={{ marginTop: 16 }}>{error}</div>}

      <div className="stack stack-12" style={{ marginTop: 22, paddingBottom: 220 }}>
        <div className="card card-md" style={{ padding: '13px 15px 12px' }}>
          <label style={{ marginBottom: 10 }}>Sleep last night (hours)</label>
          <input type="number" inputMode="decimal" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)} placeholder="7.5" />
        </div>
        {DIMS.map((d) => (
          <SliderCard key={d.key} icon={d.icon} title={d.title} words={[...d.words]} value={vals[d.key]} onChange={(v) => setVals((s) => ({ ...s, [d.key]: v }))} />
        ))}
        <div className="card card-md" style={{ padding: '13px 15px 12px' }}>
          <label style={{ marginBottom: 10 }}>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything notable?" />
        </div>
      </div>

      {/* Fixed footer with live readiness */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, maxWidth: 460, margin: '0 auto', padding: '14px 18px calc(26px + env(safe-area-inset-bottom))', background: 'var(--footer-bg)', borderTop: '1px solid var(--border)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 12 }}>
          <div style={{ position: 'relative', width: 52, height: 52, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ring value={readiness.score} size={52} stroke={5} />
            <div style={{ position: 'absolute', fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>{readiness.score}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Readiness · {readiness.label}</div>
            <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--text-dim)', marginTop: 2 }}>{readiness.note}</div>
          </div>
        </div>
        <button className="btn btn-lg" onClick={save} disabled={saving || !loaded}>
          {saving ? <span className="spin" /> : <>Save check-in<span className="msr-fill" style={{ fontSize: 20 }}>check</span></>}
        </button>
      </div>
    </>
  );
}

function SliderCard({ icon, title, words, value, onChange }: { icon: string; title: string; words: string[]; value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pct = ((value - 1) / 4) * 100;

  const setFromX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let p = (clientX - rect.left) / rect.width;
    p = Math.max(0, Math.min(1, p));
    onChange(Math.round(p * 4) + 1);
  };

  return (
    <div className="card card-md" style={{ padding: '13px 15px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span className="msr-fill" style={{ fontSize: 18, color: 'var(--accent)' }}>{icon}</span>
        <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</div>
      </div>
      <div
        style={{ padding: '13px 3px 9px', touchAction: 'none', cursor: 'pointer' }}
        onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setFromX(e.clientX); }}
        onPointerMove={(e) => { if (dragging.current) setFromX(e.clientX); }}
        onPointerUp={() => { dragging.current = false; }}
      >
        <div ref={trackRef} style={{ position: 'relative', height: 6, borderRadius: 4, background: 'var(--track)' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 4, background: 'var(--accent)' }} />
          <div style={{ position: 'absolute', top: '50%', left: `${pct}%`, width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)', border: '2.5px solid var(--thumb-border)', boxShadow: '0 2px 7px -1px var(--accent-glow)', transform: 'translate(-50%,-50%)' }} />
        </div>
      </div>
      <div style={{ position: 'relative', height: 14 }}>
        {words.map((w, i) => {
          const on = i === value - 1;
          const left = i * 25;
          const tx = i === 0 ? 'translateX(0)' : i === 4 ? 'translateX(-100%)' : 'translateX(-50%)';
          return (
            <div key={i} style={{ position: 'absolute', top: 0, left: `${left}%`, transform: tx, fontSize: 10, fontWeight: on ? 700 : 500, letterSpacing: '-0.02em', whiteSpace: 'nowrap', color: on ? 'var(--accent)' : 'var(--text-faint)' }}>{w}</div>
          );
        })}
      </div>
    </div>
  );
}
