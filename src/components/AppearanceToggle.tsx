'use client';

import { useEffect, useState } from 'react';

type Choice = 'auto' | 'light' | 'dark';

// Light / dark / auto switch. Persists to localStorage and sets [data-theme] on
// <html> (auto = follow the OS via the CSS prefers-color-scheme fallback).
export default function AppearanceToggle() {
  const [choice, setChoice] = useState<Choice>('auto');

  useEffect(() => {
    try {
      const t = localStorage.getItem('theme');
      setChoice(t === 'light' || t === 'dark' ? t : 'auto');
    } catch { /* ignore */ }
  }, []);

  function apply(next: Choice) {
    setChoice(next);
    try {
      if (next === 'auto') {
        localStorage.removeItem('theme');
        document.documentElement.removeAttribute('data-theme');
      } else {
        localStorage.setItem('theme', next);
        document.documentElement.setAttribute('data-theme', next);
      }
    } catch { /* ignore */ }
  }

  const opts: { key: Choice; icon: string; label: string }[] = [
    { key: 'auto', icon: 'contrast', label: 'Auto' },
    { key: 'light', icon: 'light_mode', label: 'Light' },
    { key: 'dark', icon: 'dark_mode', label: 'Dark' },
  ];

  return (
    <div className="seg" style={{ marginTop: 2 }}>
      {opts.map((o) => (
        <button key={o.key} className={`seg-item ${choice === o.key ? 'active' : ''}`} onClick={() => apply(o.key)}>
          <span className="msr" style={{ fontSize: 16 }}>{o.icon}</span>{o.label}
        </button>
      ))}
    </div>
  );
}
