/**
 * delete-session.ts — list planned sessions or delete one by id, via the
 * x-api-key endpoints.
 *
 *   npx tsx scripts/delete-session.ts --list        # print ids + dates
 *   npx tsx scripts/delete-session.ts <id>          # delete session <id>
 *
 * Environment:
 *   PLANNED_SESSIONS_API_KEY   required — the x-api-key
 *   PFT_API_URL                base URL, default http://localhost:3000
 */
import { parseFlowItems } from '../src/lib/flowItems';

function fail(msg: string): never {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

async function main() {
const args = process.argv.slice(2);
const list = args.includes('--list');
const idArg = args.find((a) => /^\d+$/.test(a));

const key = process.env.PLANNED_SESSIONS_API_KEY?.trim();
if (!key) fail('PLANNED_SESSIONS_API_KEY is not set in the environment.');
const base = (process.env.PFT_API_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');
const headers = { 'x-api-key': key };

if (list) {
  const res = await fetch(`${base}/api/planned-sessions?scope=all`, { headers });
  const json = (await res.json().catch(() => ({}))) as { sessions?: Array<{ id: number; date: string; type: string; title: string | null; warmup: string | null }>; error?: string };
  if (!res.ok) fail(`List failed (${res.status}): ${json.error ?? 'unknown error'}`);
  const rows = json.sessions ?? [];
  if (rows.length === 0) { console.log('No planned sessions.'); process.exit(0); }
  console.log(`\x1b[1mID    DATE        TYPE        WARM  TITLE\x1b[0m`);
  for (const s of rows) {
    const date = new Date(s.date).toISOString().slice(0, 10);
    const warm = parseFlowItems(s.warmup).length;
    console.log(
      `${String(s.id).padEnd(5)} ${date}  ${s.type.padEnd(11)} ${String(warm).padEnd(5)} ${s.title ?? ''}`,
    );
  }
  process.exit(0);
}

if (!idArg) fail('Usage: npx tsx scripts/delete-session.ts --list | <id>');

const res = await fetch(`${base}/api/planned-sessions/${idArg}`, { method: 'DELETE', headers });
const json = (await res.json().catch(() => ({}))) as { deleted?: { id: number; title: string | null; type: string; date: string }; error?: string };
if (!res.ok) fail(`Delete failed (${res.status}): ${json.error ?? 'unknown error'}`);

const d = json.deleted;
console.log(`\x1b[32m✓ Deleted session #${d?.id}\x1b[0m ${d?.title ?? `${d?.type} session`} (${d ? new Date(d.date).toISOString().slice(0, 10) : ''})`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
