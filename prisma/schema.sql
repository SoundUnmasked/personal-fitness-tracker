-- CreateTable
CREATE TABLE "athlete_profile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "goals" TEXT,
    "baselines" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "title" TEXT,
    "duration_min" INTEGER,
    "location" TEXT DEFAULT 'Third Space Wimbledon',
    "energy_pre" INTEGER,
    "rpe_overall" REAL,
    "cooldown_done" BOOLEAN NOT NULL DEFAULT false,
    "warmup_done" BOOLEAN NOT NULL DEFAULT false,
    "warmup" TEXT,
    "cooldown" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "external_id" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "planned_exercises" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_id" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "exercise_name" TEXT NOT NULL,
    "target_sets" INTEGER,
    "target_reps" INTEGER,
    "target_weight_kg" REAL,
    "rest_seconds" INTEGER,
    "set_style" TEXT,
    "duration_seconds" INTEGER,
    "tempo" TEXT,
    "superset_group" TEXT,
    "notes" TEXT,
    "logged_note" TEXT,
    CONSTRAINT "planned_exercises_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "strength_sets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_id" INTEGER NOT NULL,
    "exercise_name" TEXT NOT NULL,
    "set_no" INTEGER NOT NULL,
    "reps" INTEGER,
    "weight_kg" REAL,
    "duration_seconds" INTEGER,
    "is_warmup" BOOLEAN NOT NULL DEFAULT false,
    "rpe" REAL,
    "rpe_high" REAL,
    "notes" TEXT,
    CONSTRAINT "strength_sets_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_id" INTEGER NOT NULL,
    "distance_km" REAL,
    "duration_min" REAL,
    "avg_pace" TEXT,
    "avg_hr" INTEGER,
    "max_hr" INTEGER,
    "hr_source" TEXT,
    "calf_raises_done" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    CONSTRAINT "runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "body_composition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    "weight_kg" REAL,
    "body_fat_pct" REAL,
    "skeletal_muscle_mass_kg" REAL,
    "visceral_fat" REAL,
    "bmr" INTEGER,
    "raw" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "daily_checkin" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "sleep_hours" REAL,
    "sleep_quality" INTEGER,
    "energy_morning" INTEGER,
    "energy_afternoon" INTEGER,
    "energy_evening" INTEGER,
    "soreness" INTEGER,
    "mood" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "goals" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "target_value" REAL,
    "current_value" REAL,
    "unit" TEXT,
    "target_date" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sync_state" (
    "source" TEXT NOT NULL PRIMARY KEY,
    "last_synced_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "message" TEXT,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "expires_at" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "sessions_date_idx" ON "sessions"("date");

-- CreateIndex
CREATE INDEX "sessions_status_idx" ON "sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_source_external_id_key" ON "sessions"("source", "external_id");

-- CreateIndex
CREATE INDEX "planned_exercises_session_id_idx" ON "planned_exercises"("session_id");

-- CreateIndex
CREATE INDEX "strength_sets_session_id_idx" ON "strength_sets"("session_id");

-- CreateIndex
CREATE INDEX "runs_session_id_idx" ON "runs"("session_id");

-- CreateIndex
CREATE INDEX "body_composition_date_idx" ON "body_composition"("date");

-- CreateIndex
CREATE INDEX "body_composition_source_idx" ON "body_composition"("source");

-- CreateIndex
CREATE UNIQUE INDEX "daily_checkin_date_key" ON "daily_checkin"("date");

-- CreateIndex
CREATE INDEX "daily_checkin_date_idx" ON "daily_checkin"("date");

