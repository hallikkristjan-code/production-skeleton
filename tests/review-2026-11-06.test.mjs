// Review 2026-11-06, before wider distribution: false PASSes from comments (gates 1 and 9),
// a stub error path (gate 5), the src/app layout and the CI template's preconditions (fix),
// the backup template's scope, and the live POST that used to ride along with --url.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { makeRepo, TODAY } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { gateById } from "../skills/production-skeleton/scripts/lib/gates.mjs";
import { probeUrl } from "../skills/production-skeleton/scripts/lib/live.mjs";
import { planFix, applyFix } from "../skills/production-skeleton/scripts/fix.mjs";

const base = { today: TODAY, config: {}, live: null };
const run = (id, files, ctx = base) => gateById(id).run(loadRepo(makeRepo(files)), ctx);
const skill = (rel) => fileURLToPath(new URL(`../skills/production-skeleton/${rel}`, import.meta.url));
const template = (name) => readFileSync(skill(`adapters/next-supabase-vercel/templates/${name}`), "utf8").replace(/\r\n/g, "\n");

// ---------- gate 1: comments are not CI steps ----------

const WF = (steps, on = "on: [push]") => `${on}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
const BUILD_PKG = { "package.json": '{"scripts":{"build":"next build"}}' };

test("gate 1: commented-out test and build steps are not CI", () => {
  const r = run(1, { ...BUILD_PKG, ".github/workflows/ci.yml": WF("      # npm test\n      # npm run build\n      - run: echo no-checks\n") });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /no test step/);
});

test("gate 1: a trailing comment is not a step; a real step with a trailing comment still is", () => {
  const fake = run(1, { ".github/workflows/ci.yml": WF("      - run: echo hi # npm test\n") });
  assert.equal(fake.status, "FAIL");
  const real = run(1, { ...BUILD_PKG, ".github/workflows/ci.yml": WF("      # unit tests, then the production build\n      - run: npm test # fast\n      - run: npm run build\n") });
  assert.equal(real.status, "PASS");
});

test("gate 1: a commented-out trigger is not a trigger", () => {
  const r = run(1, { ".github/workflows/ci.yml": WF("      - run: npm test\n", 'on:\n  # push:\n  schedule:\n    - cron: "0 3 * * *"') });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /no push\/pull_request trigger/);
});

// ---------- gate 9: comments are not timeouts ----------

test("gate 9: a TODO comment near the call is not a timeout", () => {
  const below = run(9, { "a.js": 'fetch("https://example.org");\n// TODO add timeout later\n' });
  assert.equal(below.status, "FAIL");
  assert.match(below.note, /a\.js:1/);
  const trailing = run(9, { "a.js": 'const r = await fetch("https://example.org"); // TODO timeout\n' });
  assert.equal(trailing.status, "FAIL");
  const python = run(9, { "a.py": 'r = requests.get("https://example.org")  # timeout later\n' });
  assert.equal(python.status, "FAIL");
});

test("gate 9: a real guard next to a comment still passes", () => {
  const multi = run(9, { "a.js": 'await fetch("https://example.org", {\n  // abort a hung partner\n  signal: AbortSignal.timeout(5000),\n});\n' });
  assert.equal(multi.status, "PASS");
  const oneLine = run(9, { "a.js": 'await fetch("https://example.org/a", { signal: AbortSignal.timeout(5000) }); // 5 s\n' });
  assert.equal(oneLine.status, "PASS");
  const python = run(9, { "a.py": 'r = requests.get("https://example.org", timeout=5)  # seconds\n' });
  assert.equal(python.status, "PASS");
});

test("comments are not evidence in a CRLF checkout either (Windows, core.autocrlf)", () => {
  const trailing = run(9, { "a.js": 'const r = await fetch("https://example.org"); // TODO timeout\r\nexport default r;\r\n' });
  assert.equal(trailing.status, "FAIL");
  const ci = run(1, { ".github/workflows/ci.yml": WF("      - run: echo hi # npm test\n").replaceAll("\n", "\r\n") });
  assert.equal(ci.status, "FAIL");
});

test("gate 9: a block comment is not a timeout either", () => {
  const r = run(9, { "a.ts": 'fetch("https://example.org");\n/*\nTODO timeout\n*/\n' });
  assert.equal(r.status, "FAIL");
  const jsdoc = run(9, { "a.ts": 'fetch("https://example.org");\n/**\n * add a timeout here\n */\n' });
  assert.equal(jsdoc.status, "FAIL");
  // a glob string holds "/*" too: it must not swallow the guard that follows
  const glob = run(9, { "a.ts": 'const files = glob("src/**/*.ts");\nawait fetch("https://example.org", {\n  signal: AbortSignal.timeout(5000),\n});\n' });
  assert.equal(glob.status, "PASS");
});

test("gate 3: an env var named only in a comment is not read", () => {
  assert.equal(run(3, { "src/app.ts": "// old config: process.env.REMOVED_KEY\n" }).status, "PASS");
  assert.equal(run(3, { "src/app.ts": "/*\n process.env.REMOVED_KEY\n*/\n" }).status, "PASS");
  const real = run(3, { "src/app.ts": "// the key\nconst k = process.env.REAL_KEY;\n" });
  assert.equal(real.status, "FAIL");
  assert.match(real.note, /REAL_KEY/);
});

test("gate 10: a check inside Next 16's proxy.ts is loaded by the framework, like middleware.ts", () => {
  for (const file of ["proxy.ts", "src/proxy.ts"]) {
    const r = run(10, { [file]: "export function proxy(req) { if (req.headers.get('origin') !== APP) return deny(); }" });
    assert.equal(r.status, "PASS", file);
  }
});

// ---------- comment stripping must not eat code (independent review of this change set) ----------

test("a JS private field starts with # and is code, not a comment (gates 3 and 9)", () => {
  const call = run(9, { "a.ts": "class C {\n  #load = () => fetch('https://api.example.com/y');\n}\n" });
  assert.equal(call.status, "FAIL");
  const env = run(3, { "a.ts": "class C {\n  #key = process.env.STRIPE_KEY;\n}\n" });
  assert.equal(env.status, "FAIL");
  assert.match(env.note, /STRIPE_KEY/);
});

test("a # or // inside a string is not a comment", () => {
  const py = run(9, { "a.py": 'requests.post(URL, json={"text": f"Deploy run #{rid} failed"}, timeout=10)\n' });
  assert.equal(py.status, "PASS");
  const yml = run(1, { ".github/workflows/ci.yml": WF('      - run: echo "build #1" && npm test\n') });
  assert.equal(yml.status, "PASS");
  const js = run(9, { "a.js": 'await fetch("https://example.org/?q=a // b", { signal: AbortSignal.timeout(5000) });\n' });
  assert.equal(js.status, "PASS");
});

test("a /* path line in a Netlify _headers file is not a block comment (gate 11)", () => {
  const r = run(11, { "_headers": "/*\n  Strict-Transport-Security: max-age=63072000\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff\n" });
  assert.equal(r.status, "PASS");
});

test("a block comment opened or closed mid-line hides only what is inside it", () => {
  const disabled = run(10, { "middleware.ts": "export function middleware(req) { /* disabled:\n  if (req.headers.get('origin') !== HOST) return deny();\n*/ }\n" });
  assert.equal(disabled.status, "FAIL");
  const afterClose = run(9, { "a.ts": '/* partner call\n*/ const r = await fetch("https://example.org");\n' });
  assert.equal(afterClose.status, "FAIL");
  assert.match(afterClose.note, /a\.ts:2/);
  const inline = run(9, { "a.ts": 'await fetch("https://example.org", /* 5 s */ { signal: AbortSignal.timeout(5000) });\n' });
  assert.equal(inline.status, "PASS");
});

test("a root logs/ directory holds run output, not source; a route named logs is still source", () => {
  const repo = loadRepo(makeRepo({ "logs/audit/verify.mjs": "process.env.REMOVED_KEY", "app/logs/route.ts": "", "src/a.ts": "" }));
  assert.ok(!repo.files.some((f) => f.startsWith("logs/")));
  assert.ok(repo.files.includes("app/logs/route.ts"));
  assert.equal(run(3, { "logs/audit/verify.mjs": "const k = process.env.REMOVED_KEY;" }).status, "PASS");
});

// ---------- gate 5: a stub and a key name are not delivery ----------

test("gate 5: a stub spread over lines is still a stub", () => {
  const r = run(5, {
    "lib/errors.ts": "export function reportError(e: unknown) {\n  // TODO send\n}\n",
    "app.ts": "import { reportError } from './lib/errors';\ntry { run(); } catch (e) { reportError(e); }\n",
    "lib/mail.ts": "export const to = process.env.ALERT_EMAIL;\n",
    ".env.example": "ALERT_EMAIL=\n",
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /empty stub/);
});

test("gate 5: the alert address must be read on the error path, not somewhere unrelated", () => {
  const r = run(5, {
    "lib/errors.ts": "export function reportError(e: unknown) {\n  db.insert(String(e));\n}\n",
    "app.ts": "import { reportError } from './lib/errors';\ntry { run(); } catch (e) { reportError(e); }\n",
    "lib/newsletter.ts": "export const to = process.env.ALERT_EMAIL;\n",
    ".env.example": "ALERT_EMAIL=\n",
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /ALERT_EMAIL.*not read in a file that defines or calls/);
});

test("gate 5: an empty recordError stub plus ALERT_EMAIL= in .env.example is not an error path", () => {
  const r = run(5, { "lib/errors.js": "export function recordError(e) {}\n", ".env.example": "ALERT_EMAIL=\n" });
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /recordError at lib\/errors\.js:1/);
});

test("gate 5: a reporter nothing calls, or an alert address nothing reads, does not pass", () => {
  const send = "export async function recordError(e) { await mail.send(process.env.ALERT_EMAIL, String(e)); }\n";
  const uncalled = run(5, { "lib/errors.js": send, ".env.example": "ALERT_EMAIL=\n" });
  assert.equal(uncalled.status, "FAIL");
  assert.match(uncalled.note, /never called/);
  const unread = run(5, {
    "lib/errors.js": "export async function recordError(e) { await db.insert(e); }\n",
    "app.js": "import { recordError } from './lib/errors.js';\ntry { run(); } catch (e) { await recordError(e); }\n",
    ".env.example": "ALERT_EMAIL=\n",
  });
  assert.equal(unread.status, "FAIL");
  assert.match(unread.note, /ALERT_EMAIL.*not read in a file that defines or calls/);
});

const WIRED_ERRORS = {
  "lib/errors.js": "export async function recordError(e) { await mail.send(process.env.ALERT_EMAIL, String(e)); }\n",
  "app.js": "import { recordError } from './lib/errors.js';\ntry { run(); } catch (e) { await recordError(e); }\n",
  ".env.example": "# where alerts go\nALERT_EMAIL=\n",
};

test("gate 5: a called reporter that reads the alert address passes — as a static finding, delivery untested", () => {
  const r = run(5, WIRED_ERRORS);
  assert.equal(r.status, "PASS");
  assert.match(r.note, /^static: /);
  assert.match(r.note, /delivery not tested/);
});

test("gate 5: a tracker init is a static finding too; the note never claims an alert arrived", () => {
  const r = run(5, { "sentry.server.config.ts": "Sentry.init({ dsn: process.env.SENTRY_DSN })", ".env.example": "SENTRY_DSN=\n" });
  assert.equal(r.status, "PASS");
  assert.match(r.note, /^static: /);
  assert.match(r.note, /delivery not tested/);
});

// ---------- fix: src/app layout ----------

const PKG = (extra = {}) => JSON.stringify({
  dependencies: { next: "16", "@supabase/supabase-js": "2" },
  devDependencies: { typescript: "5" },
  scripts: { build: "next build", test: "vitest run" },
  ...extra,
});
const NPM_NEXT = { "package.json": PKG(), "package-lock.json": "{}", "vercel.json": "{}" };
const byGateDest = (plan) => Object.fromEntries(plan.actions.filter((a) => a.dest).map((a) => [a.dest, a.action]));

test("fix: a src/app project gets its route under src/app, never a competing app/ root", async () => {
  const root = makeRepo({ ...NPM_NEXT, "src/app/page.tsx": "export default function Page() { return null; }" });
  const plan = await planFix(root, { today: TODAY });
  const dests = byGateDest(plan);
  assert.equal(dests["src/app/api/health/route.ts"], "write");
  assert.equal(dests["src/lib/server/csrf.ts"], "write");
  assert.ok(!("app/api/health/route.ts" in dests));
  applyFix(root, plan, { today: TODAY });
  assert.ok(existsSync(join(root, "src/app/api/health/route.ts")));
  assert.ok(!existsSync(join(root, "app")));
  assert.ok(!existsSync(join(root, "lib")));
  // idempotent: the second run has nothing left to write
  const again = applyFix(root, await planFix(root, { today: TODAY }), { today: TODAY });
  assert.deepEqual(again.written, []);
});

test("fix: an app/ project keeps app/ and root lib/", async () => {
  const root = makeRepo({ ...NPM_NEXT, "app/page.tsx": "" });
  const dests = byGateDest(await planFix(root, { today: TODAY }));
  assert.equal(dests["app/api/health/route.ts"], "write");
  assert.equal(dests["lib/server/csrf.ts"], "write");
});

test("fix: a Pages Router project, or one with both app roots, gets a manual action instead of a route file", async () => {
  for (const files of [{ "pages/index.tsx": "" }, { "src/pages/index.tsx": "" }, { "app/page.tsx": "", "src/app/page.tsx": "" }]) {
    const root = makeRepo({ ...NPM_NEXT, ...files });
    const plan = await planFix(root, { today: TODAY });
    const health = plan.actions.find((a) => a.gate === 6);
    assert.equal(health.action, "manual", Object.keys(files).join(" + "));
    assert.match(health.note, /Pages Router|ignores src\//);
    const { written } = applyFix(root, plan, { today: TODAY });
    assert.ok(!written.some((f) => /api\/health/.test(f)));
  }
});

test("fix: src/app next to a root pages/ is ignored by Next.js, so no route is written there", async () => {
  const root = makeRepo({ ...NPM_NEXT, "pages/index.tsx": "", "src/app/page.tsx": "" });
  const plan = await planFix(root, { today: TODAY });
  const health = plan.actions.find((a) => a.gate === 6);
  assert.equal(health.action, "manual");
  assert.match(health.note, /ignores src\//);
});

test("fix: the privacy-page note names a path that exists in the project's router", async () => {
  const note = async (files) => (await planFix(makeRepo({ ...NPM_NEXT, "HUMAN-GATES.md": "---\nstage: 3\n---\n", ...files }), { today: TODAY })).actions.find((a) => a.gate === 13).note;
  assert.match(await note({ "src/app/page.tsx": "" }), /src\/app\/privacy\/page\.tsx/);
  assert.match(await note({ "pages/index.tsx": "" }), /pages\/privacy\.tsx/);
  assert.doesNotMatch(await note({ "pages/index.tsx": "" }), /app\/privacy/);
});

// ---------- fix: the CI template's preconditions ----------

test("fix: the npm CI template is written only when its commands can run", async () => {
  const ok = await planFix(makeRepo(NPM_NEXT), { today: TODAY });
  assert.equal(byGateDest(ok)[".github/workflows/ci.yml"], "write");

  const cases = [
    [{ "package.json": PKG(), "vercel.json": "{}" }, /package-lock\.json/],
    [{ "package.json": PKG(), "pnpm-lock.yaml": "", "vercel.json": "{}" }, /package-lock\.json/],
    [{ ...NPM_NEXT, "package.json": PKG({ scripts: { build: "next build" } }) }, /script "test"/],
    [{ ...NPM_NEXT, "package.json": PKG({ scripts: { test: "vitest run" } }) }, /script "build"/],
    [{ ...NPM_NEXT, "package.json": PKG({ devDependencies: {} }) }, /typescript/],
  ];
  for (const [files, needs] of cases) {
    const root = makeRepo(files);
    const plan = await planFix(root, { today: TODAY });
    const ci = plan.actions.find((a) => a.dest === ".github/workflows/ci.yml");
    assert.equal(ci.action, "skip-requires");
    assert.match(ci.requires, needs);
    assert.match(ci.note, /pnpm|yarn|by hand/);
    assert.ok(!applyFix(root, plan, { today: TODAY }).written.includes(".github/workflows/ci.yml"));
  }
});

test("fix: TypeScript templates are not dropped into a project without typescript", async () => {
  const root = makeRepo({ ...NPM_NEXT, "package.json": PKG({ devDependencies: {} }), "HUMAN-GATES.md": "---\nstage: 3\n---\n" });
  const plan = await planFix(root, { today: TODAY });
  for (const gate of [6, 10, 11]) {
    const a = plan.actions.find((x) => x.gate === gate);
    assert.equal(a.action, "skip-requires", `gate ${gate}`);
    assert.match(a.requires, /typescript/);
  }
});

// Found by a real `next build` on a create-next-app 16.4 project (cacheComponents on by default):
// "Route segment config "dynamic" is not compatible with nextConfig.cacheComponents".
test("health route template builds with cacheComponents: no route segment config, connection() instead", () => {
  const route = template("health-route.ts");
  assert.doesNotMatch(route, /^export const dynamic\b/m);
  assert.match(route, /await connection\(\);/);
  assert.ok(route.indexOf("await connection();") < route.indexOf("await fetch("));
});

test("fix: connection() needs Next.js 15, so an older Next gets no health route", async () => {
  const old = makeRepo({ ...NPM_NEXT, "package.json": PKG({ dependencies: { next: "^14.2.5", "@supabase/supabase-js": "2" } }) });
  const health = (await planFix(old, { today: TODAY })).actions.find((a) => a.gate === 6);
  assert.equal(health.action, "skip-requires");
  assert.match(health.requires, /next 15 or newer \(found \^14\.2\.5\)/);
  for (const range of ["15.0.0", "^16.4.5", "latest"]) {
    const root = makeRepo({ ...NPM_NEXT, "package.json": PKG({ dependencies: { next: range, "@supabase/supabase-js": "2" } }) });
    assert.equal((await planFix(root, { today: TODAY })).actions.find((a) => a.gate === 6).action, "write", range);
  }
});

// Dependabot bumps this repo's own workflow, not the templates `fix --write` hands to other
// projects. An action both use must be on the version this repo's CI runs green on.
test("adapter templates pin shared actions to the version this repo's own CI uses", () => {
  const own = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const pins = (text) => Object.fromEntries([...text.matchAll(/uses:\s*"?(actions\/[\w-]+)@(v\d+)/g)].map((m) => [m[1], m[2]]));
  const ours = pins(own);
  assert.ok(ours["actions/checkout"] && ours["actions/setup-node"]);
  for (const name of ["ci.yml", "backup.yml"]) {
    for (const [action, version] of Object.entries(pins(template(name)))) {
      if (ours[action]) assert.equal(version, ours[action], `${name}: ${action}`);
    }
  }
});

// ---------- backup template: scope, retention, a restore that stops on errors ----------

test("backup template: dumps are not committed to the repo unless the owner opts in", () => {
  const wf = template("backup.yml");
  assert.match(wf, /^permissions:\n  contents: read/m);
  const commitStep = wf.slice(wf.lastIndexOf("      - name:"));
  assert.match(commitStep, /git push/);
  assert.match(commitStep, /^\s+if: vars\.BACKUP_COMMIT_TO_REPO == 'true'/m);
  assert.equal(wf.match(/git push/g).length, 1);
});

test("backup template: refuses a public repository before it touches the database", () => {
  const wf = template("backup.yml");
  const guard = wf.indexOf('--jq .private)" != "true"');
  assert.ok(guard > 0);
  assert.ok(guard < wf.indexOf("bin/pg_dump "));
});

test("backup template and drill say what the dump leaves out", () => {
  for (const text of [template("backup.yml"), template("restore-drill.md")]) {
    assert.match(text, /auth/i);
    assert.match(text, /storage/i);
  }
  assert.doesNotMatch(template("backup.yml"), /All app data lives in public/);
});

test("restore drill: psql stops at the first SQL error, and the template ships without a date", () => {
  const drill = template("restore-drill.md");
  assert.match(drill, /ON_ERROR_STOP=1/);
  assert.doesNotMatch(drill, /\b\d{4}-\d{2}-\d{2}\b/);
  for (const check of [/users/i, /polic|grant/i, /file|bucket/i]) assert.match(drill, check);
});

// ---------- --url: GET only unless the POST is asked for ----------

async function withServer(fn) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(req.method === "POST" ? 403 : 200, { "content-type": "application/json" });
    res.end('{"ok":true,"version":"abc1234"}');
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, seen);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("--url sends GET requests only by default", async () => {
  await withServer(async (url, seen) => {
    const live = await probeUrl(url);
    assert.deepEqual(seen, ["GET /api/health", "GET /"]);
    assert.equal(live.health.status, 200);
    assert.ok(!("csrf" in live));
    assert.deepEqual(live.errors, []);
  });
});

test("--csrf-post adds exactly one cross-origin POST", async () => {
  await withServer(async (url, seen) => {
    const live = await probeUrl(url, { csrfPost: true });
    assert.deepEqual(seen.filter((s) => s.startsWith("POST")), ["POST /api/health"]);
    assert.equal(live.csrf.status, 403);
  });
});

test("gate 10: --url without the POST keeps the static result (not UNKNOWN, not a live PASS)", () => {
  const live = { health: { status: 200, body: "version" }, headers: {}, errors: [] };
  const r = run(10, { "middleware.ts": "const o = req.headers.get('origin');" }, { ...base, live });
  assert.equal(r.status, "PASS");
  assert.match(r.note, /^static: /);
  assert.match(r.note, /protection not verified/);
});

test("probe.mjs: --csrf-post without --url is a usage error", () => {
  const r = spawnSync(process.execPath, [skill("scripts/probe.mjs"), skill("."), "--csrf-post"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--csrf-post needs --url/);
});
