import { makePrismaClient, usingTurso } from './db-client';

const prisma = makePrismaClient();
if (usingTurso) console.log('→ Seeding Turso/libSQL (TURSO_DATABASE_URL set)');

async function main() {
  // --- Athlete profile (single row) ----------------------------------------
  // Reference baselines kept on the profile for context. The actual body-comp
  // checkpoints are loaded from real history by prisma/import-logbook.ts.
  const baselines = {
    inbody_dec_2024: {
      date: '2024-12-01',
      weight_kg: 84.5,
      body_fat_pct: 14.7,
      skeletal_muscle_mass_kg: 41.7,
      note: 'InBody baseline (Third Space), Dec 2024.',
    },
    inbody_apr_2026: {
      date: '2026-04-20',
      weight_kg: 89.0,
      body_fat_pct: 17.9,
      skeletal_muscle_mass_kg: 42.2,
      note: 'InBody at start of 12-week block, Apr 2026.',
    },
  };
  // General health & fitness is the headline. Hyrox is one goal among several.
  const goals = {
    focus: 'General health & fitness',
    body_fat_pct_target: 12,
    hyrox: { target_time: 'sub-1:30' },
  };

  const existingProfile = await prisma.athleteProfile.findFirst();
  if (!existingProfile) {
    await prisma.athleteProfile.create({
      data: {
        name: 'Oliver Leonard',
        goalsJson: JSON.stringify(goals),
        baselines: JSON.stringify(baselines),
        notes:
          'Personal health & fitness tracker. Training at Third Space Wimbledon.',
      },
    });
    console.log('✓ Seeded athlete_profile');
  } else {
    console.log('• athlete_profile already exists, skipping');
  }

  // --- Goals ----------------------------------------------------------------
  // General fitness goals with Hyrox as a single event goal (not a set of
  // Hyrox-station benchmarks). Specific targets are left for the user to add.
  const goalSeeds: {
    name: string;
    unit: string | null;
    targetValue: number | null;
  }[] = [
    { name: 'Body composition (~12% body fat)', unit: '%', targetValue: 12 },
    { name: 'Hyrox event (sub-1:30)', unit: 'time', targetValue: null },
    { name: '5k run time', unit: 'time', targetValue: null },
    { name: 'Training consistency', unit: 'sessions/week', targetValue: null },
  ];
  for (const g of goalSeeds) {
    const exists = await prisma.goal.findFirst({ where: { name: g.name } });
    if (!exists) {
      await prisma.goal.create({
        data: {
          name: g.name,
          unit: g.unit ?? undefined,
          targetValue: g.targetValue ?? undefined,
        },
      });
    }
  }
  console.log('✓ Seeded goals');

  // --- Sync state rows ------------------------------------------------------
  for (const source of ['strava', 'withings'] as const) {
    await prisma.syncState.upsert({
      where: { source },
      update: {},
      create: { source, status: 'disconnected' },
    });
  }
  console.log('✓ Seeded sync_state (strava, withings)');

  console.log('\nSeed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
