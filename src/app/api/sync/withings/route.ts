import { NextResponse } from 'next/server';
import { buildAuthUrl, isWithingsConfigured } from '@/lib/withings';

export const dynamic = 'force-dynamic';

// GET /api/sync/withings — begin OAuth: redirect to Withings consent.
export async function GET() {
  if (!isWithingsConfigured()) {
    return NextResponse.json(
      {
        error:
          'Withings not configured. Set WITHINGS_CLIENT_ID/SECRET in .env first.',
      },
      { status: 503 },
    );
  }
  return NextResponse.redirect(buildAuthUrl());
}
