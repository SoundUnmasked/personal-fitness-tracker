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
import { latestDraft, DRAFT_EVENT, type SessionDraft } from '@/lib/sessionDraft';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;

export default function SessionBar() {
  const path = usePathname();
  const [draft, setDraft] = useState<SessionDraft | null>(null);

  useEffect(() => {
    const refresh = () => setDraft(latestDraft());
    refresh();
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener(DRAFT_EVENT, refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener(DRAFT_EVENT, refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  // Re-check whenever the route changes (e.g. right after Finish clears it).
  useEffect(() => { setDraft(latestDraft()); }, [path]);

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

  return (
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
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', opacity: 0.85 }}>
          {paused ? 'SESSION PAUSED' : 'SESSION IN PROGRESS'}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {draft.title} · {paused ? 'paused' : mmss(draft.elapsed)}
        </div>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12.5, fontWeight: 700, flex: 'none' }}>
        {paused ? 'Resume' : 'Open'}<span className="msr-fill" style={{ fontSize: 18 }} aria-hidden="true">chevron_right</span>
      </span>
    </Link>
  );
}
