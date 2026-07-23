// Region-based tempo model (Package P). A tempo notation is four explicit
// regions: eccentric (lower), isometric bottom (pause), concentric (lift), and
// rest/hold at top. Pure + framework-free so it is unit-testable and shared by
// the logger's tempo block.

export type RegionKey = 'ecc' | 'bottom' | 'con' | 'top';

export interface TempoRegion {
  key: RegionKey;
  label: string;
  sec: number;
  explosive?: boolean; // "X" in the concentric slot — move as fast as possible
}

export const REGION_LABEL: Record<RegionKey, string> = {
  ecc: 'Lower',
  bottom: 'Pause',
  con: 'Lift',
  top: 'Hold',
};
export const REGION_ORDER: RegionKey[] = ['ecc', 'bottom', 'con', 'top'];

/**
 * Parse a tempo notation into its active regions, in order. Supports 4-digit
 * (3030, 3110), an "X" explosive concentric (31X1), and shorter forms (a
 * 3-digit 303 = lower/pause/lift with no top hold). Zero-length or invalid
 * regions are dropped, so the result is exactly the regions that take time.
 */
export function parseTempoRegions(tempo: string): TempoRegion[] {
  const chars = String(tempo).toUpperCase().replace(/[^0-9X]/g, '').slice(0, 4).split('');
  const out: TempoRegion[] = [];
  chars.forEach((c, i) => {
    const key = REGION_ORDER[i];
    if (!key) return;
    const explosive = c === 'X';
    const sec = explosive ? 1 : Number(c);
    if (!Number.isFinite(sec) || sec <= 0) return; // 0 / invalid → not a timed region
    out.push({ key, label: explosive && key === 'con' ? 'Explode' : REGION_LABEL[key], sec, explosive });
  });
  return out;
}

/** Total cycle length (seconds) of one rep for a tempo. */
export function tempoCycleSeconds(tempo: string): number {
  return parseTempoRegions(tempo).reduce((a, r) => a + r.sec, 0);
}
