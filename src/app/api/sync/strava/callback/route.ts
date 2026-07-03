import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { exchangeToken, isStravaConfigured } from '@/lib/strava';

export const dynamic = 'force-dynamic';

// GET /api/sync/strava/callback?code=... — OAuth redirect target.
export async function GET(req: NextRequest) {
  const base = process.env.APP_BASE_URL || req.nextUrl.origin;
  if (!isStravaConfigured()) {
    return NextResponse.redirect(`${base}/sync?error=strava_not_configured`);
  }
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  if (error || !code) {
    await prisma.syncState.update({
      where: { source: 'strava' },
      data: { status: 'error', message: error || 'No code returned' },
    });
    return NextResponse.redirect(`${base}/sync?error=strava_denied`);
  }

  try {
    const tokens = await exchangeToken({ code });
    await prisma.syncState.upsert({
      where: { source: 'strava' },
      update: {
        status: 'connected',
        message: null,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
      create: {
        source: 'strava',
        status: 'connected',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
    });
    return NextResponse.redirect(`${base}/sync?connected=strava`);
  } catch (err) {
    await prisma.syncState.update({
      where: { source: 'strava' },
      data: { status: 'error', message: (err as Error).message },
    });
    return NextResponse.redirect(`${base}/sync?error=strava_token`);
  }
}
