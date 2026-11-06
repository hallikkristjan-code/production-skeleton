# Changelog

## 0.2.0 — unreleased

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
- Regression suite: 201 tests on Windows with Node 20, 22 and 24. A generated Next 16
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
- Not checked: the backup workflow on GitHub Actions, a restore into a real
  Supabase project, macOS.

## 0.1.0 — 2026-10-20

First public version: the probe (13 gates), `fix` with the Next.js + Supabase
+ Vercel adapter, the human-gates register, and the skeptic-review skill.
