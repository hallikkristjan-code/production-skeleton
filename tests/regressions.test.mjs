// False PASS / false FAIL cases found in real runs on a Django app and a docs-only repo
// (2026-10-17), in an independent review (2026-10-02) and in a security review (2026-10-03).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, TODAY } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { gateById } from "../skills/production-skeleton/scripts/lib/gates.mjs";
import { planFix, applyFix } from "../skills/production-skeleton/scripts/fix.mjs";

const base = { today: TODAY, config: {}, live: null };
const run = (id, files, ctx = base) => gateById(id).run(loadRepo(makeRepo(files)), ctx);
const NEXT = { "package.json": '{"dependencies":{"next":"16"}}', "vercel.json": "{}" };
const CI_TEST = "on:\n  push:\njobs:\n  t:\n    steps:\n      - run: npm test\n";

// ---------- real runs ----------

test("gate 1: Django `manage.py test` and `python -m unittest` are test steps", () => {
  for (const step of ["uv run python manage.py test", "python -m unittest discover"]) {
    const wf = `on:\n  push:\njobs:\n  t:\n    steps:\n      - run: ${step}\n`;
    assert.equal(run(1, { ".github/workflows/ci.yml": wf }).status, "PASS", step);
  }
});

test("gate 6: a Django tests.py hitting /health is not the health route", () => {
  const r = run(6, { "core/tests.py": "self.client.get('/health')" });
  assert.equal(r.status, "FAIL");
});

test("gate 6: Django path('health', view) is a health route", () => {
  const r = run(6, { "config/urls.py": "urlpatterns = [path('health', health, name='health')]" });
  assert.equal(r.status, "PASS");
  assert.match(r.note, /config\/urls\.py:1/);
});

test("gate 2: a repo with no dependency manifest has nothing to update → N/A", () => {
  const r = run(2, { "README.md": "# docs only", "design/a.md": "" });
  assert.equal(r.status, "N/A");
  assert.match(r.note, /manifest/);
  assert.equal(run(2, { "package.json": "{}" }).status, "FAIL");
});

// ---------- 2026-10-02 review, P1 ----------

test("comments are not evidence: TODO csrf, a lone `// retention`", () => {
  assert.equal(run(10, { "middleware.ts": "// TODO: add csrf protection" }).status, "FAIL");
  assert.equal(run(10, { "settings.py": "# CSRF_TRUSTED_ORIGINS = []" }).status, "FAIL");
  const g12 = run(12, { "a.ts": "const max = schema.max(100);\n// retention\n" });
  assert.equal(g12.status, "FAIL");
  assert.match(g12.note, /retention/);
});

test("comments are not evidence, but real code next to them still is", () => {
  assert.equal(run(10, { "middleware.ts": "// check origin\nconst origin = req.headers.get('origin');" }).status, "PASS");
});

test("gate 10/11: a helper no source file imports is not wired up → FAIL with a pointer", () => {
  const csrf = run(10, { "lib/server/csrf.ts": "export function isTrustedOrigin(req) { return req.headers.get('origin') === APP; }" });
  assert.equal(csrf.status, "FAIL");
  assert.match(csrf.note, /lib\/server\/csrf\.ts.*not imported/);
  const headers = run(11, { "lib/server/securityHeaders.ts": "Strict-Transport-Security\nframe-ancestors\nnosniff" });
  assert.equal(headers.status, "FAIL");
  assert.match(headers.note, /not imported/);
});

test("gate 10/11: the same helper imported from middleware / next.config passes", () => {
  const csrf = run(10, {
    "lib/server/csrf.ts": "export function isTrustedOrigin(req) { return req.headers.get('origin') === APP; }",
    "middleware.ts": 'import { isTrustedOrigin } from "./lib/server/csrf";',
  });
  assert.equal(csrf.status, "PASS");
  const headers = run(11, {
    "lib/server/securityHeaders.ts": "Strict-Transport-Security\nframe-ancestors\nnosniff",
    "next.config.ts": 'import { SECURITY_HEADERS } from "./lib/server/securityHeaders";',
  });
  assert.equal(headers.status, "PASS");
});

test("fix --write does not turn gates 10/11 green with unwired helpers", async () => {
  const { runProbe } = await import("../skills/production-skeleton/scripts/lib/run.mjs");
  const root = makeRepo({ ...NEXT, "HUMAN-GATES.md": "---\nstage: 3\n---\n" });
  applyFix(root, await planFix(root, { today: TODAY }), { today: TODAY });
  const out = await runProbe(root, { today: TODAY, audit: false });
  const byId = Object.fromEntries(out.results.map((r) => [r.id, r]));
  assert.equal(byId[10].status, "FAIL");
  assert.equal(byId[11].status, "FAIL");
});

test("fix respects a reasoned N/A: no file, no human gate for that gate", async () => {
  const root = makeRepo({ ...NEXT, "HUMAN-GATES.md": "---\nstage: 3\nna:\n  10: no cookie authentication\n  5: errors go to the platform log, read daily\n---\n" });
  const plan = await planFix(root, { today: TODAY });
  const csrf = plan.actions.find((a) => a.gate === 10);
  assert.equal(csrf.action, "skip-na");
  const tracker = plan.actions.find((a) => a.gate === 5);
  assert.equal(tracker.action, "skip-na");
  const r = applyFix(root, plan, { today: TODAY });
  assert.ok(!r.written.includes("lib/server/csrf.ts"));
  assert.ok(!r.humanGatesAdded.some((g) => /error tracker/i.test(g)));
});

test("Django tests_*.py modules are test files: a link from one does not count (Django app, gate 13)", () => {
  const r = run(13, { "app/privacy/page.tsx": "", "core/tests_retention.py": "self.client.get('/privacy')" });
  assert.equal(r.status, "FAIL");
});

test("Django app templates are source, scaffold templates are not (gate 13 without config)", () => {
  const django = run(13, {
    "core/templates/core/privacy.html": "<h1>Privacy</h1>",
    "core/templates/core/base.html": "<a href=\"{% url 'privacy' %}\">Privacy</a>",
  });
  assert.equal(django.status, "PASS");
  assert.match(django.note, /core\/templates\/core\/base\.html:1/);
  const repo = loadRepo(makeRepo({ "adapters/x/templates/health-route.ts": "", "core/templates/core/base.html": "" }));
  assert.ok(repo.isTestPath("adapters/x/templates/health-route.ts"));
  assert.ok(!repo.isTestPath("core/templates/core/base.html"));
});

test("gate 13: Django {% url %} link is preferred over the route declaration and the render() path", () => {
  const cfg = { ...base, config: { privacy: "core/templates/core/privacy.html" } };
  const files = {
    "core/templates/core/privacy.html": "<h1>Privacy</h1>",
    "config/urls.py": "urlpatterns = [path('privacy', privacy, name='privacy')]",
    "core/views.py": "def privacy(request):\n    return render(request, 'core/privacy.html')",
    "core/tests_retention.py": "self.client.get('/privacy')",
    "core/templates/core/base.html": "<footer><a href=\"{% url 'privacy' %}\">Privacy</a></footer>",
  };
  const r = run(13, files, cfg);
  assert.equal(r.status, "PASS");
  assert.match(r.note, /linked from core\/templates\/core\/base\.html:1/);
});

test("gate 13: a Django path('privacy', ...) route alone counts; render() of the template does not", () => {
  const cfg = { ...base, config: { privacy: "core/templates/core/privacy.html" } };
  const page = { "core/templates/core/privacy.html": "" };
  const routed = run(13, { ...page, "config/urls.py": "urlpatterns = [path('privacy', privacy)]" }, cfg);
  assert.equal(routed.status, "PASS");
  assert.match(routed.note, /config\/urls\.py:1/);
  const rendered = run(13, { ...page, "core/views.py": "return render(request, 'core/privacy.html')" }, cfg);
  assert.equal(rendered.status, "FAIL");
});

test("files inside .claude/worktrees are other checkouts, not this repo", () => {
  const repo = loadRepo(makeRepo({ "config/urls.py": "", ".claude/worktrees/w1/config/urls.py": "", ".claude/settings.json": "{}" }));
  assert.ok(repo.files.includes("config/urls.py"));
  assert.ok(!repo.files.some((f) => f.startsWith(".claude/worktrees/")));
});

// ---------- security review 2026-10-03 ----------

const PRT = (extra = "") => `on:\n  pull_request_target:\njobs:\n  d:\n    ${extra}steps:\n      - run: deploy\n        env:\n          TOKEN: \${{ secrets.DEPLOY_TOKEN }}\n`;

test("gate 1: pull_request_target with repo secrets and no environment → FAIL (secrets reach fork PRs)", () => {
  const r = run(1, { ".github/workflows/ci.yml": CI_TEST, ".github/workflows/deploy.yml": PRT() });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /deploy\.yml.*pull_request_target.*secrets\.DEPLOY_TOKEN/);
});

test("gate 1: the same workflow behind an environment, or using only GITHUB_TOKEN, is fine", () => {
  assert.equal(run(1, { ".github/workflows/ci.yml": CI_TEST, ".github/workflows/deploy.yml": PRT("environment: production\n    ") }).status, "PASS");
  const tokenOnly = PRT().replace("secrets.DEPLOY_TOKEN", "secrets.GITHUB_TOKEN");
  assert.equal(run(1, { ".github/workflows/ci.yml": CI_TEST, ".github/workflows/label.yml": tokenOnly }).status, "PASS");
});
