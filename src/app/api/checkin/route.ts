import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isoDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

// GET /api/checkin           -> recent check-ins
// GET /api/checkin?date=...   -> single check-in for that date (or null)
export async function GET(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get('date');
  if (dateParam) {
    const checkin = await prisma.dailyCheckin.findUnique({
      where: { date: startOfDay(dateParam) },
    });
    return NextResponse.json({ checkin });
  }
  const checkins = await prisma.dailyCheckin.findMany({
    orderBy: { date: 'desc' },
    take: 30,
  });
  return NextResponse.json({ checkins });
}

// POST /api/checkin — upsert by date (one check-in per day)
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const date = startOfDay(body.date ? String(body.date) : isoDate(new Date()));
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  }

  const data = {
    sleepHours: float(body.sleepHours),
    sleepQuality: scale(body.sleepQuality, 5),
    energyMorning: scale(body.energyMorning, 5),
    energyAfternoon: scale(body.energyAfternoon, 5),
    energyEvening: scale(body.energyEvening, 5),
    soreness: scale(body.soreness, 5),
    mood: scale(body.mood, 5),
    notes: str(body.notes),
  };

  const checkin = await prisma.dailyCheckin.upsert({
    where: { date },
    create: { date, ...data },
    update: data,
  });
  return NextResponse.json({ checkin }, { status: 201 });
}

function startOfDay(d: string): Date {
  const date = new Date(d);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
function float(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function scale(v: unknown, max: number): number | null {
  const n = float(v);
  if (n === null) return null;
  return Math.min(Math.max(Math.round(n), 1), max);
}
