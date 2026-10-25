import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { makeRepo, TODAY } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { gateById } from "../skills/production-skeleton/scripts/lib/gates.mjs";

const ctx = { today: TODAY, config: {}, live: null };
const run = (id, files) => gateById(id).run(loadRepo(makeRepo(files)), ctx);

const CI_OK = `on:\n  push:\n  pull_request:\njobs:\n  t:\n    steps:\n      - run: npm test\n      - run: npm run build\n`;

test("gate 1: workflow with test and build passes", () => {
  const r = run(1, { ".github/workflows/ci.yml": CI_OK, "package.json": '{"scripts":{"build":"x"}}' });
  assert.equal(r.status, "PASS");
  assert.match(r.note, /ci\.yml/);
});
test("gate 1: build step only required when a build script exists", () => {
  const r = run(1, { ".github/workflows/ci.yml": "on: [push]\njobs:\n  t:\n    steps:\n      - run: pytest\n" });
  assert.equal(r.status, "PASS");
});
test("gate 1: missing build step fails", () => {
  const r = run(1, { ".github/workflows/ci.yml": "on: [push]\njobs:\n  t:\n    steps:\n      - run: npm test\n", "package.json": '{"scripts":{"build":"x"}}' });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /no build step/);
});
test("gate 1: no workflow fails", () => {
  assert.equal(run(1, { "a.js": "" }).status, "FAIL");
});
test("gate 1: 'push' outside the on: block does not count as a trigger", () => {
  const wf = "on:\n  workflow_dispatch:\njobs:\n  t:\n    steps:\n      - run: npm test\n      - run: git push origin main\n";
  const r = run(1, { ".github/workflows/deploy.yml": wf });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /no push\/pull_request trigger/);
});

test("gate 2: dependabot or renovate", () => {
  assert.equal(run(2, { "package.json": "{}", ".github/dependabot.yml": "version: 2" }).status, "PASS");
  assert.equal(run(2, { "package.json": "{}", "renovate.json": "{}" }).status, "PASS");
  assert.equal(run(2, { "package.json": "{}", "a.js": "" }).status, "FAIL");
});
test("gate 2: a scanner step in a workflow counts as evidence", () => {
  const steps = [
    'uses: "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.5.0"',
    "uses: aquasecurity/trivy-action@0.36.0",
    "uses: anchore/scan-action@v6",
    "uses: snyk/actions/node@master",
    "uses: SocketDev/socket-github-action@v1",
    "run: npx @aikidosec/ci-api-client scan",
  ];
  for (const step of steps) {
    const r = run(2, { "package.json": "{}", ".github/workflows/security.yml": "on: [push]\njobs:\n  s:\n    steps:\n      - " + step + "\n" });
    assert.equal(r.status, "PASS", step);
    assert.match(r.note, /security\.yml/);
  }
  assert.equal(run(2, { "package.json": "{}", ".github/workflows/ci.yml": "on: [push]\njobs:\n  t:\n    steps:\n      - run: npm test\n" }).status, "FAIL");
});
test("gate 2: config present but the audit reports high or critical → FAIL with the count", () => {
  const files = { "package.json": "{}", ".github/dependabot.yml": "version: 2" };
  const withAudit = (audit) => gateById(2).run(loadRepo(makeRepo(files)), { ...ctx, audit });
  const r = withAudit({ tool: "npm audit", high: 2, critical: 1 });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /npm audit: 2 high, 1 critical/);
  const ok = withAudit({ tool: "npm audit", high: 0, critical: 0 });
  assert.equal(ok.status, "PASS");
  assert.match(ok.note, /npm audit: 0 high/);
  const pip = withAudit({ tool: "pip-audit", findings: 3 });
  assert.equal(pip.status, "FAIL");
  assert.match(pip.note, /pip-audit: 3 known vulnerabilities/);
  const skipped = withAudit({ tool: "npm audit", skipped: "no lockfile" });
  assert.equal(skipped.status, "UNKNOWN");
  assert.match(skipped.note, /audit not verified: no lockfile/);
});

test("gate 3: every env var read in source is in .env.example", () => {
  const ok = run(3, {
    ".env.example": "FOO=\nBAR=x\n",
    "src/a.ts": "process.env.FOO; process.env.NODE_ENV",
    "src/b.py": 'os.environ["BAR"]; os.getenv("BAR")',
    "tests/c.ts": "process.env.ONLY_IN_TESTS",
  });
  assert.equal(ok.status, "PASS");
  const bad = run(3, { ".env.example": "FOO=\n", "src/a.ts": "process.env.FOO; process.env.SECRET_KEY" });
  assert.equal(bad.status, "FAIL");
  assert.match(bad.note, /SECRET_KEY \(src\/a\.ts:1\)/);
});
test("gate 3: env reads but no example file fails; no env reads passes", () => {
  assert.equal(run(3, { "src/a.ts": "process.env.FOO" }).status, "FAIL");
  assert.equal(run(3, { "src/a.ts": "const x = 1" }).status, "PASS");
});
test("gate 3: bracket-notation process.env reads are detected", () => {
  const r = run(3, { ".env.example": "FOO=\n", "src/a.ts": 'const k = process.env["API_KEY"]; const f = process.env[\'FOO\'];' });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /API_KEY \(src\/a\.ts:1\)/);
});

test("gate 4: HUMAN-GATES.md missing / fresh / stale", () => {
  assert.equal(run(4, { "a.js": "" }).status, "FAIL");
  const fresh = run(4, { "HUMAN-GATES.md": "- [ ] 2026-09-10 thing\n" });
  assert.equal(fresh.status, "PASS");
  assert.match(fresh.note, /1 open, none stale/);
  const stale = run(4, { "HUMAN-GATES.md": "- [ ] 2026-08-01 old thing\n" });
  assert.equal(stale.status, "STALE");
  assert.match(stale.note, /old thing/);
});

// A committed .env is a leak: .gitignore added later does not remove it from history.
const gitRepo = (files, trackedEnv) => {
  const root = makeRepo(files);
  const git = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init", "--date=2026-01-02T00:00:00Z");
  if (trackedEnv) {
    writeFileSync(join(root, ".gitignore"), ".env\n");
    git("add", ".gitignore");
    git("commit", "-q", "-m", "ignore", "--date=2026-02-03T00:00:00Z");
  }
  return root;
};
test("gate 3: a git-tracked .env fails even when .env.example is complete", () => {
  const root = gitRepo({ ".env.example": "FOO=\n", ".env": "FOO=secret\n", "src/a.ts": "process.env.FOO" }, true);
  const r = gateById(3).run(loadRepo(root), ctx);
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /\.env tracked in git since 2026-01-02/);
  assert.match(r.note, /rotate/);
});
test("gate 3: an untracked .env next to a complete .env.example passes; nested .env.production fails", () => {
  const ok = gitRepo({ ".gitignore": ".env\n", ".env.example": "FOO=\n", ".env": "FOO=secret\n", "src/a.ts": "process.env.FOO" });
  assert.equal(gateById(3).run(loadRepo(ok), ctx).status, "PASS");
  const bad = gitRepo({ ".env.example": "FOO=\n", "apps/web/.env.production": "FOO=x\n", "src/a.ts": "process.env.FOO" });
  const r = gateById(3).run(loadRepo(bad), ctx);
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /apps\/web\/\.env\.production tracked/);
});
test("gate 3: outside a git repo the leak check is skipped", () => {
  assert.equal(run(3, { ".env.example": "FOO=\n", ".env": "FOO=1\n", "src/a.ts": "process.env.FOO" }).status, "PASS");
});
