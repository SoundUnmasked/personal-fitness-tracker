import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  exchangeToken,
  fetchActivities,
  mapActivityToRun,
} from '@/lib/strava';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/sync/strava/sync — pull recent runs from Strava into sessions.
// Strava is the source of truth for distance/pace; HR passed through (COROS).
export async function POST() {
  const state = await prisma.syncState.findUnique({
    where: { source: 'strava' },
  });
  if (!state || state.status === 'disconnected' || !state.refreshToken) {
    return NextResponse.json(
      { error: 'Strava not connected. Connect it first.' },
      { status: 409 },
    );
  }

  await prisma.syncState.update({
    where: { source: 'strava' },
    data: { status: 'syncing' },
  });

  try {
    // Refresh the access token if it is missing or expired.
    let accessToken = state.accessToken ?? '';
    if (!accessToken || !state.expiresAt || state.expiresAt < new Date()) {
      const tokens = await exchangeToken({ refreshToken: state.refreshToken });
      accessToken = tokens.accessToken;
      await prisma.syncState.update({
        where: { source: 'strava' },
        data: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        },
      });
    }

    const afterEpoch = state.lastSyncedAt
      ? Math.floor(state.lastSyncedAt.getTime() / 1000)
      : undefined;
    const activities = await fetchActivities(accessToken, afterEpoch);

    let imported = 0;
    for (const activity of activities) {
      const mapped = mapActivityToRun(activity);
      if (!mapped) continue; // skip non-runs
      // Dedupe on (source, externalId).
      const existing = await prisma.session.findUnique({
        where: {
          source_externalId: { source: 'strava', externalId: mapped.externalId },
        },
      });
      if (existing) continue;

      await prisma.session.create({
        data: {
          date: mapped.date,
          type: 'Run',
          title: mapped.title,
          durationMin: mapped.durationMin,
          source: 'strava',
          externalId: mapped.externalId,
          runs: { create: mapped.run },
        },
      });
      imported++;
    }

    await prisma.syncState.update({
      where: { source: 'strava' },
      data: { status: 'connected', lastSyncedAt: new Date(), message: null },
    });
    return NextResponse.json({ imported, scanned: activities.length });
  } catch (err) {
    await prisma.syncState.update({
      where: { source: 'strava' },
      data: { status: 'error', message: (err as Error).message },
    });
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
