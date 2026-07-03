/**
 * Create the schema on Turso / libSQL.
 *
 * Prisma's `db push` targets the local SQLite file; this script applies the
 * SAME schema (prisma/schema.sql, generated from schema.prisma) to your Turso
 * database via the libSQL client. Run it once after you set TURSO_DATABASE_URL
 * and TURSO_AUTH_TOKEN:
 *
 *     npm run db:push:turso
 *     npm run db:seed        # seed + (optionally) npm run import
 *
 * It is safe-ish to re-run: every CREATE uses IF NOT EXISTS so existing tables
 * are left untouched. To regenerate schema.sql after a schema change:
 *
 *     npx prisma migrate diff --from-empty \
 *       --to-schema-datamodel prisma/schema.prisma --script > prisma/schema.sql
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

async function main() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || undefined;
  if (!url) {
    console.error(
      'TURSO_DATABASE_URL is not set. Add it (and TURSO_AUTH_TOKEN) to .env first.',
    );
    process.exit(1);
  }

  const sqlPath = join(process.cwd(), 'prisma', 'schema.sql');
  const raw = readFileSync(sqlPath, 'utf8');

  // Make the DDL idempotent so re-running doesn't error on existing objects.
  const ddl = raw
    .replace(/CREATE TABLE "/g, 'CREATE TABLE IF NOT EXISTS "')
    .replace(/CREATE UNIQUE INDEX "/g, 'CREATE UNIQUE INDEX IF NOT EXISTS "')
    .replace(/CREATE INDEX "/g, 'CREATE INDEX IF NOT EXISTS "');

  const client = createClient({ url, authToken });
  console.log(`→ Applying schema to Turso (${url})`);
  await client.executeMultiple(ddl);
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' ORDER BY name",
  );
  console.log(
    '✓ Schema applied. Tables:',
    tables.rows.map((r) => r.name).join(', '),
  );
  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
