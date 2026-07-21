// Structured warm-up / cool-down items. Stored in Session.warmup / .cooldown as
// a JSON array (or a legacy plain string, handled on read). Shared by the API
// contract (write), the logger (read/log), and the export (read).

export interface FlowItem {
  name: string;
  detail?: string | null;        // reps / distance / duration text, e.g. "2×10"
  weightKg?: number | null;      // planned weight for weighted items
  done: boolean;                 // ticked in the logger
  loggedWeightKg?: number | null; // actual weight used (weighted items)
}

function floatOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function coerceItem(raw: unknown): FlowItem | null {
  if (typeof raw === 'string') { const n = raw.trim(); return n ? { name: n, done: false } : null; }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) return null;
  return {
    name,
    detail: strOrNull(o.detail),
    weightKg: floatOrNull(o.weightKg),
    done: !!o.done,
    loggedWeightKg: floatOrNull(o.loggedWeightKg),
  };
}

/**
 * Normalise untrusted input into items for storage. Accepts an array of
 * items/strings, OR a plain string (stored as a single item — backwards
 * compatible with the old free-text format). Returns null when empty.
 */
export function normalizeFlowInput(v: unknown): FlowItem[] | null {
  if (v == null) return null;
  if (typeof v === 'string') { const n = v.trim(); return n ? [{ name: n, done: false }] : null; }
  if (Array.isArray(v)) {
    const items = v.map(coerceItem).filter((x): x is FlowItem => x !== null);
    return items.length ? items : null;
  }
  return null;
}

/** Read a stored column (JSON array or legacy string) into items. */
export function parseFlowItems(raw: string | null | undefined): FlowItem[] {
  if (!raw) return [];
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const a = JSON.parse(s);
      if (Array.isArray(a)) return a.map(coerceItem).filter((x): x is FlowItem => x !== null);
    } catch { /* fall through to legacy */ }
  }
  return [{ name: s, done: false }]; // legacy plain string → single item
}

export function serializeFlowItems(items: FlowItem[] | null | undefined): string | null {
  return items && items.length ? JSON.stringify(items) : null;
}
