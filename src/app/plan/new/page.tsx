import Link from 'next/link';

export const dynamic = 'force-dynamic';

// How you plan a session. For now the primary path is planning with Claude in
// chat; the manual in-app form is kept for edge cases. End-state: Claude pushes
// planned sessions straight into the app via POST /api/planned-sessions and they
// appear in the Calendar automatically — this screen is the interim bridge.
export default function NewPlanChooser() {
  return (
    <>
      <div className="topbar">
        <Link href="/plan" className="icon-btn"><span className="msr">chevron_left</span></Link>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ marginTop: 4 }}>
        <div className="eyebrow eyebrow-accent">PLAN A SESSION</div>
        <div className="h1-lg" style={{ marginTop: 8 }}>How do you want to plan?</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--text-dim)', marginTop: 8 }}>
          Plan with Claude in chat and it lands here automatically, or build one by hand.
        </div>
      </div>

      {/* Primary — Plan with AI */}
      <a
        href="https://claude.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="card"
        style={{ display: 'block', borderRadius: 22, marginTop: 20, background: 'var(--accent-tint)', border: '1px solid var(--accent-line)' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
          <div style={{ width: 44, height: 44, flex: 'none', borderRadius: 13, background: 'var(--accent)', color: 'var(--on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
            <span className="msr-fill">auto_awesome</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="h2">Plan with AI</div>
              <span className="msr" style={{ fontSize: 16, color: 'var(--accent)' }}>open_in_new</span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--text-dim)', marginTop: 4 }}>
              Open Claude and plan your session in chat. Once the app is deployed, Claude sends it straight into your Calendar.
            </div>
          </div>
        </div>
      </a>

      {/* Secondary — Plan in app */}
      <Link
        href="/plan/new/manual"
        className="card"
        style={{ display: 'block', borderRadius: 22, marginTop: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
          <div style={{ width: 44, height: 44, flex: 'none', borderRadius: 13, background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
            <span className="msr-fill">edit_note</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="h2">Plan in app</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--text-dim)', marginTop: 4 }}>
              Build a session by hand with the form — type, date, movements and targets.
            </div>
          </div>
          <span className="msr" style={{ fontSize: 20, color: 'var(--text-faint)', alignSelf: 'center' }}>chevron_right</span>
        </div>
      </Link>
    </>
  );
}
