import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { makeRepo, TODAY } from "./helpers.mjs";
import { runProbe } from "../skills/production-skeleton/scripts/lib/run.mjs";

const BROKEN = fileURLToPath(new URL("../eval/broken-app/", import.meta.url));

test("broken-app: stage 2, exactly gates 1, 3, 9, 12 fail; gate 2 is UNKNOWN (no lockfile to audit)", async () => {
  const out = await runProbe(BROKEN, { today: TODAY });
  assert.equal(out.stage, 2);
  const failing = out.results.filter((r) => r.status !== "PASS").map((r) => `${r.id}:${r.status}`);
  assert.deepEqual(failing, ["1:FAIL", "2:UNKNOWN", "3:FAIL", "9:FAIL", "12:FAIL"]);
  assert.deepEqual(out.score, { requiredPassed: 5, required: 9, passed: 8, total: 13, na: 0 });
  assert.match(out.results[2].note, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(out.results[8].note, /app\/api\/ai\/route\.ts:4/);
});

test("stage 0 repo: gates 5-13 are N/A, required is 4", async () => {
  const root = makeRepo({ "package.json": "{}", "index.mjs": "", "HUMAN-GATES.md": "- [ ] 2026-09-12 x\n", ".github/dependabot.yml": "", ".github/workflows/ci.yml": "on: [push]\njobs:\n  t:\n    steps:\n      - run: npm test\n" });
  const out = await runProbe(root, { today: TODAY });
  assert.equal(out.stage, 0);
  assert.equal(out.results.filter((r) => r.status === "N/A").length, 9);
  assert.equal(out.results[4].note, "no deploy target");
  assert.deepEqual(out.score, { requiredPassed: 4, required: 4, passed: 4, total: 13, na: 9 });
});

test("frontmatter: stage override and na with reason", async () => {
  const root = makeRepo({
    "package.json": '{"dependencies":{"express":"4"}}',
    "HUMAN-GATES.md": "---\nstage: 3\nna:\n  7: managed database, provider snapshots\n---\n",
  });
  const out = await runProbe(root, { today: TODAY });
  assert.equal(out.stage, 3);
  assert.ok(out.reasons.includes("stage 3 declared in HUMAN-GATES.md"));
  assert.equal(out.results[6].status, "N/A");
  assert.equal(out.results[6].note, "managed database, provider snapshots");
});

test("this repo scores 4/4 required", async () => {
  const out = await runProbe(fileURLToPath(new URL("../", import.meta.url)), { today: TODAY });
  assert.equal(out.stage, 0);
  assert.equal(out.score.requiredPassed, 4);
});

test("na without a reason becomes FAIL", async () => {
  const root = makeRepo({
    "package.json": '{"dependencies":{"express":"4"}}',
    "HUMAN-GATES.md": "---\nna:\n  8:\n---\n",
  });
  const out = await runProbe(root, { today: TODAY });
  assert.equal(out.results[7].status, "FAIL");
  assert.match(out.results[7].note, /without a reason/);
});

test("runProbe: gate 2 note carries the audit result, and audit:false leaves it out", async () => {
  const root = makeRepo({ "package.json": '{"dependencies":{"a":"1"}}', "index.mjs": "", ".github/dependabot.yml": "version: 2" });
  const withAudit = (await runProbe(root, { today: TODAY })).results.find((r) => r.id === 2);
  assert.equal(withAudit.status, "UNKNOWN");
  assert.match(withAudit.note, /audit not verified: no package-lock\.json/);
  const without = (await runProbe(root, { today: TODAY, audit: false })).results.find((r) => r.id === 2);
  assert.equal(without.status, "PASS");
  assert.equal(without.note, ".github/dependabot.yml present; audit not run (--no-audit)");
});
