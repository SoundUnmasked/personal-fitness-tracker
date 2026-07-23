import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { previousWeights, previousWarmups, reconstructCompletedRows } from '@/lib/plannedSessions';
import { hasRunComponent, needsCooldownPrompt } from '@/lib/rules';
import { readFlow } from '@/lib/flowItems';
import LogGrid, { type LogPlan } from './LogGrid';

export const dynamic = 'force-dynamic';

export default async function LogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = Number(id);
  if (Number.isNaN(sessionId)) notFound();

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      plannedExercises: { orderBy: { order: 'asc' } },
      // Package R fix 1: for a completed session we hydrate the logger from the
      // DATABASE (there is no local draft — it was cleared on Finish).
      strengthSets: { orderBy: { id: 'asc' } },
    },
  });
  if (!session) notFound();

  const names = session.plannedExercises.map((e) => e.exerciseName);
  const [prev, prevWarm] = await Promise.all([
    previousWeights(prisma, names, session.date),
    previousWarmups(prisma, names, session.date),
  ]);

  const warm = readFlow(session.warmup);
  const cool = readFlow(session.cooldown);

  // Package R fix 1: reconstruct the recorded actuals, aligned to the planned
  // exercises by name, so "Edit logged sets" opens on exactly what was saved
  // (pre-ticked) rather than a blank plan.
  let completed: LogPlan['completed'] = null;
  if (session.status === 'completed') {
    completed = {
      durationMin: session.durationMin,
      rpeOverall: session.rpeOverall,
      energyPre: session.energyPre,
      sessionNote: session.notes ?? '',
      totalSets: session.strengthSets.length,
      exercises: reconstructCompletedRows(session.plannedExercises, session.strengthSets),
    };
  }

  const plan: LogPlan = {
    id: session.id,
    type: session.type,
    title: session.title || `${session.type} session`,
    hasRun: hasRunComponent(session.type),
    needsCooldown: needsCooldownPrompt(session.type),
    warmup: warm.items,
    warmupText: warm.legacyText,
    cooldown: cool.items,
    cooldownText: cool.legacyText,
    exercises: session.plannedExercises.map((e) => {
      const p = prev[e.exerciseName];
      return {
        name: e.exerciseName,
        targetSets: e.targetSets,
        targetReps: e.targetReps,
        targetWeightKg: e.targetWeightKg,
        restSeconds: e.restSeconds,
        setStyle: e.setStyle === 'duration' ? 'duration' : 'reps',
        durationSeconds: e.durationSeconds,
        tempo: e.tempo,
        superset: e.supersetGroup,
        prevKg: p?.weightKg ?? null,
        prevReps: p?.reps ?? null,
        planNote: e.notes ?? null,
        loggedNote: e.loggedNote ?? null,
        prevWarmups: prevWarm[e.exerciseName] ?? [],
      };
    }),
    completed,
  };

  return <LogGrid plan={plan} />;
}
