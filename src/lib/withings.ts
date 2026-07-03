// Withings integration (body composition — daily trend).
// Withings = daily trend; InBody = accurate checkpoint. They are stored as
// separate rows and NEVER averaged.
//
// OAuth flow and measurement mapping implemented; credentials are env
// placeholders. Nothing runs until you create a Withings app and fill in .env.

const WITHINGS_AUTH = 'https://account.withings.com/oauth2_user/authorize2';
const WITHINGS_TOKEN = 'https://wbsapi.withings.net/v2/oauth2';
const WITHINGS_MEASURE = 'https://wbsapi.withings.net/measure';

export function isWithingsConfigured(): boolean {
  return (
    !!process.env.WITHINGS_CLIENT_ID &&
    !process.env.WITHINGS_CLIENT_ID.includes('REPLACE_ME') &&
    !!process.env.WITHINGS_CLIENT_SECRET &&
    !process.env.WITHINGS_CLIENT_SECRET.includes('REPLACE_ME')
  );
}

function redirectUri(): string {
  return (
    process.env.WITHINGS_REDIRECT_URI ||
    `${process.env.APP_BASE_URL || 'http://localhost:3000'}/api/sync/withings/callback`
  );
}

export function buildAuthUrl(state = 'hyrox'): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WITHINGS_CLIENT_ID as string,
    redirect_uri: redirectUri(),
    scope: 'user.metrics',
    state,
  });
  return `${WITHINGS_AUTH}?${params.toString()}`;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export async function exchangeToken(
  params: { code: string } | { refreshToken: string },
): Promise<OAuthTokens> {
  const form = new URLSearchParams({
    action: 'requesttoken',
    client_id: process.env.WITHINGS_CLIENT_ID as string,
    client_secret: process.env.WITHINGS_CLIENT_SECRET as string,
  });
  if ('code' in params) {
    form.set('grant_type', 'authorization_code');
    form.set('code', params.code);
    form.set('redirect_uri', redirectUri());
  } else {
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', params.refreshToken);
  }

  const res = await fetch(WITHINGS_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!res.ok) throw new Error(`Withings token exchange failed: ${res.status}`);
  const json = (await res.json()) as {
    status: number;
    body?: {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  };
  if (json.status !== 0 || !json.body) {
    throw new Error(`Withings token error (status ${json.status})`);
  }
  return {
    accessToken: json.body.access_token,
    refreshToken: json.body.refresh_token,
    expiresAt: new Date(Date.now() + json.body.expires_in * 1000),
  };
}

// Withings measure type codes we care about.
const MEAS = {
  WEIGHT: 1, // kg
  FAT_RATIO: 6, // %
  MUSCLE_MASS: 76, // kg (Withings reports muscle mass, mapped to SMM trend)
} as const;

interface WithingsGrp {
  date: number; // epoch seconds
  measures: { type: number; value: number; unit: number }[];
}

export async function fetchMeasures(
  accessToken: string,
  sinceEpoch?: number,
): Promise<WithingsGrp[]> {
  const form = new URLSearchParams({
    action: 'getmeas',
    meastypes: `${MEAS.WEIGHT},${MEAS.FAT_RATIO},${MEAS.MUSCLE_MASS}`,
    category: '1',
  });
  if (sinceEpoch) form.set('startdate', String(sinceEpoch));

  const res = await fetch(WITHINGS_MEASURE, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  if (!res.ok) throw new Error(`Withings getmeas failed: ${res.status}`);
  const json = (await res.json()) as {
    status: number;
    body?: { measuregrps: WithingsGrp[] };
  };
  if (json.status !== 0 || !json.body) {
    throw new Error(`Withings getmeas error (status ${json.status})`);
  }
  return json.body.measuregrps;
}

export interface MappedBodyComp {
  date: Date;
  source: 'Withings';
  weightKg: number | null;
  bodyFatPct: number | null;
  skeletalMuscleMassKg: number | null;
  raw: Record<string, unknown>;
}

/** Map a Withings measure group to a body_composition row. */
export function mapMeasureGroup(grp: WithingsGrp): MappedBodyComp {
  const get = (type: number): number | null => {
    const m = grp.measures.find((x) => x.type === type);
    return m ? m.value * Math.pow(10, m.unit) : null;
  };
  return {
    date: new Date(grp.date * 1000),
    source: 'Withings',
    weightKg: round(get(MEAS.WEIGHT)),
    bodyFatPct: round(get(MEAS.FAT_RATIO)),
    skeletalMuscleMassKg: round(get(MEAS.MUSCLE_MASS)),
    raw: { measuregrp: grp },
  };
}

function round(v: number | null): number | null {
  return v == null ? null : Number(v.toFixed(2));
}
