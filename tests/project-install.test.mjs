// Found by following the README in a clean session on a fresh create-next-app project: installed
// into the project, the skill read its own code as the app's (gates 6, 9 and 12 passed on it, and
// fix then skipped the health route), fix did nothing through the .claude/skills link, and
// create-next-app's .gitignore hid the .env.example that fix wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo, TODAY } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { gateById } from "../skills/production-skeleton/scripts/lib/gates.mjs";
import { runProbe } from "../skills/production-skeleton/scripts/lib/run.mjs";
import { planFix } from "../skills/production-skeleton/scripts/fix.mjs";

const SKILL = fileURLToPath(new URL("../skills/production-skeleton", import.meta.url));
const NEXT = '{"dependencies":{"next":"16","@supabase/supabase-js":"2"},"devDependencies":{"typescript":"5"}}';
const base = { today: TODAY, config: {}, live: null };

/** A project with the skill installed the way `npx skills add` does it. */
function withSkill(installDir) {
  const root = makeRepo({ "package.json": NEXT, "app/page.tsx": "export default function Page() { return null; }" });
  cpSync(SKILL, join(root, installDir, "production-skeleton"), { recursive: true });
  return root;
}

for (const dir of [".agents/skills", ".claude/skills", ".cursor/skills"]) {
  test(`a skill installed in ${dir} is not the app's code`, async () => {
    const root = withSkill(dir);
    assert.equal(loadRepo(root).files.some((f) => f.startsWith(`${dir}/`)), false);
    const out = await runProbe(root, { today: TODAY, audit: false });
    const status = (id) => out.results.find((r) => r.id === id).status;
    assert.equal(status(6), "FAIL", "no health route in the app");
    assert.equal(status(12), "FAIL", "no size limit or retention in the app");
    assert.match(out.results.find((r) => r.id === 9).note, /no external HTTP calls/);
  });
}

test("fix writes the health route when the skill is installed in the project", async () => {
  const plan = await planFix(withSkill(".agents/skills"), { today: TODAY });
  assert.equal(plan.actions.find((a) => a.dest === "app/api/health/route.ts").action, "write");
});

test("the app's own files stay in scope: root skills/, dot directories without skills", () => {
  const r = loadRepo(makeRepo({ "skills/app.ts": "", ".github/workflows/ci.yml": "", ".config/app.ts": "", "src/.hidden/skills/a.ts": "" }));
  assert.ok(r.files.includes("skills/app.ts"));
  assert.ok(r.files.includes(".github/workflows/ci.yml"));
  assert.ok(r.files.includes(".config/app.ts"));
  assert.ok(r.files.includes("src/.hidden/skills/a.ts"), "only a dot directory in the project root is an agent's");
});

test("fix.mjs started through a link (.claude/skills → .agents/skills) still runs", () => {
  const root = withSkill(".agents/skills");
  const link = join(root, "linked-skill");
  symlinkSync(join(root, ".agents/skills/production-skeleton"), link, "junction");
  const r = spawnSync(process.execPath, [join(link, "scripts/fix.mjs"), root, "--today", TODAY], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /## fix — adapter next-supabase-vercel/);
});

function gitRepo(files) {
  const root = makeRepo(files);
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  return root;
}
const READS_ENV = { "app/route.ts": "const k = process.env.API_KEY;", ".env.example": "API_KEY=\n" };

test("gate 3: an .env.example that .gitignore hides reaches nobody", () => {
  const r = gateById(3).run(loadRepo(gitRepo({ ...READS_ENV, ".gitignore": ".env*\n" })), base);
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /\.env\.example is ignored/);
  assert.match(r.note, /!\.env\.example/);
});

test("gate 3: an un-ignored .env.example passes, with or without git", () => {
  assert.equal(gateById(3).run(loadRepo(gitRepo({ ...READS_ENV, ".gitignore": ".env*\n!.env.example\n" })), base).status, "PASS");
  assert.equal(gateById(3).run(loadRepo(makeRepo({ ...READS_ENV, ".gitignore": ".env*\n" })), base).status, "PASS", "no git repository, nothing to hide it from");
});

test("fix tells a create-next-app project what its .gitignore does to .env.example", async () => {
  const plan = await planFix(makeRepo({ "package.json": NEXT, "app/page.tsx": "", ".gitignore": ".env*\n" }), { today: TODAY });
  assert.match(plan.actions.find((a) => a.dest === ".env.example").note, /!\.env\.example/);
});
