import { prisma } from './prisma';
import { computeReadiness } from './readiness';
import { isoDate } from './format';

export interface WeekDay {
  letter: string; // M T W ...
  iso: string;
  state: 'done' | 'today' | 'planned' | 'rest';
  label?: string; // short session name on today
}

/** Everything the Home (command-centre) screen needs, from REAL data only. */
export async function getHomeData() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Monday of the current week.
  const weekStart = new Date(startOfToday);
  const dow = (startOfToday.getDay() + 6) % 7; // Mon=0
  weekStart.setDate(startOfToday.getDate() - dow);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const [latestCheckin, recentCheckins, weekSessions, planToday, nextPlan, latestWithings, latestInbody, profile] =
    await Promise.all([
      prisma.dailyCheckin.findFirst({ orderBy: { date: 'desc' } }),
      prisma.dailyCheckin.findMany({ orderBy: { date: 'desc' }, take: 7 }),
      prisma.session.findMany({
        where: { date: { gte: weekStart, lt: weekEnd } },
        orderBy: { date: 'asc' },
        include: { plannedExercises: true, strengthSets: true },
      }),
      prisma.session.findFirst({
        where: { status: 'planned', date: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 86400000) } },
        include: { plannedExercises: true, strengthSets: true },
      }),
      prisma.session.findFirst({
        where: { status: 'planned', date: { gte: startOfToday } },
        orderBy: { date: 'asc' },
        include: { plannedExercises: true, strengthSets: true },
      }),
      prisma.bodyComposition.findFirst({ where: { source: 'Withings' }, orderBy: { date: 'desc' } }),
      prisma.bodyComposition.findFirst({ where: { source: 'InBody' }, orderBy: { date: 'desc' } }),
      prisma.athleteProfile.findFirst({ select: { name: true } }),
    ]);

  const firstName = profile?.name?.trim().split(/\s+/)[0] || null;

  // Only a check-in from TODAY drives "today's readiness"; older ones are stale.
  const todaysCheckin =
    latestCheckin && isoDate(latestCheckin.date) === isoDate(now) ? latestCheckin : null;
  const readiness = computeReadiness(todaysCheckin);

  // 7-day readiness bars (oldest→newest) from recent check-ins.
  const bars = recentCheckins
    .slice()
    .reverse()
    .map((c) => computeReadiness(c).score ?? 0);

  // Build the Mon→Sun strip.
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const todayIso = isoDate(now);
  const days: WeekDay[] = letters.map((letter, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const iso = isoDate(d);
    const onDay = weekSessions.filter((s) => isoDate(s.date) === iso);
    const done = onDay.some((s) => s.status === 'completed');
    const planned = onDay.some((s) => s.status === 'planned');
    const isToday = iso === todayIso;
    let state: WeekDay['state'] = 'rest';
    if (done) state = 'done';
    else if (isToday) state = 'today';
    else if (planned) state = 'planned';
    const label = isToday ? onDay[0]?.title ?? onDay[0]?.type : undefined;
    return { letter, iso, state, label };
  });

  const weekDone = weekSessions.filter((s) => s.status === 'completed').length;
  const weekPlanned = weekSessions.filter((s) => s.status === 'planned').length;

  // Which planned session to surface: today's if any, else the next upcoming.
  const focus = planToday ?? nextPlan;
  const focusSession = focus
    ? {
        id: focus.id,
        type: focus.type,
        title: focus.title,
        date: focus.date.toISOString(),
        isToday: isoDate(focus.date) === todayIso,
        exercises: focus.plannedExercises.length,
        loggedSets: focus.strengthSets.length,
        movementNames: focus.plannedExercises.slice(0, 2).map((e) => e.exerciseName),
        moreCount: Math.max(0, focus.plannedExercises.length - 2),
      }
    : null;

  const weightRow = latestWithings ?? latestInbody;

  return {
    firstName,
    readiness,
    checkedInToday: !!todaysCheckin,
    sleepHours: todaysCheckin?.sleepHours ?? null,
    weightKg: weightRow?.weightKg ?? null,
    weightSource: weightRow?.source ?? null,
    bodyFatPct: latestInbody?.bodyFatPct ?? null,
    bars,
    days,
    weekDone,
    weekPlanned,
    focusSession,
  };
}
