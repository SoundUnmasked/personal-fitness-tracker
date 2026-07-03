import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { isoDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export default async function Calendar() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(startOfToday);
  weekStart.setDate(startOfToday.getDate() - ((startOfToday.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const [weekSessions, upcoming, history] = await Promise.all([
    prisma.session.findMany({
      where: { date: { gte: weekStart, lt: weekEnd } },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, status: true },
    }),
    prisma.session.findMany({
      where: { status: 'planned', date: { gte: startOfToday } },
      orderBy: { date: 'asc' },
      include: { plannedExercises: { select: { id: true } } },
    }),
    prisma.session.findMany({
      where: { status: 'completed' },
      orderBy: { date: 'desc' },
      include: {
        strengthSets: { select: { exerciseName: true } },
        runs: { select: { distanceKm: true, avgPace: true } },
      },
    }),
  ]);

  const todayIso = isoDate(now);

  // Week strip
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const strip = letters.map((letter, i) => {
    const dd = new Date(weekStart);
    dd.setDate(weekStart.getDate() + i);
    const iso = isoDate(dd);
    const onDay = weekSessions.filter((s) => isoDate(s.date) === iso);
    const done = onDay.some((s) => s.status === 'completed');
    const planned = onDay.some((s) => s.status === 'planned');
    const isToday = iso === todayIso;
    return { letter, state: done ? 'done' : isToday ? 'today' : planned ? 'planned' : 'rest' };
  });

  // Group completed history by month (newest first).
  const groups: { key: string; label: string; items: typeof history }[] = [];
  for (const s of history) {
    const key = `${s.date.getFullYear()}-${s.date.getMonth()}`;
    const label = s.date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, label, items: [] }; groups.push(g); }
    g.items.push(s);
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="h1">Calendar</div>
          <div className="sub">{history.length} logged · {upcoming.length} planned</div>
        </div>
        <div style={{ flex: 1 }} />
        <Link href="/plan/new" className="btn-sm" style={{ background: 'var(--accent)', color: 'var(--on-accent)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span className="msr-fill">add</span>New
        </Link>
      </div>

      {/* This week strip */}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {strip.map((day, i) => <WeekPill key={i} day={day} />)}
      </div>

      {/* Upcoming planned */}
      {upcoming.length > 0 && (
        <>
          <div className="section-head"><div className="h2">Upcoming</div></div>
          <div className="stack stack-11">
            {upcoming.map((s) => (
              <SessionCard key={s.id} id={s.id} date={s.date} type={s.type} title={s.title}
                todayIso={todayIso} status="planned" summary={`${s.plannedExercises.length} planned`} />
            ))}
          </div>
        </>
      )}

      {/* History grouped by month */}
      <div className="section-head"><div className="h2">History</div></div>
      {history.length === 0 ? (
        <div className="card"><div className="empty">No completed sessions yet.</div></div>
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            <div className="eyebrow" style={{ margin: '16px 2px 10px' }}>{g.label}</div>
            <div className="stack stack-11">
              {g.items.map((s) => {
                const run = s.runs[0];
                const exCount = new Set(s.strengthSets.map((x) => x.exerciseName)).size;
                const summary = run?.distanceKm != null
                  ? `${run.distanceKm} km${run.avgPace ? ` · ${run.avgPace}` : ''}`
                  : exCount > 0 ? `${exCount} exercise${exCount === 1 ? '' : 's'} · ${s.strengthSets.length} sets` : '';
                return (
                  <SessionCard key={s.id} id={s.id} date={s.date} type={s.type} title={s.title}
                    todayIso={todayIso} status="completed" summary={summary} durationMin={s.durationMin} />
                );
              })}
            </div>
          </div>
        ))
      )}
      <div style={{ height: 8 }} />
    </>
  );
}

function SessionCard({ id, date, type, title, todayIso, status, summary, durationMin }: {
  id: number; date: Date; type: string; title: string | null; todayIso: string;
  status: 'completed' | 'planned'; summary: string; durationMin?: number | null;
}) {
  const isToday = isoDate(date) === todayIso;
  const done = status === 'completed';
  const d = new Date(date);
  const statusLabel = done ? 'Done' : isToday ? 'Log' : 'Planned';
  return (
    <Link href={`/plan/${id}`} className="list-row"
      style={{ borderLeft: `3px solid ${isToday ? 'var(--accent)' : done ? 'var(--accent-soft2)' : 'var(--border)'}` }}>
      <div style={{ width: 42, flex: 'none', textAlign: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: isToday ? 'var(--accent)' : 'var(--text-faint)' }}>{DOW[(d.getDay() + 6) % 7]}</div>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 1 }}>{String(d.getDate()).padStart(2, '0')}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || `${type} session`}</div>
          {isToday && <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 7px', borderRadius: 6, background: 'var(--accent)', color: 'var(--on-accent)', flex: 'none' }}>TODAY</div>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
          <div className="type-chip">{type.toUpperCase()}</div>
          {summary && <div className="chip" style={{ cursor: 'default' }}>{summary}</div>}
          {durationMin ? <div className="chip" style={{ cursor: 'default' }}><span className="msr">schedule</span>{durationMin}m</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
        <div style={{ padding: '4px 10px', borderRadius: 9, fontSize: 11, fontWeight: 700, background: done ? 'var(--ok-tint)' : isToday ? 'var(--accent)' : 'var(--surface-strong)', color: done ? 'var(--accent)' : isToday ? 'var(--on-accent)' : 'var(--text-faint)' }}>{statusLabel}</div>
        <span className="msr" style={{ fontSize: 20, color: 'var(--text-faint)' }}>chevron_right</span>
      </div>
    </Link>
  );
}

function WeekPill({ day }: { day: { letter: string; state: string } }) {
  const base: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', borderRadius: 13, padding: '9px 2px 10px', minHeight: 58 };
  let style = base;
  let lc = 'var(--text-dim)';
  if (day.state === 'today') { style = { ...base, background: 'var(--surface-strong)', border: '1.5px solid var(--accent)', boxShadow: '0 0 0 4px var(--accent-soft)' }; lc = 'var(--accent)'; }
  else if (day.state === 'done') { style = { ...base, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }; lc = 'var(--text)'; }
  else if (day.state === 'rest') { style = { ...base, background: 'transparent', border: '1px dashed var(--border)' }; lc = 'var(--text-faint)'; }
  else { style = { ...base, background: 'var(--surface)', border: '1px solid var(--border)' }; }
  return (
    <div style={style}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: lc }}>{day.letter}</div>
      {day.state === 'done' && <span className="msr-fill" style={{ fontSize: 14, color: 'var(--accent)' }}>check</span>}
      {day.state === 'planned' && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-faint)' }} />}
    </div>
  );
}
