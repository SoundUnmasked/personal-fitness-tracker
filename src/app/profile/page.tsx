import Link from 'next/link';
import { prisma, dbTarget } from '@/lib/prisma';
import AppearanceToggle from '@/components/AppearanceToggle';
import NameEditor from '@/components/NameEditor';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const now = new Date();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));

  const [totalSessions, weekSessions, checkins, syncStates, goals, profile, firstGoal] = await Promise.all([
    prisma.session.count({ where: { status: 'completed' } }),
    prisma.session.count({ where: { status: 'completed', date: { gte: weekStart } } }),
    prisma.dailyCheckin.count(),
    prisma.syncState.findMany(),
    prisma.goal.count(),
    prisma.athleteProfile.findFirst(),
    prisma.goal.findFirst({ orderBy: { id: 'asc' } }),
  ]);

  const strava = syncStates.find((s) => s.source === 'strava');
  const withings = syncStates.find((s) => s.source === 'withings');
  const statusOf = (s?: { status: string } | null) => (s?.status === 'connected' ? 'Connected' : 'Not linked');

  let focus = 'General health & fitness';
  try {
    if (profile?.goalsJson) {
      const g = JSON.parse(profile.goalsJson) as { focus?: string };
      if (g.focus) focus = g.focus;
    }
  } catch { /* ignore */ }

  const name = profile?.name?.trim() || 'Athlete';
  const initial = (name[0] || 'A').toUpperCase();

  const streaks = [
    { value: String(weekSessions), label: 'this week' },
    { value: String(totalSessions), label: 'total sessions' },
    { value: String(checkins), label: 'check-ins' },
  ];

  return (
    <>
      <div className="topbar">
        <div className="h1">Profile</div>
        <div style={{ flex: 1 }} />
        <Link href="/sync" className="icon-btn dim"><span className="msr">settings</span></Link>
      </div>

      {/* Identity */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, borderRadius: 20 }}>
        <div style={{ width: 60, height: 60, flex: 'none', borderRadius: '50%', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>{initial}</div>
        <NameEditor initialName={name} subtitle={focus} />
      </div>

      {/* Streak stats */}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        {streaks.map((k) => (
          <div key={k.label} style={{ flex: 1, textAlign: 'center', padding: '13px 8px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-0.02em' }}>{k.value}</div>
            <div style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-faint)', marginTop: 3 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Data sources */}
      <div className="section-label">Data sources</div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SettingRow icon="directions_run" label="Strava" value={statusOf(strava)} good={strava?.status === 'connected'} href="/sync" />
        <SettingRow icon="monitor_weight" label="Withings" value={statusOf(withings)} good={withings?.status === 'connected'} href="/sync" />
        <SettingRow icon="photo_camera" label="InBody" value="Manual upload" href="/inbody" />
        <SettingRow icon="favorite" label="Health Connect / Samsung" value="Coming soon" />
      </div>

      {/* Training */}
      <div className="section-label">Training</div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SettingRow icon="flag" label="Goals" value={`${goals} set`} href="/metrics" />
        <SettingRow icon="fitness_center" label="Plan a session" value="" href="/plan/new" />
        <SettingRow icon="download" label="Export logbook" value="CSV · xlsx" href="/api/export?format=xlsx" />
      </div>

      {/* Preferences */}
      <div className="section-label">Appearance</div>
      <div className="card card-md">
        <AppearanceToggle />
      </div>

      <div className="section-label">Database</div>
      <div className="card card-md">
        <SettingRow icon="database" label="Storage" value={dbTarget === 'turso' ? 'Turso (cloud)' : 'Local SQLite'} plain />
      </div>

      <div style={{ height: 8 }} />
    </>
  );
}

function SettingRow({ icon, label, value, good, href, plain }: { icon: string; label: string; value: string; good?: boolean; href?: string; plain?: boolean }) {
  const inner = (
    <>
      <div style={{ width: 34, height: 34, flex: 'none', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'var(--accent)', background: 'var(--accent-soft)' }}>
        <span className="msr-fill">{icon}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{label}</div>
      {value && <div style={{ fontSize: 12.5, fontWeight: 600, color: good ? 'var(--accent)' : 'var(--text-dim)' }}>{value}</div>}
      {!plain && <span className="msr" style={{ fontSize: 19, color: 'var(--text-faint)' }}>chevron_right</span>}
    </>
  );
  const style: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderTop: '1px solid var(--border)' };
  if (href && !plain) return <Link href={href} style={style} className="setting-row">{inner}</Link>;
  return <div style={style} className="setting-row">{inner}</div>;
}
