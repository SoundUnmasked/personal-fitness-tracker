// Collapsible warm-up / cool-down block for the read-only session views. Server
// component (native <details>, no client JS), styled with the Cobalt tokens and
// deliberately LIGHTER than the exercise cards so the two blocks read as
// bookends rather than work sets (item 5).
//
// Structured items render as a compact list (one line each, with a check state
// and any weight). A legacy plain string renders as readable prose with its line
// breaks preserved, never as a single dense row.
import { readFlow } from '@/lib/flowItems';

export default function StructuredBlock({
  kind,
  raw,
}: {
  kind: 'warmup' | 'cooldown';
  raw: string | null;
}) {
  const { items, legacyText } = readFlow(raw);
  if (!items.length && !legacyText) return null;

  const isWarm = kind === 'warmup';
  const doneCount = items.filter((i) => i.done).length;
  const sub = items.length
    ? `${doneCount}/${items.length} done · ${isWarm ? 'before you start' : 'after the work'}`
    : isWarm
      ? 'before you start'
      : 'after the work';

  return (
    <details open style={{ marginTop: 14 }}>
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '11px 14px',
          borderRadius: 13,
          background: 'var(--last-bg)',
          border: '1px solid var(--border)',
        }}
      >
        <span className="msr-fill" style={{ fontSize: 18, color: 'var(--accent)' }} aria-hidden="true">
          {isWarm ? 'local_fire_department' : 'self_improvement'}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{isWarm ? 'Warm-up' : 'Cool-down'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{sub}</div>
        </div>
        <span className="msr chev" style={{ fontSize: 20, color: 'var(--text-faint)' }} aria-hidden="true">
          expand_more
        </span>
      </summary>

      {legacyText ? (
        // Legacy free text: readable prose, existing line breaks preserved.
        <div
          style={{
            padding: '11px 15px 4px',
            fontSize: 13,
            lineHeight: 1.6,
            color: 'var(--text-dim)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {legacyText}
        </div>
      ) : (
        <div style={{ padding: '8px 14px 4px' }}>
          {items.map((it, i) => {
            const weight = it.loggedWeightKg ?? it.weightKg ?? null;
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 0',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                <span
                  className="msr-fill"
                  aria-hidden="true"
                  style={{ fontSize: 17, color: it.done ? 'var(--accent)' : 'var(--text-faint)' }}
                >
                  {it.done ? 'check_circle' : 'radio_button_unchecked'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{it.name}</div>
                  {it.detail && <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{it.detail}</div>}
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
      )}
    </details>
  );
}
