# Rollback

Three cases, at most five steps each. If a case needs more, the fix is in the
architecture, not in this file.

## Code (bad deploy)

1. Vercel → Deployments → the previous green deployment → Promote to Production.
2. Confirm `/api/health` returns the previous version.
3. Revert the commit on `main` so the next push does not redeploy the bug.

## Schema (bad migration)

1. Confirm the linked project reference and database host are the intended target. Inspect `supabase migration list` and the deployed application version. Take a backup before changing schema.
2. Create a new compensating migration with `supabase migration new compensate_previous_change`. Write reviewed SQL that preserves required data and is compatible with the application version being restored. A column the bad migration dropped comes back empty: its values are a Data case, below. Do not place inverse SQL alongside forward migrations for automatic application.
3. Apply and verify the compensation in an isolated test database first. Restore the backup there (`restore-drill.md`) and count the rows. Stop if the restore failed: on an empty database `db push` builds empty tables and reports success. The dump holds no migration history, so `db push` would start at the first migration and stop on `relation ... already exists`. Mark what the dump already holds as applied, then push:

   ```sh
   supabase migration repair --status applied <every version in the dump> --remote="$ISOLATED_DATABASE_URL"
   supabase db push --remote="$ISOLATED_DATABASE_URL"
   ```

   Supabase CLI 2 has no `--remote`: use `--db-url "$ISOLATED_DATABASE_URL"`. Check constraints, RLS, users, data and application reads/writes. Record the rehearsal. This template is not evidence of a completed drill.
4. On the confirmed target, inspect `supabase db push --dry-run` for the exact pending migrations and order; stop on unexpected entries. Apply `supabase db push` only after that review.
5. Promote a compatible application deployment, then verify health and the main user flow. Record the versions and results.

Reference: [Supabase CLI migration and push semantics](https://supabase.com/docs/reference/cli/supabase-db-push).

## Data (bad write, deleted rows)

Never restore a full dump over live data.

1. Take the last dump (see `restore-drill.md`) and restore it into a scratch project.
2. Two databases cannot read each other's tables, so the rows travel by file. Export only the affected ones (the table and columns here are an example):

   ```sh
   psql "$SCRATCH_DATABASE_URL" -c "\copy (select id, owner, body from public.notes where id between 101 and 110) to 'rows.csv' csv"
   ```

3. Put this in `restore-rows.sql`. `overriding system value` is for a `generated always` id; drop it for any other key. For a column that came back empty, use `update … from restored` instead of the insert.

   ```sql
   create temp table restored (id bigint, owner uuid, body text) on commit drop;
   \copy restored from 'rows.csv' csv
   insert into public.notes (id, owner, body) overriding system value
     select id, owner, body from restored
     on conflict (id) do nothing;
   ```

4. Run it on the target. It is one transaction: an error leaves nothing behind.

   ```sh
   psql -v ON_ERROR_STOP=1 --single-transaction "$DATABASE_URL" -f restore-rows.sql
   ```

5. Count the rows. Delete `rows.csv` (it is plaintext). Record what was restored and why in the change log.
