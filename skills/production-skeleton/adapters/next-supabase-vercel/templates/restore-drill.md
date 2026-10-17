# Restore drill

Restoring is the only proof a backup exists. Repeat at least every 90 days;
the probe turns gate 7 STALE after `drill_max_days`.

## Last drill

Date: (YYYY-MM-DD — the probe reads the first date in this file)
Dump: (artifact or commit)
Target: (fresh project / local Postgres)
Result: (tables, rows, minutes)
RPO: (backup frequency → hours of data at risk)
RTO: (minutes from decision to restored service)

## Procedure

1. Download the latest `backups/*.sql.gpg` artifact (or take the weekly commit).
2. `gpg --decrypt backup.sql.gpg > backup.sql` on the machine that holds the private key.
3. `psql "$FRESH_DATABASE_URL" < backup.sql`.
4. Count rows in the three biggest tables; compare with production.
5. Write the date, counts and minutes above. Commit.
