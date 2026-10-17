import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";

test("lists files posix-relative, skipping node_modules and .git", () => {
  const root = makeRepo({
    "a.ts": "x",
    "src/b.py": "y",
    "node_modules/m/index.js": "no",
    ".git/HEAD": "no",
  });
  const repo = loadRepo(root);
  assert.deepEqual(repo.files, ["a.ts", "src/b.py"]);
});

test("read/exists/grep", () => {
  const root = makeRepo({ "src/x.ts": "const a = process.env.FOO;\nconst b = 1;\n" });
  const repo = loadRepo(root);
  assert.equal(repo.exists("src/x.ts"), true);
  assert.equal(repo.read("missing"), null);
  assert.deepEqual(repo.grep(/process\.env/), [
    { file: "src/x.ts", line: 1, text: "const a = process.env.FOO;" },
  ]);
});

test("sourceFiles excludes tests, fixtures and eval dirs", () => {
  const root = makeRepo({
    "lib/a.ts": "", "lib/a.test.ts": "", "tests/b.ts": "", "eval/app/c.py": "",
    "app/page.tsx": "", "README.md": "", "scripts/d.mjs": "",
  });
  const repo = loadRepo(root);
  assert.deepEqual(repo.sourceFiles(), ["app/page.tsx", "lib/a.ts", "scripts/d.mjs"]);
});
