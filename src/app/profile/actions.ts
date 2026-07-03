'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';

/** Update the athlete's display name (editable in Profile → settings). */
export async function updateName(name: string): Promise<{ ok: boolean; name: string }> {
  const clean = name.trim().slice(0, 60);
  const existing = await prisma.athleteProfile.findFirst();
  if (existing) {
    await prisma.athleteProfile.update({ where: { id: existing.id }, data: { name: clean || null } });
  } else {
    await prisma.athleteProfile.create({ data: { name: clean || null } });
  }
  revalidatePath('/');
  revalidatePath('/profile');
  return { ok: true, name: clean };
}
