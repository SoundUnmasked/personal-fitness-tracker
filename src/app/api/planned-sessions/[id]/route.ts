import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPlannedSessionsKey } from '@/lib/apiKey';
import {
  isValidDateIso,
  findDateClash,
  moveSessionDate,
  deleteSessionCascade,
} from '@/lib/plannedSessions';

export const dynamic = 'force-dynamic';

// Machine-facing per-session endpoint, same `x-api-key` auth as the collection
// POST. Lets the planning tool (and the delete/push CLIs) delete a session or
// move its date without hand-writing DB calls.

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * DELETE /api/planned-sessions/:id — remove a session and all of its children
 * (planned exercises, strength sets, runs). Works for planned or completed.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = checkPlannedSessionsKey(req.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id == null) return NextResponse.json({ error: 'Invalid session id.' }, { status: 400 });

  const existing = await prisma.session.findUnique({
    where: { id },
    select: { id: true, title: true, type: true, date: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });

  await deleteSessionCascade(prisma, id);
  return NextResponse.json({ deleted: existing, message: 'Session deleted.' });
}

/**
 * PATCH /api/planned-sessions/:id — update a planned session's date.
 * Body: { "date": "YYYY-MM-DD", "force"?: boolean }. If the target day already
 * holds another session and `force` isn't true, responds 409 with the clash.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = checkPlannedSessionsKey(req.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: raw } = await ctx.params;
  const id = parseId(raw);
  if (id == null) return NextResponse.json({ error: 'Invalid session id.' }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const b = (body ?? {}) as { date?: unknown; force?: unknown };
  if (!isValidDateIso(b.date)) {
    return NextResponse.json({ error: 'date is required as "YYYY-MM-DD".' }, { status: 400 });
  }

  const session = await prisma.session.findUnique({ where: { id }, select: { status: true } });
  if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
  if (session.status !== 'planned') {
    return NextResponse.json({ error: 'Only planned sessions can be moved.' }, { status: 409 });
  }

  if (b.force !== true) {
    const clash = await findDateClash(prisma, b.date, id);
    if (clash) {
      return NextResponse.json(
        { error: 'Another session already exists on that date.', clash },
        { status: 409 },
      );
    }
  }

  const updated = await moveSessionDate(prisma, id, b.date);
  return NextResponse.json({ session: updated, message: 'Session date updated.' });
}
