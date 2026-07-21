// Collapsible warm-up / cool-down block for the session views. Server component
// (native <details>, no client JS) — styled with the Cobalt tokens. Renders the
// structured item list read-only: a check state per item plus planned/logged
// weight for weighted items.
import type { FlowItem } from '@/lib/flowItems';

export default function StructuredBlock({
  kind,
  items,
}: {
  kind: 'warmup' | 'cooldown';
  items: FlowItem[];
}) {
  if (!items.length) return null;
  const isWarm = kind === 'warmup';
  const doneCount = items.filter((i) => i.done).length;
  return (
    <details open style={{ marginTop: 14 }}>
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '13px 15px',
          borderRadius: 14,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <span className="msr-fill" style={{ fontSize: 19, color: 'var(--accent)' }} aria-hidden="true">
          {isWarm ? 'local_fire_department' : 'self_improvement'}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{isWarm ? 'Warm-up' : 'Cool-down'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            {doneCount}/{items.length} done · {isWarm ? 'before you start' : 'after the work'}
          </div>
        </div>
        <span className="msr chev" style={{ fontSize: 20, color: 'var(--text-faint)' }} aria-hidden="true">
          expand_more
        </span>
      </summary>
      <div style={{ padding: '10px 15px 4px' }}>
        {items.map((it, i) => {
          const weight = it.loggedWeightKg ?? it.weightKg ?? null;
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 0',
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
              }}
            >
              <span
                className="msr-fill"
                aria-hidden="true"
                style={{ fontSize: 18, color: it.done ? 'var(--accent)' : 'var(--text-faint)' }}
              >
                {it.done ? 'check_circle' : 'radio_button_unchecked'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{it.name}</div>
                {it.detail && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{it.detail}</div>
                )}
              </div>
              {weight != null && (
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                  {weight} kg
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
