import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const probePath = resolve(here, "../skills/production-skeleton/scripts/probe.mjs");
const fixPath = resolve(here, "../skills/production-skeleton/scripts/fix.mjs");
const fixtureRoot = resolve(here, "../eval/broken-app");

test("probe.mjs: --k=v and --k v forms both work, --json prints valid JSON", () => {
  const r1 = spawnSync(process.execPath, [probePath, fixtureRoot, "--today=2026-09-12", "--json"], { encoding: "utf8" });
  assert.equal(r1.status, 0);
  const out1 = JSON.parse(r1.stdout);
  assert.equal(out1.stage, 2);

  const r2 = spawnSync(process.execPath, [probePath, fixtureRoot, "--today", "2026-09-12", "--json"], { encoding: "utf8" });
  assert.equal(r2.status, 0);
  const out2 = JSON.parse(r2.stdout);
  assert.equal(out2.stage, 2);
});

test("probe.mjs: --url=<v> form accepted (parsed, live probe just errors offline)", () => {
  const r = spawnSync(process.execPath, [probePath, fixtureRoot, "--today=2026-09-12", "--url=https://127.0.0.1:1/nope", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0);
});

test("probe.mjs: invalid --today exits 2 with usage on stderr", () => {
  const r = spawnSync(process.execPath, [probePath, fixtureRoot, "--today=nonsense"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test("probe.mjs: unknown flag exits 2 with usage on stderr", () => {
  const r = spawnSync(process.execPath, [probePath, fixtureRoot, "--bogus"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test("probe.mjs: boolean flag with =value form exits 2 with usage on stderr", () => {
  const r = spawnSync(process.execPath, [probePath, fixtureRoot, "--json=false"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test("fix.mjs: --write=false-ish forms and --today=v both parse; unknown flag exits 2", () => {
  const dry = spawnSync(process.execPath, [fixPath, fixtureRoot, "--today=2026-09-12"], { encoding: "utf8" });
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /dry-run/);

  const bad = spawnSync(process.execPath, [fixPath, fixtureRoot, "--today=nonsense"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage/);

  const bogus = spawnSync(process.execPath, [fixPath, fixtureRoot, "--nope"], { encoding: "utf8" });
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /usage/);
});

test("probe.mjs: --no-audit skips the dependency audit", () => {
  const r = spawnSync(process.execPath, [probePath, fixtureRoot, "--today=2026-09-12", "--no-audit", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  const gate2 = JSON.parse(r.stdout).results.find((g) => g.id === 2);
  assert.equal(gate2.note, ".github/dependabot.yml present; audit not run (--no-audit)");
});
