// Readiness — a 0–100 morning score.
//
// GRACEFUL DEGRADATION: the design envisions readiness blending objective
// wearable data (HRV, sleep) with subjective input. Those sources are not wired
// yet (Health Connect / Samsung phase), so for now readiness is computed purely
// from the latest DAILY CHECK-IN (subjective sleep / energy / freshness / mood),
// which is real data we already collect. When there is no check-in we return a
// clean "not yet" state — never a broken tile. The weighting mirrors the design
// mockup so the number is consistent across screens.

export interface CheckinLike {
  sleepQuality?: number | null; // 1–5
  energyMorning?: number | null; // 1–5
  energyAfternoon?: number | null; // 1–5
  energyEvening?: number | null; // 1–5
  soreness?: number | null; // 1–5 (higher = more sore)
  mood?: number | null; // 1–5
}

export interface Readiness {
  hasData: boolean;
  score: number | null; // 0–100
  label: string; // primed | recovered | moderate | compromised | —
  note: string;
  /** whether the score is subjective-only (no wearable objective data yet) */
  subjectiveOnly: boolean;
}

const norm = (v: number | null | undefined): number | null =>
  v == null ? null : Math.max(0, Math.min(1, (v - 1) / 4));

function avg(vals: (number | null)[]): number | null {
  const xs = vals.filter((v): v is number => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function computeReadiness(c: CheckinLike | null | undefined): Readiness {
  if (!c) {
    return {
      hasData: false,
      score: null,
      label: '—',
      note: 'Check in to set your readiness for today.',
      subjectiveOnly: true,
    };
  }

  const sleep = norm(c.sleepQuality);
  const energy = avg([norm(c.energyMorning), norm(c.energyAfternoon), norm(c.energyEvening)]);
  // Freshness is the inverse of soreness (less sore = fresher).
  const freshness = c.soreness == null ? null : norm(6 - c.soreness);
  const mood = norm(c.mood);

  // Missing dimensions default to neutral (0.5) so a partial check-in still scores.
  const f = (v: number | null) => (v == null ? 0.5 : v);
  const raw = 53 + f(sleep) * 13 + f(energy) * 13 + f(freshness) * 12 + f(mood) * 9;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const label =
    score >= 80 ? 'primed' : score >= 65 ? 'recovered' : score >= 50 ? 'moderate' : 'compromised';
  const note =
    score >= 80
      ? 'Green light — push your top sets today.'
      : score >= 65
        ? 'Train as planned, leave 1–2 reps in reserve.'
        : score >= 50
          ? 'Dial back volume or intensity a touch.'
          : 'Consider a lighter session or a recovery day.';

  return { hasData: true, score, label, note, subjectiveOnly: true };
}
