import Link from 'next/link';
import { getHomeData } from '@/lib/home';
import Ring from '@/components/Ring';

export const dynamic = 'force-dynamic';

// Weight shows a decimal only when one exists: 78.4 kg, 78 kg (not 78.0).
function fmtKg(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

export default async function Home() {
  const d = await getHomeData();
  const now = new Date();
  const hour = now.getHours();
  const base = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const greeting = d.firstName ? `${base}, ${d.firstName}` : base;
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', ' ·');
  const r = d.readiness;
  const avatarInitial = (d.firstName?.[0] || 'A').toUpperCase();

  return (
    <div className="app-flat">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 2px 6px' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>{dateStr}</div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 3, color: 'var(--text-1)' }}>{greeting}</div>
        </div>
        <Link
          href="/profile"
          style={{
            width: 42, height: 42, borderRadius: '50%', background: 'var(--surface-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 600, fontSize: 15, color: 'var(--text-1)',
          }}
        >
          {avatarInitial}
        </Link>
      </div>

      {/* Readiness hero */}
      <Link href="/checkin" className="card" style={{ display: 'block', padding: '16px 16px 15px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>Readiness</div>
            {r.hasData ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 6 }}>
                  <div style={{ fontSize: 52, lineHeight: 0.85, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--text-1)' }}>{r.score}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-3)' }}>/100</div>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 11, padding: '4px 9px', borderRadius: 8, background: 'var(--accent-soft)', fontSize: 12, fontWeight: 600, color: 'var(--accent-text)' }}>
                  {r.label}
                </div>
              </>
            ) : (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 40, lineHeight: 0.9, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--text-3)' }}>·</div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 8, maxWidth: 190 }}>Check in to set today&apos;s readiness.</div>
              </div>
            )}
          </div>
          <div style={{ position: 'relative', width: 92, height: 92, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ring value={r.score} size={92} />
            <div style={{ position: 'absolute', display: 'flex', fontSize: 24, color: 'var(--accent)' }}>
              <span className="msr-fill">bolt</span>
            </div>
          </div>
        </div>
        {r.hasData && <div style={{ fontSize: 13, lineHeight: 1.35, marginTop: 7, color: 'var(--text-2)' }}>{r.note}</div>}
        {/* mini readiness bars: only the latest reads as current (accent), the
            rest sit quiet on a raised surface so accent stays scarce. */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 22, marginTop: 11 }}>
          {(d.bars.length ? d.bars : [0, 0, 0, 0, 0, 0, 0]).slice(-7).map((v, i, arr) => (
            <div
              key={i}
              style={{
                flex: 1, height: `${Math.max(8, v)}%`, minHeight: 5, borderRadius: 3,
                background: v === 0 ? 'var(--surface-3)' : i === arr.length - 1 ? 'var(--accent)' : 'var(--surface-3)',
              }}
            />
          ))}
        </div>
        {r.subjectiveOnly && r.hasData && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
            From your check-in · wearable HRV/sleep not linked yet
          </div>
        )}
      </Link>

      {/* Stat tiles */}
      <div className="stat-row" style={{ marginTop: 10 }}>
        <StatTile label="Sleep" value={d.sleepHours != null ? String(d.sleepHours) : '·'} unit={d.sleepHours != null ? 'h' : ''} placeholder={d.sleepHours == null} hint={d.sleepHours == null ? 'from check-in' : undefined} />
        <StatTile label="HRV" value="·" unit="" placeholder hint="link wearable" />
        <StatTile label="Weight" value={d.weightKg != null ? fmtKg(d.weightKg) : '·'} unit={d.weightKg != null ? 'kg' : ''} placeholder={d.weightKg == null} hint={d.weightKg == null ? 'no scan yet' : (d.weightSource ?? undefined)?.toLowerCase()} />
      </div>

      {/* This week */}
      <Link href="/plan" className="card" style={{ display: 'block', marginTop: 10, padding: '15px 15px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>This week</div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>{d.weekDone} done · {d.weekPlanned} planned</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
          {d.days.map((day, i) => (
            <WeekPill key={i} day={day} />
          ))}
        </div>
      </Link>

      {/* Today's / next session */}
      {d.focusSession ? (
        <div className="card" style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>
                {d.focusSession.isToday ? 'Today' : 'Next session'}
              </div>
              <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 5, color: 'var(--text-1)' }}>
                {d.focusSession.title || `${d.focusSession.type} session`}
              </div>
              <div style={{ fontSize: 13, marginTop: 3, color: 'var(--text-2)' }}>
                {d.focusSession.exercises} exercise{d.focusSession.exercises === 1 ? '' : 's'} · {d.focusSession.type}
              </div>
            </div>
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-3)' }}>Logged</div>
              <div style={{ fontSize: 17, fontWeight: 600, marginTop: 4, color: 'var(--text-1)' }}>{d.focusSession.loggedSets}</div>
            </div>
          </div>
          {d.focusSession.movementNames.length > 0 && (
            <div style={{ display: 'flex', gap: 6, margin: '11px 0 12px', flexWrap: 'wrap' }}>
              {d.focusSession.movementNames.map((n) => (
                <span key={n} style={chipStyle}>{n}</span>
              ))}
              {d.focusSession.moreCount > 0 && <span style={chipStyle}>+{d.focusSession.moreCount} more</span>}
            </div>
          )}
          <Link href={`/plan/${d.focusSession.id}`} className="btn">
            <span className="msr-fill" style={{ fontSize: 21 }}>play_arrow</span>
            {d.focusSession.loggedSets > 0 ? 'Resume session' : 'Open session'}
          </Link>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>No session planned</div>
          <div style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 12px', color: 'var(--text-1)' }}>Plan your next workout</div>
          <Link href="/plan/new" className="btn">
            <span className="msr-fill" style={{ fontSize: 20 }}>add</span>Plan a session
          </Link>
        </div>
      )}
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 10px',
  borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text-2)',
  fontSize: 11, fontWeight: 600,
};

function StatTile({ label, value, unit, placeholder, hint }: { label: string; value: string; unit: string; placeholder?: boolean; hint?: string }) {
  return (
    <div className="tile">
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 8 }}>
        <div className="num" style={{ color: placeholder ? 'var(--text-3)' : 'var(--text-1)' }}>{value}</div>
        {unit && <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-2)' }}>{unit}</div>}
      </div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function WeekPill({ day }: { day: { letter: string; state: string; label?: string } }) {
  const base: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, padding: '9px 4px 10px', minHeight: 64, flex: 1,
  };
  // Accent marks the current day only; done/planned/rest differ by surface,
  // shape and weight, not colour.
  let style: React.CSSProperties = { ...base };
  let letterColor = 'var(--text-2)';
  if (day.state === 'today') {
    style = { ...base, flex: 1.9, background: 'var(--surface-2)', border: '1.5px solid var(--accent)', padding: '9px 6px 10px' };
    letterColor = 'var(--accent-text)';
  } else if (day.state === 'done') {
    style = { ...base, background: 'var(--surface-1)' };
    letterColor = 'var(--text-1)';
  } else if (day.state === 'rest') {
    style = { ...base, background: 'transparent', border: '1px dashed var(--hairline)' };
    letterColor = 'var(--text-3)';
  } else {
    style = { ...base, background: 'var(--surface-1)' };
  }
  return (
    <div style={style}>
      <div style={{ fontSize: 12, fontWeight: 600, color: letterColor }}>{day.letter}</div>
      {day.state === 'today' && day.label && (
        <div style={{ fontSize: 8.5, fontWeight: 600, color: 'var(--accent-text)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 52 }}>
          {day.label}
        </div>
      )}
      {day.state === 'done' && <span className="msr-fill" style={{ fontSize: 15, color: 'var(--text-2)' }}>check</span>}
      {day.state === 'planned' && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-3)' }} />}
    </div>
  );
}
