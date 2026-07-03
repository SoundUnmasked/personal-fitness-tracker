import type { BodyPoint } from '@/lib/dashboard';

// Plots weight (kg) over time. Withings = continuous trend LINE; InBody =
// discrete checkpoint DOTS. The two series are drawn together but NEVER
// averaged — they share axes only. Themed with the Cobalt accent.
export default function BodyCompChart({
  inbody,
  withings,
}: {
  inbody: BodyPoint[];
  withings: BodyPoint[];
}) {
  const W = 600;
  const H = 200;
  const pad = { l: 34, r: 12, t: 12, b: 22 };

  const all = [...inbody, ...withings].filter((p) => p.weightKg != null);
  if (all.length === 0) {
    return <p className="empty">No body-composition data yet — add an InBody or sync Withings.</p>;
  }

  const ts = all.map((p) => p.t);
  const ws = all.map((p) => p.weightKg as number);
  let minT = Math.min(...ts);
  let maxT = Math.max(...ts);
  if (minT === maxT) { minT -= 86_400_000; maxT += 86_400_000; }
  const minW = Math.floor(Math.min(...ws) - 1);
  const maxW = Math.ceil(Math.max(...ws) + 1);

  const x = (t: number) => pad.l + ((t - minT) / (maxT - minT)) * (W - pad.l - pad.r);
  const y = (w: number) => pad.t + (1 - (w - minW) / (maxW - minW)) * (H - pad.t - pad.b);

  const wPts = withings.filter((p) => p.weightKg != null);
  const withingsPath = wPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t)} ${y(p.weightKg as number)}`).join(' ');
  const areaPath = withingsPath ? `${withingsPath} L ${x(wPts[wPts.length - 1].t)} ${H - pad.b} L ${x(wPts[0].t)} ${H - pad.b} Z` : '';

  const ticks = 4;
  const gridY = Array.from({ length: ticks + 1 }, (_, i) => {
    const w = minW + ((maxW - minW) * i) / ticks;
    return { w, py: y(w) };
  });

  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Body weight trend" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="bc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridY.map((g) => (
          <g key={g.w}>
            <line x1={pad.l} x2={W - pad.r} y1={g.py} y2={g.py} style={{ stroke: 'var(--border)' }} strokeWidth="1" />
            <text x={2} y={g.py + 3} style={{ fill: 'var(--text-faint)' }} fontSize="10">{g.w.toFixed(0)}</text>
          </g>
        ))}
        {areaPath && <path d={areaPath} fill="url(#bc-fill)" />}
        {withingsPath && <path d={withingsPath} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {wPts.map((p) => (
          <circle key={`w-${p.t}`} cx={x(p.t)} cy={y(p.weightKg as number)} r="2.5" style={{ fill: 'var(--accent)' }} />
        ))}
        {inbody.filter((p) => p.weightKg != null).map((p) => (
          <circle key={`i-${p.t}`} cx={x(p.t)} cy={y(p.weightKg as number)} r="5" style={{ fill: 'var(--accent)', stroke: 'var(--bg)' }} strokeWidth="2.5" />
        ))}
      </svg>
      <div className="legend">
        <span><span className="dot" style={{ background: 'var(--accent)' }} /> Withings (daily trend)</span>
        <span><span className="dot" style={{ background: 'var(--accent)', outline: '2px solid var(--bg)' }} /> InBody (checkpoint)</span>
      </div>
    </div>
  );
}
