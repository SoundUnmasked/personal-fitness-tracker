import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  exchangeToken,
  fetchMeasures,
  mapMeasureGroup,
} from '@/lib/withings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/sync/withings/sync — pull body-comp measures into body_composition.
// Withings = daily trend; stored as separate rows from InBody (never averaged).
export async function POST() {
  const state = await prisma.syncState.findUnique({
    where: { source: 'withings' },
  });
  if (!state || state.status === 'disconnected' || !state.refreshToken) {
    return NextResponse.json(
      { error: 'Withings not connected. Connect it first.' },
      { status: 409 },
    );
  }

  await prisma.syncState.update({
    where: { source: 'withings' },
    data: { status: 'syncing' },
  });

  try {
    let accessToken = state.accessToken ?? '';
    if (!accessToken || !state.expiresAt || state.expiresAt < new Date()) {
      const tokens = await exchangeToken({ refreshToken: state.refreshToken });
      accessToken = tokens.accessToken;
      await prisma.syncState.update({
        where: { source: 'withings' },
        data: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        },
      });
    }

    const sinceEpoch = state.lastSyncedAt
      ? Math.floor(state.lastSyncedAt.getTime() / 1000)
      : undefined;
    const groups = await fetchMeasures(accessToken, sinceEpoch);

    let imported = 0;
    for (const grp of groups) {
      const mapped = mapMeasureGroup(grp);
      // Dedupe by (source, date) — one Withings row per measure timestamp.
      const existing = await prisma.bodyComposition.findFirst({
        where: { source: 'Withings', date: mapped.date },
      });
      if (existing) continue;
      await prisma.bodyComposition.create({
        data: {
          date: mapped.date,
          source: 'Withings',
          weightKg: mapped.weightKg,
          bodyFatPct: mapped.bodyFatPct,
          skeletalMuscleMassKg: mapped.skeletalMuscleMassKg,
          raw: JSON.stringify(mapped.raw),
        },
      });
      imported++;
    }

    await prisma.syncState.update({
      where: { source: 'withings' },
      data: { status: 'connected', lastSyncedAt: new Date(), message: null },
    });
    return NextResponse.json({ imported, scanned: groups.length });
  } catch (err) {
    await prisma.syncState.update({
      where: { source: 'withings' },
      data: { status: 'error', message: (err as Error).message },
    });
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
