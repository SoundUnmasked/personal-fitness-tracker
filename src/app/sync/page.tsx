import { prisma } from '@/lib/prisma';
import { shortDate } from '@/lib/format';
import { isStravaConfigured } from '@/lib/strava';
import { isWithingsConfigured } from '@/lib/withings';
import { isAnthropicConfigured } from '@/lib/anthropic';
import SyncControls from '@/components/SyncControls';

export const dynamic = 'force-dynamic';

export default async function SyncPage() {
  const states = await prisma.syncState.findMany();
  const strava = states.find((s) => s.source === 'strava');
  const withings = states.find((s) => s.source === 'withings');

  const integrations = [
    {
      source: 'strava' as const,
      title: 'Strava',
      blurb: 'Runs — source of truth for distance & pace. HR via COROS.',
      state: strava,
      configured: isStravaConfigured(),
    },
    {
      source: 'withings' as const,
      title: 'Withings',
      blurb: 'Body composition — daily trend (kept separate from InBody).',
      state: withings,
      configured: isWithingsConfigured(),
    },
  ];

  return (
    <>
      <h1 className="page-title">Sync & integrations</h1>
      <p className="page-sub">Connect external sources. Credentials live in .env.</p>

      {integrations.map((it) => (
        <div className="card" key={it.source}>
          <h2>
            {it.title}
            <span className={`pill ${it.state?.status === 'connected' ? 'aerobic' : 'manual'}`}>
              {it.configured ? it.state?.status ?? 'disconnected' : 'not configured'}
            </span>
          </h2>
          <p className="muted" style={{ marginBottom: '0.75rem' }}>{it.blurb}</p>
          {it.state?.lastSyncedAt && (
            <p className="meta" style={{ marginBottom: '0.5rem' }}>
              Last synced: {shortDate(it.state.lastSyncedAt)}
            </p>
          )}
          {it.state?.status === 'error' && it.state.message && (
            <div className="err-note">{it.state.message}</div>
          )}
          <SyncControls
            source={it.source}
            connected={it.state?.status === 'connected'}
            configured={it.configured}
          />
        </div>
      ))}

      <div className="card">
        <h2>
          InBody extraction (Claude vision)
          <span className={`pill ${isAnthropicConfigured() ? 'aerobic' : 'manual'}`}>
            {isAnthropicConfigured() ? 'ready' : 'not configured'}
          </span>
        </h2>
        <p className="muted">
          {isAnthropicConfigured()
            ? 'ANTHROPIC_API_KEY is set — photo extraction is live.'
            : 'Add ANTHROPIC_API_KEY to .env to enable InBody photo extraction. Manual entry works regardless.'}
        </p>
      </div>

      <div className="card">
        <h2>Android Health Connect</h2>
        <p className="muted">
          Reserved integration point for a future native Android companion
          (steps, HR, sleep). Endpoint <code>/api/health-connect</code> is
          documented but not built — see README.
        </p>
      </div>
    </>
  );
}
