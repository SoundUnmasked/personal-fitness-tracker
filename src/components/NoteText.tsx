'use client';

// Package R fix 3: long notes show a short portion with a "See full note"
// control that expands them in place. Shared by the logger, completed and
// preview views so truncation behaves identically everywhere.
import { useState } from 'react';

export default function NoteText({
  text,
  max = 120,
  style,
}: {
  text: string;
  max?: number;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const t = text ?? '';
  const long = t.length > max;
  // Truncate on a word boundary near the limit so we never cut mid-word.
  const cut = long && !open ? t.slice(0, max).replace(/\s+\S*$/, '').trimEnd() : t;

  return (
    <span style={{ whiteSpace: 'pre-wrap', ...style }}>
      {long && !open ? `${cut}… ` : t}
      {long && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((o) => !o); }}
          style={{ display: 'inline', padding: 0, border: 'none', background: 'transparent', color: 'var(--accent)', fontWeight: 700, fontSize: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {open ? 'Show less' : 'See full note'}
        </button>
      )}
    </span>
  );
}
