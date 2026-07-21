import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPlannedSessionsKey } from '@/lib/apiKey';
import {
  validatePlannedSession,
  createPlannedSession,
} from '@/lib/plannedSessions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/planned-sessions
 *   ?scope=upcoming (default) — planned sessions dated today or later
 *   ?scope=all                — every planned session
 * Read-only listing (used by the delete/push CLIs to identify a session).
 * Requires the same `x-api-key` as the write endpoints; only returns planned
 * sessions.
 */
export async function GET(req: NextRequest) {
  const auth = checkPlannedSessionsKey(req.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const scope = req.nextUrl.searchParams.get('scope') ?? 'upcoming';
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const sessions = await prisma.session.findMany({
    where: {
      status: 'planned',
      ...(scope === 'all' ? {} : { date: { gte: startOfToday } }),
    },
    orderBy: { date: 'asc' },
    include: { plannedExercises: { orderBy: { order: 'asc' } } },
  });
  return NextResponse.json({ sessions });
}

/**
 * POST /api/planned-sessions — the documented planning→app hook.
 *
 * Auth: `x-api-key: <PLANNED_SESSIONS_API_KEY>` (or `Authorization: Bearer …`).
 * Body: see the JSON contract in the README. Creates a `planned` session that
 * then appears in the app ready to open at the gym. This is the "door" only —
 * the planning tool that calls it is out of scope.
 */
export async function POST(req: NextRequest) {
  const auth = checkPlannedSessionsKey(req.headers);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const result = validatePlannedSession(body);
  if (!result.ok || !result.value) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const session = await createPlannedSession(prisma, result.value, 'plan-api');
  return NextResponse.json(
    { session, message: 'Planned session created.' },
    { status: 201 },
  );
}
