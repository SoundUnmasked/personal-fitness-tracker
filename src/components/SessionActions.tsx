'use client';

// Session overflow actions (Package G): Move (reschedule), Duplicate, Delete.
// Shared by the Calendar/Home list rows and the session detail screen. All work
// goes through the plan server actions; on delete we also clear the local draft
// so the "session in progress" mini-bar disappears if this was the live session.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { shortDate } from '@/lib/format';
import { clearDraft } from '@/lib/sessionDraft';
import {
  movePlanAction,
  duplicatePlanAction,
  deleteSessionAction,
  type MoveResult,
} from '@/app/plan/actions';

type Status = 'planned' | 'completed';
type View = null | 'menu' | 'move' | 'clash' | 'duplicate' | 'delete';

export default function SessionActions({
  sessionId,
  dateIso,
  title,
  type,
  status,
  variant = 'list',
}: {
  sessionId: number;
  dateIso: string; // YYYY-MM-DD
  title: string;
  type: string;
  status: Status;
  variant?: 'list' | 'detail';
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(null);
  const [moveDate, setMoveDate] = useState(dateIso);
  const [dupDate, setDupDate] = useState(dateIso);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clash, setClash] = useState<MoveResult['clash']>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  const close = () => { setView(null); setError(null); setClash(undefined); };
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  async function doMove(force: boolean) {
    setBusy(true); setError(null);
    const res = await movePlanAction(sessionId, moveDate, { force });
    setBusy(false);
    if (res.ok) { close(); router.refresh(); flash(`Moved to ${shortDate(moveDate)}`); return; }
    if (res.clash) { setClash(res.clash); setView('clash'); return; }
    setError(res.error ?? 'Could not move the session.');
  }

  async function doDuplicate() {
    setBusy(true); setError(null);
    const res = await duplicatePlanAction(sessionId, dupDate);
    setBusy(false);
    if (res.ok) { close(); router.refresh(); flash(`Duplicated to ${shortDate(dupDate)}`); return; }
    setError(res.error ?? 'Could not duplicate the session.');
  }

  async function doDelete() {
    setBusy(true); setError(null);
    const res = await deleteSessionAction(sessionId);
    setBusy(false);
    if (!res.ok) { setError(res.error ?? 'Could not delete the session.'); return; }
    clearDraft(sessionId); // drop any live draft + the mini-bar for this session
    close();
    if (variant === 'detail') { router.push('/plan'); router.refresh(); }
    else { router.refresh(); flash('Session deleted'); }
  }

  const trigger =
    variant === 'detail' ? (
      <button className="icon-btn dim" aria-label="Session actions" onClick={() => setView('menu')}>
        <span className="msr" aria-hidden="true">more_horiz</span>
      </button>
    ) : (
      <button
        aria-label={`Actions for ${title || `${type} session`}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setView('menu'); }}
        style={{ width: 34, height: 34, flex: 'none', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer' }}
      >
        <span className="msr" aria-hidden="true">more_horiz</span>
      </button>
    );

  const niceDate = shortDate(dateIso);

  return (
    <>
      {trigger}

      <Portal>
      {view === 'menu' && (
        <Sheet title={title || `${type} session`} subtitle={niceDate} onClose={close}>
          {status === 'planned' && (
            <Row icon="event" label="Move session" hint="Reschedule to another date" onClick={() => { setMoveDate(dateIso); setView('move'); }} />
          )}
          <Row icon="content_copy" label="Duplicate to another date" hint="Copies the plan, not logged sets" onClick={() => { setDupDate(dateIso); setView('duplicate'); }} />
          <Row icon="delete" label="Delete session" hint={status === 'completed' ? 'Permanently removes logged data' : 'Removes this planned session'} danger onClick={() => setView('delete')} />
        </Sheet>
      )}

      {view === 'move' && (
        <Sheet title="Move session" subtitle={`Currently ${niceDate}`} onClose={close}>
          {error && <div className="note note-err">{error}</div>}
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-faint)', margin: '4px 2px 6px' }}>New date</label>
          <input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} style={dateInput} />
          <button className="btn btn-lg" disabled={busy} onClick={() => doMove(false)}>
            {busy ? <span className="spin" /> : <>Move session<span className="msr-fill" style={{ fontSize: 20 }}>arrow_forward</span></>}
          </button>
        </Sheet>
      )}

      {view === 'clash' && clash && (
        <Dialog
          icon="event_busy"
          title="Date already has a session"
          body={`"${clash.title || `${clash.type} session`}" is already on ${shortDate(clash.date)}. Move here anyway and have both on the same day?`}
          confirmLabel="Move anyway"
          onCancel={() => setView('move')}
          onConfirm={() => doMove(true)}
          busy={busy}
        />
      )}

      {view === 'duplicate' && (
        <Sheet title="Duplicate session" subtitle="Copies the plan as a new planned session" onClose={close}>
          {error && <div className="note note-err">{error}</div>}
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-faint)', margin: '4px 2px 6px' }}>Copy to date</label>
          <input type="date" value={dupDate} onChange={(e) => setDupDate(e.target.value)} style={dateInput} />
          <button className="btn btn-lg" disabled={busy} onClick={doDuplicate}>
            {busy ? <span className="spin" /> : <>Duplicate<span className="msr-fill" style={{ fontSize: 20 }}>content_copy</span></>}
          </button>
        </Sheet>
      )}

      {view === 'delete' && (
        <Dialog
          icon="delete"
          danger
          title={`Delete "${title || `${type} session`}"?`}
          body={
            status === 'completed'
              ? `This session is on ${niceDate}. Deleting it permanently removes all logged sets and run data. This cannot be undone.`
              : `This planned session on ${niceDate} and its exercises will be removed. This cannot be undone.`
          }
          confirmLabel={status === 'completed' ? 'Delete logged session' : 'Delete session'}
          onCancel={close}
          onConfirm={doDelete}
          busy={busy}
          error={error}
        />
      )}

      {toast && (
        <div role="status" style={{ position: 'fixed', left: '50%', bottom: 'calc(96px + env(safe-area-inset-bottom))', transform: 'translateX(-50%)', zIndex: 90, maxWidth: 340, width: 'calc(100% - 40px)', background: 'var(--accent)', color: 'var(--on-accent)', borderRadius: 13, padding: '11px 14px', fontSize: 13.5, fontWeight: 700, boxShadow: '0 12px 30px -10px var(--accent-glow)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="msr-fill" style={{ fontSize: 18 }} aria-hidden="true">check_circle</span>{toast}
        </div>
      )}
      </Portal>
    </>
  );
}

/** Renders children into <body> so fixed overlays escape any ancestor stacking
 *  context (e.g. a list row with backdrop-filter). */
function Portal({ children }: { children: React.ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const node = document.createElement('div');
    document.body.appendChild(node);
    setEl(node);
    return () => { document.body.removeChild(node); };
  }, []);
  return el ? createPortal(children, el) : null;
}

const dateInput: React.CSSProperties = { width: '100%', height: 48, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 15, padding: '0 12px', marginBottom: 14 };

function Sheet({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 85, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--panel-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTop: '1px solid var(--border)', padding: '18px 18px calc(26px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
          <div className="h2" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          <button className="icon-btn dim" onClick={onClose} aria-label="Close"><span className="msr" aria-hidden="true">close</span></button>
        </div>
        {subtitle && <div className="sub" style={{ marginBottom: 14 }}>{subtitle}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
      </div>
    </div>
  );
}

function Row({ icon, label, hint, danger, onClick }: { icon: string; label: string; hint: string; danger?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '13px 14px', borderRadius: 14, border: `1px solid ${danger ? 'var(--err-line)' : 'var(--border)'}`, background: danger ? 'var(--err-tint)' : 'var(--surface)', cursor: 'pointer', color: danger ? 'var(--err-text)' : 'var(--text)' }}>
      <span className="msr-fill" style={{ fontSize: 22, color: danger ? 'var(--err-text)' : 'var(--accent)', flex: 'none' }} aria-hidden="true">{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: danger ? 'var(--err-text)' : 'var(--text-faint)', marginTop: 1 }}>{hint}</div>
      </div>
    </button>
  );
}

function Dialog({ icon, title, body, confirmLabel, danger, busy, error, onCancel, onConfirm }: {
  icon: string; title: string; body: string; confirmLabel: string; danger?: boolean; busy?: boolean; error?: string | null; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 88, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 }} onClick={(e) => { e.stopPropagation(); onCancel(); }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 340, background: 'var(--panel-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', border: '1px solid var(--border)', borderRadius: 22, padding: 20, textAlign: 'center' }}>
        <div style={{ width: 46, height: 46, margin: '0 auto 12px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: danger ? 'var(--err-tint)' : 'var(--accent-soft)' }}>
          <span className="msr-fill" style={{ fontSize: 22, color: danger ? 'var(--err-text)' : 'var(--accent)' }} aria-hidden="true">{icon}</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.4 }}>{body}</div>
        {error && <div className="note note-err" style={{ marginTop: 12, marginBottom: 0, textAlign: 'left' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={onCancel} disabled={busy} style={{ flex: 1, height: 46, border: '1px solid var(--border)', borderRadius: 13, background: 'var(--surface)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={onConfirm} disabled={busy} style={{ flex: 1.3, height: 46, borderRadius: 13, background: danger ? 'var(--err-tint)' : 'var(--accent)', color: danger ? 'var(--err-text)' : 'var(--on-accent)', border: danger ? '1px solid var(--err-line)' : 'none', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
            {busy ? <span className="spin" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
