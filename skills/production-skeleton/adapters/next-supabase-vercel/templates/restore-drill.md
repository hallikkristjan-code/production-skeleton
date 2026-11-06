# Restore drill

Restoring is the only proof a backup exists. Repeat at least every 90 days;
the probe turns gate 7 STALE after `drill_max_days`. Until a drill has been run
and dated below, gate 7 stays FAIL. Leave the date empty rather than write one
for a drill that did not happen.

## Last drill

Date: (YYYY-MM-DD — the probe reads this Date field; enter only the last completed drill)
Dump: (which artifact)
Target: (a throwaway project or a local Postgres — never production)
Result: (tables, rows, minutes)
Users: (how many came back, or "not covered")
Files: (which uploads opened, or "not covered")
RPO: (backup frequency → hours of data at risk)
RTO: (minutes from decision to restored service)

## What the dump covers

The backup workflow dumps schema `public` only: tables, rows, indexes,
functions, row-level-security policies. It does not hold:

- `auth` — users, password hashes, identities. Covered by: (fill in, or "nothing yet")
- Storage — the files in the buckets and their metadata. Covered by: (fill in, or "nothing yet")
- `supabase_migrations` — the migration history. On a restored database
  `supabase db push` starts again from the first migration and stops on
  `relation ... already exists`. Before pushing to one, run
  `supabase migration repair --status applied <versions>` for every migration
  the dump holds.
- roles and grants, other schemas, Edge Functions, project settings, secrets.

An app with logins or uploads is not restored by this dump alone. A drill that
only counts table rows proves the tables came back, not the app.

## Procedure

Restore into something you can throw away: a fresh project or a local
Postgres. Never restore over production to "test" it.

1. Download the latest `backup-*` artifact from the backup workflow's run page.
2. `gpg --decrypt backup.sql.gpg > backup.sql` on the machine that holds the private key.
3. `psql -v ON_ERROR_STOP=1 --single-transaction "$FRESH_DATABASE_URL" -f backup.sql`.
   It stops at the first SQL error and rolls everything back, instead of
   leaving a half-restored database that looks fine. Two errors mean something
   specific:
   - `schema "public" already exists` — the target already has the schema.
     Remove the line `CREATE SCHEMA public;` from backup.sql and run again.
   - a foreign key to `auth.users` fails — the rows point at users the target
     does not have. Restore the users first; that is the gap named above.
4. Tables: count rows in the three biggest tables; compare with production.
5. Users: sign in as a known user against the target — or write "not covered".
6. Permissions: the dump carries the policies but no grants (`--no-acl`). As a
   signed-in non-admin user, read a row you should see and one you should not.
7. Files: open one uploaded file through the app — or write "not covered".
8. Point a local copy of the app at the target and click through the main flow.
9. Write the date, counts and minutes above. Delete backup.sql (it is
   plaintext). Commit.
