# sessions/

Planned-session payload files for the push CLI.

This folder is **gitignored** (`/sessions/*`) so personal plans stay out of the
repo. Only `example-session.json` (generic placeholder data) and this README are
committed; every real payload you drop here is ignored by default. Copy the
example, edit the values, and keep your real files here locally.

## Usage

```bash
# validate a payload offline (no server call)
npx tsx scripts/push-session.ts sessions/example-session.json --dry-run

# create it in the running app
export PLANNED_SESSIONS_API_KEY=...        # same key the API uses
export PFT_API_URL=https://your-app.example # default http://localhost:3000
npx tsx scripts/push-session.ts sessions/your-real-plan.json

# list planned sessions (ids + dates), then delete one (dry-run first)
npx tsx scripts/delete-session.ts --list
npx tsx scripts/delete-session.ts <id> --dry-run
npx tsx scripts/delete-session.ts <id>
```

The payload shape is the `POST /api/planned-sessions` contract documented in the
top-level README. Structured `warmup` / `cooldown` are arrays of
`{ name, detail?, weightKg? }`; a plain string is still accepted for legacy
plans.
