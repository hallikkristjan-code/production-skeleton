// Probe safety regressions, 2026-11-06: the probe ran build code from the repository it
// was reading (F01), froze the stage its own generator wrote (F02), gave a PASS to input it never
// read (F03, F08), took weak live answers as proof (F04), accepted dates that are not dates (F05),
// counted an artifact setting as log retention (F06), and passed a CI job that cannot run (F07).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { makeRepo } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { gateById } from "../skills/production-skeleton/scripts/lib/gates.mjs";
import { runProbe } from "../skills/production-skeleton/scripts/lib/run.mjs";
import * as auditLib from "../skills/production-skeleton/scripts/lib/audit.mjs";
const { runAudit, parsePipAudit, requirementsProblem } = auditLib;
import { detectStage, declaredDeps } from "../skills/production-skeleton/scripts/lib/stage.mjs";
import { probeUrl } from "../skills/production-skeleton/scripts/lib/live.mjs";
import { parseArgs } from "../skills/production-skeleton/scripts/lib/cli.mjs";
import { renderMarkdown } from "../skills/production-skeleton/scripts/lib/report.mjs";
import { planFix, applyFix } from "../skills/production-skeleton/scripts/fix.mjs";

const TODAY = "2026-11-06";
const base = { today: TODAY, config: {}, live: null };
const run = (id, files, ctx = base) => gateById(id).run(loadRepo(makeRepo(files)), ctx);
const DEPENDABOT = { ".github/dependabot.yml": "version: 2" };
const template = (name) =>
  readFileSync(fileURLToPath(new URL(`../skills/production-skeleton/adapters/next-supabase-vercel/templates/${name}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

// ---------- F01: the dependency audit never runs code from the repository ----------

test("F01: a fully pinned requirements file is statically auditable", () => {
  assert.equal(requirementsProblem("# prod\nrequests==2.32.4\nuvicorn[standard]==0.30.0 ; python_version >= '3.9'\n"), null);
  assert.equal(requirementsProblem("--index-url https://pypi.org/simple\nrequests==2.32.4 \\\n    --hash=sha256:abc\n"), null);
  assert.equal(requirementsProblem(""), null);
});

test("F01: anything pip would have to resolve, fetch or build is refused", () => {
  assert.match(requirementsProblem("requests>=2.0\n"), /requests>=2\.0/);
  assert.match(requirementsProblem("requests\n"), /requests/);
  assert.match(requirementsProblem("requests==2.32.4\n-r other.txt\n"), /-r other\.txt/);
  assert.match(requirementsProblem("-e .\n"), /-e \./);
  assert.match(requirementsProblem("./vendor/pkg\n"), /vendor\/pkg/);
  assert.match(requirementsProblem("C:/Users/x/pkg\n"), /C:\/Users/);
  assert.match(requirementsProblem("pkg @ git+https://example.org/pkg.git\n"), /git\+https/);
  assert.match(requirementsProblem("requests==2.*\n"), /2\.\*/);
});

test("F01: a requirement that points at a local build backend is not built (marker stays absent)", () => {
  const root = makeRepo({
    "pyproject.toml": '[build-system]\nrequires = []\nbuild-backend = "audit_backend"\nbackend-path = ["."]\n',
    "audit_backend.py": 'from pathlib import Path\nPath(__file__).with_name("backend-executed.txt").write_text("ran")\ndef get_requires_for_build_wheel(config_settings=None):\n    raise RuntimeError("stop")\n',
  });
  writeFileSync(join(root, "requirements.txt"), root.replaceAll("\\", "/") + "\n");
  const r = runAudit(loadRepo(root));
  assert.equal(existsSync(join(root, "backend-executed.txt")), false, "the audit ran the repository's build backend");
  assert.match((r.parts?.find((p) => p.manifest === "requirements.txt") ?? r).skipped, /not pinned/);
});

test("F01: an unpinned requirements.txt is not resolved: skipped with the reason, gate 2 UNKNOWN", () => {
  const files = { "requirements.txt": "requests>=2.0\n", ...DEPENDABOT };
  const audit = runAudit(loadRepo(makeRepo(files)));
  assert.equal(audit.tool, "pip-audit");
  assert.match(audit.skipped, /not pinned.*requests>=2\.0/);
  const g2 = run(2, files, { ...base, audit });
  assert.equal(g2.status, "UNKNOWN");
  assert.match(g2.note, /not pinned/);
});

// ---------- F03: what was not checked is said, never passed ----------

test("F03: a package pip-audit skipped is not a clean package", () => {
  const parsed = parsePipAudit(JSON.stringify({ dependencies: [{ name: "private-package", skip_reason: "not on PyPI" }, { name: "a", version: "1", vulns: [] }] }));
  assert.equal(parsed.findings, 0);
  assert.deepEqual(parsed.skippedPackages, [{ name: "private-package", reason: "not on PyPI" }]);
  const g2 = run(2, { "requirements.txt": "a==1\n", ...DEPENDABOT }, { ...base, audit: { tool: "pip-audit", ...parsed } });
  assert.equal(g2.status, "UNKNOWN");
  assert.match(g2.note, /private-package.*not on PyPI/);
});

test("F03: package.json with no dependencies does not hide requirements.txt", () => {
  const files = { "package.json": "{}", "requirements.txt": "requests>=2.0\n", ...DEPENDABOT };
  const audit = runAudit(loadRepo(makeRepo(files)));
  assert.deepEqual(audit.parts.map((p) => p.manifest), ["package.json", "requirements.txt"]);
  const g2 = run(2, files, { ...base, audit });
  assert.equal(g2.status, "UNKNOWN");
  assert.match(g2.note, /requirements\.txt/);
});

test("F03: one vulnerable ecosystem fails the gate even when the other is clean", () => {
  const audit = { parts: [{ manifest: "package.json", tool: "npm audit", high: 0, critical: 0 }, { manifest: "requirements.txt", tool: "pip-audit", findings: 2 }] };
  const g2 = run(2, { "package.json": "{}", ...DEPENDABOT }, { ...base, audit });
  assert.equal(g2.status, "FAIL");
  assert.match(g2.note, /pip-audit: 2 known vulnerabilities/);
  const clean = { parts: [{ manifest: "package.json", tool: "npm audit", high: 0, critical: 0 }, { manifest: "requirements.txt", tool: "pip-audit", findings: 0 }] };
  assert.equal(run(2, { "package.json": "{}", ...DEPENDABOT }, { ...base, audit: clean }).status, "PASS");
});

test("F03: a workspace root without direct dependencies still has something to audit", () => {
  const files = {
    "package.json": '{"private":true,"workspaces":["apps/*"]}',
    "apps/web/package.json": '{"dependencies":{"next":"16","stripe":"17"}}',
  };
  const audit = runAudit(loadRepo(makeRepo(files)));
  assert.equal(audit.nothing, undefined);
  assert.equal(audit.parts[0].skipped, "no package-lock.json");
});

test("F03: a nested manifest outside the workspaces is listed as not audited", () => {
  const files = { "package.json": "{}", "services/api/requirements.txt": "flask==3.0.0\n", "go.mod": "module x\n", ...DEPENDABOT };
  const audit = runAudit(loadRepo(makeRepo(files)));
  const nested = audit.parts.find((p) => p.manifest === "services/api/requirements.txt");
  assert.match(nested.skipped, /services\/api/);
  assert.match(audit.parts.find((p) => p.manifest === "go.mod").skipped, /no audit/);
  const g2 = run(2, files, { ...base, audit });
  assert.equal(g2.status, "UNKNOWN");
  assert.match(g2.note, /services\/api\/requirements\.txt/);
});

test("F03: stage detection reads the workspace apps, and says which manifest", () => {
  const s = detectStage(loadRepo(makeRepo({
    "package.json": '{"private":true,"workspaces":["apps/*"]}',
    "apps/web/package.json": '{"dependencies":{"next":"16","stripe":"17"}}',
  })));
  assert.equal(s.stage, 3);
  assert.match(s.reasons.join("; "), /deploy target: next \(apps\/web\/package\.json\)/);
  assert.match(s.reasons.join("; "), /payments: stripe \(apps\/web\/package\.json\)/);
});

test("F03: fix still picks its adapter from the root manifest only", async () => {
  const root = makeRepo({ "package.json": '{"private":true,"workspaces":["apps/*"]}', "apps/web/package.json": '{"dependencies":{"next":"16"}}' });
  assert.equal(declaredDeps(loadRepo(root)).has("next"), false);
  assert.equal((await planFix(root, { today: TODAY })).adapter, null);
});

test("F03: pyproject dependencies on one line, with extras, and in a Poetry table", () => {
  const inline = detectStage(loadRepo(makeRepo({ "pyproject.toml": '[project]\nname="web"\nversion="0.1"\ndependencies = ["fastapi>=0.100"]\n' })));
  assert.deepEqual(inline, { stage: 1, reasons: ["deploy target: fastapi"] });
  const extras = declaredDeps(loadRepo(makeRepo({ "pyproject.toml": '[project]\ndependencies = ["uvicorn[standard]>=0.2", "Stripe"]\n' })));
  assert.ok(extras.has("uvicorn") && extras.has("stripe"));
  const poetry = detectStage(loadRepo(makeRepo({ "pyproject.toml": '[tool.poetry.dependencies]\npython = "^3.12"\ndjango = "^5.0"\n' })));
  assert.equal(poetry.stage, 1);
  const multi = declaredDeps(loadRepo(makeRepo({ "pyproject.toml": '[project]\ndependencies = [\n  "flask>=3",  # web\n  "authlib",\n]\n\n[project.optional-dependencies]\npay = ["stripe"]\n' })));
  assert.ok(multi.has("flask") && multi.has("authlib") && multi.has("stripe"));
});

test("F03: a keyword or classifier is not a dependency", () => {
  const deps = declaredDeps(loadRepo(makeRepo({ "pyproject.toml": '[project]\nname = "lib"\nkeywords = ["stripe", "django"]\nclassifiers = [\n  "Framework :: Django",\n]\n' })));
  assert.equal(deps.has("stripe"), false);
  assert.equal(deps.has("django"), false);
  assert.equal(deps.has("framework"), false);
});

test("F03: a manifest the probe cannot read is named, not reported as 'no deploy target'", async () => {
  const root = makeRepo({ "go.mod": "module example.org/api\n", "main.go": "package main\n", "HUMAN-GATES.md": "# Human gates\n" });
  const s = detectStage(loadRepo(root));
  assert.equal(s.stage, 0);
  assert.match(s.reasons.join("; "), /go\.mod/);
  const out = await runProbe(root, { today: TODAY, audit: false });
  assert.match(out.results.find((r) => r.id === 9).note, /stage not detected/);
  assert.deepEqual(out.coverage.manifestsNotRead, ["go.mod"]);
  assert.deepEqual(out.coverage.notScanned, { ".go": 1 });
  assert.match(renderMarkdown(out), /Not covered:.*go\.mod/);
});

test("F03: the JSON result lists what the audit checked and skipped", async () => {
  const root = makeRepo({ "package.json": "{}", "requirements.txt": "requests>=2.0\n", ...DEPENDABOT });
  const out = await runProbe(root, { today: TODAY });
  assert.deepEqual(out.coverage.audit.map((p) => p.manifest), ["package.json", "requirements.txt"]);
  assert.match(out.coverage.audit[1].skipped, /not pinned/);
  const off = await runProbe(root, { today: TODAY, audit: false });
  assert.equal(off.coverage.audit, null);
});

// ---------- F02: the generator does not freeze the stage ----------

test("F02: fix before the first feature, then auth, then payments: the stage and the required gates grow", async () => {
  const root = makeRepo({ "package.json": '{"dependencies":{"next":"16"}}' });
  applyFix(root, await planFix(root, { today: TODAY }), { today: TODAY });
  assert.doesNotMatch(readFileSync(join(root, "HUMAN-GATES.md"), "utf8"), /^stage:/m);
  const first = await runProbe(root, { today: TODAY, audit: false });
  assert.equal(first.stage, 1);
  writeFileSync(join(root, "package.json"), '{"dependencies":{"next":"16","next-auth":"5"}}');
  const withAuth = await runProbe(root, { today: TODAY, audit: false });
  assert.equal(withAuth.stage, 2);
  writeFileSync(join(root, "package.json"), '{"dependencies":{"next":"16","next-auth":"5","stripe":"17"}}');
  const withPayments = await runProbe(root, { today: TODAY, audit: false });
  assert.equal(withPayments.stage, 3);
  assert.ok(first.score.required < withAuth.score.required && withAuth.score.required < withPayments.score.required,
    `${first.score.required} < ${withAuth.score.required} < ${withPayments.score.required}`);
});

test("F02: a declared stage below the detected one is kept, and the conflict is visible", async () => {
  const root = makeRepo({ "package.json": '{"dependencies":{"next":"16","stripe":"17"}}', "HUMAN-GATES.md": "---\nstage: 1\n---\n# Human gates\n" });
  const out = await runProbe(root, { today: TODAY, audit: false });
  assert.equal(out.stage, 1);
  assert.equal(out.detectedStage, 3);
  assert.match(out.reasons[0], /stage 1 declared in HUMAN-GATES\.md.*detected stage 3/);
  assert.match(renderMarkdown(out), /detected stage 3/);
  applyFix(root, await planFix(root, { today: TODAY }), { today: TODAY });
  assert.match(readFileSync(join(root, "HUMAN-GATES.md"), "utf8"), /^stage: 1$/m, "fix must not remove a human's override");
});

test("F02: a declared stage at or above the detected one reads as before", async () => {
  const root = makeRepo({ "package.json": '{"dependencies":{"next":"16"}}', "HUMAN-GATES.md": "---\nstage: 3\n---\n" });
  const out = await runProbe(root, { today: TODAY, audit: false });
  assert.equal(out.stage, 3);
  assert.equal(out.reasons[0], "stage 3 declared in HUMAN-GATES.md");
});

// ---------- F05: dates and register config are validated ----------

test("F05: a restore drill dated in the future is a plan, not a rehearsal", () => {
  const BACKUP = { "scripts/backup.sh": "pg_dump db" };
  const future = run(7, { ...BACKUP, "docs/ops/restore-drill.md": "Date: 2099-01-01" });
  assert.equal(future.status, "FAIL");
  assert.match(future.note, /future/);
  const invalid = run(7, { ...BACKUP, "docs/ops/restore-drill.md": "Date: 2026-99-99" });
  assert.equal(invalid.status, "FAIL");
  assert.match(invalid.note, /2026-99-99/);
  const sameDay = run(7, { ...BACKUP, "docs/ops/restore-drill.md": `Date: ${TODAY}` });
  assert.equal(sameDay.status, "PASS");
});

test("F05: the drill date is the one the drill was run on, not the next planned one", () => {
  const BACKUP = { "scripts/backup.sh": "pg_dump db" };
  const r = run(7, { ...BACKUP, "docs/ops/restore-drill.md": "Next drill due: 2027-02-01\nPlanned: 2026-12-01\n\nLast drill: 2026-10-01, 500 rows, 12 min" });
  assert.equal(r.status, "PASS");
  assert.match(r.note, /2026-10-01/);
  const onlyPlan = run(7, { ...BACKUP, "docs/ops/restore-drill.md": "Planned: 2026-10-01" });
  assert.equal(onlyPlan.status, "FAIL");
});

test("F05: an open human gate with an impossible date fails gate 4", () => {
  const r = run(4, { "HUMAN-GATES.md": "- [ ] 2026-99-99 Add backup (due: 2026-99-99)\n" });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /2026-99-99/);
  const due = run(4, { "HUMAN-GATES.md": "- [ ] 2026-11-01 Add backup (due: 2026-02-31)\n" });
  assert.equal(due.status, "FAIL");
  assert.equal(run(4, { "HUMAN-GATES.md": "- [ ] 2026-11-05 Add backup (due: 2026-12-01)\n" }).status, "PASS");
});

test("F05: --today must be a real calendar day", () => {
  assert.match(parseArgs(["--today", "2026-02-31"], { today: "string" }).error, /invalid --today/);
  assert.match(parseArgs(["--today", "2026-13-01"], { today: "string" }).error, /invalid --today/);
  assert.equal(parseArgs(["--today", "2028-02-29"], { today: "string" }).error, null);
});

test("F05: a register setting that is not a number is an error, and never disables staleness", async () => {
  const root = makeRepo({
    "package.json": '{"dependencies":{"express":"4"}}',
    "HUMAN-GATES.md": "---\nstale_days: soon\ndrill_max_days: abc\nstage: nine\n---\n- [ ] 2026-01-01 Old open line\n",
    "scripts/backup.sh": "pg_dump db",
    "docs/ops/restore-drill.md": "Date: 2026-01-01",
  });
  const out = await runProbe(root, { today: TODAY, audit: false });
  const g = (id) => out.results.find((r) => r.id === id);
  assert.equal(g(4).status, "FAIL");
  assert.match(g(4).note, /stale_days.*drill_max_days.*stage|stage.*stale_days.*drill_max_days/);
  assert.equal(g(7).status, "STALE", "the default 90 days applies when the setting is unreadable");
  assert.equal(out.stage, 1, "an unreadable stage does not override detection");
  assert.equal(out.humanGates.stale.length, 1);
});

// ---------- F06: an artifact setting is not log retention ----------

test("F06: retention-days on a workflow artifact is not a cleanup job", () => {
  const r = run(12, {
    "src/input.ts": "const input = z.string().max(50);",
    ".github/workflows/backup.yml": "steps:\n  - uses: actions/upload-artifact@v4\n    with:\n      retention-days: 90",
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /retention/);
});

test("F06: a scheduled delete of old log rows is, and the PASS says what was not checked", () => {
  const sql = run(12, { "src/input.ts": "const input = z.string().max(50);", "supabase/migrations/1_cleanup.sql": "select cron.schedule('nightly', '0 3 * * *', $$delete from error_log where created_at < now() - interval '90 days'$$);" });
  assert.equal(sql.status, "PASS");
  assert.match(sql.note, /^static: /);
  const job = run(12, { "src/input.ts": "const input = z.string().max(50);", "scripts/cleanup.mjs": "// nightly\nawait purge(logs, { olderThan: '90 days' });" });
  assert.equal(job.status, "PASS");
  const wf = run(12, { "src/input.ts": "const input = z.string().max(50);", ".github/workflows/cleanup.yml": "on:\n  schedule:\n    - cron: '0 3 * * *'\njobs:\n  purge:\n    steps:\n      - run: node scripts/purge-logs.mjs --retention 90\n        # with retention-days: 5 on the artifact\n" });
  assert.equal(wf.status, "PASS");
});

// ---------- F07: a job that cannot run is not CI; GitLab has its own syntax ----------

const GH = (jobs) => `on: [push]\njobs:\n${jobs}`;
const JOB = (name, extra, steps) => `  ${name}:\n${extra}    runs-on: ubuntu-latest\n    steps:\n${steps}`;

test("F07: a job switched off with `if: false` does not run its test step", () => {
  const off = run(1, { ".github/workflows/ci.yml": GH(JOB("tests", "    if: false\n", "      - run: npm test\n")) });
  assert.equal(off.status, "FAIL");
  assert.match(off.note, /no test step/);
  const expr = run(1, { ".github/workflows/ci.yml": GH(JOB("tests", "    if: ${{ false }}\n", "      - run: npm test\n")) });
  assert.equal(expr.status, "FAIL");
});

test("F07: a step switched off with `if: false` is not a step", () => {
  const first = run(1, { ".github/workflows/ci.yml": GH(JOB("tests", "", "      - if: false\n        run: npm test\n      - run: echo done\n")) });
  assert.equal(first.status, "FAIL");
  const later = run(1, { ".github/workflows/ci.yml": GH(JOB("tests", "", "      - name: unit\n        run: npm test\n        if: false\n      - run: echo done\n")) });
  assert.equal(later.status, "FAIL");
});

test("F07: a disabled job next to a live one, or a real condition, still passes", () => {
  const twoJobs = run(1, { ".github/workflows/ci.yml": GH(JOB("old", "    if: false\n", "      - run: echo legacy\n") + JOB("tests", "", "      - run: npm test\n")) });
  assert.equal(twoJobs.status, "PASS");
  const stepOffThenOn = run(1, { ".github/workflows/ci.yml": GH(JOB("tests", "", "      - if: false\n        run: echo skipped\n      - run: npm test\n")) });
  assert.equal(stepOffThenOn.status, "PASS");
  const conditional = run(1, { ".github/workflows/ci.yml": GH(JOB("tests", "    if: github.event_name == 'push'\n", "      - run: npm test\n")) });
  assert.equal(conditional.status, "PASS");
});

test("F07: .gitlab-ci.yml runs on every push without an `on:` key", () => {
  const ok = run(1, { ".gitlab-ci.yml": "test:\n  script:\n    - npm test\n" });
  assert.equal(ok.status, "PASS");
  assert.match(ok.note, /\.gitlab-ci\.yml runs tests/);
  const noTest = run(1, { ".gitlab-ci.yml": "lint:\n  script:\n    - npm run lint\n" });
  assert.equal(noTest.status, "FAIL");
  assert.match(noTest.note, /no test step/);
  const manual = run(1, { ".gitlab-ci.yml": "test:\n  when: manual\n  script:\n    - npm test\n" });
  assert.equal(manual.status, "FAIL");
});

// ---------- F08: unread files and unloaded helpers ----------

test("F08: unsupported components are reported as uncovered, not clean", () => {
  const vue = run(9, { "src/App.vue": '<script setup>\nfetch("https://example.org");\n</script>' });
  assert.equal(vue.status, "UNKNOWN");
  assert.match(vue.note, /\.vue/);
  const svelte = run(9, { "src/routes/+page.svelte": '<script>\n  const r = fetch("https://example.org", { signal: AbortSignal.timeout(5000) });\n</script>' });
  assert.equal(svelte.status, "UNKNOWN");
  assert.match(svelte.note, /\.svelte/);
});

test("F08: source the probe does not read turns 'none found' into UNKNOWN", () => {
  const g9 = run(9, { "main.go": 'package main\nfunc main() { http.Get("https://example.org") }\n', "web/app.ts": "export const x = 1;" });
  assert.equal(g9.status, "UNKNOWN");
  assert.match(g9.note, /\.go/);
  const g3 = run(3, { "main.go": 'package main\nvar k = os.Getenv("API_KEY")\n' });
  assert.equal(g3.status, "UNKNOWN");
  assert.match(g3.note, /\.go/);
  const tests = run(9, { "tests/fixtures/main.go": "package main\n", "app.ts": "export const x = 1;" });
  assert.equal(tests.status, "PASS", "test fixtures are not the app's source");
});

test("F08: a helper imported only by a file nothing loads is not wired", () => {
  const dead = run(10, { "lib/csrf.ts": "export function csrf() { return false; }", "lib/dead.ts": 'import { csrf } from "./csrf";' });
  assert.equal(dead.status, "FAIL");
  assert.match(dead.note, /lib\/csrf\.ts/);
  const chain = run(10, {
    "lib/csrf.ts": "export function csrf() { return false; }",
    "lib/guard.ts": 'import { csrf } from "./csrf";\nexport const guard = csrf;',
    "middleware.ts": 'import { guard } from "./lib/guard";\nexport default guard;',
  });
  assert.equal(chain.status, "PASS");
  const cycle = run(10, { "lib/csrf.ts": 'import "./dead";\nexport function csrf() {}', "lib/dead.ts": 'import { csrf } from "./csrf";' });
  assert.equal(cycle.status, "FAIL", "two dead files importing each other are still dead");
});

test("F08: Django settings that switch a header off are not the header", () => {
  const off = run(11, { "config/settings.py": 'SECURE_HSTS_SECONDS = 0\nX_FRAME_OPTIONS = ""\nSECURE_CONTENT_TYPE_NOSNIFF = False' });
  assert.equal(off.status, "FAIL");
  assert.match(off.note, /Strict-Transport-Security.*frame-ancestors.*nosniff/);
  const on = run(11, { "config/settings.py": 'SECURE_HSTS_SECONDS = 31536000\nX_FRAME_OPTIONS = "DENY"\nSECURE_CONTENT_TYPE_NOSNIFF = True' });
  assert.equal(on.status, "PASS");
  const js = run(11, { "next.config.ts": 'const h = [["Strict-Transport-Security", "max-age=0"], ["Content-Security-Policy", "frame-ancestors *"], ["X-Content-Type-Options", "nosniff"]];' });
  assert.equal(js.status, "FAIL");
  assert.match(js.note, /Strict-Transport-Security.*frame-ancestors/);
});

// ---------- F04: live checks measure what they claim ----------

const liveHealth = (body, status = 200) => run(6, {}, { ...base, live: { health: { status, body } } });

test("F04: a health answer is JSON with a real version, not any page that contains the letters 'sha'", () => {
  const html = liveHealth("<html>Please share this page</html>");
  assert.equal(html.status, "FAIL");
  assert.match(html.note, /not JSON/);
  assert.equal(liveHealth('{"ok":true}').status, "FAIL");
  assert.equal(liveHealth('{"ok":true,"sha":""}').status, "FAIL");
  assert.equal(liveHealth('"version 1.2.3"').status, "FAIL");
  const dev = liveHealth('{"ok":true,"version":"dev"}');
  assert.equal(dev.status, "FAIL");
  assert.match(dev.note, /"dev"/);
});

test("F04: version, sha or commit with a value still passes", () => {
  assert.equal(liveHealth('{"ok":true,"db":"ok","version":"abc1234"}').status, "PASS");
  assert.equal(liveHealth('{"status":"ok","commit":"9f3c2d1"}').status, "PASS");
  assert.equal(liveHealth('{"git_sha":"9f3c2d1"}').status, "PASS");
  assert.equal(liveHealth('{"version":"1.4.0"}').status, "PASS");
  assert.equal(liveHealth('{"version":3}').status, "PASS");
});

const liveHeaders = (headers, finalUrl = "https://app.example/") => run(11, {}, { ...base, live: { headers, finalUrl } });
const GOOD = { "strict-transport-security": "max-age=31536000; includeSubDomains", "content-security-policy": "default-src 'self'; frame-ancestors 'none'", "x-content-type-options": "nosniff" };

test("F04: a header that is present but switched off is missing", () => {
  const hsts = liveHeaders({ ...GOOD, "strict-transport-security": "max-age=0" });
  assert.equal(hsts.status, "FAIL");
  assert.match(hsts.note, /Strict-Transport-Security.*max-age=0/);
  const frames = liveHeaders({ ...GOOD, "content-security-policy": "frame-ancestors *" });
  assert.equal(frames.status, "FAIL");
  assert.match(frames.note, /frame-ancestors/);
  const scheme = liveHeaders({ ...GOOD, "content-security-policy": "frame-ancestors https:" });
  assert.equal(scheme.status, "FAIL");
  const xfo = liveHeaders({ ...GOOD, "content-security-policy": "", "x-frame-options": "ALLOWALL" });
  assert.equal(xfo.status, "FAIL");
});

test("F04: working header values pass over https; over http HSTS proves nothing", () => {
  assert.equal(liveHeaders(GOOD).status, "PASS");
  assert.equal(liveHeaders({ ...GOOD, "content-security-policy": "", "x-frame-options": "SAMEORIGIN" }).status, "PASS");
  assert.equal(liveHeaders({ ...GOOD, "content-security-policy": "frame-ancestors 'self' https://partner.example" }).status, "PASS");
  const http = liveHeaders(GOOD, "http://app.example/");
  assert.equal(http.status, "UNKNOWN");
  assert.match(http.note, /https/);
  const httpMissing = liveHeaders({}, "http://app.example/");
  assert.equal(httpMissing.status, "FAIL", "a missing header is missing on any transport");
});

test("F04: health POST responses never prove mutation-route CSRF protection", () => {
  for (const status of [200, 403, 404, 405]) {
    const result = run(10, {}, { ...base, live: { csrf: { status } } });
    assert.equal(result.status, "UNKNOWN");
    assert.match(result.note, /inconclusive/);
  }
});

async function withServer(handler, fn) {
  const seen = [];
  const server = createServer((req, res) => { seen.push({ method: req.method, url: req.url, origin: req.headers.origin }); handler(req, res); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(url, seen); } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
}

test("F04: --csrf-post sends only its explicitly requested cross-origin health POST", async () => {
  await withServer((req, res) => {
    if (req.method === "POST") { res.writeHead(403); return res.end("Login required"); }
    res.end("<html>Please share this page</html>");
  }, async (url, seen) => {
    const live = await probeUrl(url, { csrfPost: true });
    assert.deepEqual(live.csrf, { status: 403 });
    assert.deepEqual(seen.filter((s) => s.method === "POST"), [
      { method: "POST", url: "/api/health", origin: "https://evil.example" },
    ]);
    assert.equal(live.finalUrl, url + "/");
    const ctx = { ...base, live };
    assert.equal(gateById(6).run(loadRepo(makeRepo({})), ctx).status, "FAIL");
    assert.notEqual(gateById(10).run(loadRepo(makeRepo({})), ctx).status, "PASS");
  });
});

test("F04: even an Origin-specific health rejection is inconclusive for mutation routes", async () => {
  await withServer((req, res) => {
    if (req.method === "POST" && req.headers.origin !== `http://${req.headers.host}`) { res.writeHead(403); return res.end(); }
    res.writeHead(req.method === "POST" ? 405 : 200, { "content-type": "application/json" });
    res.end('{"ok":true,"version":"abc1234"}');
  }, async (url) => {
    const live = await probeUrl(url, { csrfPost: true });
    assert.deepEqual(live.csrf, { status: 403 });
    assert.equal(gateById(10).run(loadRepo(makeRepo({})), { ...base, live }).status, "UNKNOWN");
  });
});

// ---------- F09: the rollback runbook does not ship a `down` file next to live migrations ----------

test("F09: schema rollback is a new forward migration, checked with a dry run against the right project", () => {
  const text = template("rollback.md");
  assert.doesNotMatch(text, /paired `down`|`down` migration/);
  assert.match(text, /supabase migration new/);
  assert.match(text, /supabase migration list/);
  assert.match(text, /supabase db push --dry-run/);
  assert.equal(run(8, { "docs/ops/rollback.md": text }).status, "PASS");
});

// Found by following both guides on a throwaway Postgres 17 with the Supabase CLI, 2026-11-06.
test("rollback: a restored copy needs its migration history back before db push", () => {
  const text = template("rollback.md");
  assert.match(text, /supabase migration repair --status applied/);
  assert.match(text, /relation \.\.\. already exists/);
  assert.match(text, /--remote="\$ISOLATED_DATABASE_URL"/);
  assert.match(text, /--db-url/, "CLI 2 has no --remote");
  assert.match(text, /empty database/i, "a failed restore leaves an empty target where db push looks green");
});

test("rollback: a compensating migration brings the column back, not its values", () => {
  assert.match(template("rollback.md"), /comes back empty/);
});

test("rollback: data goes between two databases by file, not a bare INSERT … SELECT", () => {
  const text = template("rollback.md");
  assert.doesNotMatch(text, /targeted `INSERT … SELECT`/);
  assert.match(text, /\\copy/);
  assert.match(text, /--single-transaction/);
  assert.match(text, /overriding system value/i);
  assert.match(text, /on conflict/i);
  assert.match(text, /rows\.csv/);
  assert.match(text, /plaintext/);
  assert.equal(run(8, { "docs/ops/rollback.md": text }).status, "PASS");
});

test("restore drill: the dump carries no migration history, and the guide says what follows", () => {
  const text = template("restore-drill.md");
  assert.match(text, /supabase_migrations/);
  assert.match(text, /supabase migration repair/);
});

test("review: nested workspace manifests remain explicitly unverified", () => {
  const r = runAudit(loadRepo(makeRepo({ "package.json": '{"workspaces":["apps/*"]}', "apps/web/package.json": '{"dependencies":{"next":"16"}}' })));
  assert.ok(r.parts?.some((p) => p.manifest === "apps/web/package.json" && p.skipped));
});

test("review: malformed manifests and unsupported TOML are never a clean no-deploy result", async () => {
  const malformed = runAudit(loadRepo(makeRepo({ "package.json": "{" })));
  assert.match(malformed.skipped, /invalid/);
  const out = await runProbe(makeRepo({ "pyproject.toml": '[project]\n"dependencies" = ["fastapi"]\n' }), { audit: false, today: TODAY });
  assert.ok(out.coverage.manifestsNotRead.includes("pyproject.toml"));
  assert.equal(out.results.find((g) => g.id === 9).status, "UNKNOWN");
});

test("review: component-only stage zero has unknown coverage, not N/A", async () => {
  const out = await runProbe(makeRepo({ "App.vue": '<script>fetch("https://example.org")</script>' }), { audit: false, today: TODAY });
  assert.equal(out.results.find((g) => g.id === 9).status, "UNKNOWN");
});

test("review: invalid due text and future creation cannot suppress stale human gates", () => {
  for (const line of ["- [ ] 2026-01-01 task (due: tomorrow)", "- [ ] 2099-01-01 task"]) {
    assert.equal(run(4, { "HUMAN-GATES.md": line }).status, "FAIL");
  }
});

test("review: a pinned requirements export does not silently cover a different pyproject", () => {
  const r = runAudit(loadRepo(makeRepo({ "requirements.txt": "", "pyproject.toml": '[project]\ndependencies=["fastapi"]' })));
  assert.ok(r.parts?.some((p) => p.manifest === "pyproject.toml" && p.skipped));
});
