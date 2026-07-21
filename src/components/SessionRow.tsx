'use client';

// Calendar / list session row. A tap on the row opens the session; the overflow
// button opens the Move / Duplicate / Delete actions (Package G). Kept as a
// client component so the row can carry an interactive overflow control without
// nesting a button inside a navigation link.
import { useRouter } from 'next/navigation';
import SessionActions from './SessionActions';

const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export default function SessionRow({
  id, dateIso, type, title, status, summary, durationMin, isToday,
}: {
  id: number;
  dateIso: string; // YYYY-MM-DD
  type: string;
  title: string | null;
  status: 'planned' | 'completed';
  summary: string;
  durationMin?: number | null;
  isToday: boolean;
}) {
  const router = useRouter();
  const d = new Date(dateIso);
  const done = status === 'completed';
  const statusLabel = done ? 'Done' : isToday ? 'Log' : 'Planned';

  return (
    <div
      className="list-row"
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/plan/${id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/plan/${id}`); }}
      style={{ cursor: 'pointer', borderLeft: `3px solid ${isToday ? 'var(--accent)' : done ? 'var(--accent-soft2)' : 'var(--border)'}` }}
    >
      <div style={{ width: 42, flex: 'none', textAlign: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: isToday ? 'var(--accent)' : 'var(--text-faint)' }}>{DOW[(d.getDay() + 6) % 7]}</div>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 1 }}>{String(d.getDate()).padStart(2, '0')}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || `${type} session`}</div>
          {isToday && <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 7px', borderRadius: 6, background: 'var(--accent)', color: 'var(--on-accent)', flex: 'none' }}>TODAY</div>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
          <div className="type-chip">{type.toUpperCase()}</div>
          {summary && <div className="chip" style={{ cursor: 'default' }}>{summary}</div>}
          {durationMin ? <div className="chip" style={{ cursor: 'default' }}><span className="msr">schedule</span>{durationMin}m</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        <div style={{ padding: '4px 10px', borderRadius: 9, fontSize: 11, fontWeight: 700, background: done ? 'var(--ok-tint)' : isToday ? 'var(--accent)' : 'var(--surface-strong)', color: done ? 'var(--accent)' : isToday ? 'var(--on-accent)' : 'var(--text-faint)' }}>{statusLabel}</div>
        <SessionActions sessionId={id} dateIso={dateIso} title={title ?? ''} type={type} status={status} variant="list" />
      </div>
    </div>
  );
}
