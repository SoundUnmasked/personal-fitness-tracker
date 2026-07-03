import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { BODY_COMP_SOURCES, type BodyCompSource } from '@/lib/constants';

export const dynamic = 'force-dynamic';

// GET /api/body-composition?source=InBody  — list (optionally filtered)
export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get('source');
  const rows = await prisma.bodyComposition.findMany({
    where: source ? { source } : undefined,
    orderBy: { date: 'asc' },
  });
  return NextResponse.json({ bodyComposition: rows });
}

// POST /api/body-composition — manually add a checkpoint (e.g. from extraction)
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const source = String(body.source ?? '');
  if (!BODY_COMP_SOURCES.includes(source as BodyCompSource)) {
    return NextResponse.json(
      { error: `source must be one of ${BODY_COMP_SOURCES.join(', ')}` },
      { status: 400 },
    );
  }
  const date = body.date ? new Date(String(body.date)) : new Date();
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const row = await prisma.bodyComposition.create({
    data: {
      date,
      source,
      weightKg: float(body.weightKg),
      bodyFatPct: float(body.bodyFatPct),
      skeletalMuscleMassKg: float(body.skeletalMuscleMassKg),
      visceralFat: float(body.visceralFat),
      bmr: int(body.bmr),
      raw: body.raw ? JSON.stringify(body.raw) : null,
    },
  });
  return NextResponse.json({ bodyComposition: row }, { status: 201 });
}

function float(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function int(v: unknown): number | null {
  const n = float(v);
  return n === null ? null : Math.round(n);
}
