import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { previousWeights } from '@/lib/plannedSessions';
import { shortDate } from '@/lib/format';
import CompletedView from './CompletedView';
import StructuredBlock from '@/components/StructuredBlock';

export const dynamic = 'force-dynamic';

interface PreviewExercise {
  name: string;
  badge: string;
  showDivider: boolean;
  scheme: string;
  weight: string | null;
  rest: string | null;
  tempo: string | null;
  timed: boolean;
  last: string | null;
  note: string | null;
}

/** Seconds → "2:00" (≥1 min) or "45s". */
function restLabel(sec: number): string {
  return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec}s`;
}
interface Block {
  isSuperset: boolean;
  tag: string;
  exercises: PreviewExercise[];
}

export default async function PlannedSessionPreview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sessionId = Number(id);
  if (Number.isNaN(sessionId)) notFound();

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      plannedExercises: { orderBy: { order: 'asc' } },
      strengthSets: { orderBy: { id: 'asc' } },
      runs: true,
    },
  });
  if (!session) notFound();

  // Completed sessions (logged or imported history) get the read-only detail view.
  if (session.status === 'completed') {
    return (
      <CompletedView
        session={{
          id: session.id,
          type: session.type,
          title: session.title,
          date: session.date.toISOString(),
          location: session.location,
          durationMin: session.durationMin,
          rpeOverall: session.rpeOverall,
          energyPre: session.energyPre,
          cooldownDone: session.cooldownDone,
          warmup: session.warmup,
          cooldown: session.cooldown,
          source: session.source,
          notes: session.notes,
          sets: session.strengthSets.map((s) => ({
            exerciseName: s.exerciseName, setNo: s.setNo, reps: s.reps,
            weightKg: s.weightKg, durationSeconds: s.durationSeconds, rpe: s.rpe, notes: s.notes,
          })),
          runs: session.runs.map((r) => ({
            distanceKm: r.distanceKm, durationMin: r.durationMin, avgPace: r.avgPace,
            avgHr: r.avgHr, maxHr: r.maxHr, hrSource: r.hrSource, calfRaisesDone: r.calfRaisesDone, notes: r.notes,
          })),
        }}
      />
    );
  }

  const prev = await previousWeights(
    prisma,
    session.plannedExercises.map((e) => e.exerciseName),
    session.date,
  );

  // Group into superset blocks (consecutive shared tag).
  const blocks: Block[] = [];
  let item = 0;
  let i = 0;
  const exs = session.plannedExercises;
  const fmtScheme = (s: number | null, r: number | null) =>
    s != null && r != null ? `${s} × ${r}` : s != null ? `${s} sets` : r != null ? `${r} reps` : 'as felt';
  const buildEx = (idx: number, badge: string, showDivider: boolean): PreviewExercise => {
    const e = exs[idx];
    const p = prev[e.exerciseName];
    const timed = e.setStyle === 'duration';
    const scheme = timed
      ? (e.targetSets != null
          ? `${e.targetSets} × ${e.durationSeconds != null ? `${e.durationSeconds}s` : 'timed'}`
          : e.durationSeconds != null ? `${e.durationSeconds}s` : 'timed')
      : fmtScheme(e.targetSets, e.targetReps);
    return {
      name: e.exerciseName,
      badge,
      showDivider,
      scheme,
      weight: e.targetWeightKg != null ? `${e.targetWeightKg} kg` : null,
      rest: e.restSeconds != null ? restLabel(e.restSeconds) : null,
      tempo: e.tempo,
      timed,
      last: p ? `${p.weightKg != null ? `${p.weightKg} kg` : '·'}${p.reps != null ? ` × ${p.reps}` : ''}` : null,
      note: e.notes,
    };
  };
  while (i < exs.length) {
    const g = exs[i].supersetGroup;
    if (g) {
      const idxs: number[] = [];
      while (i < exs.length && exs[i].supersetGroup === g) { idxs.push(i); i++; }
      item++;
      blocks.push({ isSuperset: true, tag: g, exercises: idxs.map((idx, pos) => buildEx(idx, `${item}${String.fromCharCode(65 + pos)}`, pos > 0)) });
    } else {
      item++;
      blocks.push({ isSuperset: false, tag: '', exercises: [buildEx(i, String(item), false)] });
      i++;
    }
  }

  const totalSets = exs.reduce((a, e) => a + (e.targetSets ?? 0), 0);
  const isCompleted = session.status === 'completed';

  return (
    <>
      {/* Header */}
      <div className="topbar">
        <Link href="/plan" className="icon-btn"><span className="msr">chevron_left</span></Link>
        <div style={{ flex: 1 }} />
        <Link href="/plan/new" className="icon-btn dim"><span className="msr">edit</span></Link>
      </div>

      <div style={{ marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', padding: '4px 10px', borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {shortDate(session.date).toUpperCase()}
          </div>
          <div className="sub">{session.location}</div>
        </div>
        <div className="h1-lg" style={{ marginTop: 12 }}>{session.title || `${session.type} session`}</div>
        {session.notes && <div style={{ fontSize: 14, lineHeight: 1.4, color: 'var(--text-dim)', marginTop: 6 }}>{session.notes}</div>}
      </div>

      {isCompleted && (
        <div className="note note-accent" style={{ marginTop: 16 }}>
          <span className="msr-fill">check_circle</span>
          Already logged. Opening the logger again will let you overwrite the recorded actuals.
        </div>
      )}

      {/* Totals */}
      <div className="stat-row" style={{ marginTop: 18 }}>
        <TotalTile icon="local_fire_department" value={session.type} label="session type" />
        <TotalTile icon="fitness_center" value={String(exs.length)} label="exercises" />
        <TotalTile icon="repeat" value={totalSets ? String(totalSets) : '·'} label="planned sets" />
      </div>

      {/* Structured warm-up (own collapsible block) */}
      <StructuredBlock kind="warmup" raw={session.warmup} />

      {/* Plan */}
      <div className="section-head">
        <div className="h2">The plan</div>
        <div className="sub">{exs.length} exercise{exs.length === 1 ? '' : 's'}{totalSets ? ` · ${totalSets} sets` : ''}</div>
      </div>

      {exs.length === 0 ? (
        <div className="empty">No movements on this plan.</div>
      ) : (
        <div className="stack stack-12">
          {blocks.map((block, bi) => (
            <div
              key={bi}
              className="card"
              style={{ padding: 0, overflow: 'hidden', borderLeft: `3px solid ${block.isSuperset ? 'var(--accent-soft2)' : 'var(--border)'}` }}
            >
              {block.isSuperset && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 15px', borderBottom: '1px solid var(--border)', background: 'var(--accent-tint)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--accent)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
                  SUPERSET {block.tag} · ALTERNATE
                </div>
              )}
              {block.exercises.map((ex, ei) => (
                <div key={ei}>
                  {ex.showDivider && <div style={{ height: 1, background: 'var(--border)' }} />}
                  <div style={{ padding: '14px 15px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ minWidth: 30, height: 28, flex: 'none', padding: '0 9px', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: 'var(--accent-soft)', color: 'var(--accent)' }}>{ex.badge}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{ex.name}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{ex.scheme}</div>
                        </div>
                        {(ex.weight || ex.rest || ex.tempo || ex.timed) && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                            {ex.weight && <div className="chip" style={{ cursor: 'default' }}><span className="msr">fitness_center</span>{ex.weight}</div>}
                            {ex.timed && <div className="chip" style={{ cursor: 'default' }}><span className="msr">hourglass_top</span>Timed</div>}
                            {ex.rest && <div className="chip" style={{ cursor: 'default' }}><span className="msr">timer</span>Rest {ex.rest}</div>}
                            {ex.tempo && <div className="chip" style={{ cursor: 'default' }}><span className="msr">speed</span>Tempo {ex.tempo}</div>}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 11, padding: '8px 10px', borderRadius: 10, background: 'var(--last-bg)' }}>
                          <span className="msr" style={{ fontSize: 14, color: 'var(--text-faint)' }}>history</span>
                          <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-dim)' }}>
                            {ex.last ? <>Last time · <span style={{ color: 'var(--text)', fontWeight: 600 }}>{ex.last}</span></> : 'No previous record'}
                          </div>
                        </div>
                        {ex.note && (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 9 }}>
                            <span className="msr" style={{ fontSize: 14, color: 'var(--accent)', marginTop: 1 }}>push_pin</span>
                            <div style={{ fontSize: 11.5, lineHeight: 1.35, color: 'var(--text-dim)', fontStyle: 'italic' }}>{ex.note}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Structured cool-down (own collapsible block) */}
      <StructuredBlock kind="cooldown" raw={session.cooldown} />

      <div style={{ height: 92 }} />
      {/* Fixed footer CTA */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40, maxWidth: 460, margin: '0 auto', padding: '14px 18px calc(26px + env(safe-area-inset-bottom))', background: 'var(--footer-bg)', borderTop: '1px solid var(--border)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}>
        <Link href={`/plan/${session.id}/log`} className="btn btn-lg">
          <span className="msr-fill" style={{ fontSize: 22 }}>play_arrow</span>
          {isCompleted ? 'Open logger' : 'Start session'}
        </Link>
      </div>
    </>
  );
}

function TotalTile({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="tile" style={{ padding: '13px 12px 14px' }}>
      <span className="msr-fill" style={{ fontSize: 19, color: 'var(--accent)' }}>{icon}</span>
      <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 9 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-faint)', marginTop: 2 }}>{label}</div>
    </div>
  );
}
