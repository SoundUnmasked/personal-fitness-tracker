import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { exchangeToken, isWithingsConfigured } from '@/lib/withings';

export const dynamic = 'force-dynamic';

// GET /api/sync/withings/callback?code=... — OAuth redirect target.
export async function GET(req: NextRequest) {
  const base = process.env.APP_BASE_URL || req.nextUrl.origin;
  if (!isWithingsConfigured()) {
    return NextResponse.redirect(`${base}/sync?error=withings_not_configured`);
  }
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  if (error || !code) {
    await prisma.syncState.update({
      where: { source: 'withings' },
      data: { status: 'error', message: error || 'No code returned' },
    });
    return NextResponse.redirect(`${base}/sync?error=withings_denied`);
  }

  try {
    const tokens = await exchangeToken({ code });
    await prisma.syncState.upsert({
      where: { source: 'withings' },
      update: {
        status: 'connected',
        message: null,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
      create: {
        source: 'withings',
        status: 'connected',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
    });
    return NextResponse.redirect(`${base}/sync?connected=withings`);
  } catch (err) {
    await prisma.syncState.update({
      where: { source: 'withings' },
      data: { status: 'error', message: (err as Error).message },
    });
    return NextResponse.redirect(`${base}/sync?error=withings_token`);
  }
}
