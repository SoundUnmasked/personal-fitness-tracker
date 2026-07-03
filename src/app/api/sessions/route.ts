import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SESSION_TYPES, DEFAULT_LOCATION, type SessionType } from '@/lib/constants';
import { backToBackHardWarning } from '@/lib/rules';

export const dynamic = 'force-dynamic';

// GET /api/sessions?limit=20  — recent sessions with children
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '20');
  const sessions = await prisma.session.findMany({
    orderBy: { date: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    include: { strengthSets: { orderBy: { setNo: 'asc' } }, runs: true },
  });
  return NextResponse.json({ sessions });
}

interface SetInput {
  exerciseName: string;
  setNo?: number;
  reps?: number | null;
  weightKg?: number | null;
  rpe?: number | null;
  notes?: string | null;
}

// POST /api/sessions — create a session (+ optional strength sets / run)
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const type = String(body.type ?? '');
  if (!SESSION_TYPES.includes(type as SessionType)) {
    return NextResponse.json(
      { error: `type must be one of ${SESSION_TYPES.join(', ')}` },
      { status: 400 },
    );
  }

  const date = body.date ? new Date(String(body.date)) : new Date();
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const sets: SetInput[] = Array.isArray(body.strengthSets)
    ? (body.strengthSets as SetInput[])
    : [];

  // Build the back-to-back-hard warning (flag, never block).
  const others = await prisma.session.findMany({
    select: { date: true, type: true },
    orderBy: { date: 'desc' },
    take: 30,
  });
  const warning = backToBackHardWarning({ date, type }, others);

  const created = await prisma.session.create({
    data: {
      date,
      type,
      title: str(body.title),
      durationMin: int(body.durationMin),
      location: str(body.location) ?? DEFAULT_LOCATION,
      energyPre: int(body.energyPre),
      rpeOverall: int(body.rpeOverall),
      cooldownDone: Boolean(body.cooldownDone),
      source: 'manual',
      notes: str(body.notes),
      strengthSets: {
        create: sets
          .filter((s) => s.exerciseName?.trim())
          .map((s, i) => ({
            exerciseName: s.exerciseName.trim(),
            setNo: s.setNo ?? i + 1,
            reps: int(s.reps),
            weightKg: float(s.weightKg),
            rpe: int(s.rpe),
            notes: str(s.notes),
          })),
      },
      runs: isRunInput(body.run)
        ? {
            create: {
              distanceKm: float((body.run as Record<string, unknown>).distanceKm),
              durationMin: float((body.run as Record<string, unknown>).durationMin),
              avgPace: str((body.run as Record<string, unknown>).avgPace),
              avgHr: int((body.run as Record<string, unknown>).avgHr),
              maxHr: int((body.run as Record<string, unknown>).maxHr),
              calfRaisesDone: Boolean(
                (body.run as Record<string, unknown>).calfRaisesDone,
              ),
              notes: str((body.run as Record<string, unknown>).notes),
            },
          }
        : undefined,
    },
    include: { strengthSets: true, runs: true },
  });

  return NextResponse.json({ session: created, warning }, { status: 201 });
}

function isRunInput(v: unknown): boolean {
  return !!v && typeof v === 'object';
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
function int(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isNaN(n) ? null : n;
}
function float(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
