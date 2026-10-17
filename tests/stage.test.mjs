import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { detectStage, declaredDeps, hasBuildScript } from "../skills/production-skeleton/scripts/lib/stage.mjs";

const pkg = (deps, scripts = {}) => JSON.stringify({ dependencies: deps, scripts });

test("stage 0: no server framework and no deploy file", () => {
  const r = loadRepo(makeRepo({ "package.json": pkg({ chalk: "1" }), "index.mjs": "" }));
  assert.deepEqual(detectStage(r), { stage: 0, reasons: ["no deploy target (no server framework, no deploy file)"] });
});

test("stage 1: server framework, no auth, no PII, no payments", () => {
  const r = loadRepo(makeRepo({ "package.json": pkg({ express: "4" }) }));
  assert.deepEqual(detectStage(r), { stage: 1, reasons: ["deploy target: express"] });
});

test("stage 2 via auth library", () => {
  const r = loadRepo(makeRepo({ "package.json": pkg({ next: "16", "next-auth": "5" }) }));
  const s = detectStage(r);
  assert.equal(s.stage, 2);
  assert.ok(s.reasons.includes("personal data: auth library next-auth"));
});

test("stage 2 via PII column in a migration, ignoring test dirs", () => {
  const r = loadRepo(makeRepo({
    "package.json": pkg({ next: "16" }),
    "supabase/migrations/0001_init.sql": "create table people (id uuid, email text);",
    "tests/fixtures/schema.sql": "create table x (phone text);",
  }));
  const s = detectStage(r);
  assert.equal(s.stage, 2);
  assert.ok(s.reasons.includes("personal data: column email in supabase/migrations/0001_init.sql:1"));
});

test("stage 2 via a compound PII column name", () => {
  const r = loadRepo(makeRepo({
    "package.json": pkg({ next: "16" }),
    "prisma/schema.prisma": "model User { id Int @id\n phone_number String }",
  }));
  const s = detectStage(r);
  assert.equal(s.stage, 2);
  assert.ok(s.reasons.includes("personal data: column phone in prisma/schema.prisma:2"));
});

test("stage 3 via payment dependency", () => {
  const r = loadRepo(makeRepo({ "package.json": pkg({ next: "16", stripe: "14" }) }));
  const s = detectStage(r);
  assert.equal(s.stage, 3);
  assert.ok(s.reasons.includes("payments: stripe"));
});

test("python: django deploy + contrib.auth", () => {
  const r = loadRepo(makeRepo({
    "requirements.txt": "Django==5.1\npsycopg[binary]\n",
    "manage.py": "",
    "config/settings.py": "INSTALLED_APPS = ['django.contrib.auth']\n",
  }));
  const s = detectStage(r);
  assert.equal(s.stage, 2);
  assert.ok(s.reasons.includes("deploy target: django"));
  assert.ok(declaredDeps(r).has("django"));
  assert.ok(declaredDeps(r).has("django.contrib.auth"));
});

test("hasBuildScript", () => {
  assert.equal(hasBuildScript(loadRepo(makeRepo({ "package.json": pkg({}, { build: "next build" }) }))), true);
  assert.equal(hasBuildScript(loadRepo(makeRepo({ "package.json": pkg({}) }))), false);
  assert.equal(hasBuildScript(loadRepo(makeRepo({ "requirements.txt": "" }))), false);
});

test("stage 1: a Vite/CRA single-page app counts as a deploy target", () => {
  const r = loadRepo(makeRepo({ "package.json": '{"scripts":{"build":"vite build"},"devDependencies":{"vite":"6"}}', "vite.config.ts": "", "index.html": "" }));
  const s = detectStage(r);
  assert.equal(s.stage, 1);
  assert.match(s.reasons[0], /deploy target: static site \(vite\.config\.ts\)/);
  const cra = detectStage(loadRepo(makeRepo({ "package.json": '{"dependencies":{"react-scripts":"5"}}' })));
  assert.equal(cra.stage, 1);
  const lib = detectStage(loadRepo(makeRepo({ "package.json": '{"devDependencies":{"vite":"6"}}' })));
  assert.equal(lib.stage, 0, "vite as a dev tool without a config file is still a library");
});
