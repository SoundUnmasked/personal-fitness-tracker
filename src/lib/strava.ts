// Strava integration (runs). Strava = source of truth for distance & pace.
// COROS supplies HR; Samsung Health / Galaxy Watch distance is IGNORED.
//
// The OAuth flow and data mapping are implemented; client id/secret are read
// from env placeholders, so nothing here works until you create a Strava app
// and fill in .env. No credentials are hardcoded.

import { paceFromSeconds } from './format';

const STRAVA_AUTH = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN = 'https://www.strava.com/oauth/token';
const STRAVA_API = 'https://www.strava.com/api/v3';

export function isStravaConfigured(): boolean {
  return (
    !!process.env.STRAVA_CLIENT_ID &&
    !process.env.STRAVA_CLIENT_ID.includes('REPLACE_ME') &&
    !!process.env.STRAVA_CLIENT_SECRET &&
    !process.env.STRAVA_CLIENT_SECRET.includes('REPLACE_ME')
  );
}

function redirectUri(): string {
  return (
    process.env.STRAVA_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || 'http://localhost:3000'}/api/sync/strava/callback`
  );
}

/** Build the Strava authorize URL the user is redirected to. */
export function buildAuthUrl(state = 'hyrox'): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID as string,
    redirect_uri: redirectUri(),
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state,
  });
  return `${STRAVA_AUTH}?${params.toString()}`;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Exchange an authorization code (or refresh token) for access tokens. */
export async function exchangeToken(
  params: { code: string } | { refreshToken: string },
): Promise<OAuthTokens> {
  const body: Record<string, string> = {
    client_id: process.env.STRAVA_CLIENT_ID as string,
    client_secret: process.env.STRAVA_CLIENT_SECRET as string,
  };
  if ('code' in params) {
    body.code = params.code;
    body.grant_type = 'authorization_code';
  } else {
    body.refresh_token = params.refreshToken;
    body.grant_type = 'refresh_token';
  }

  const res = await fetch(STRAVA_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Strava token exchange failed: ${res.status}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(json.expires_at * 1000),
  };
}

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date_local: string;
  distance: number; // metres
  moving_time: number; // seconds
  elapsed_time: number;
  average_heartrate?: number;
  max_heartrate?: number;
}

/** Fetch recent activities (runs only are mapped by the caller). */
export async function fetchActivities(
  accessToken: string,
  afterEpoch?: number,
): Promise<StravaActivity[]> {
  const params = new URLSearchParams({ per_page: '50' });
  if (afterEpoch) params.set('after', String(afterEpoch));
  const res = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status}`);
  return (await res.json()) as StravaActivity[];
}

export interface MappedRun {
  externalId: string;
  date: Date;
  title: string;
  type: 'Run';
  source: 'strava';
  durationMin: number;
  run: {
    distanceKm: number; // Strava = source of truth
    durationMin: number;
    avgPace: string; // derived from Strava distance/time
    avgHr: number | null; // present if device supplied it (COROS preferred)
    maxHr: number | null;
    hrSource: string | null; // COROS when Strava carried HR (top of the hierarchy)
  };
}

/**
 * Map a Strava activity to our Session+Run shape.
 * IMPORTANT: distance & pace come from Strava (source of truth). HR is passed
 * through if present (COROS feeds HR into Strava). Returns null for non-runs.
 */
export function mapActivityToRun(a: StravaActivity): MappedRun | null {
  const sport = (a.sport_type || a.type || '').toLowerCase();
  if (!sport.includes('run')) return null;

  const distanceKm = a.distance / 1000;
  const durationMin = a.moving_time / 60;
  const secondsPerKm = distanceKm > 0 ? a.moving_time / distanceKm : 0;

  return {
    externalId: String(a.id),
    date: new Date(a.start_date_local),
    title: a.name,
    type: 'Run',
    source: 'strava',
    durationMin: Math.round(durationMin),
    run: {
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMin: Number(durationMin.toFixed(1)),
      avgPace: secondsPerKm ? paceFromSeconds(secondsPerKm) : '—',
      avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
      maxHr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
      // Strava receives HR from the COROS watch, so any HR here is COROS —
      // the top of the priority hierarchy.
      hrSource: a.average_heartrate ? 'COROS' : null,
    },
  };
}
