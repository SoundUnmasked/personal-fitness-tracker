import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * The "+" tab's daily loop (L1): jump straight to today's planned session if
 * one exists, otherwise to creating a new session. Evaluated per tap (dynamic)
 * so a session planned mid-visit is picked up. Same local-midnight day window
 * as the Home screen's "today" query (lib/home.ts).
 */
export default async function TodayPage() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const planToday = await prisma.session.findFirst({
    where: {
      status: 'planned',
      date: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 86_400_000) },
    },
    orderBy: { date: 'asc' },
    select: { id: true },
  });
  redirect(planToday ? `/plan/${planToday.id}` : '/plan/new');
}
