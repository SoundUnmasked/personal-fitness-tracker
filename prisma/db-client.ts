/**
 * Shared PrismaClient factory for the CLI scripts (seed, import, turso-push).
 *
 * Mirrors src/lib/prisma.ts: connect to Turso/libSQL when TURSO_DATABASE_URL is
 * set, otherwise the local SQLite file. This is why `npm run db:seed` and
 * `npm run import` automatically target the cloud DB once the keys are present —
 * no code change needed when you migrate.
 */
import { PrismaClient } from '@prisma/client';

export function makePrismaClient(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  if (tursoUrl) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaLibSQL } = require('@prisma/adapter-libsql');
    const adapter = new PrismaLibSQL({
      url: tursoUrl,
      authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
    });
    return new PrismaClient({ adapter });
  }
  return new PrismaClient();
}

export const usingTurso = !!process.env.TURSO_DATABASE_URL?.trim();
