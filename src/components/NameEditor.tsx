'use client';

import { useState } from 'react';
import { updateName } from '@/app/profile/actions';

// Inline name editor for the Profile identity card. Tap the pencil to edit.
export default function NameEditor({ initialName, subtitle }: { initialName: string; subtitle?: string }) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await updateName(draft);
    if (res.ok) setName(res.name || 'Athlete');
    setSaving(false);
    setEditing(false);
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Your name"
          autoFocus
          style={{ fontSize: 17, fontWeight: 700, padding: '8px 10px' }}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        />
        <button className="btn-sm" style={{ background: 'var(--accent)', color: 'var(--on-accent)', flex: 'none' }} onClick={save} disabled={saving}>
          {saving ? <span className="spin" /> : 'Save'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>{name || 'Athlete'}</div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-dim)', marginTop: 3 }}>{subtitle ?? 'Tap the pencil to edit'}</div>
      </div>
      <button className="icon-btn dim" style={{ width: 36, height: 36, flex: 'none' }} onClick={() => { setDraft(name); setEditing(true); }} aria-label="Edit name">
        <span className="msr">edit</span>
      </button>
    </div>
  );
}
