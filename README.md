# production-skeleton

After every vibe-coded app, someone asks: are there backups? Who keeps the
dependencies updated? How do you roll back a bad release? These two skills for
coding agents (Claude Code, Codex) answer that skeptic.

The question underneath is not "is the code secure" but **"does the app survive
its first bad day"**: a dead disk, a leaked key, a release that has to come
back, a partner API that hangs. Security review tools answer the first
question. These two answer the second, and point at the file and line for each
answer.

**production-skeleton** is the foundation, not an audit. Run it before the
first feature, in an empty folder if you like: it says what must exist before
the first line of real code, and writes the missing files when you ask (never
overwriting one). Later, on a grown app, the same command tells you in 60
seconds whether that foundation is still there. Thirteen questions, every
answer pointing to a file and line:

1. Do tests and the build run on every push?
2. Do dependency security updates arrive automatically, with no known
   high-severity hole open?
3. Is every environment variable the code reads listed in `.env.example`?
4. Is there a list of the tasks only a human can do, and is it current?
5. Do errors reach a person?
6. Does a `/health` route answer with the deployed version?
7. Do backups run, and has a restore been rehearsed recently?
8. Is there a written plan to roll back code, database schema and data?
9. Does every call to an outside service have a timeout?
10. Are writes from other websites refused (CSRF)?
11. Are the basic security headers set (HSTS, frame-ancestors, nosniff)?
12. Does input have size limits, and are old logs deleted on a schedule?
13. Is there a privacy page, and is it linked?

What it requires grows with the app: a library or a tool needs 1 to 4, an app
that stores personal data needs 1 to 9, an app that takes payments needs all 13.

**skeptic-review** is for an app that is already running. It is that skeptic
as a skill: it audits 13 areas and accepts only evidence it can point to in
the code. "We have backups"
without a file and line counts as no.

1. Architecture: where it runs, backups, and how much data you can lose
   and how fast you recover, as numbers.
2. Identity and access: admin MFA, where secrets live, least privilege,
   and whether every path enforces the same rule.
3. External integrations: how each is authenticated, what happens when a
   partner is down, retries, whether an operation can safely run twice.
4. Payments: card data scope, webhook validation, double charges.
5. Security: SQL injection, XSS, CSRF, headers, rate limits, brute force,
   continuous dependency scanning.
6. Data protection: where personal data lives, how long it is kept, and
   whether deletion reaches the backups.
7. AI usage: what the AI does, whether it can change data without a
   human, and which outside text reaches a prompt.
8. Automation: bad input, limits, change log, rollback, race conditions.
9. Monitoring: how you learn that a nightly job failed.
10. Testing: the real test count, integration tests, CI, a smoke test
    around deploys.
11. Scalability: ten times the load, a slow outside API, losing one
    instance.
12. Business continuity: the AI or an API goes down, a partner quits, who
    besides the owner can get in.
13. Top-3 risks: the three worst findings, first thing in the report.

An area that does not apply (no payments, no AI) is marked N/A with a reason.

We built both after an AI-built app ran in daily use for three weeks and an
audit then found 22 issues. Fifteen would have been caught by the day-zero
checks.

## 60 seconds, read-only

```bash
npx skills add hallikkristjan-code/production-skeleton
```

In Claude Code: `/skeleton`. In Codex or another agent, ask it to "run the
production-skeleton probe on this repo and show the scorecard". Nothing is
written. You get this:

```
## production-skeleton — stage 2 · 6/9 required · 9/13 total, 0 n/a

Stage: deploy target: next; personal data: auth library @supabase/ssr

| # | Gate                                      | Stage | Status   | Evidence                                                        |
|---|-------------------------------------------|-------|----------|-----------------------------------------------------------------|
| 1 | CI runs tests and build on every push     | 1     | **FAIL** | .github/workflows/backup.yml: no push/pull_request trigger      |
| 2 | Dependency security updates are automatic | 1     | PASS     | .github/dependabot.yml present                                  |
| 3 | Every env var is named in .env.example    | 1     | **FAIL** | missing from .env.example: SUPABASE_SERVICE_ROLE_KEY (lib/supabase.ts:2) |
| 4 | Human-gates register is current           | 1     | PASS     | 1 open, none stale                                              |
| … |                                           |       |          |                                                                 |
| 9 | External calls time out                   | 2     | **FAIL** | 1 of 1 calls without a timeout/signal: app/api/ai/route.ts:4    |
| … |                                           |       |          |                                                                 |

Badge: `![skeleton](https://img.shields.io/badge/skeleton-9%2F13-orange)`

Read-only: nothing in this repo was changed. `fix` generates the missing files (dry-run by default).
```

Without an agent, from a clone of this repo: `npm run probe -- <path>` (or
`node ~/.claude/skills/production-skeleton/scripts/probe.mjs <path>` after
installing).
Add `--json` for machines, `--url https://your.app` for two live checks
(health, headers) that send GET requests only. `--csrf-post` adds one cross-origin POST to `/api/health`
as a diagnostic only; even a 403 is inconclusive for mutation-route protection. It is a write request and the probe cannot know what a
POST does on a server, so it is off by default: use it on an app you own.

`/skeleton fix` prints what it would generate. `/skeleton fix --write`
generates it — and never overwrites a file that exists. Generation needs a
stack adapter; one ships today (Next.js + Supabase + Vercel, triggered by the
`next` dependency). Other stacks still get the full scorecard, and `fix` says
so instead of writing.

The adapter writes only what can work in the project it finds. Routes go
under `src/app` when that is where the app lives; a Pages Router project, or
one where Next.js would ignore `src/`, gets a manual step instead of a route
file. The CI workflow is an npm + TypeScript
template, written only when `package-lock.json`, `typescript` and both a
`test` and a `build` script are there. Otherwise the plan names what is
missing (`skip-requires`), and with pnpm, yarn or bun you write the workflow
yourself. The TypeScript helpers are skipped the same way in a project
without `typescript`, and the health route in a project older than
Next.js 15.

The backup workflow it generates dumps the Postgres schema `public` only:
no auth users, no Storage files. It keeps each encrypted dump as a 90-day
workflow artifact, refuses to run in a public repository, and commits nothing
to your repo unless you opt in. The restore drill it writes ships without a
date, so gate 7 stays FAIL until you have restored into a throwaway database
and written down what came back.

## The 13 gates

Each gate is one probe, one row, one status. Stage is detected from the code
(an auth library or a personal-data column → stage 2; a payment dependency →
stage 3; no server framework, deploy file or bundled single-page app → stage 0,
a library, where gates 5–13 are N/A).

| # | Gate | Stage | Evidence the probe looks for |
|---|---|---|---|
| 1 | CI runs tests and build on every push | 1 | workflow with a push/PR trigger and a test step (and a build step if there is a build script); no `pull_request_target` workflow hands repo secrets to fork PRs without an `environment:` |
| 2 | Dependency security updates are automatic | 1 | `.github/dependabot.yml`, a Renovate config, or a workflow running a dependency scanner (OSV-Scanner, Trivy, Grype, Snyk, Socket, Aikido); then `npm audit` on the lockfile must report 0 high/critical, or `pip-audit` 0 findings on `requirements.txt` or a `uv export` of `uv.lock` (`--no-audit` skips it) |
| 3 | Every env var is named in `.env.example` | 1 | every `process.env.X` / `os.environ[...]` read in source has a key in the example file, and no `.env`, `.env.local` or `.env.production` is tracked in git (a committed one FAILs with the date it was first added: rotate, then purge history) |
| 4 | Human-gates register is current | 1 | `HUMAN-GATES.md` exists and no open line is older than `stale_days` or past its `due:` date |
| 5 | Errors reach a human | 2 | an error-tracker init in source and its DSN key in `.env.example`; or your own reporter (`recordError`, `reportError`, `sendAlert`, …) that has a body, is called, and whose alert address (`ALERT_EMAIL`, `*_WEBHOOK`) is named in config and read on that path. Static only: the probe cannot see an alert arrive |
| 6 | `/health` answers with the deployed version | 2 | a health route (live: 200 and a version in the body) |
| 7 | Independent backup with a rehearsed restore | 2 | a backup job and `docs/ops/restore-drill.md` dated within `drill_max_days` |
| 8 | Rollback runbook: code, schema, data | 2 | `docs/ops/rollback.md` mentions all three |
| 9 | External calls time out | 2 | every `fetch`/axios/requests/httpx call has a `signal` or `timeout` nearby; `fetch('/api/…')` is same-origin and not counted |
| 10 | Cross-origin writes are refused | 3 | an Origin/CSRF check in source (live, with `--csrf-post`: inconclusive health-route diagnostic) |
| 11 | HSTS, frame-ancestors, nosniff | 3 | all three configured (live: present in response headers) |
| 12 | Input size limits and log retention | 3 | a max-length validator and a cleanup job with a retention period |
| 13 | Privacy page matches the code | 3 | a page named `privacy` (or its equivalent in eight other languages, or `gdpr`, or the file named by `privacy:` in HUMAN-GATES.md), linked as a route from source |

Statuses: **PASS**, **FAIL**, **STALE** (evidence exists but is too old —
a restore drill, a human gate past due), **UNKNOWN** (the probe tried and
could not verify — an audit that did not run, a live request that failed;
counts as not passed), **N/A** (stage 0, or declared with a
reason, or gate 2 in a repo with no dependency manifest). Score: `x/y required · x/13 total, n n/a` — *required* is what your
stage demands today, *total* is the badge.

PASS means the probe found the pattern, not that it works end to end.
Comments never count as evidence, whole-line, trailing or block: a commented-out
`# npm test` is not a CI step and `// TODO add timeout` is not a timeout. A
CSRF or header helper counts only when the framework loads it or another file
imports it — so `fix --write` alone leaves gates 10 and 11 FAIL until you wire
the helpers in. Gate 5 is static by nature: it shows the error path is wired
(an empty `recordError() {}` and a key name do not pass), not that an alert
reaches you. It cannot tell a reporter that sends from one that only logs.
Throw one test error in production and see it arrive; that check belongs in
`HUMAN-GATES.md`. The comment filter is a heuristic too, not a parser. Gates 7, 9 and 12 are still heuristics. The live
checks and the audit are the stronger proof.

Deliberately not in the list: performance, SEO, accessibility, code quality,
deep OWASP. Other tools do those; this one is the floor. An OWASP skill such as
[agamm/claude-code-owasp](https://github.com/agamm/claude-code-owasp) asks
whether the code is secure; this one asks whether the app survives. Run both.

## HUMAN-GATES.md — the part no tool can do

Some things only a human can do: a GPG passphrase, a repo secret, a DNS
record, a vendor account, a restore drill. They are also the things that sit
undone for three weeks because no probe fails on them. The register is a
plain file:

```markdown
---
stage: 2
stale_days: 7
drill_max_days: 90
na:
  7: managed database with provider snapshots, restore tested 2026-09-01
---
- [ ] 2026-09-12 Add SENTRY_DSN to the hosting env (due: 2026-09-19)
- [x] 2026-09-01 Commit the backup public key
```

The agent reads the open lines aloud at the start of every session until the
list is empty. A line older than `stale_days`, or past its `due:`, turns gate 4 STALE. `fix --write`
appends lines for what it could not do itself.

## skeptic-review — proving the floor holds

`/skeptic-review` is a 13-section production-readiness audit with one rule:
**a claim without a `file:line` is not a status, it is a guess.** Every section
is ❌ until evidence says otherwise; N/A needs a reason; the report has a fixed
shape (top-3 risks → section table → skeleton scorecard → quick wins → not
traced → verdict → "I can do this now"). It runs the skeleton probe as its evidence step, and
"ready" is not allowed while a required gate fails.

The sections are wider than the gates — payments, AI usage, business
continuity, identity — because a day-zero file cannot fix those. Roughly:

| Gate | Section |
|---|---|
| 1, 2 | 10 Testing, 5 Security |
| 3 | 2 Identity and access |
| 4 | 12 Business continuity |
| 5, 6 | 9 Monitoring |
| 7, 8 | 1 Architecture |
| 9 | 3 External integrations, 11 Scalability |
| 10, 11 | 5 Security |
| 12, 13 | 6 Data protection |

## What the numbers say

- A real app: 2/13 gates before its audit, 8/13 after the fixes
  ([docs/retro-eval.md](docs/retro-eval.md)).
- A second app of mine, started with the skeleton on day zero (Hono on
  Cloudflare Workers, a stack with no adapter here): 13/13 after 200 commits,
  with the restore drill two days old because the human-gates register kept
  asking for it.
- A fixture with five planted holes: the probe finds the three a file can
  show, and the audit finds all five ([docs/eval-skeptic.md](docs/eval-skeptic.md)).
- A real app of about 285 files, checked against the 18 findings of a deep
  security scan: the audit, one agent in a few minutes, finds 7 to 9 of them,
  up from 3 or 4 before the seam checks
  ([docs/eval-deep-scan.md](docs/eval-deep-scan.md)). Run it first, then point
  the deep scan at what it says it did not trace.

**This repo** (2026-10-17): stage 0, 4/4 required.

## What this adds

Existing production-readiness skills are end-of-line audits: long checklists,
run once before a deploy, with no generator. This one is a day-zero skeleton with
a generator, a human-gates register that ages, stage-based requirements, and a
probe that returns evidence instead of prose. The audit is the pair that keeps
the skeleton honest.

The 13 audit sections were sparked by a comment under a post about a
vibe-coded app; the wording, the evidence rule and the process are ours.

## Layout

```
skills/production-skeleton/   SKILL.md, scripts/probe.mjs, scripts/fix.mjs, adapters/
skills/skeptic-review/        SKILL.md
tests/                        node --test files, zero dependencies
HUMAN-GATES.md                this repo's own register
eval/broken-app/              the fixture
docs/                         retro-eval.md, eval-skeptic.md
CHANGELOG.md, SECURITY.md, CONTRIBUTING.md
```

Zero dependencies. Node 20+. `npm test` runs the suite; CI runs it on Node 20,
22 and 24, on Linux and Windows. macOS is not tested.

## License

MIT.

### Probe coverage and safety

Python audits accept only exact pinned requirements and always use `--no-deps --disable-pip`.
Ranges, paths, editable packages, URLs and includes are UNKNOWN without resolution or builds.
A pinned list covers only the packages it contains; supply a complete resolved export.
JSON `coverage.audit` lists checked and skipped manifests/packages; a finding fails gate 2 even
if another ecosystem was skipped. Nested manifests remain unverified: select the application
directory to audit and generate files. Stage detection considers nested declarations conservatively;
the adapter uses only the root application.

TOML extraction recognizes common project arrays and Poetry tables, not the whole language;
`coverage.manifestsNotRead` includes pyproject.toml as partially read. `coverage.notScanned` counts
unsupported source types including Vue/Svelte/Astro. Absence of findings in that coverage is not PASS.
Generated registers leave stage automatic; explicit lower overrides remain with a visible warning.
Restore evidence requires a completed Date/Last drill/Last run/Completed field with a real,
non-future calendar date. Live health requires JSON with a meaningful version/sha/commit/git_sha.
Live HSTS requires HTTPS and positive max-age; framing and nosniff values are checked.
Static CI, import wiring and security configuration checks are heuristics, not execution proof.
