// Collapsible warm-up / cool-down block for the session views. Server component
// (native <details>, no client JS) — styled with the Cobalt tokens.
export default function StructuredBlock({
  kind,
  text,
}: {
  kind: 'warmup' | 'cooldown';
  text: string;
}) {
  const isWarm = kind === 'warmup';
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
            {isWarm ? 'Before you start' : 'After the work'}
          </div>
        </div>
        <span className="msr chev" style={{ fontSize: 20, color: 'var(--text-faint)' }} aria-hidden="true">
          expand_more
        </span>
      </summary>
      <div
        style={{
          padding: '12px 15px 4px',
          fontSize: 13.5,
          lineHeight: 1.5,
          color: 'var(--text-dim)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </details>
  );
}
