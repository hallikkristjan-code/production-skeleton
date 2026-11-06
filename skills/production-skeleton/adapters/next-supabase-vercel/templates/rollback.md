# Rollback

Three cases, at most five steps each. If a case needs more, the fix is in the
architecture, not in this file.

## Code (bad deploy)

1. Vercel → Deployments → the previous green deployment → Promote to Production.
2. Confirm `/api/health` returns the previous version.
3. Revert the commit on `main` so the next push does not redeploy the bug.

## Schema (bad migration)

1. Confirm the linked project reference and database host are the intended target. Inspect `supabase migration list` and the deployed application version. Take a backup before changing schema.
2. Create a new compensating migration with `supabase migration new compensate_previous_change`. Write reviewed SQL that preserves required data and is compatible with the application version being restored. Do not place inverse SQL alongside forward migrations for automatic application.
3. Apply and verify the compensation in an isolated test database first; check constraints, RLS, users, data and application reads/writes. Record the rehearsal. This template is not evidence of a completed drill.
4. On the confirmed target, inspect `supabase db push --dry-run` for the exact pending migrations and order; stop on unexpected entries. Apply `supabase db push` only after that review.
5. Promote a compatible application deployment, then verify health and the main user flow. Record the versions and results.

Reference: [Supabase CLI migration and push semantics](https://supabase.com/docs/reference/cli/supabase-db-push).

## Data (bad write, deleted rows)

1. Take the last dump (see `restore-drill.md`) and restore it into a scratch project.
2. Copy the affected rows back with a targeted `INSERT … SELECT`, never a full restore over live data.
3. Record what was restored and why in the change log.
