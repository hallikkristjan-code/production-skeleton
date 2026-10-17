# Rollback

Three cases, at most five steps each. If a case needs more, the fix is in the
architecture, not in this file.

## Code (bad deploy)

1. Vercel → Deployments → the previous green deployment → Promote to Production.
2. Confirm `/api/health` returns the previous version.
3. Revert the commit on `main` so the next push does not redeploy the bug.

## Schema (bad migration)

1. Every migration ships with a paired `down` migration in `supabase/migrations/`.
2. Apply the `down` migration with `supabase db push` (or paste it into the SQL editor).
3. Promote the previous deployment (Code, step 1) if the code depends on the new schema.

## Data (bad write, deleted rows)

1. Take the last dump (see `restore-drill.md`) and restore it into a scratch project.
2. Copy the affected rows back with a targeted `INSERT … SELECT`, never a full restore over live data.
3. Record what was restored and why in the change log.
