# skeptic-review eval on eval/broken-app

> Fixture change 2026-10-17: `middleware.ts` and `next.config.ts` now import
> `lib/csrf.ts` and `lib/securityHeaders.ts`, because the probe stopped counting
> unimported helpers as evidence. The planted holes are unchanged. The probe now
> also fails gate 12, since `scripts/retention.sql` is only a comment — the same
> thing the audit reports in section 6 below.

The fixture has five planted holes. Three are visible to the probe; two only
to the audit. This is what the audit found (run 2026-09-12, one pass, no
retries; evidence gathered by two cheap-model sub-agents, synthesized by a
standard model following `skills/skeptic-review/SKILL.md`).

| Hole | Where | Found by probe | Found by audit | Section |
|---|---|---|---|---|
| A — no CI | (no workflow) | yes (gate 1) | yes | 10 |
| B — env var not declared | lib/supabase.ts:2 | yes (gate 3) | yes | 2 |
| C — fetch without timeout | app/api/ai/route.ts:4 | yes (gate 9) | yes | 3, 11 |
| D — AI writes without confirmation | app/api/ai/route.ts:9-11 | no | yes | 7 |
| E — webhook not idempotent | app/api/webhook/route.ts:3-7 | no | yes | 3 |

Verdict given: **Not ready** — 8 sections ❌, 3 ⚠️, 1 N/A (payments), and
required skeleton gates 1, 3, 9 FAIL. Expected: not ready.

What the audit found that was not planted: `scripts/retention.sql` is a SQL
comment, not a scheduled job, so the privacy page's "12 months" claim has no
mechanism behind it (section 6). The probe's gate 12 accepts that file because
it pattern-matches; this is the heuristic gap `SKILL.md` warns about, and a
good illustration of why the audit exists on top of the skeleton.

## Report

# Skeptic Review — broken-app (production-readiness audit)

Project root audited: `eval/broken-app` (Next.js 16 + Supabase + Sentry + Vercel; read-only audit, nothing modified).

## Top-3 risks

1. **CSRF check is inverted — it trusts requests with no Origin header.**
   `lib/csrf.ts:2` — `return !origin || origin === process.env.SUPABASE_URL;`. Any
   cross-origin tool that omits the `Origin` header (curl, server-to-server,
   many non-browser clients) passes as "trusted." This is not a partial gap,
   it is a bypass of the one CSRF control the app has, on the same write path
   (`app/api/ai/route.ts`) that lets an AI response overwrite a person's `name`
   in the database.

2. **AI output is written to the `people` table with no validation and no human
   confirmation, and the input is unvalidated.** `app/api/ai/route.ts:4-10` —
   `prompt` comes straight from the request body (no `PersonInput`/zod check
   despite `lib/schema.ts` existing), is sent to OpenAI, and the raw
   `output_text` is written to `people.name` via the code's own comment: *"The
   model's answer goes straight into the table. Nobody confirms it."*
   Combined with risk #1, an external caller can rewrite arbitrary people
   records through model output with no auth boundary and no review step.

3. **Error tracking is wired in code but not live, and the webhook has no
   signature verification and a real (documented-in-code) double-processing
   bug.** Sentry is initialized (`sentry.server.config.ts:1`) but
   `SENTRY_DSN` is not yet set in Vercel — it is an open, not-yet-done item in
   `HUMAN-GATES.md:1` ("Add SENTRY_DSN to Vercel"). Until that gate closes,
   production errors, including the two issues above, reach nobody.
   Separately, `app/api/webhook/route.ts` never checks a signature/secret
   before acting, and inserts into `audit_log` *before* checking whether
   `webhook_events.id` (the dedupe key) already exists — the code's own
   comment says "a redelivered event runs the side effect twice."

## Section table (13 sections)

| # | Section | Status | Evidence |
|---|---|---|---|
| 1 | Architecture | ⚠️ | Next.js on Vercel (`package.json:1`, `vercel.json` empty/default), DB is Supabase (`lib/supabase.ts:2`). Backup: nightly `pg_dump` + gpg encrypt, cron `0 3 * * *` (`.github/workflows/backup.yml:2-8`). Restore drill done 2026-09-01, 11 days before the audit date: RPO 24h, RTO 15min, stated explicitly (`docs/ops/restore-drill.md:3`). Numbers exist and are recent — good — but there is no CI to build/test before deploy (see #10), so architecture is one gate short of solid. |
| 2 | Identity and access | ❌ | No admin MFA anywhere in the repo. `lib/supabase.ts:2` creates a single `admin()` client with the **service-role key** used for every DB call in both `app/api/ai/route.ts:2` and `app/api/webhook/route.ts:2` — no anon/least-privilege client exists. `supabase/migrations/0001_init.sql:1-3` defines `people`, `audit_log`, `webhook_events` with no RLS policies at all (moot for the service-role key, but there is no lower-privilege path for anything). `SUPABASE_SERVICE_ROLE_KEY` is used in code (`lib/supabase.ts:2`) but missing from `.env.example` (probe gate 3, FAIL) — undocumented secret surface. |
| 3 | External integrations | ❌ | OpenAI call (`app/api/ai/route.ts:4`) has no timeout/AbortSignal (probe gate 9, FAIL) and no retry/backoff. Webhook receiver (`app/api/webhook/route.ts:1-8`) has no signature/HMAC verification before acting, and the idempotency check that could exist (`webhook_events.id` is a primary key) is not applied before the side effect runs — `audit_log` insert happens unconditionally on every delivery, so a retried webhook double-processes (comment at `app/api/webhook/route.ts:3-4` confirms this is a known, not just theoretical, bug). |
| 4 | Payments | N/A | No payment or card-data code anywhere in the repo (`grep` across `app/`, `lib/` found none) — PCI DSS scope is zero. |
| 5 | Security | ❌ | CSRF check exists but is inverted/bypassable, see top risk #1 (`lib/csrf.ts:2`). CSP is present but weak: only `frame-ancestors 'none'` (`lib/securityHeaders.ts:2`), no `default-src`/`script-src`, so it does not mitigate XSS. HSTS and `nosniff` are set (`lib/securityHeaders.ts:3-4`, probe gate 11 PASS). No rate limiting or brute-force protection found anywhere (no auth/login route exists in the repo to protect, and no rate-limit middleware on the API routes that do exist). Dependency scanning is continuous: `.github/dependabot.yml:1-5` (weekly npm updates, probe gate 2 PASS) — this one sub-item is solid. SQLi risk is low (Supabase client, no raw string SQL in app code); XSS risk is low in the two static pages shown. |
| 6 | Data protection | ❌ | Personal data lives in `people` (`email`, `name` — `supabase/migrations/0001_init.sql:1`) and in `audit_log.body` (jsonb, whatever the webhook sends, `0001_init.sql:2`). Privacy page states "we store your email and name for 12 months" (`app/privacy/page.tsx:1`), but the only enforced retention is `scripts/retention.sql:1`, a **SQL comment, not a scheduled job** — no workflow or cron references `retention.sql` anywhere (`grep -rn retention .github/` found nothing). So the privacy claim about `people` is not backed by any deletion mechanism, and `audit_log` retention is unenforced code, not a running job. No right-to-be-forgotten endpoint exists for `people`, and encrypted nightly backups (`backup.yml:5`) would retain "deleted" rows regardless. |
| 7 | AI usage | ❌ | One AI integration: `app/api/ai/route.ts` calls OpenAI's `gpt-5` (`app/api/ai/route.ts:6-8`). It can change data (`people.name`) with **no human confirmation** — stated in the code's own comment (`app/api/ai/route.ts:9`). No hallucination guard: `lib/schema.ts:2` defines `PersonInput` with zod but it is never imported/used in this route. Prompt-injection surface is wide open: the entire request body's `prompt` field goes straight into the OpenAI `input` field with no sanitization (`app/api/ai/route.ts:3-8`), and the model's unvalidated output is trusted as a DB write. |
| 8 | Automation | ❌ | No input sanity checks on the webhook body (`app/api/webhook/route.ts:2-6` — `event` is used directly, no size/shape validation) and no max-delete/absurd-value protection anywhere. Rollback path is documented and reasonably complete: `docs/ops/rollback.md` covers code (Vercel promote-previous), schema (paired `down` migration), and data (restore drill scratch-project copy) — probe gate 8 PASS. No change log beyond git history was found. |
| 9 | Monitoring | ❌ | Sentry is initialized in code (`sentry.server.config.ts:1`) but the DSN is not yet configured in the deployment — open item in `HUMAN-GATES.md:1` ("Add SENTRY_DSN to Vercel," due 2026-12-31, not stale under the 7-day threshold but still not done). Until that gate closes, no error from either API route reaches a human. `/health` exists and reports a version (`app/api/health/route.ts:1`, probe gate 6 PASS, static only — not checked live). The nightly backup job (`backup.yml`) has no failure-alerting step — a failed `pg_dump` would be silent. |
| 10 | Testing | ❌ | `package.json:1` declares `"test": "vitest run"` but `vitest` is not listed in `dependencies` (no `devDependencies` block exists at all), there is no `node_modules` directory (confirmed: `ls node_modules` → "No such file or directory"), and no test file was found anywhere in the repo (`find . -iname "*.test.*" -o -iname "*.spec.*"` returned nothing). The test count is **zero, verified, not merely unrun** — the project cannot currently execute its own declared test command. No CI workflow runs build or test on push (probe gate 1, FAIL — the only workflow present, `backup.yml`, is cron-triggered, not `push`/`pull_request`). No smoke test before/after deploy. |
| 11 | Scalability | ⚠️ | No in-memory state was found (both API routes are stateless per-request, consistent with Vercel serverless). The one external dependency in the request path, the OpenAI call, has no timeout (see #3/probe gate 9) — under load or a slow provider response this ties up a serverless invocation with no cutoff, which is a real risk at even modest concurrency, not just at "10x." No queueing or batching exists for the AI or webhook paths. |
| 12 | Business continuity | ⚠️ | Backup + restore drill are real and recent (see #1) and the rollback runbook covers code/schema/data (`docs/ops/rollback.md`). No bus-factor documentation was found — nothing in the repo names who besides the owner can access Vercel/Supabase/OpenAI accounts, and `HUMAN-GATES.md` tracks exactly one manual item with no owner field beyond the single line. No fallback is defined for OpenAI outage or API changes — the `ai` route has no error handling around the `fetch` call at all (`app/api/ai/route.ts:4-8`), so a non-2xx or malformed OpenAI response is not caught. |
| 13 | Top-3 risks | — | See "Top-3 risks" above (this row records that the opening question was answered at the top of the report, per the checklist format). |

## Skeleton scorecard (probe, verbatim)

```
production-skeleton — stage 2 · 6/9 required · 10/13 total, 0 n/a
Stage: deploy target: next; personal data: auth library @supabase/ssr

| # | Gate | Stage | Status | Evidence |
|---|---|---|---|---|
| 1 | CI runs tests and build on every push | 1 | FAIL | .github/workflows/backup.yml: no push/pull_request trigger |
| 3 | Every env var is named in .env.example | 1 | FAIL | missing from .env.example: SUPABASE_SERVICE_ROLE_KEY (lib/supabase.ts:2) |
| 9 | External calls time out | 2 | FAIL | 1 of 1 calls without a timeout/signal: app/api/ai/route.ts:4 |

Open human gates (1, 0 stale):
- 2026-09-10 Add SENTRY_DSN to Vercel (due: 2026-12-31)
```

Full gate list (all 13, for reference): 1 FAIL, 2 PASS (dependabot), 3 FAIL, 4 PASS (human-gates register current), 5 PASS (Sentry init + DSN named, though not yet wired live per HUMAN-GATES), 6 PASS (health route, static check only), 7 PASS (backup + drill), 8 PASS (rollback runbook), 9 FAIL, 10 PASS (CSRF check present — static only, its logic is inverted, see section 5 above), 11 PASS (headers present), 12 PASS (size limit + retention.sql exists as a file, though not scheduled — see section 6 above), 13 PASS (privacy page linked from layout).

Command run: `node skills/production-skeleton/scripts/probe.mjs eval/broken-app --today 2026-09-12 --json` (and again without `--json` for the table).

## Quick wins (under about an hour each)

- Fix `lib/csrf.ts:2` — do not treat a missing `Origin` header as trusted; reject or require the header on state-changing routes.
- Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.example` (probe gate 3).
- Add an `AbortSignal.timeout(...)` to the `fetch` call in `app/api/ai/route.ts:4` (probe gate 9).
- Reorder `app/api/webhook/route.ts` to check `webhook_events.id` for existence before inserting into `audit_log`, and add a signature check on the incoming webhook.
- Close the open `HUMAN-GATES.md:1` item (set `SENTRY_DSN` in Vercel) so error tracking is actually live.
- Add a `push`/`pull_request` trigger (build + `vitest run`) to a CI workflow — `backup.yml` alone does not satisfy this (probe gate 1).
- Wire `scripts/retention.sql` into an actual scheduled job (it is currently a comment nobody runs).

## I can do this now:

1. Fix the CSRF bypass in `lib/csrf.ts:2` (reject missing-Origin requests) — ~5 min.
2. Add an `AbortSignal.timeout` to the OpenAI call in `app/api/ai/route.ts:4` and wrap the fetch/response parsing in error handling — ~10 min.
3. Fix the webhook double-processing bug in `app/api/webhook/route.ts` by checking `webhook_events.id` before the `audit_log` insert — ~10 min.

## Verdict

**Not ready.** Eight sections are ❌ (Identity and access, External integrations, Security, Data protection, AI usage, Automation, Monitoring, Testing — see table; 8 of the 12 graded sections are ❌, one is N/A, the remaining three are ⚠️), and three required skeleton gates are FAIL (CI on push, env var documentation, external-call timeouts), with one open (not-yet-closed) human gate blocking live error monitoring. Per the checklist rule, "Ready" requires no applicable ❌ section and no required gate in FAIL/STALE — neither condition holds here.

> Corrected 2026-10-17: the original run wrote "Six sections" and "7 of 13" here while listing eight; the counts above follow the table. Nothing else in the report was changed.
