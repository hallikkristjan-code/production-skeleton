# Changelog

## 0.3.1 — 2026-11-15

Found by running `--url` against a real Cloudflare Worker during a
`skeptic-review`: two live checks failed an app that passed them.

- Gate 6: when `/api/health` answers 401, 403 or 405 (an `/api/*` behind the
  app's own login), the probe now tries `/health` too. 0.3.0 tried it only on
  a 404 and reported the 401 as a missing health route. A 5xx is still
  reported as a broken route.
- Gate 11: frame-ancestors is judged on an HTML page. When the front page is
  a 404 or JSON, the probe also requests `/privacy`; with no HTML page found,
  the gate is UNKNOWN instead of FAIL. HSTS and nosniff are checked as before.

## 0.3.0 — 2026-11-15

Operations: the processes behind a running app, graded by the audit and
started by `fix`. No new gates.

- `skeptic-review` has a 14th section, **Operations**, before Top-3 risks:
  incident handling, a support channel, how changes reach production,
  runtime and framework end-of-life, redundancy and failover against the RTO,
  and secret rotation. A process counts only with a trace that it is followed.
  The skeleton gates are unchanged.
- `fix` writes `docs/ops/incident.md` for the Next.js adapter: who receives
  alerts, who stands in, where users report problems, the first 15 minutes,
  an incident log. It is not a gate and is skipped only when gate 5 is N/A.
- The README names what the skeleton does not check: redundancy, failover,
  support, end-of-life, change approval, secret rotation.

## 0.2.1 — 2026-11-07

Found by following the README in a clean session on a fresh create-next-app
project, and by running the probe on 34 local repositories.

- A skill installed in the project (`.agents/skills`, `.claude/skills`, any
  dot directory's `skills/`) is no longer read as the app's code. In 0.2.0 it
  gave false passes on gates 6, 9 and 12, and `fix` then skipped the health route.
- `fix.mjs` started through a link, such as `.claude/skills`, ran nothing and
  exited 0. It now runs.
- Gate 3 fails when `.gitignore` hides `.env.example`, as create-next-app's
  `.env*` does, and `fix` names the line to add.
- Gate 7 reads a dated line under any label, in any language. 0.2.0 knew four
  English labels and called a rehearsed drill undated.
- Gate 4 accepts a real due date followed by a remark.
- A `pyproject.toml` with `[project]` or Poetry dependencies is no longer
  reported as unread.
- Following imports visits each file once and a file is read once. 0.2.0 took
  40 s on a repository the probe now reads in 0.3 s.

## 0.2.0 — 2026-11-06

A reliability round before wider distribution. No new gates, no new adapters.

### Probe safety and coverage

- Python audits accept exact pins only, with pip resolution and builds disabled.
  Skipped packages, nested manifests and incomplete ecosystem coverage are explicit.
- Generated registers leave maturity detection automatic; lower manual overrides
  are retained with a warning.
- Health responses require JSON with a meaningful version; live security headers
  require enabled values and HTTPS. A health POST never proves mutation-route CSRF.
- Invalid/future dates, disabled CI jobs, artifact retention mistaken for log cleanup,
  unsupported source files and dead helper imports no longer give misleading passes.
- Rollback guidance uses a reviewed compensating migration, target verification and
  dry-run; an isolated database rehearsal remains necessary.
- Rollback and restore guides, corrected after following them for real: a restored
  database needs `supabase migration repair` before `db push`, a failed restore
  leaves an empty target where `db push` looks green, a dropped column comes back
  empty, and rows reach another database by `\copy` and a staging table, not by
  a bare `INSERT … SELECT`.
- Regression suite: 205 tests on Ubuntu and Windows with Node 20, 22 and 24. A generated Next 16
  application builds successfully; database restore and hosted workflow checks remain manual.

### Probe: fewer false PASSes

- Comments are never evidence, whether whole-line, trailing or block, in LF
  and CRLF checkouts. A commented-out `# npm test` is no longer a CI step
  (gate 1), `// TODO add timeout` is no longer a timeout (gate 9), and an env
  var named only in a comment is no longer a read (gate 3). The filter knows
  the file type and skips strings: `#` is a comment in Python and YAML, a
  private field in JavaScript.
- Gate 5 no longer passes on an empty `recordError() {}` plus a key name. A
  hand-rolled reporter must have a body, be called, and the alert address that
  config names must be read on that path. Every gate 5 PASS is marked
  `static:` and says delivery was not tested.
- Gate 10 treats Next.js 16's `proxy.ts` as a framework-loaded file, like
  `middleware.ts`.

### Probe: `--url` no longer sends a POST

- `--url` sends GET requests only. The cross-origin POST to `/api/health` is
  now behind `--csrf-post`, because the probe cannot know what a POST does on
  a server.

### fix: writes only what can work

- A `src/app` project gets its files under `src/`; a Pages Router project, or
  one where `src/app/` sits next to a root `app/` or `pages/`, gets a manual
  step instead of a route file.
- The CI workflow is written only when `package-lock.json`, `typescript` and
  both a `test` and a `build` script exist. The TypeScript helpers need
  `typescript`; the health route needs Next.js 15 or newer. Otherwise the plan
  says what is missing.
- Health route template: `export const dynamic` is gone (Next.js 16 with
  `cacheComponents` rejects it); `connection()` takes its place.
- Backup template: nothing is committed to the repository unless the owner
  opts in; the job refuses to run in a public repository; the header lists
  what the dump leaves out (auth users, Storage files, grants).
- Restore drill template: `psql -v ON_ERROR_STOP=1 --single-transaction`, plus
  checks for users, permissions and files.
- CI and backup templates use `actions/checkout@v7` and
  `actions/setup-node@v7`, the versions this repository's own CI runs on. A
  test keeps them in step.

### Checked by hand for this release

- `fix --write`, then `npm ci`, `tsc --noEmit`, `npm test` and `next build`,
  on two fresh create-next-app projects: Next.js 16.4.5 with `src/app`, and
  Next.js 15.5.29 with `app/`.
- The restore command against a throwaway Postgres 17: it stops and rolls back
  on both errors the drill names, and restores cleanly once they are handled.
- The rollback and restore guides, step by step, on a throwaway Postgres 17 with
  Supabase CLI 3.0.0, and the history commands on CLI 2.122.1. `auth` was a stub
  table, not a Supabase project: bad migration, compensation, isolated rehearsal
  with RLS checks, row recovery and both errors the drill names.
- Not checked: the backup workflow on GitHub Actions, either guide against a real
  Supabase project, macOS.

## 0.1.0 — 2026-10-20

First public version: the probe (13 gates), `fix` with the Next.js + Supabase
+ Vercel adapter, the human-gates register, and the skeptic-review skill.
