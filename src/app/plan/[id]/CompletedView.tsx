import Link from 'next/link';
import { shortDate, isoDate } from '@/lib/format';
import StructuredBlock from '@/components/StructuredBlock';
import SessionActions from '@/components/SessionActions';

export interface CompletedSet {
  exerciseName: string;
  setNo: number;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  rpe: number | null; // half-points allowed (7.5)
  rpeHigh: number | null; // upper bound when RPE was a range ("7 or 8")
  notes: string | null;
}
export interface CompletedRun {
  distanceKm: number | null;
  durationMin: number | null;
  avgPace: string | null;
  avgHr: number | null;
  maxHr: number | null;
  hrSource: string | null;
  calfRaisesDone: boolean;
  notes: string | null;
}
export interface CompletedSession {
  id: number;
  type: string;
  title: string | null;
  date: string; // ISO
  location: string | null;
  durationMin: number | null;
  rpeOverall: number | null;
  energyPre: number | null;
  cooldownDone: boolean;
  warmup: string | null;
  cooldown: string | null;
  source: string;
  notes: string | null;
  sets: CompletedSet[];
  runs: CompletedRun[];
}

interface ExGroup { name: string; sets: CompletedSet[] }

export default function CompletedView({ session }: { session: CompletedSession }) {
  // Group sets by exercise name, preserving import/log order (sets of one
  // movement are consecutive).
  const groups: ExGroup[] = [];
  for (const s of session.sets) {
    const last = groups[groups.length - 1];
    if (last && last.name === s.exerciseName) last.sets.push(s);
    else groups.push({ name: s.exerciseName, sets: [s] });
  }
  const run = session.runs[0];

  return (
    <>
      <div className="topbar">
        <Link href="/plan" className="icon-btn"><span className="msr">chevron_left</span></Link>
        <div style={{ flex: 1 }} />
        <div style={{ padding: '6px 10px', borderRadius: 9, fontSize: 11, fontWeight: 700, background: 'var(--ok-tint)', color: 'var(--accent)' }}>Completed</div>
        <SessionActions
          sessionId={session.id}
          dateIso={isoDate(session.date)}
          title={session.title ?? ''}
          type={session.type}
          status="completed"
          variant="detail"
        />
      </div>

      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', padding: '4px 10px', borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {shortDate(session.date).toUpperCase()}
          </div>
          {session.location && <div className="sub">{session.location}</div>}
        </div>
        <div className="h1-lg" style={{ marginTop: 12 }}>{session.title || `${session.type} session`}</div>
        {session.notes && <div style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--text-dim)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{session.notes}</div>}
      </div>

      {/* Totals */}
      <div className="stat-row" style={{ marginTop: 18 }}>
        <Total icon="local_fire_department" value={session.type} label="type" />
        <Total icon="fitness_center" value={String(groups.length || (run ? 1 : 0))} label={run && groups.length === 0 ? 'run' : 'exercises'} />
        <Total icon="schedule" value={session.durationMin ? `${session.durationMin}m` : '·'} label="duration" />
      </div>

      {/* Session meta chips */}
      {(session.rpeOverall != null || session.energyPre != null || session.cooldownDone) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {session.rpeOverall != null && <div className="chip" style={{ cursor: 'default' }}>Overall RPE {session.rpeOverall}</div>}
          {session.energyPre != null && <div className="chip" style={{ cursor: 'default' }}>Energy {session.energyPre}/5</div>}
          {session.cooldownDone && <div className="chip" style={{ cursor: 'default' }}><span className="msr">check</span>Cooldown</div>}
        </div>
      )}

      {/* Edit logged actuals: reopens the logger; finishing again overwrites. */}
      <div className="note note-accent" style={{ marginTop: 16, marginBottom: 0 }}>
        <span className="msr-fill" aria-hidden="true">check_circle</span>
        Already logged. Opening the logger again will let you overwrite the recorded actuals.
      </div>
      <Link
        href={`/plan/${session.id}/log`}
        className="btn"
        style={{ marginTop: 10, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-line)' }}
      >
        <span className="msr-fill" style={{ fontSize: 19 }} aria-hidden="true">edit_note</span>
        Edit logged sets
      </Link>

      {/* Structured warm-up */}
      <StructuredBlock kind="warmup" raw={session.warmup} />

      {/* Run block */}
      {run && (
        <>
          <div className="section-head"><div className="h2">Run</div></div>
          <div className="card card-md">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 24px' }}>
              <Metric label="Distance" value={run.distanceKm != null ? `${run.distanceKm} km` : '·'} />
              <Metric label="Duration" value={run.durationMin != null ? `${Math.round(run.durationMin)} min` : '·'} />
              <Metric label="Pace" value={run.avgPace || '·'} />
              <Metric label="Avg HR" value={run.avgHr != null ? `${run.avgHr} bpm` : '·'} />
              <Metric label="Max HR" value={run.maxHr != null ? `${run.maxHr} bpm` : '·'} />
              <Metric label="HR source" value={run.hrSource || '·'} accent={run.hrSource != null && run.hrSource !== 'Samsung'} />
            </div>
            {run.hrSource === 'Samsung' && (
              <div className="note note-accent" style={{ marginTop: 12, marginBottom: 0 }}>
                <span className="msr-fill">info</span>HR from Samsung/Galaxy: least-reliable fallback (Elvanse-inflated); distance from Samsung is never used.
              </div>
            )}
            {run.notes && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 12, whiteSpace: 'pre-wrap' }}>{run.notes}</div>}
          </div>
        </>
      )}

      {/* Exercises with actual sets */}
      {groups.length > 0 && (
        <>
          <div className="section-head">
            <div className="h2">Exercises</div>
            <div className="sub">{groups.length} · {session.sets.length} sets</div>
          </div>
          <div className="stack stack-12">
            {groups.map((g, gi) => (
              <div key={gi} className="card" style={{ padding: 15 }}>
                <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{g.name}</div>
                <div style={{ marginTop: 10 }}>
                  {g.sets.map((s, si) => (
                    <div key={si} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderTop: si === 0 ? 'none' : '1px solid var(--border)' }}>
                      <div style={{ width: 22, flex: 'none', fontSize: 12, fontWeight: 700, color: 'var(--text-faint)' }}>{s.setNo}</div>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>
                        {s.weightKg != null ? <><span>{s.weightKg}</span><span style={{ color: 'var(--text-dim)', fontWeight: 500 }}> kg</span></> : s.durationSeconds == null ? <span style={{ color: 'var(--text-faint)' }}>·</span> : null}
                        {s.durationSeconds != null && <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>{s.weightKg != null ? ' · ' : ''}{s.durationSeconds}s</span>}
                        {s.reps != null && <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}> × {s.reps}</span>}
                        {s.rpe != null && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>  ·  RPE {s.rpe}{s.rpeHigh != null ? `-${s.rpeHigh}` : ''}</span>}
                      </div>
                    </div>
                  ))}
                </div>
                {/* movement notes (prose detail preserved on the first set) */}
                {g.sets.map((s, si) => s.notes ? (
                  <div key={`n${si}`} style={{ fontSize: 11.5, lineHeight: 1.35, color: 'var(--text-dim)', marginTop: si === 0 ? 10 : 4, whiteSpace: 'pre-wrap' }}>{s.notes}</div>
                ) : null)}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Structured cool-down */}
      <StructuredBlock kind="cooldown" raw={session.cooldown} />

      <div style={{ height: 20 }} />
    </>
  );
}

function Total({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="tile" style={{ padding: '13px 12px 14px' }}>
      <span className="msr-fill" style={{ fontSize: 19, color: 'var(--accent)' }}>{icon}</span>
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 9 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-faint)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ minWidth: 68 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', marginTop: 4, color: accent ? 'var(--accent)' : 'var(--text)' }}>{value}</div>
    </div>
  );
}
