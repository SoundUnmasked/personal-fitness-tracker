import type { EnergyBucket } from '@/lib/dashboard';

// Simple bar chart of average energy (1-5) by time of day.
export default function EnergyChart({ buckets }: { buckets: EnergyBucket[] }) {
  const hasData = buckets.some((b) => b.avg != null);
  if (!hasData) {
    return <p className="empty">Log a few check-ins to see energy by time of day.</p>;
  }
  const W = 600;
  const H = 180;
  const pad = { l: 28, r: 12, t: 12, b: 28 };
  const max = 5;
  const bw = (W - pad.l - pad.r) / buckets.length;

  const colors = ['#fbbf24', '#60a5fa', '#a78bfa'];

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Energy by time of day">
      {[1, 2, 3, 4, 5].map((v) => {
        const py = pad.t + (1 - v / max) * (H - pad.t - pad.b);
        return (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={py} y2={py} stroke="#2c2c3e" strokeWidth="1" />
            <text x={4} y={py + 4} fill="#9090b0" fontSize="10">{v}</text>
          </g>
        );
      })}
      {buckets.map((b, i) => {
        const cx = pad.l + bw * i + bw / 2;
        const val = b.avg ?? 0;
        const barH = (val / max) * (H - pad.t - pad.b);
        const top = H - pad.b - barH;
        return (
          <g key={b.label}>
            {b.avg != null && (
              <>
                <rect x={cx - bw * 0.3} y={top} width={bw * 0.6} height={barH} rx="4" fill={colors[i % colors.length]} opacity="0.85" />
                <text x={cx} y={top - 5} fill="#e8e6f2" fontSize="11" textAnchor="middle">
                  {val.toFixed(1)}
                </text>
              </>
            )}
            <text x={cx} y={H - 8} fill="#9090b0" fontSize="11" textAnchor="middle">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
