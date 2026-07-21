import Link from 'next/link';
import { getHomeData } from '@/lib/home';
import Ring from '@/components/Ring';

export const dynamic = 'force-dynamic';

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
    <>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 2px 6px' }}>
        <div>
          <div className="eyebrow">{dateStr}</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 3 }}>{greeting}</div>
        </div>
        <Link
          href="/profile"
          style={{
            width: 42, height: 42, borderRadius: '50%', background: 'var(--surface-strong)',
            border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 600, fontSize: 15, position: 'relative',
          }}
        >
          {avatarInitial}
          <span style={{ position: 'absolute', top: -1, right: -1, width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--bg)' }} />
        </Link>
      </div>

      {/* Readiness hero */}
      <Link href="/checkin" className="card" style={{ display: 'block', borderRadius: 26, padding: '16px 16px 15px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">READINESS</div>
            {r.hasData ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 6 }}>
                  <div style={{ fontSize: 52, lineHeight: 0.85, fontWeight: 700, letterSpacing: '-0.035em' }}>{r.score}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-faint)' }}>/100</div>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 11, padding: '4px 9px', borderRadius: 20, background: 'var(--accent-soft)', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
                  {r.label}
                </div>
              </>
            ) : (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 40, lineHeight: 0.9, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text-faint)' }}>·</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 8, maxWidth: 190 }}>Check in to set today&apos;s readiness.</div>
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
        {r.hasData && <div style={{ fontSize: 13, lineHeight: 1.35, marginTop: 7, color: 'var(--text-dim)' }}>{r.note}</div>}
        {/* mini readiness bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 22, marginTop: 11 }}>
          {(d.bars.length ? d.bars : [0, 0, 0, 0, 0, 0, 0]).slice(-7).map((v, i, arr) => (
            <div
              key={i}
              style={{
                flex: 1, height: `${Math.max(8, v)}%`, minHeight: 5, borderRadius: 3,
                background: v === 0 ? 'var(--track)' : i === arr.length - 1 ? 'var(--accent)' : 'var(--accent-soft2)',
              }}
            />
          ))}
        </div>
        {r.subjectiveOnly && r.hasData && (
          <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 8 }}>
            From your check-in · wearable HRV/sleep not linked yet
          </div>
        )}
      </Link>

      {/* Stat tiles */}
      <div className="stat-row" style={{ marginTop: 10 }}>
        <StatTile label="SLEEP" value={d.sleepHours != null ? String(d.sleepHours) : '·'} unit={d.sleepHours != null ? 'h' : ''} placeholder={d.sleepHours == null} hint={d.sleepHours == null ? 'from check-in' : undefined} />
        <StatTile label="HRV" value="·" unit="" placeholder hint="link wearable" />
        <StatTile label="WEIGHT" value={d.weightKg != null ? d.weightKg.toFixed(1) : '·'} unit={d.weightKg != null ? 'kg' : ''} placeholder={d.weightKg == null} hint={d.weightKg == null ? 'no scan yet' : (d.weightSource ?? undefined)?.toLowerCase()} />
      </div>

      {/* This week */}
      <Link href="/plan" className="card" style={{ display: 'block', borderRadius: 22, marginTop: 10, padding: '15px 15px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>This week</div>
          <div className="eyebrow" style={{ letterSpacing: '0.08em', fontSize: 10 }}>{d.weekDone} DONE · {d.weekPlanned} PLANNED</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
          {d.days.map((day, i) => (
            <WeekPill key={i} day={day} />
          ))}
        </div>
      </Link>

      {/* Today's / next session */}
      {d.focusSession ? (
        <div className="card" style={{ borderRadius: 24, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="eyebrow eyebrow-accent" style={{ fontSize: 9.5, letterSpacing: '0.12em' }}>
                {d.focusSession.isToday ? "TODAY'S SESSION" : 'NEXT SESSION'}
              </div>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 5 }}>
                {d.focusSession.title || `${d.focusSession.type} session`}
              </div>
              <div style={{ fontSize: 12, marginTop: 3, color: 'var(--text-dim)' }}>
                {d.focusSession.exercises} exercise{d.focusSession.exercises === 1 ? '' : 's'} · {d.focusSession.type}
              </div>
            </div>
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <div className="eyebrow" style={{ fontSize: 9 }}>LOGGED</div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>{d.focusSession.loggedSets}</div>
            </div>
          </div>
          {d.focusSession.movementNames.length > 0 && (
            <div style={{ display: 'flex', gap: 6, margin: '11px 0 12px', flexWrap: 'wrap' }}>
              {d.focusSession.movementNames.map((n) => (
                <span key={n} className="chip" style={{ cursor: 'default' }}>{n}</span>
              ))}
              {d.focusSession.moreCount > 0 && <span className="chip" style={{ cursor: 'default' }}>+{d.focusSession.moreCount} more</span>}
            </div>
          )}
          <Link href={`/plan/${d.focusSession.id}`} className="btn">
            <span className="msr-fill" style={{ fontSize: 21 }}>play_arrow</span>
            {d.focusSession.loggedSets > 0 ? 'Resume session' : 'Open session'}
          </Link>
        </div>
      ) : (
        <div className="card" style={{ borderRadius: 24, marginTop: 10, textAlign: 'center' }}>
          <div className="eyebrow eyebrow-accent" style={{ fontSize: 9.5 }}>NO SESSION PLANNED</div>
          <div style={{ fontSize: 15, fontWeight: 600, margin: '8px 0 12px' }}>Plan your next workout</div>
          <Link href="/plan/new" className="btn">
            <span className="msr-fill" style={{ fontSize: 20 }}>add</span>Plan a session
          </Link>
        </div>
      )}
    </>
  );
}

function StatTile({ label, value, unit, placeholder, hint }: { label: string; value: string; unit: string; placeholder?: boolean; hint?: string }) {
  return (
    <div className="tile">
      <div className="eyebrow" style={{ fontSize: 9, letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 8 }}>
        <div className="num" style={{ color: placeholder ? 'var(--text-faint)' : 'var(--text)' }}>{value}</div>
        {unit && <div style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--text-dim)' }}>{unit}</div>}
      </div>
      {hint && <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function WeekPill({ day }: { day: { letter: string; state: string; label?: string } }) {
  const base: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 14, padding: '9px 4px 10px', minHeight: 64, flex: 1,
  };
  let style: React.CSSProperties = { ...base };
  let letterColor = 'var(--text-dim)';
  if (day.state === 'today') {
    style = { ...base, flex: 1.9, background: 'var(--surface-strong)', border: '1.5px solid var(--accent)', boxShadow: '0 0 0 4px var(--accent-soft)', padding: '9px 6px 10px' };
    letterColor = 'var(--accent)';
  } else if (day.state === 'done') {
    style = { ...base, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' };
    letterColor = 'var(--text)';
  } else if (day.state === 'rest') {
    style = { ...base, background: 'transparent', border: '1px dashed var(--border)' };
    letterColor = 'var(--text-faint)';
  } else {
    style = { ...base, background: 'var(--surface)', border: '1px solid var(--border)' };
  }
  return (
    <div style={style}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: letterColor }}>{day.letter}</div>
      {day.state === 'today' && day.label && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, fontWeight: 600, color: 'var(--accent)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 52 }}>
          {day.label}
        </div>
      )}
      {day.state === 'done' && <span className="msr-fill" style={{ fontSize: 15, color: 'var(--accent)' }}>check</span>}
      {day.state === 'planned' && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-faint)' }} />}
    </div>
  );
}
