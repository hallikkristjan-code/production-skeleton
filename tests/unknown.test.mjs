// UNKNOWN: the probe tried to verify a gate and could not. Never a PASS, never N/A.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, TODAY } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { gateById } from "../skills/production-skeleton/scripts/lib/gates.mjs";
import { score, badge, renderMarkdown } from "../skills/production-skeleton/scripts/lib/report.mjs";
import { runProbe } from "../skills/production-skeleton/scripts/lib/run.mjs";

const base = { today: TODAY, config: {}, live: null };
const run = (id, files, ctx = base) => gateById(id).run(loadRepo(makeRepo(files)), ctx);
const DEPS = { "package.json": "{}", ".github/dependabot.yml": "version: 2" };

test("gate 2: config present but the audit could not run → UNKNOWN with the reason", () => {
  const r = run(2, DEPS, { ...base, audit: { tool: "npm audit", skipped: "no JSON from npm audit (offline?)" } });
  assert.equal(r.status, "UNKNOWN");
  assert.match(r.note, /dependabot\.yml present.*offline/);
});

test("gate 2: --no-audit is an explicit opt-out → PASS on config, and the note says so", () => {
  const r = run(2, DEPS, { ...base, audit: null });
  assert.equal(r.status, "PASS");
  assert.match(r.note, /audit not run/);
});

test("gates 6/10/11: --url given but the live request failed → UNKNOWN, static evidence kept in the note", () => {
  const live = { health: null, headers: null, csrf: null, errors: ["health: fetch failed"] };
  const g6 = run(6, { "app/api/health/route.ts": "" }, { ...base, live });
  assert.equal(g6.status, "UNKNOWN");
  assert.match(g6.note, /live check failed.*route file app\/api\/health\/route\.ts/);
  const g10 = run(10, { "middleware.ts": "const o = req.headers.get('origin');" }, { ...base, live });
  assert.equal(g10.status, "UNKNOWN");
  const g11 = run(11, { "next.config.ts": "Strict-Transport-Security frame-ancestors nosniff" }, { ...base, live });
  assert.equal(g11.status, "UNKNOWN");
});

test("a failed live request does not hide a static FAIL", () => {
  const live = { health: null, headers: null, csrf: null, errors: ["health: fetch failed"] };
  assert.equal(run(6, { "a.ts": "" }, { ...base, live }).status, "FAIL");
});

test("UNKNOWN counts as not passed: required score, orange badge, bold row", () => {
  const rows = [{ id: 1, name: "g1", stage: 1, status: "PASS", note: "n" }, { id: 2, name: "g2", stage: 1, status: "UNKNOWN", note: "n" }];
  const s = score(rows, 1);
  assert.equal(s.requiredPassed, 1);
  assert.equal(s.required, 2);
  assert.match(badge(s), /orange/);
  const md = renderMarkdown({ stage: 1, reasons: ["x"], results: rows, score: s, humanGates: { open: [], stale: [] }, liveErrors: ["health: fetch failed"] });
  assert.match(md, /\| 2 \| g2 \| 1 \| \*\*UNKNOWN\*\* \| n \|/);
  assert.match(md, /Live check errors.*health: fetch failed/s);
});

test("runProbe passes live errors through to the gates", async () => {
  const root = makeRepo({ "package.json": '{"dependencies":{"next":"16"}}', "app/api/health/route.ts": "" });
  const out = await runProbe(root, { today: TODAY, audit: false, live: { health: null, headers: null, csrf: null, errors: ["health: timeout"] } });
  assert.equal(out.results[5].status, "UNKNOWN");
});

test("runAudit: package.json with no dependencies has nothing to audit → gate 2 PASS", async () => {
  const { runAudit } = await import("../skills/production-skeleton/scripts/lib/audit.mjs");
  const a = runAudit(loadRepo(makeRepo({ "package.json": '{"name":"x","scripts":{"test":"node --test"}}' })));
  assert.equal(a.nothing, "no dependencies declared");
  const r = run(2, DEPS, { ...base, audit: a });
  assert.equal(r.status, "PASS");
  assert.match(r.note, /nothing to audit/);
});
