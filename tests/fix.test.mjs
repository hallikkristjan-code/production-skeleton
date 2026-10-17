import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeRepo, TODAY } from "./helpers.mjs";
import { planFix, applyFix, HOOK_SNIPPET } from "../skills/production-skeleton/scripts/fix.mjs";

test("HOOK_SNIPPET is valid JSON and never throws (wraps its body in try/catch)", () => {
  const parsed = JSON.parse(HOOK_SNIPPET);
  const command = parsed.hooks.SessionStart[0].hooks[0].command;
  assert.match(command, /try/);
  assert.match(command, /catch/);
});

const NEXT = { "package.json": '{"dependencies":{"next":"16","@supabase/supabase-js":"2"},"scripts":{"build":"next build","test":"vitest run"}}', "vercel.json": "{}" };

test("no adapter for a non-Next repo", async () => {
  const plan = await planFix(makeRepo({ "package.json": '{"dependencies":{"express":"4"}}' }), { today: TODAY });
  assert.equal(plan.adapter, null);
  assert.deepEqual(plan.actions, []);
});

test("plans one write per failing gate, skips passing gates and existing files", async () => {
  const root = makeRepo({ ...NEXT, ".github/dependabot.yml": "version: 2", "docs/ops/rollback.md": "" });
  const plan = await planFix(root, { today: TODAY });
  assert.equal(plan.adapter, "next-supabase-vercel");
  const byDest = Object.fromEntries(plan.actions.map((a) => [a.dest, a.action]));
  assert.equal(byDest[".github/workflows/ci.yml"], "write");
  assert.equal(byDest[".github/dependabot.yml"], "skip-pass");
  assert.equal(byDest["docs/ops/rollback.md"], "skip-exists");
  assert.equal(byDest["HUMAN-GATES.md"], "write");
});

test("requires: backup.yml skipped without supabase-js", async () => {
  const root = makeRepo({ "package.json": '{"dependencies":{"next":"16"}}' });
  const plan = await planFix(root, { today: TODAY });
  const backup = plan.actions.find((a) => a.dest === ".github/workflows/backup.yml");
  assert.equal(backup.action, "skip-requires");
  assert.match(backup.requires, /@supabase\/supabase-js/);
});

test("applyFix writes files, never overwrites, appends human gates once", async () => {
  const root = makeRepo({ ...NEXT, "docs/ops/rollback.md": "KEEP" });
  const plan = await planFix(root, { today: TODAY });
  const r1 = applyFix(root, plan, { today: TODAY });
  assert.ok(r1.written.includes(".github/workflows/ci.yml"));
  assert.ok(existsSync(join(root, "app/api/health/route.ts")));
  assert.equal(readFileSync(join(root, "docs/ops/rollback.md"), "utf8"), "KEEP");
  const hg = readFileSync(join(root, "HUMAN-GATES.md"), "utf8");
  assert.match(hg, /^stage: 1$/m);
  assert.match(hg, new RegExp(`^- \\[ \\] ${TODAY} .*BACKUP_DATABASE_URL`, "m"));
  assert.ok(r1.humanGatesAdded.length >= 2);
  // second run: nothing to write, no duplicate human-gate lines
  const plan2 = await planFix(root, { today: TODAY });
  const r2 = applyFix(root, plan2, { today: TODAY });
  assert.deepEqual(r2.written, []);
  assert.equal(readFileSync(join(root, "HUMAN-GATES.md"), "utf8"), hg);
});

test("Next-only repo: .env.example is planned because a written file reads env vars", async () => {
  const { runProbe } = await import("../skills/production-skeleton/scripts/lib/run.mjs");
  const root = makeRepo({ "package.json": '{"dependencies":{"next":"16"},"scripts":{"build":"next build","test":"vitest run"}}' });
  const plan = await planFix(root, { today: TODAY });
  assert.equal(plan.actions.find((a) => a.dest === ".env.example").action, "write");
  applyFix(root, plan, { today: TODAY });
  const out = await runProbe(root, { today: TODAY, audit: false });
  const failing = out.results.filter((r) => r.status !== "PASS").map((r) => r.id);
  // 6 and 7's backup need supabase-js; 5, 12, 13 need app code; 7's drill needs a human;
  // 10 and 11 get helper files that stay FAIL until middleware/next.config import them
  assert.deepEqual(failing, [5, 6, 7, 10, 11, 12, 13]);
  assert.equal(out.results[2].status, "PASS");
});

test("after fix --write only gates that need app code or a human still fail", async () => {
  const { runProbe } = await import("../skills/production-skeleton/scripts/lib/run.mjs");
  const root = makeRepo(NEXT);
  applyFix(root, await planFix(root, { today: TODAY }), { today: TODAY });
  const out = await runProbe(root, { today: TODAY, audit: false });
  const failing = out.results.filter((r) => r.status !== "PASS").map((r) => r.id);
  // 5 (no tracker in code), 7 (the drill template has no date until a human runs it),
  // 12 (no validator/retention in code), 13 (no privacy page) need a human or app code, not skeleton files;
  // 10, 11: the helpers are written but a generated file is not proof they are wired in
  assert.deepEqual(failing, [5, 7, 10, 11, 12, 13]);
});

test("gate 2 failing plans both dependabot and an OSV-Scanner workflow; passing plans neither", async () => {
  const failing = await planFix(makeRepo(NEXT), { today: TODAY });
  const byDest = Object.fromEntries(failing.actions.map((a) => [a.dest, a.action]));
  assert.equal(byDest[".github/dependabot.yml"], "write");
  assert.equal(byDest[".github/workflows/osv-scanner.yml"], "write");
  const passing = await planFix(makeRepo({ ...NEXT, ".github/dependabot.yml": "version: 2" }), { today: TODAY });
  assert.equal(passing.actions.find((a) => a.dest === ".github/workflows/osv-scanner.yml").action, "skip-pass");
});
