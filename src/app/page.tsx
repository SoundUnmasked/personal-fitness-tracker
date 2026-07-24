import Link from 'next/link';
import { getHomeData } from '@/lib/home';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const d = await getHomeData();
  const now = new Date();
  const hour = now.getHours();
  const base = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const greeting = d.firstName ? `${base}, ${d.firstName}` : base;
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', ' ·');
  const avatarInitial = (d.firstName?.[0] || 'A').toUpperCase();

  return (
    <div className="app-flat">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 2px 10px' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>{dateStr}</div>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 3, color: 'var(--text-1)' }}>{greeting}</div>
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

      {/* This week */}
      <Link href="/plan" className="card" style={{ display: 'block', marginTop: 8, padding: '15px 15px 16px' }}>
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
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>
                {d.focusSession.isToday ? 'Today' : 'Next session'}
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 5, color: 'var(--text-1)' }}>
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
        <div className="card" style={{ marginTop: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)' }}>No session planned</div>
          <div style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 12px', color: 'var(--text-1)' }}>Plan your next workout</div>
          <Link href="/plan/new" className="btn">
            <span className="msr-fill" style={{ fontSize: 20 }}>add</span>Plan a session
          </Link>
        </div>
      )}

      {/* Connected data: an honest empty slot for the one real (scaffolded)
          integration. No numbers, no fake trend, just the connect affordance. */}
      <Link
        href="/sync"
        style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: '14px 15px', borderRadius: 'var(--radius-card)', border: '1px dashed var(--hairline)', color: 'var(--text-1)' }}
      >
        <span className="msr" style={{ fontSize: 22, color: 'var(--text-3)' }} aria-hidden="true">directions_run</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Strava</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Connect to sync your runs</div>
        </div>
        <span style={{ ...chipStyle, background: 'var(--surface-2)', color: 'var(--accent-text)' }}>Connect</span>
      </Link>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 10px',
  borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text-2)',
  fontSize: 11, fontWeight: 600,
};

function WeekPill({ day }: { day: { letter: string; state: string; label?: string } }) {
  const bcolor: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, padding: '9px 4px 10px', minHeight: 64, flex: 1,
  };
  // Accent marks the current day only; done/planned/rest differ by surface,
  // shape and weight, not colour.
  let style: React.CSSProperties = { ...bcolor };
  let letterColor = 'var(--text-2)';
  if (day.state === 'today') {
    style = { ...bcolor, flex: 1.9, background: 'var(--surface-2)', border: '1.5px solid var(--accent)', padding: '9px 6px 10px' };
    letterColor = 'var(--accent-text)';
  } else if (day.state === 'done') {
    style = { ...bcolor, background: 'var(--surface-1)' };
    letterColor = 'var(--text-1)';
  } else if (day.state === 'rest') {
    style = { ...bcolor, background: 'transparent', border: '1px dashed var(--hairline)' };
    letterColor = 'var(--text-3)';
  } else {
    style = { ...bcolor, background: 'var(--surface-1)' };
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
