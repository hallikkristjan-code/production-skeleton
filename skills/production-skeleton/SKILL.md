---
name: production-skeleton
description: Day-0 production floor for any app — 13 gates (CI, dependency updates, env example, human-gates register, error tracking, /health, backup drill, rollback runbook, timeouts, CSRF, security headers, limits + retention, privacy page). Use on /skeleton (read-only scorecard), /skeleton fix (generate missing files, dry-run by default), or before the first feature of a new project. Also read HUMAN-GATES.md aloud at session start when it has open lines.
---

# production-skeleton

**Skeleton, not audit. Probes, not prose. 13 gates, not 90.**

A skeleton is the floor you build before the first feature. This skill scores a
repo against 13 gates with a read-only probe, keeps a register of the things
only a human can do, and generates the missing files for known stacks.
`skeptic-review` (same repo) is the audit that proves the floor holds.

## Commands

| Say | Runs | Changes files? |
|---|---|---|
| `/skeleton` | `node <skill>/scripts/probe.mjs .` | No |
| `/skeleton --url https://app.example` | probe + 3 live requests (health, headers, cross-origin POST) | No |
| `/skeleton --no-audit` | probe without the `npm audit` call (offline, or a slow registry) | No |
| `/skeleton fix` | `node <skill>/scripts/fix.mjs .` — plan only | No |
| `/skeleton fix --write` | generates missing files, appends human gates | Yes, never overwrites |

`<skill>` is this skill's directory. Show the scorecard verbatim; do not
paraphrase the statuses.

Gate 2 runs `npm audit --json` against `package-lock.json` when one exists, or `pip-audit` for a Python project (`requirements.txt`, or `uv.lock` exported with `uv export` to a temp file) (network, ~3 s); any high or critical finding turns the gate FAIL with the count. A missing lockfile or an offline registry is noted, not failed.

What --url sends: `GET /api/health` (falling back to `GET /health`), `GET /` (following redirects, headers only), and `POST /api/health` with a foreign `Origin` header and an empty JSON body. A 403 on the POST is the only result that upgrades gate 10; any other answer keeps the static result.

## Session start (gate 4)

If `HUMAN-GATES.md` exists and has open `- [ ]` lines, list them before any
feature work — the created date, the text, the due date. Stop listing when the
file is empty. A line past `stale_days` (default 7) or past its `due:` turns
the gate STALE; say so.

## Statuses

- **PASS** — evidence found. Notes marked `static:` were checked in the repo only; pass `--url` to check them live.
  PASS means the probe found the pattern, not that it works end to end. Whole-line comments are
  never evidence, and a gate 10/11 helper counts only when the framework loads it (middleware,
  next.config, settings.py, …) or another source file imports it — after `fix --write`, wire the
  helpers in before those gates turn green. Gates 7, 9 and 12 are heuristics (a backup job name,
  a timeout near a call, a cleanup job); the live checks and the audit skill are the stronger proof.
- **FAIL** — evidence missing. The note says what was looked for and where.
- **STALE** — evidence exists but is too old (restore drill > `drill_max_days`, human gate past due).
- **UNKNOWN** — the probe tried to verify and could not: gate 2's audit did not run (offline, tool
  missing, no lockfile), or `--url` was given and the live request for gate 6, 10 or 11 failed. Counts
  as not passed. `--no-audit` is a deliberate opt-out: gate 2 then passes on its config and says so.
- **N/A** — not applicable: stage 0 (no deploy target) makes gates 5–13 N/A; any gate can be declared N/A in `HUMAN-GATES.md` frontmatter with a reason. No reason → FAIL. Gate 2 is N/A when the repo has no dependency manifest. `fix` never
  writes files or adds human gates for an N/A gate.

Score: `x/y required · x/13 total, n n/a`. Required = gates at or below the
detected stage. The badge counts total.

## Stages

Detected from the code and shown with the reason:

- **0 library** — no server framework, no deploy file, no bundled single-page app (Vite config, CRA, Angular). Gates 1–4 only.
- **1 tool** — deploys somewhere. Gates 1–4 required.
- **2 product** — personal data: an auth library or an `email|phone|name|address` column in a migration. Gates 1–9 required.
- **3 service** — payments (`stripe`, `paddle`, …). All 13 required.

Override in `HUMAN-GATES.md` frontmatter: `stage: 2`.

## HUMAN-GATES.md

```markdown
---
stage: 2
stale_days: 7
drill_max_days: 90
privacy: app/legal/page.tsx
na:
  7: managed database with provider snapshots, restore tested 2026-09-01
---
- [ ] 2026-09-12 Add SENTRY_DSN to the hosting env (due: 2026-09-19)
- [x] 2026-09-01 Commit the backup public key
```

Every frontmatter key is optional; `na` is a map of gate number → reason, and an entry without a reason counts as FAIL.

The date is the day the line was written. `fix --write` appends lines for the
things it cannot do itself (secrets, DNS, vendor accounts).

## Evidence paths (fixed, convention over configuration)

- `docs/ops/restore-drill.md` — first `YYYY-MM-DD` in the file is the drill date.
- `docs/ops/rollback.md` — must mention code/deploy, schema/migration, and data.
- a file or route named `privacy` (English, eight other languages —
  privacidad, datenschutz, andmekaitse, confidentialité, integritetspolicy,
  tietosuoja, personvern, privatlivspolitik — or `gdpr`), or the file
  named by the `privacy:` key in `HUMAN-GATES.md` frontmatter; it must be
  linked as a route from a source file (a `/stem` reference), not just
  mentioned in a README.

## What the probe does not do

No performance, SEO, accessibility, code quality, or deep OWASP. Those are
other tools' jobs. Security depth: run `/cso` or a proper pentest.

## After the scorecard

End with **I can do this now:** — 1–3 numbered lines, only actions the agent
can take in this environment (write a file, run `fix --write`, add a test),
ordered by risk, not ease. Do not run them; wait for a number.
