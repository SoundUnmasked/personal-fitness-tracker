/**
 * backup-db.ts — dump every table to a timestamped JSON file so a snapshot can
 * be taken before any destructive command (delete, discard, bulk edit).
 *
 *   npx tsx scripts/backup-db.ts
 *   npx tsx scripts/backup-db.ts --out /some/dir
 *
 * It connects with the SAME env as the app (src/lib/prisma): if TURSO_DATABASE_URL
 * is set it backs up the live Turso database, otherwise the local SQLite file in
 * DATABASE_URL. Output goes to backups/ (gitignored) unless --out is given.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma, dbTarget } from '../src/lib/prisma';

function fail(msg: string): never {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : join(process.cwd(), 'backups');

  // Every model in schema.prisma. Add new models here when the schema grows.
  const tables = {
    athleteProfile: () => prisma.athleteProfile.findMany(),
    sessions: () => prisma.session.findMany(),
    plannedExercises: () => prisma.plannedExercise.findMany(),
    strengthSets: () => prisma.strengthSet.findMany(),
    runs: () => prisma.run.findMany(),
    bodyComposition: () => prisma.bodyComposition.findMany(),
    dailyCheckins: () => prisma.dailyCheckin.findMany(),
    goals: () => prisma.goal.findMany(),
    syncState: () => prisma.syncState.findMany(),
  } as const;

  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const [name, load] of Object.entries(tables)) {
    const rows = await load();
    data[name] = rows;
    counts[name] = rows.length;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(outDir, `backup-${stamp}.json`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ takenAt: new Date().toISOString(), target: dbTarget, counts, data }, null, 2),
  );

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\x1b[32m✓ Backed up ${total} row(s) from ${Object.keys(tables).length} tables (${dbTarget})\x1b[0m`);
  for (const [name, n] of Object.entries(counts)) console.log(`  ${name.padEnd(18)} ${n}`);
  console.log(`  → ${file}`);

  await prisma.$disconnect();
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
