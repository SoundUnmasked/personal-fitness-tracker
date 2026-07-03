import { prisma } from './prisma';

export interface BodyPoint {
  date: string; // ISO
  t: number; // epoch ms (x)
  weightKg: number | null;
  bodyFatPct: number | null;
  skeletalMuscleMassKg: number | null;
}

export interface EnergyBucket {
  label: string; // Morning / Afternoon / Evening
  avg: number | null; // mean energy 1-5
  count: number;
}

export async function getDashboardData() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    recentSessions,
    plannedUpcoming,
    inbody,
    withings,
    checkins,
    goals,
    syncStates,
    profile,
  ] = await Promise.all([
      prisma.session.findMany({
        where: { status: 'completed' },
        orderBy: { date: 'desc' },
        take: 8,
        include: { strengthSets: true, runs: true },
      }),
      prisma.session.findMany({
        where: { status: 'planned', date: { gte: startOfToday } },
        orderBy: { date: 'asc' },
        take: 5,
        include: { plannedExercises: { orderBy: { order: 'asc' } } },
      }),
      prisma.bodyComposition.findMany({
        where: { source: 'InBody' },
        orderBy: { date: 'asc' },
      }),
      prisma.bodyComposition.findMany({
        where: { source: 'Withings' },
        orderBy: { date: 'asc' },
      }),
      prisma.dailyCheckin.findMany({ orderBy: { date: 'desc' }, take: 30 }),
      prisma.goal.findMany({ orderBy: { id: 'asc' } }),
      prisma.syncState.findMany(),
      prisma.athleteProfile.findFirst(),
    ]);

  const toPoints = (
    rows: typeof inbody,
  ): BodyPoint[] =>
    rows.map((r) => ({
      date: r.date.toISOString(),
      t: r.date.getTime(),
      weightKg: r.weightKg,
      bodyFatPct: r.bodyFatPct,
      skeletalMuscleMassKg: r.skeletalMuscleMassKg,
    }));

  // Energy by time-of-day — averaged across the last 30 check-ins.
  const buckets: EnergyBucket[] = [
    avgEnergy('Morning', checkins.map((c) => c.energyMorning)),
    avgEnergy('Afternoon', checkins.map((c) => c.energyAfternoon)),
    avgEnergy('Evening', checkins.map((c) => c.energyEvening)),
  ];

  return {
    recentSessions,
    plannedUpcoming,
    inbodyPoints: toPoints(inbody),
    withingsPoints: toPoints(withings),
    energyBuckets: buckets,
    goals,
    syncStates,
    profile,
    counts: {
      sessions: await prisma.session.count({ where: { status: 'completed' } }),
      planned: plannedUpcoming.length,
      checkins: checkins.length,
    },
  };
}

function avgEnergy(label: string, values: (number | null)[]): EnergyBucket {
  const nums = values.filter((v): v is number => typeof v === 'number');
  return {
    label,
    avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
    count: nums.length,
  };
}
