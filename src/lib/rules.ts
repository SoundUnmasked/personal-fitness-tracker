// Domain rules. These FLAG situations (return warnings) — they never block.

import {
  HARD_SESSION_TYPES,
  HR_SOURCE_PRIORITY,
  UNRELIABLE_HR_SOURCES,
  RUN_COMPONENT_TYPES,
  COOLDOWN_PROMPT_TYPES,
  type SessionType,
  type HrSource,
} from './constants';

export interface SessionLike {
  date: Date | string;
  type: string;
}

/**
 * Rule: flag (don't block) when two hard sessions are logged back-to-back.
 * "Hard" = Power or Foundation only (Aerobic is NOT hard — see constants).
 * "Back-to-back" = two hard sessions on the same calendar day OR on
 * consecutive calendar days. Returns a human-readable warning, or null.
 *
 * @param candidate the session being added/edited
 * @param existing  all other sessions to compare against
 */
export function backToBackHardWarning(
  candidate: SessionLike,
  existing: SessionLike[],
): string | null {
  if (!isHard(candidate.type)) return null;

  const candDay = dayNumber(candidate.date);

  for (const s of existing) {
    if (!isHard(s.type)) continue;
    const diff = Math.abs(dayNumber(s.date) - candDay);
    if (diff <= 1) {
      const when =
        diff === 0 ? 'on the same day' : 'on the day before/after';
      return `Two hard sessions ${when}: "${candidate.type}" close to "${s.type}" (both Power/Foundation). Consider recovery.`;
    }
  }
  return null;
}

export function isHard(type: string): boolean {
  return HARD_SESSION_TYPES.includes(type as SessionType);
}

/** True when the session type carries a run (Run or Aerobic). */
export function hasRunComponent(type: string): boolean {
  return RUN_COMPONENT_TYPES.includes(type as SessionType);
}

/** True when the session type should prompt the 10-min cooldown (Foundation). */
export function needsCooldownPrompt(type: string): boolean {
  return COOLDOWN_PROMPT_TYPES.includes(type as SessionType);
}

export interface HrPick {
  source: HrSource | null;
  /** true when the chosen source is a flagged, less-reliable fallback. */
  unreliable: boolean;
  /** short human note when a fallback was used, else null. */
  warning: string | null;
}

/**
 * HR source hierarchy (NOT a whitelist). Given the set of sources that actually
 * produced a reading for this session, pick the highest-priority one:
 *   1) COROS  2) Technogym machine  3) Samsung/Galaxy (fallback, flagged).
 * Samsung is acceptable when nothing better is available — it is logged, but
 * flagged as unreliable (Elvanse-inflated). Never returns null just because the
 * preferred source is missing; only returns null when NO source is available.
 */
export function pickHrSource(available: (string | null | undefined)[]): HrPick {
  const present = new Set(
    available
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .map((s) => normalizeHrSource(s))
      .filter((s): s is HrSource => s !== null),
  );

  for (const source of HR_SOURCE_PRIORITY) {
    if (present.has(source)) {
      const unreliable = UNRELIABLE_HR_SOURCES.includes(source);
      return {
        source,
        unreliable,
        warning: unreliable
          ? `HR from ${source} — least-reliable fallback (Elvanse-inflated); no COROS/Technogym reading available.`
          : null,
      };
    }
  }
  return { source: null, unreliable: false, warning: null };
}

/** Map loose input ("coros", "Galaxy Watch") to a canonical HrSource. */
export function normalizeHrSource(raw: string): HrSource | null {
  const s = raw.toLowerCase();
  if (s.includes('coros')) return 'COROS';
  if (s.includes('technogym') || s.includes('machine')) return 'Technogym';
  if (s.includes('samsung') || s.includes('galaxy')) return 'Samsung';
  return null;
}

/** Days since epoch in local time (calendar-day granularity). */
function dayNumber(d: Date | string): number {
  const date = typeof d === 'string' ? new Date(d) : d;
  return Math.floor(
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() /
      86_400_000,
  );
}
