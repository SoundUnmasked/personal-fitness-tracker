// Small formatting / parsing helpers shared by UI and sync code.

/**
 * The one true time format (Package N item 5): seconds -> "M:SS", rolling over
 * to "H:MM:SS" past an hour. Never "45s", never "1 min", never mixed units.
 * Used for rest timers, the session clock, and every logged/duration time.
 */
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Minutes -> "M:SS" style clock (whole minutes come in as e.g. a session's durationMin). */
export function fmtClockFromMinutes(totalMinutes: number): string {
  return fmtClock(Math.round(totalMinutes * 60));
}

/** Format a Date (or ISO string) as "Mon 16 Jun". */
export function shortDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Format a Date as YYYY-MM-DD (for <input type="date"> and grouping). */
export function isoDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Seconds-per-km -> "m:ss /km" pace string. */
export function paceFromSeconds(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

/** Derive an avg pace string from distance (km) and duration (min). */
export function paceFromDistance(
  distanceKm: number,
  durationMin: number,
): string | null {
  if (!distanceKm || !durationMin) return null;
  const secondsPerKm = (durationMin * 60) / distanceKm;
  return paceFromSeconds(secondsPerKm);
}

/** Bucket an hour-of-day (0-23) into morning / afternoon / evening / night. */
export function timeOfDayBucket(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 22) return 'Evening';
  return 'Night';
}
