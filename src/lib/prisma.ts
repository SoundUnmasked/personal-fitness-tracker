import { PrismaClient } from '@prisma/client';

// One shared PrismaClient. In dev it is cached across hot reloads so we don't
// exhaust connections.
//
// DATABASE TARGET
// ---------------
// • If TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN for remote) is set, we connect to
//   Turso / libSQL through the Prisma driver adapter — this is the cloud path.
// • Otherwise we fall back to the local SQLite file in DATABASE_URL. This means
//   the app still runs locally tomorrow BEFORE any Turso keys are added.
//
// The libSQL adapter is imported lazily and only when Turso is configured, so a
// plain local run needs neither the credentials nor the adapter to be loaded.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const log: ('error' | 'warn')[] =
  process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'];

function createClient(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();

  if (tursoUrl) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaLibSQL } = require('@prisma/adapter-libsql');
    const adapter = new PrismaLibSQL({
      url: tursoUrl,
      authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
    });
    return new PrismaClient({ adapter, log });
  }

  return new PrismaClient({ log });
}

/** Which database this process is talking to (handy for banners/logs). */
export const dbTarget: 'turso' | 'sqlite' = process.env.TURSO_DATABASE_URL?.trim()
  ? 'turso'
  : 'sqlite';

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
