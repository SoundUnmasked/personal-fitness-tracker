import { unlockAction } from './actions';

export const dynamic = 'force-dynamic';

// Minimal passphrase gate. Server-rendered, works without client JS (plain
// form → server action → redirect), styled entirely with the Cobalt tokens so
// it follows light/dark like every other screen.
export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div
      style={{
        minHeight: '80vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 8px',
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 360, borderRadius: 26, padding: '26px 22px', textAlign: 'center' }}>
        <div
          style={{
            width: 56,
            height: 56,
            margin: '0 auto',
            borderRadius: '50%',
            background: 'var(--accent-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span className="msr-fill" style={{ fontSize: 26, color: 'var(--accent)' }} aria-hidden="true">
            lock
          </span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 14 }}>
          Fitness Tracker
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 5 }}>
          Enter the passphrase to unlock.
        </p>

        {error === 'unconfigured' ? (
          <div className="note note-err" style={{ marginTop: 16, textAlign: 'left' }}>
            The app is not configured for unlocking yet.
          </div>
        ) : error ? (
          <div className="note note-err" style={{ marginTop: 16, textAlign: 'left' }}>
            Wrong passphrase — try again.
          </div>
        ) : null}

        <form action={unlockAction} style={{ marginTop: 18 }}>
          <label htmlFor="passphrase" style={{ display: 'block', textAlign: 'left' }}>
            Passphrase
          </label>
          <input
            id="passphrase"
            name="passphrase"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            style={{ width: '100%' }}
          />
          <button type="submit" className="btn" style={{ width: '100%', marginTop: 14 }}>
            <span className="msr-fill" style={{ fontSize: 20 }} aria-hidden="true">
              lock_open
            </span>
            Unlock
          </button>
        </form>
      </div>
    </div>
  );
}
