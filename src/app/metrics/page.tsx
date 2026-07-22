import Link from 'next/link';
import { getDashboardData } from '@/lib/dashboard';
import BodyCompChart from '@/components/BodyCompChart';

export const dynamic = 'force-dynamic';

export default async function MetricsPage() {
  const d = await getDashboardData();
  const points = [...d.withingsPoints, ...d.inbodyPoints].filter((p) => p.weightKg != null).sort((a, b) => a.t - b.t);
  const latest = points.at(-1);
  const first = points[0];
  const delta = latest && first && points.length > 1 ? (latest.weightKg! - first.weightKg!) : null;
  const latestInbody = d.inbodyPoints.at(-1);

  return (
    <>
      <div className="topbar">
        <div>
          <div className="h1">Progress</div>
          <div className="sub">Your real logged data</div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Scan capture lives here now (L1) — the "+" tab opens the daily loop. */}
        <Link
          href="/inbody"
          className="btn-sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 44, borderRadius: 13, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)', textDecoration: 'none' }}
        >
          <span className="msr-fill" style={{ fontSize: 18 }} aria-hidden="true">photo_camera</span>
          Add a scan
        </Link>
      </div>

      {/* Body weight */}
      <div className="card" style={{ borderRadius: 22 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="msr-fill" style={{ fontSize: 16, color: 'var(--accent)' }}>monitor_weight</span>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)' }}>Body weight</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
              <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em' }}>{latest ? latest.weightKg!.toFixed(1) : '·'}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)' }}>kg</div>
            </div>
          </div>
          {delta != null && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 20, background: 'var(--accent-soft)', fontSize: 12.5, fontWeight: 700, color: 'var(--accent)' }}>
              {delta <= 0 ? '▼' : '▲'} {Math.abs(delta).toFixed(1)} kg
            </div>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <BodyCompChart inbody={d.inbodyPoints} withings={d.withingsPoints} />
        </div>
      </div>

      {/* Real metric tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11, marginTop: 12 }}>
        <MetricTile icon="percent" label="Body fat" value={latestInbody?.bodyFatPct != null ? latestInbody.bodyFatPct.toFixed(1) : '·'} unit="%" placeholder={latestInbody?.bodyFatPct == null} />
        <MetricTile icon="fitness_center" label="Muscle mass" value={latestInbody?.skeletalMuscleMassKg != null ? latestInbody.skeletalMuscleMassKg.toFixed(1) : '·'} unit="kg" placeholder={latestInbody?.skeletalMuscleMassKg == null} />
        <MetricTile icon="calendar_month" label="Sessions logged" value={String(d.counts.sessions)} unit="" />
        <MetricTile icon="check_circle" label="Check-ins" value={String(d.counts.checkins)} unit="" />
      </div>

      {/* Placeholder: sources not wired yet */}
      <div className="card card-md" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="msr" style={{ fontSize: 18, color: 'var(--text-faint)' }}>pending</span>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Coming with wearables</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
          VO₂ max, HRV, resting HR and weekly running volume appear here once Health Connect / Samsung sync is connected.
        </div>
      </div>

      {/* Goals */}
      <div className="section-head"><div className="h2">Goals</div></div>
      {d.goals.length === 0 ? (
        <div className="card"><div className="empty">No goals set.</div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {d.goals.map((g, i) => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 15px', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{g.name}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)' }}>
                {g.currentValue ?? '·'}{g.targetValue != null ? ` / ${g.targetValue}` : ''}{g.unit ? ` ${g.unit}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-head"><div className="h2">Export</div></div>
      <div className="fab-row">
        <a className="btn" href="/api/export?format=xlsx" download><span className="msr-fill" style={{ fontSize: 18 }}>download</span>Excel</a>
        <a className="btn btn-secondary" href="/api/export?format=csv" download><span className="msr-fill" style={{ fontSize: 18 }}>download</span>CSV</a>
      </div>
      <div style={{ height: 8 }} />
    </>
  );
}

function MetricTile({ icon, label, value, unit, placeholder }: { icon: string; label: string; value: string; unit: string; placeholder?: boolean }) {
  return (
    <div className="tile" style={{ borderRadius: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="msr-fill" style={{ fontSize: 15, color: 'var(--accent)' }}>{icon}</span>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-dim)' }}>{label}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 9 }}>
        <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', color: placeholder ? 'var(--text-faint)' : 'var(--text)' }}>{value}</div>
        {unit && <div style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-faint)' }}>{unit}</div>}
      </div>
    </div>
  );
}
