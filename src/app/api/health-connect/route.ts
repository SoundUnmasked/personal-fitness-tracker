import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// FUTURE INTEGRATION POINT — Android Health Connect companion (NOT built yet).
//
// This route documents the planned contract so a future native Android app can
// push Health Connect data (steps, HR, sleep, workouts) into this database
// without changing the schema. It is intentionally a stub: it advertises the
// expected payload and returns 501 Not Implemented.
//
// Planned contract (POST, when implemented):
//   headers: Authorization: Bearer <device token>   (per-device secret)
//   body: {
//     source: "health-connect",
//     records: [
//       { kind: "sleep",    date, sleepHours, ... }     -> daily_checkin (merge)
//       { kind: "heartrate", date, avgHr, maxHr, ... }   -> runs / sessions
//       { kind: "exercise", date, type, durationMin }    -> sessions
//     ]
//   }
//
// Mapping rules to honour when implementing:
//   - Strava remains source of truth for run distance/pace.
//   - COROS HR preferred; Health Connect HR only fills gaps.
//   - Samsung Health / Galaxy Watch *distance* must still be ignored.
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json({
    status: 'planned',
    implemented: false,
    note: 'Health Connect ingest endpoint for a future Android companion. See source comments for the planned contract.',
  });
}

export async function POST() {
  return NextResponse.json(
    {
      error: 'Not implemented',
      note: 'Health Connect ingest is a documented future integration point and is not built yet.',
    },
    { status: 501 },
  );
}
