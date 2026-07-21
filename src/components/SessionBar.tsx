'use client';

// App-wide "Session in progress" mini-bar. Renders on every screen (it's in the
// root layout) whenever a logging draft exists, EXCEPT on that session's own
// logger screen. Tapping it returns to the live session. This is the resume
// affordance that makes a backed-out session impossible to "lose".
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

  if (!draft) return null;
  if (path === `/plan/${draft.sessionId}/log`) return null; // already there

  return (
    <Link
      href={`/plan/${draft.sessionId}/log`}
      aria-label={`Continue session: ${draft.title}`}
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 'calc(70px + env(safe-area-inset-bottom))',
        zIndex: 45, maxWidth: 460, margin: '0 auto', width: 'calc(100% - 24px)',
        display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px 10px 14px',
        borderRadius: 16, background: 'var(--accent)', color: 'var(--on-accent)',
        boxShadow: '0 12px 30px -10px var(--accent-glow)', textDecoration: 'none',
      }}
    >
      <span className="pft-live-dot" aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--on-accent)', flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', opacity: 0.85 }}>SESSION IN PROGRESS</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {draft.title} · {mmss(draft.elapsed)}
        </div>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12.5, fontWeight: 700, flex: 'none' }}>
        Continue<span className="msr-fill" style={{ fontSize: 18 }} aria-hidden="true">chevron_right</span>
      </span>
    </Link>
  );
}
