# skeptic-review against a deep security scan

A real app: Next.js and Supabase, about 285 TypeScript files, an MCP server,
OAuth, admin logins and person tokens, five GitHub workflows. One snapshot.
The answer key is the 18 findings a separate per-path security scan produced
on that snapshot (1 high, 8 medium, 9 low).

## Protocol

- The audit runs blind: one agent, no sub-agents, no access to the answer key.
- Same snapshot, same model (Sonnet), same prompt for every run. Only the
  skill text changes between versions.
- Three runs per version, because one run varies.
- A report scores a **full hit** when a developer reading only the report would
  fix that finding: same mechanism, same code location or set of paths. A
  **partial** touches the right file or a neighbouring symptom but misses the
  mechanism.

## Results

| skeptic-review | Full hits (of 18) | Partial |
|---|---|---|
| without the seam checks | 3 / 3 / 4 | 3 / 2 / 2 |
| with the seam checks | 7 / 9 / 7 | 3 / 2 / 3 |
| with the conditional checks | 10 / 12 / 10 | not compared |

The ranges do not overlap.

**Seam checks** (sections 2 and 8): every path a documented rule must hold on,
side handlers that skip an existing guard, read-only labels on writing tools,
and read-then-write races. The new hits were in exactly those classes.

**Conditional checks** (sections 2, 3 and 6): which environments receive each
production secret, SSRF when the server fetches a URL that comes from data, and
CSV formula injection when the app exports spreadsheets. Each targeted finding
went from 0 of 3 runs to 3 of 3. These three classes were chosen after seeing
this scan's misses, so the third row is an upper bound until a second app
confirms it. The third row was scored by a different grader; it matched the
earlier full-hit count on a calibration report (7 = 7) but counted partials
more generously, so partials are not compared.

## What it still misses

Three findings were missed in every run of the latest version: a service
worker that keeps serving responses after a token is revoked, a write allowed
outside the event's date window, and a log scrubber whose pattern misses one
token shape. Each is a rule specific to one app, found by following one path
end to end. That is the deep scan's job. The audit's report ends with a
"Not traced" block that names what it did not open, so you know where to
point it.

## Beyond the key

Each run also reported issues the scan did not list (for example backups kept
in git history indefinitely, a shared break-glass password). They are not
verified here and are not counted.
