'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isoDate } from '@/lib/format';

interface Extracted {
  date: string | null;
  weight_kg: number | null;
  body_fat_pct: number | null;
  skeletal_muscle_mass_kg: number | null;
  visceral_fat: number | null;
  bmr: number | null;
  raw: Record<string, unknown>;
}

export default function CapturePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [form, setForm] = useState({
    date: isoDate(new Date()), weightKg: '', bodyFatPct: '', skeletalMuscleMassKg: '', visceralFat: '', bmr: '',
  });

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f); setError(null); setExtracted(null);
    if (f) setPreview(URL.createObjectURL(f));
  }

  async function extract() {
    if (!file) return;
    setExtracting(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const res = await fetch('/api/inbody/extract', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.configured === false
          ? 'Anthropic API key not set yet. Add ANTHROPIC_API_KEY to .env, then retry. You can still enter values manually below.'
          : data.error || 'Extraction failed');
      }
      const ex: Extracted = data.extracted;
      setExtracted(ex);
      setForm({
        date: ex.date || isoDate(new Date()),
        weightKg: ex.weight_kg?.toString() ?? '',
        bodyFatPct: ex.body_fat_pct?.toString() ?? '',
        skeletalMuscleMassKg: ex.skeletal_muscle_mass_kg?.toString() ?? '',
        visceralFat: ex.visceral_fat?.toString() ?? '',
        bmr: ex.bmr?.toString() ?? '',
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/body-composition', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'InBody', date: form.date,
          weightKg: form.weightKg || null, bodyFatPct: form.bodyFatPct || null,
          skeletalMuscleMassKg: form.skeletalMuscleMassKg || null,
          visceralFat: form.visceralFat || null, bmr: form.bmr || null,
          raw: extracted ?? { manual: true },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      // Scan capture is entered from Metrics ("Add a scan", L1) — return there
      // so the new checkpoint is visible immediately.
      router.push('/metrics');
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, padding: '10px 2px 8px' }}>
        <button className="icon-btn" onClick={() => router.push('/metrics')} aria-label="Close"><span className="msr">close</span></button>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ marginTop: 2, paddingBottom: 120 }}>
        <div className="eyebrow eyebrow-accent">CAPTURE</div>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', marginTop: 8 }}>Add to your log</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--text-dim)', marginTop: 8 }}>
          Snap an InBody scan (Claude reads the numbers), or enter them by hand below. Kept as an accurate checkpoint, separate from the Withings trend, never averaged.
        </div>

        {error && <div className="note note-err" style={{ marginTop: 16 }}>{error}</div>}

        {/* Drop / preview zone */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} style={{ display: 'none' }} />
        <div
          onClick={() => fileRef.current?.click()}
          style={{ marginTop: 18, height: preview ? 'auto' : 196, borderRadius: 18, border: '1.5px dashed var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden' }}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="preview" style={{ width: '100%', display: 'block' }} />
          ) : (
            <>
              <span className="msr" style={{ fontSize: 34, color: 'var(--text-faint)' }}>add_photo_alternate</span>
              <div style={{ fontSize: 13, color: 'var(--text-faint)', marginTop: 8 }}>Drop a scan, screenshot or photo</div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
            <span className="msr-fill" style={{ fontSize: 22 }}>photo_camera</span>Take photo
          </button>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
            <span className="msr-fill" style={{ fontSize: 22 }}>image</span>Choose file
          </button>
        </div>

        {file && !extracted && (
          <button className="btn" style={{ marginTop: 12 }} onClick={extract} disabled={extracting}>
            {extracting ? <span className="spin" /> : <><span className="msr-fill" style={{ fontSize: 20 }}>auto_awesome</span>Extract with Claude</>}
          </button>
        )}

        {/* confirm / edit values */}
        <div className="section-head"><div className="h2">Values {extracted ? '· confirm' : '· manual'}</div></div>
        <div className="card card-md">
          <div className="row">
            <div className="field" style={{ margin: 0 }}><label>Date</label><input type="date" value={form.date} onChange={set('date')} /></div>
            <div className="field" style={{ margin: 0 }}><label>Weight (kg)</label><input type="number" inputMode="decimal" value={form.weightKg} onChange={set('weightKg')} /></div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <div className="field" style={{ margin: 0 }}><label>Body fat (%)</label><input type="number" inputMode="decimal" value={form.bodyFatPct} onChange={set('bodyFatPct')} /></div>
            <div className="field" style={{ margin: 0 }}><label>SMM (kg)</label><input type="number" inputMode="decimal" value={form.skeletalMuscleMassKg} onChange={set('skeletalMuscleMassKg')} /></div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <div className="field" style={{ margin: 0 }}><label>Visceral fat</label><input type="number" inputMode="decimal" value={form.visceralFat} onChange={set('visceralFat')} /></div>
            <div className="field" style={{ margin: 0 }}><label>BMR (kcal)</label><input type="number" inputMode="numeric" value={form.bmr} onChange={set('bmr')} /></div>
          </div>
        </div>
      </div>

      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, maxWidth: 460, margin: '0 auto', padding: '14px 18px calc(26px + env(safe-area-inset-bottom))', background: 'var(--footer-bg)', borderTop: '1px solid var(--border)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}>
        <button className="btn btn-lg" onClick={save} disabled={saving}>
          {saving ? <span className="spin" /> : <>Save to log<span className="msr-fill" style={{ fontSize: 20 }}>check</span></>}
        </button>
      </div>
    </>
  );
}
