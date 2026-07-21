import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { previousWeights } from '@/lib/plannedSessions';
import { hasRunComponent, needsCooldownPrompt } from '@/lib/rules';
import LogGrid, { type LogPlan } from './LogGrid';

export const dynamic = 'force-dynamic';

export default async function LogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = Number(id);
  if (Number.isNaN(sessionId)) notFound();

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { plannedExercises: { orderBy: { order: 'asc' } } },
  });
  if (!session) notFound();

  const prev = await previousWeights(
    prisma,
    session.plannedExercises.map((e) => e.exerciseName),
    session.date,
  );

  const plan: LogPlan = {
    id: session.id,
    type: session.type,
    title: session.title || `${session.type} session`,
    hasRun: hasRunComponent(session.type),
    needsCooldown: needsCooldownPrompt(session.type),
    warmup: session.warmup,
    cooldown: session.cooldown,
    warmupDone: session.warmupDone,
    cooldownDone: session.cooldownDone,
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
      };
    }),
  };

  return <LogGrid plan={plan} />;
}
