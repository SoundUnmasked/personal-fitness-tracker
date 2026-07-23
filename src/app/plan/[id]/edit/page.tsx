import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { parseFlowItems } from '@/lib/flowItems';
import { isoDate } from '@/lib/format';
import EditForm, { type EditInitial } from './EditForm';

export const dynamic = 'force-dynamic';

// Package Q: edit a PLANNED session's contents. Completed sessions are edited
// via "Edit logged sets" (the logger), so send those back to their detail view.
export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = Number(id);
  if (Number.isNaN(sessionId)) notFound();

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { plannedExercises: { orderBy: { order: 'asc' } } },
  });
  if (!session) notFound();
  if (session.status !== 'planned') redirect(`/plan/${sessionId}`);

  const initial: EditInitial = {
    id: session.id,
    dateIso: isoDate(session.date),
    type: session.type,
    title: session.title ?? '',
    location: session.location ?? '',
    notes: session.notes ?? '',
    exercises: session.plannedExercises.map((e) => ({
      name: e.exerciseName,
      sets: e.targetSets != null ? String(e.targetSets) : '',
      reps: e.targetReps != null ? String(e.targetReps) : '',
      weightKg: e.targetWeightKg != null ? String(e.targetWeightKg) : '',
      restSeconds: e.restSeconds != null ? String(e.restSeconds) : '',
      tempo: e.tempo ?? '',
      superset: e.supersetGroup ?? '',
      notes: e.notes ?? '',
    })),
    warmup: parseFlowItems(session.warmup).map((it) => ({
      name: it.name, detail: it.detail ?? '', weightKg: it.weightKg != null ? String(it.weightKg) : '',
    })),
    cooldown: parseFlowItems(session.cooldown).map((it) => ({
      name: it.name, detail: it.detail ?? '', weightKg: it.weightKg != null ? String(it.weightKg) : '',
    })),
  };

  return <EditForm initial={initial} />;
}
