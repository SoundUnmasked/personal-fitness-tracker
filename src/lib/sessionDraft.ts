// Central store for an in-progress logging session ("draft"), shared by the
// logger (writer) and the app-wide "Session in progress" mini-bar (reader).
//
// Why a module (not just localStorage in the logger): the mini-bar lives in the
// root layout and must see the same draft from any screen. Everything is keyed
// by session id, with an index of ids so the bar can find the latest draft
// without knowing which session it is. A same-tab custom event plus the native
// cross-tab `storage` event keep every reader in sync.
//
// Durability: drafts are persisted to localStorage AND we request persistent
// storage (see requestPersistentStorage) so the browser is far less likely to
// evict them when the tab is backgrounded/discarded — the root cause of the
// "backing out wipes progress" report on Android Chrome.

export interface DraftSetRow {
  kg: string; reps: string; dur: string; rpe: string; done: boolean; prevKg: string; prevReps: string;
  warmup?: boolean; // warm-up (ramp-up) row — sits above set 1, no set number
}
import type { FlowItem } from './flowItems';

export interface SessionDraft {
  v: 2;
  sessionId: number;
  title: string;
  sets: DraftSetRow[][];
  warmup?: FlowItem[];   // logged warm-up items (done + loggedWeightKg)
  cooldown?: FlowItem[]; // logged cool-down items
  active: { ei: number; si: number; field: 'kg' | 'reps' | 'rpe' | 'dur' };
  elapsed: number;   // session seconds at last save
  paused: boolean;   // true once backed-out / paused → shown as "Continue"
  updatedAt: number; // epoch ms
}

const KEY = (id: number) => `pft:logdraft:v2:${id}`;
const IDS = 'pft:logdraft:ids';
export const DRAFT_EVENT = 'pft-draft-change';

function readIds(): number[] {
  try { const r = localStorage.getItem(IDS); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function writeIds(ids: number[]) {
  try { localStorage.setItem(IDS, JSON.stringify([...new Set(ids)])); } catch { /* ignore */ }
}
function emit() { try { window.dispatchEvent(new Event(DRAFT_EVENT)); } catch { /* ignore */ } }

export function saveDraft(d: SessionDraft): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY(d.sessionId), JSON.stringify(d));
    writeIds([...readIds(), d.sessionId]);
    emit();
  } catch { /* storage full/blocked */ }
}

export function readDraft(id: number): SessionDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const r = localStorage.getItem(KEY(id));
    if (!r) return null;
    const d = JSON.parse(r);
    return d && Array.isArray(d.sets) ? (d as SessionDraft) : null;
  } catch { return null; }
}

export function clearDraft(id: number): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY(id));
    writeIds(readIds().filter((x) => x !== id));
    emit();
  } catch { /* ignore */ }
}

/** The most-recently-updated live draft, for the app-wide mini-bar. */
export function latestDraft(): SessionDraft | null {
  if (typeof window === 'undefined') return null;
  const ids = readIds();
  let best: SessionDraft | null = null;
  const alive: number[] = [];
  for (const id of ids) {
    const d = readDraft(id);
    if (!d) continue; // stale id — drop it below
    alive.push(id);
    if (!best || d.updatedAt > best.updatedAt) best = d;
  }
  if (alive.length !== ids.length) writeIds(alive);
  return best;
}

/**
 * Ask the browser to keep our storage from being evicted under pressure.
 * Best-effort + feature-detected; the promise result is logged for debugging.
 */
export function requestPersistentStorage(): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      navigator.storage.persist().then((granted) => {
        // eslint-disable-next-line no-console
        console.log('[storage] persistent granted:', granted);
      }).catch(() => {});
    }
  } catch { /* unsupported */ }
}
