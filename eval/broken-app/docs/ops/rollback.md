# Rollback

## Code
1. Vercel → Deployments → previous → Promote to Production.

## Schema
1. Apply the paired `down` migration from `supabase/migrations/`.

## Data
1. Restore the last dump (see restore-drill.md) into a scratch project, copy the rows back.
