import { NextResponse } from 'next/server';
import { buildAuthUrl, isStravaConfigured } from '@/lib/strava';

export const dynamic = 'force-dynamic';

// GET /api/sync/strava — begin OAuth: redirect the user to Strava's consent.
export async function GET() {
  if (!isStravaConfigured()) {
    return NextResponse.json(
      {
        error:
          'Strava not configured. Set STRAVA_CLIENT_ID/SECRET in .env first.',
      },
      { status: 503 },
    );
  }
  return NextResponse.redirect(buildAuthUrl());
}
