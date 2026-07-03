'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SyncControls({
  source,
  connected,
  configured,
}: {
  source: 'strava' | 'withings';
  connected: boolean;
  configured: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function runSync() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch(`/api/sync/${source}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setMsg(`Imported ${data.imported} of ${data.scanned} scanned.`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {err && <div className="err-note">{err}</div>}
      {msg && <div className="ok-note">{msg}</div>}
      {!configured ? (
        <p className="muted">
          Add <code>{source.toUpperCase()}_CLIENT_ID</code> and{' '}
          <code>{source.toUpperCase()}_CLIENT_SECRET</code> to <code>.env</code> to enable.
        </p>
      ) : connected ? (
        <div className="row">
          <button className="btn btn-sm" onClick={runSync} disabled={busy}>
            {busy ? <span className="spin" /> : 'Sync now'}
          </button>
          <a className="btn ghost btn-sm" href={`/api/sync/${source}`}>
            Reconnect
          </a>
        </div>
      ) : (
        <a className="btn btn-sm" href={`/api/sync/${source}`}>
          Connect {source}
        </a>
      )}
    </div>
  );
}
