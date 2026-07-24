'use client';

// App-wide "Session in progress" mini-bar. Renders on every screen (it's in the
// root layout) whenever a logging draft exists, EXCEPT on that session's own
// logger screen. Tapping it returns straight into the live session (which
// auto-resumes and flashes "Resumed" if it was implicitly paused). This is the
// resume affordance that makes a backed-out session impossible to "lose".
//
// Item 4a: the bar is FIXED but reserves its own layout space — while it is
// showing we add a matching bottom padding to the app shell so page content
// scrolls clear and the bar never covers the last rows or the bottom nav.
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { latestDraft, clearDraft, DRAFT_EVENT, type SessionDraft } from '@/lib/sessionDraft';
import { fmtClock } from '@/lib/format';

const mmss = fmtClock;
// Item 7: a draft older than this is "stale" — it must not masquerade as a live
// session, so the bar offers to discard it (draft is local-only; nothing in the
// DB is touched).
const STALE_MS = 24 * 60 * 60 * 1000;

/** Human draft age, e.g. "just now", "3h ago", "2 days ago". */
function ageLabel(updatedAt: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - updatedAt) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function SessionBar() {
  const path = usePathname();
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [now, setNow] = useState(0); // 0 until mounted → SSR-safe (no age flash)

  useEffect(() => {
    const refresh = () => { setDraft(latestDraft()); setNow(Date.now()); };
    refresh();
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener(DRAFT_EVENT, refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVis);
    // Re-evaluate age every minute so a draft can cross the 24h threshold while
    // the bar is on screen.
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.removeEventListener(DRAFT_EVENT, refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, []);
  // Re-check whenever the route changes (e.g. right after Finish clears it).
  useEffect(() => { setDraft(latestDraft()); setNow(Date.now()); }, [path]);

  const visible = !!draft && path !== `/plan/${draft?.sessionId}/log`;

  // Toggle the layout-reserving class on the app shell so content clears the bar.
  useEffect(() => {
    const shell = document.getElementById('app-shell');
    if (!shell) return;
    shell.classList.toggle('has-session-bar', visible);
    return () => { shell.classList.remove('has-session-bar'); };
  }, [visible]);

  if (!draft || !visible) return null;

  const paused = draft.paused;
  const age = now ? ageLabel(draft.updatedAt, now) : '';
  const stale = now > 0 && now - draft.updatedAt > STALE_MS;

  // Item 7: a stale (>24h) draft gets a distinct warning treatment with a
  // discard action, so old state can't pass for a live session. The existing
  // age line stays. Discard clears only the local draft.
  if (stale) {
    return (
      <div className="flat-tokens" style={{ display: 'contents' }}>
        <div className="session-bar session-bar-stale" role="alert">
          <span className="msr-fill" aria-hidden="true" style={{ fontSize: 20, flex: 'none' }}>history</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>Old session, {age}</div>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Discard this old session?
            </div>
          </div>
          <button
            onClick={() => { clearDraft(draft.sessionId); setDraft(null); }}
            className="session-bar-btn"
            aria-label="Discard old session"
          >Discard</button>
          <Link href={`/plan/${draft.sessionId}/log`} className="session-bar-btn session-bar-btn-ghost" aria-label={`Resume ${draft.title}`}>Resume</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flat-tokens" style={{ display: 'contents' }}>
      <Link
        href={`/plan/${draft.sessionId}/log`}
        aria-label={`Return to session: ${draft.title}${paused ? ' (paused)' : ''}`}
        className="session-bar"
      >
        <span
          className={paused ? undefined : 'pft-live-dot'}
          aria-hidden="true"
          style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--on-accent)', opacity: paused ? 0.6 : 1, flex: 'none' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>
            {paused ? 'Session paused' : 'Session in progress'}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{draft.title}</span>
            <span style={{ flex: 'none', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{mmss(draft.elapsed)}</span>
          </div>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12.5, fontWeight: 600, flex: 'none' }}>
          {paused ? 'Resume' : 'Open'}<span className="msr-fill" style={{ fontSize: 18 }} aria-hidden="true">chevron_right</span>
        </span>
      </Link>
    </div>
  );
}
