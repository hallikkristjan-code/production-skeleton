import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { parseNpmAudit, parsePipAudit, runAudit } from "../skills/production-skeleton/scripts/lib/audit.mjs";

test("parseNpmAudit: reads high and critical from npm 7+ json", () => {
  const json = JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 3, moderate: 1, high: 2, critical: 1, total: 7 } } });
  assert.deepEqual(parseNpmAudit(json), { high: 2, critical: 1 });
});
test("parseNpmAudit: garbage → null", () => {
  assert.equal(parseNpmAudit("npm ERR! something"), null);
  assert.equal(parseNpmAudit("{}"), null);
});
test("runAudit: no lockfile → skipped, nothing spawned", () => {
  const r = runAudit(loadRepo(makeRepo({ "package.json": '{"dependencies":{"a":"1"}}' })));
  assert.deepEqual(r, { tool: "npm audit", skipped: "no package-lock.json" });
});
test("runAudit: no package.json at all → skipped", () => {
  const r = runAudit(loadRepo(makeRepo({ "a.py": "" })));
  assert.equal(r.skipped, "not an npm project");
});
test("parsePipAudit: counts vulnerabilities across dependencies", () => {
  const json = JSON.stringify({ dependencies: [{ name: "a", version: "1", vulns: [{ id: "X" }, { id: "Y" }] }, { name: "b", version: "2", vulns: [] }] });
  assert.deepEqual(parsePipAudit(json), { findings: 2 });
  assert.equal(parsePipAudit("nope"), null);
});
test("runAudit: python project uses pip-audit (or says it is not installed)", () => {
  const r = runAudit(loadRepo(makeRepo({ "requirements.txt": "requests==2.32.0\n" })));
  assert.equal(r.tool, "pip-audit");
  assert.ok(typeof r.findings === "number" || /not installed|pip-audit/.test(r.skipped), JSON.stringify(r));
});
test("runAudit: falls back to `python -m pip_audit` when pip-audit is not on PATH", (t) => {
  const { spawnSync } = require("node:child_process");
  const probe = spawnSync("python -m pip_audit --version", { shell: true, encoding: "utf8" });
  if (probe.status !== 0) return t.skip("pip_audit module not installed");
  const r = runAudit(loadRepo(makeRepo({ "requirements.txt": "requests==2.32.4\n" })));
  assert.equal(r.tool, "pip-audit");
  assert.equal(typeof r.findings, "number", JSON.stringify(r));
});
test("runAudit: uv project (pyproject + uv.lock) is audited via `uv export` → pip-audit", (t) => {
  const { spawnSync } = require("node:child_process");
  if (spawnSync("uv --version", { shell: true }).status !== 0) return t.skip("uv not installed");
  if (spawnSync("python -m pip_audit --version", { shell: true }).status !== 0) return t.skip("pip_audit not installed");
  const root = makeRepo({ "pyproject.toml": '[project]\nname = "x"\nversion = "0"\nrequires-python = ">=3.10"\ndependencies = ["requests==2.25.0"]\n' });
  const lock = spawnSync("uv lock", { cwd: root, shell: true, encoding: "utf8" });
  if (lock.status !== 0) return t.skip(`uv lock failed (offline?): ${lock.stderr}`);
  const r = runAudit(loadRepo(root));
  assert.equal(r.tool, "pip-audit (uv export)");
  assert.ok(r.findings > 0, JSON.stringify(r)); // requests 2.25.0 has known CVEs
});
test("runAudit: pyproject without a lockfile → skipped with a pointer", () => {
  const r = runAudit(loadRepo(makeRepo({ "pyproject.toml": "[project]\nname = \"x\"\n" })));
  assert.equal(r.tool, "pip-audit");
  assert.match(r.skipped, /uv\.lock|requirements\.txt/);
});
