# Retro-eval

The probe run on a real app at two commits, three weeks apart, and on this repo.

## A real app: before and after its audit

An internal app, three weeks old, working, in daily use. An evidence-based audit
found 22 issues; 15 of them map to a skeleton gate.

| | Stage | Required | Total | Failing gates |
|---|---|---|---|---|
| Before the audit | 2 | 0/9 | 2/13 | 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13 |
| After the fixes | 2 | 4/9 | 8/13 | 3, 4, 7, 8, 9 |

Gates that still fail after the fixes, and why:
- 3 — env vars read by scripts under `scripts/` are not in `.env.example`; the audit covered the app's runtime vars only.
- 4 — no `HUMAN-GATES.md` in the app.
- 7, 8 — the runbooks exist but under `docs/`, not `docs/ops/`; the convention is new.
- 9 — most outbound calls still lack a timeout/signal; not addressed by this audit round.

Gate 13 now passes on the after commit: the app added a localized privacy page
and linked it from a real view, and the probe's gate 13 was widened to look
for privacy pages by name in nine languages and to check for a real route link
instead of just an English filename.

Audit findings the probe cannot see (dead code, per-row rollback, MFA,
project-specific CI checks): 4 of 22.

## Live check (manual, against a throwaway server)

Ran the probe with `--url` against a local server that mimics the app's headers
and CSRF behavior:

| # | Gate | Live result |
|---|---|---|
| 6 | /health answers with the deployed version | PASS — `live: 200 with version` |
| 10 | Cross-origin writes are refused | PASS — `live: cross-origin POST → 403` |
| 11 | HSTS, frame-ancestors, nosniff | PASS — `live: HSTS, frame-ancestors, nosniff present` |

## This repo (as of 2026-09-12)

| Stage | Required | Total | n/a |
|---|---|---|---|
| 0 | 4/4 | 4/13 | 9 |
