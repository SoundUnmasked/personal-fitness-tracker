'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import {
  validatePlannedSession,
  createPlannedSession,
  intOrNull,
  floatOrNull,
  strOrNull,
  nonNegIntOrNull,
  isValidDateIso,
  findDateClash,
  moveSessionDate,
  deleteSessionCascade,
  duplicateSession,
  type ActualSetInput,
  type CompletePlanInput,
  type ClashInfo,
} from '@/lib/plannedSessions';
import { backToBackHardWarning, pickHrSource, normalizeHrSource } from '@/lib/rules';
import { serializeFlowItems } from '@/lib/flowItems';

export interface ActionResult {
  ok: boolean;
  id?: number;
  warning?: string | null;
  error?: string;
}

/** Create a planned session from the in-app "New plan" form. */
export async function createPlanAction(input: unknown): Promise<ActionResult> {
  const result = validatePlannedSession(input);
  if (!result.ok || !result.value) {
    return { ok: false, error: result.error };
  }
  const session = await createPlannedSession(prisma, result.value, 'manual');
  revalidatePath('/');
  revalidatePath('/plan');
  return { ok: true, id: session.id };
}

/**
 * Log actuals against a planned session and mark it completed. Creates the
 * StrengthSet rows (and a Run if a run component was logged), applies the HR
 * source hierarchy, and returns the back-to-back-hard warning (flag only).
 */
export async function completePlanAction(
  sessionId: number,
  raw: CompletePlanInput,
): Promise<ActionResult> {
  const plan = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!plan) return { ok: false, error: 'Planned session not found.' };

  const sets: ActualSetInput[] = Array.isArray(raw.strengthSets)
    ? raw.strengthSets
    : [];

  // Back-to-back-hard warning vs every OTHER session (flag, never block).
  const others = await prisma.session.findMany({
    where: { id: { not: sessionId } },
    select: { date: true, type: true },
    orderBy: { date: 'desc' },
    take: 60,
  });
  const warning = backToBackHardWarning({ date: plan.date, type: plan.type }, others);

  // Resolve HR provenance for the run, if any.
  let hrPickWarning: string | null = null;
  let runData: CompleteRunData | null = null;
  if (raw.run && (raw.run.avgHr != null || raw.run.distanceKm != null || raw.run.hrSource)) {
    const pick = pickHrSource([raw.run.hrSource]);
    hrPickWarning = pick.warning;
    runData = {
      distanceKm: floatOrNull(raw.run.distanceKm),
      durationMin: floatOrNull(raw.run.durationMin),
      avgPace: strOrNull(raw.run.avgPace),
      avgHr: intOrNull(raw.run.avgHr),
      maxHr: intOrNull(raw.run.maxHr),
      hrSource: pick.source ?? normalizeHrSource(raw.run.hrSource ?? '') ?? null,
      calfRaisesDone: Boolean(raw.run.calfRaisesDone),
      notes: strOrNull(raw.run.notes),
    };
  }

  await prisma.$transaction(async (tx) => {
    // Replace any prior actuals (idempotent re-save) then write the new ones.
    await tx.strengthSet.deleteMany({ where: { sessionId } });
    await tx.run.deleteMany({ where: { sessionId } });

    await tx.session.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        durationMin: intOrNull(raw.durationMin),
        energyPre: intOrNull(raw.energyPre),
        rpeOverall: intOrNull(raw.rpeOverall),
        // cooldownDone is persisted live from the logger's cool-down block, so
        // only overwrite it when the finish step explicitly sends a value.
        ...(raw.cooldownDone !== undefined ? { cooldownDone: Boolean(raw.cooldownDone) } : {}),
        // Persist logged warm-up / cool-down items (ticks + actual weights).
        ...(raw.warmup !== undefined ? { warmup: serializeFlowItems(raw.warmup) } : {}),
        ...(raw.cooldown !== undefined ? { cooldown: serializeFlowItems(raw.cooldown) } : {}),
        notes: strOrNull(raw.notes) ?? plan.notes,
        strengthSets: {
          create: sets
            .filter((s) => s.exerciseName?.trim())
            .map((s, i) => ({
              exerciseName: s.exerciseName.trim(),
              setNo: s.setNo ?? i + 1,
              reps: intOrNull(s.reps),
              weightKg: floatOrNull(s.weightKg),
              durationSeconds: nonNegIntOrNull(s.durationSeconds),
              isWarmup: Boolean(s.isWarmup),
              rpe: intOrNull(s.rpe),
              notes: strOrNull(s.notes),
            })),
        },
        runs: runData ? { create: runData } : undefined,
      },
    });
  });

  revalidatePath('/');
  revalidatePath('/plan');
  const combined = [warning, hrPickWarning].filter(Boolean).join(' ');
  return { ok: true, warning: combined || null };
}

/**
 * Discard an in-progress session: throw away any logged actuals and return the
 * session to "planned" so it can be started fresh. Used by the back-out sheet's
 * "End session → Discard" path (behind an explicit warning). Never deletes the
 * plan itself — only the actuals recorded against it.
 */
export async function discardSessionAction(sessionId: number): Promise<ActionResult> {
  const plan = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!plan) return { ok: false, error: 'Not found.' };
  await prisma.$transaction(async (tx) => {
    await tx.strengthSet.deleteMany({ where: { sessionId } });
    await tx.run.deleteMany({ where: { sessionId } });
    await tx.session.update({
      where: { id: sessionId },
      data: { status: 'planned', durationMin: null, energyPre: null, rpeOverall: null },
    });
  });
  revalidatePath('/');
  revalidatePath('/plan');
  return { ok: true };
}

export interface MoveResult {
  ok: boolean;
  error?: string;
  clash?: ClashInfo; // set when the target day is occupied and force wasn't given
}

/**
 * Reschedule a PLANNED session to a new date. Completed sessions can't move.
 * If another session already sits on the target day and `force` isn't set, the
 * move is refused with a `clash` so the UI can warn and offer to proceed.
 */
export async function movePlanAction(
  sessionId: number,
  dateIso: string,
  opts?: { force?: boolean },
): Promise<MoveResult> {
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s) return { ok: false, error: 'Session not found.' };
  if (s.status !== 'planned') return { ok: false, error: 'Only planned sessions can be moved.' };
  if (!isValidDateIso(dateIso)) return { ok: false, error: 'Please choose a valid date.' };
  if (!opts?.force) {
    const clash = await findDateClash(prisma, dateIso, sessionId);
    if (clash) return { ok: false, clash };
  }
  await moveSessionDate(prisma, sessionId, dateIso);
  revalidatePath('/');
  revalidatePath('/plan');
  revalidatePath(`/plan/${sessionId}`);
  return { ok: true };
}

/**
 * Duplicate a session's plan onto a new date as a fresh `planned` session.
 * Works for planned OR completed sources; logged actuals are never copied.
 */
export async function duplicatePlanAction(sessionId: number, dateIso: string): Promise<ActionResult> {
  if (!isValidDateIso(dateIso)) return { ok: false, error: 'Please choose a valid date.' };
  const created = await duplicateSession(prisma, sessionId, dateIso);
  if (!created) return { ok: false, error: 'Session not found.' };
  revalidatePath('/');
  revalidatePath('/plan');
  return { ok: true, id: created.id };
}

/**
 * Delete a session (planned OR completed) and all of its children. For
 * completed sessions this permanently removes logged data — the UI shows a
 * stronger warning before calling this.
 */
export async function deleteSessionAction(sessionId: number): Promise<ActionResult> {
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s) return { ok: false, error: 'Not found.' };
  await deleteSessionCascade(prisma, sessionId);
  revalidatePath('/');
  revalidatePath('/plan');
  return { ok: true };
}

interface CompleteRunData {
  distanceKm: number | null;
  durationMin: number | null;
  avgPace: string | null;
  avgHr: number | null;
  maxHr: number | null;
  hrSource: string | null;
  calfRaisesDone: boolean;
  notes: string | null;
}
