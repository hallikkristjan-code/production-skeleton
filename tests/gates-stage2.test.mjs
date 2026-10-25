import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, TODAY } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { gateById } from "../skills/production-skeleton/scripts/lib/gates.mjs";

const base = { today: TODAY, config: {}, live: null };
const run = (id, files, ctx = base) => gateById(id).run(loadRepo(makeRepo(files)), ctx);

test("gate 5: tracker init + DSN in example", () => {
  assert.equal(run(5, { "sentry.server.config.ts": "Sentry.init({ dsn: process.env.SENTRY_DSN })", ".env.example": "SENTRY_DSN=\n" }).status, "PASS");
  const noDsn = run(5, { "app.py": "sentry_sdk.init()", ".env.example": "X=\n" });
  assert.equal(noDsn.status, "FAIL");
  assert.match(noDsn.note, /no DSN/);
  assert.equal(run(5, { "a.ts": "" }).status, "FAIL");
});

test("gate 6: health route found statically", () => {
  const r = run(6, { "app/api/health/route.ts": "export function GET(){}" });
  assert.equal(r.status, "PASS");
  assert.match(r.note, /static/);
  assert.equal(run(6, { "server.py": '@app.get("/healthz")\ndef h(): ...' }).status, "PASS");
  assert.equal(run(6, { "a.ts": "" }).status, "FAIL");
});
test("gate 6: live result overrides static", () => {
  const files = { "app/api/health/route.ts": "" };
  assert.equal(run(6, files, { ...base, live: { health: { status: 200, body: '{"ok":true,"version":"abc1234"}' } } }).status, "PASS");
  const down = run(6, files, { ...base, live: { health: { status: 503, body: "" } } });
  assert.equal(down.status, "FAIL");
  assert.match(down.note, /503/);
  const noVersion = run(6, files, { ...base, live: { health: { status: 200, body: "ok" } } });
  assert.equal(noVersion.status, "FAIL");
  assert.match(noVersion.note, /version/);
});

const BACKUP = { ".github/workflows/backup.yml": "run: pg_dump $DATABASE_URL" };
test("gate 7: backup job + dated restore drill", () => {
  assert.equal(run(7, { ...BACKUP, "docs/ops/restore-drill.md": "# Drill\n\nLast run: 2026-09-01. Restored 1234 rows in 12 min." }).status, "PASS");
  const stale = run(7, { ...BACKUP, "docs/ops/restore-drill.md": "date: 2026-01-01" });
  assert.equal(stale.status, "STALE");
  assert.match(stale.note, /2026-01-01/);
  assert.match(run(7, BACKUP).note, /restore-drill\.md/);
  assert.equal(run(7, BACKUP).status, "FAIL");
  assert.equal(run(7, { "docs/ops/restore-drill.md": "2026-09-01" }).status, "FAIL");
});
test("gate 7: drill_max_days from config", () => {
  const r = run(7, { ...BACKUP, "docs/ops/restore-drill.md": "2026-06-01" }, { ...base, config: { drill_max_days: 30 } });
  assert.equal(r.status, "STALE");
});

test("gate 8: rollback runbook covers code, schema, data", () => {
  assert.equal(run(8, { "docs/ops/rollback.md": "## Code\n…\n## Schema\n…\n## Data\n…" }).status, "PASS");
  const partial = run(8, { "docs/ops/rollback.md": "## Code\n## Migration\n" });
  assert.equal(partial.status, "FAIL");
  assert.match(partial.note, /data/);
  assert.equal(run(8, {}).status, "FAIL");
});

test("gate 9: external calls without timeout are listed", () => {
  const ok = run(9, {
    "a.ts": "await fetch(url, { signal: AbortSignal.timeout(10_000) });",
    "b.py": "requests.get(url, timeout=5)",
    "c.ts": "const r = await fetch(url, {\n  method: 'POST',\n  signal,\n});",
  });
  assert.equal(ok.status, "PASS");
  const bad = run(9, { "a.ts": "await fetch(url);", "b.py": "httpx.get(url)" });
  assert.equal(bad.status, "FAIL");
  assert.match(bad.note, /a\.ts:1/);
  assert.match(bad.note, /b\.py:1/);
  assert.equal(run(9, { "a.ts": "const x = 1" }).status, "PASS");
});

test("gate 9: relative same-origin fetches are not external calls", () => {
  const r = run(9, {
    "a.ts": "await fetch('/api/items');",
    "b.ts": "await fetch(`/api/items/${id}`, { method: 'POST' });",
    "c.ts": 'await fetch("/health");',
  });
  assert.equal(r.status, "PASS");
  assert.match(r.note, /no external HTTP calls/);
  const mixed = run(9, { "a.ts": "await fetch('/api/x');\nawait fetch('https://api.example.com');" });
  assert.equal(mixed.status, "FAIL");
  assert.match(mixed.note, /1 of 1 calls/);
});

test("gate 9: Cloudflare Workers fetch patterns are not external calls (binding, handler delegation, handler definition)", () => {
  const r = run(9, {
    ".env.example": "",
    "src/assets.ts": "const res = await c.env.ASSETS.fetch(c.req.raw);\n",
    "src/index.ts": "export default {\n  fetch: async (request, env, ctx) => withHeaders(await getProvider(env).fetch(request, env, ctx)),\n};\n",
    "src/mcp.ts": "export const mcpApi = {\n  async fetch(request: Request, env: Env, ctx: ExecutionContext) {\n    return new Response('ok');\n  },\n};\n",
    "src/github.ts": "const r = await fetch('https://api.github.com/user', { signal: AbortSignal.timeout(5000) });\n",
  });
  assert.equal(r.status, "PASS");
  assert.match(r.note, /1 external call/);
  const bad = run(9, { "src/a.ts": "const r = await fetch('https://example.com/x');\n" });
  assert.equal(bad.status, "FAIL");
});
