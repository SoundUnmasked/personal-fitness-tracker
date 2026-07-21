/**
 * push-session.ts — validate a planned-session JSON file against the API
 * contract and POST it to the running app.
 *
 *   npx tsx scripts/push-session.ts sessions/2026-07-22-power-upper.json
 *   npx tsx scripts/push-session.ts sessions/<file>.json --dry-run
 *
 * Environment:
 *   PLANNED_SESSIONS_API_KEY   required (unless --dry-run) — the x-api-key
 *   PFT_API_URL                base URL, default http://localhost:3000
 *
 * --dry-run validates and prints the summary WITHOUT contacting the server, so
 * a payload can be checked offline. Exit code is non-zero on any failure.
 */
import { readFileSync } from 'node:fs';
import { validatePlannedSession } from '../src/lib/plannedSessions';
import { parseFlowItems } from '../src/lib/flowItems';

function fail(msg: string): never {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

async function main() {
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = args.find((a) => !a.startsWith('--'));
if (!file) fail('Usage: npx tsx scripts/push-session.ts <file.json> [--dry-run]');

let raw: string;
try {
  raw = readFileSync(file, 'utf8');
} catch {
  fail(`Cannot read file: ${file}`);
}

let body: unknown;
try {
  body = JSON.parse(raw);
} catch (e) {
  fail(`Invalid JSON in ${file}: ${(e as Error).message}`);
}

// Validate against the SAME contract the API enforces, before sending.
const result = validatePlannedSession(body);
if (!result.ok || !result.value) {
  fail(`Payload rejected by the API contract: ${result.error}`);
}
const v = result.value;
const warmCount = v.warmup?.length ?? 0;
const coolCount = v.cooldown?.length ?? 0;

console.log(`\x1b[32m✓ Valid payload\x1b[0m  ${file}`);
console.log(`  Title:       ${v.title ?? '(none)'}`);
console.log(`  Type / date: ${v.type} · ${v.date}`);
console.log(`  Exercises:   ${v.exercises.length}`);
console.log(`  Warm-up:     ${warmCount} item(s)`);
console.log(`  Cool-down:   ${coolCount} item(s)`);

if (dryRun) {
  console.log('\n\x1b[33mDRY RUN — nothing sent.\x1b[0m Remove --dry-run to create it.');
  process.exit(0);
}

const key = process.env.PLANNED_SESSIONS_API_KEY?.trim();
if (!key) fail('PLANNED_SESSIONS_API_KEY is not set in the environment.');
const base = (process.env.PFT_API_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');

const res = await fetch(`${base}/api/planned-sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': key },
  body: JSON.stringify(body),
});

let json: { session?: { id: number; date: string; title: string | null; warmup: string | null; cooldown: string | null; plannedExercises?: unknown[] }; error?: string };
try {
  json = await res.json();
} catch {
  fail(`Server returned ${res.status} with a non-JSON body.`);
}

if (!res.ok || !json.session) {
  fail(`Server rejected the push (${res.status}): ${json.error ?? 'unknown error'}`);
}

const s = json.session;
const storedWarm = parseFlowItems(s.warmup);
const storedCool = parseFlowItems(s.cooldown);
console.log(`\n\x1b[32m✓ Created session #${s.id}\x1b[0m`);
console.log(`  Date:      ${new Date(s.date).toISOString().slice(0, 10)}`);
console.log(`  Title:     ${s.title ?? '(none)'}`);
console.log(`  Exercises: ${s.plannedExercises?.length ?? 0}`);
console.log(`  Warm-up stored:  ${storedWarm.length > 0 ? `yes (${storedWarm.length} items)` : 'NO'}`);
console.log(`  Cool-down stored: ${storedCool.length > 0 ? `yes (${storedCool.length} items)` : 'NO'}`);
if (storedWarm.length !== warmCount || storedCool.length !== coolCount) {
  fail('Stored warm-up / cool-down item counts do not match the payload.');
}
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
