/**
 * delete-session.ts — list planned sessions or delete one by id, via the
 * x-api-key endpoints.
 *
 *   npx tsx scripts/delete-session.ts --list          # print ids + dates
 *   npx tsx scripts/delete-session.ts <id> --dry-run  # preview only, no delete
 *   npx tsx scripts/delete-session.ts <id>            # preview + confirm + delete
 *   npx tsx scripts/delete-session.ts <id> --yes      # skip the confirmation
 *
 * A plain `<id>` prints what would be removed (session + exercise/set/run counts)
 * and then REQUIRES a typed confirmation before deleting. --dry-run stops after
 * the preview. --yes / -y skips the prompt (for scripts).
 *
 * Environment:
 *   PLANNED_SESSIONS_API_KEY   required — the x-api-key
 *   PFT_API_URL                base URL, default http://localhost:3000
 */
import { createInterface } from 'node:readline/promises';
import { parseFlowItems } from '../src/lib/flowItems';

function fail(msg: string): never {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function main() {
const args = process.argv.slice(2);
const list = args.includes('--list');
const dryRun = args.includes('--dry-run');
const yes = args.includes('--yes') || args.includes('-y');
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

if (!idArg) fail('Usage: npx tsx scripts/delete-session.ts --list | <id> [--dry-run] [--yes]');

// Preview: fetch the session + the child rows a delete would remove.
const pRes = await fetch(`${base}/api/planned-sessions/${idArg}`, { headers });
const pJson = (await pRes.json().catch(() => ({}))) as {
  session?: { id: number; title: string | null; type: string; date: string; status: string };
  counts?: { plannedExercises: number; strengthSets: number; runs: number };
  error?: string;
};
if (!pRes.ok || !pJson.session) fail(`Could not load session ${idArg} (${pRes.status}): ${pJson.error ?? 'not found'}`);
const s = pJson.session;
const c = pJson.counts ?? { plannedExercises: 0, strengthSets: 0, runs: 0 };

console.log(`\x1b[1mWould delete session #${s.id}\x1b[0m`);
console.log(`  Title:  ${s.title ?? `${s.type} session`}`);
console.log(`  Date:   ${new Date(s.date).toISOString().slice(0, 10)}  (${s.status})`);
console.log(`  Removes: ${c.plannedExercises} planned exercise(s), ${c.strengthSets} logged set(s), ${c.runs} run(s)`);

if (dryRun) {
  console.log('\n\x1b[33mDRY RUN — nothing deleted.\x1b[0m');
  process.exit(0);
}

if (!yes) {
  const warn = s.status === 'completed' ? ' This permanently removes logged data.' : '';
  const ok = await confirm(`\nDelete session #${s.id}?${warn} Type "y" to confirm: `);
  if (!ok) { console.log('Cancelled.'); process.exit(0); }
}

const res = await fetch(`${base}/api/planned-sessions/${idArg}`, { method: 'DELETE', headers });
const json = (await res.json().catch(() => ({}))) as { deleted?: { id: number; title: string | null; type: string; date: string }; error?: string };
if (!res.ok) fail(`Delete failed (${res.status}): ${json.error ?? 'unknown error'}`);

const d = json.deleted;
console.log(`\x1b[32m✓ Deleted session #${d?.id}\x1b[0m ${d?.title ?? `${d?.type} session`} (${d ? new Date(d.date).toISOString().slice(0, 10) : ''})`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
