// Progress ring (readiness dial). Pure SVG — safe in server components.
export default function Ring({
  value,
  size = 92,
  stroke = 7,
  track = 'var(--track)',
  color = 'var(--accent)',
}: {
  value: number | null; // 0–100, null = empty track only
  size?: number;
  stroke?: number;
  track?: string;
  color?: string;
}) {
  const r = size / 2 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const dash = c * (1 - pct / 100);
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      {value != null && (
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={dash}
        />
      )}
    </svg>
  );
}
