import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { isoDate } from '@/lib/format';
import SessionRow from '@/components/SessionRow';

export const dynamic = 'force-dynamic';

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
              <SessionRow key={s.id} id={s.id} dateIso={isoDate(s.date)} type={s.type} title={s.title}
                isToday={isoDate(s.date) === todayIso} status="planned" summary={`${s.plannedExercises.length} planned`} />
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
                  <SessionRow key={s.id} id={s.id} dateIso={isoDate(s.date)} type={s.type} title={s.title}
                    isToday={isoDate(s.date) === todayIso} status="completed" summary={summary} durationMin={s.durationMin} />
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
