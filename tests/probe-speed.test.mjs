// A probe that takes minutes is a probe nobody runs. Following imports must visit each file once:
// walking every path through a tightly connected code base never finishes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeRepo, TODAY } from "./helpers.mjs";

const PROBE = fileURLToPath(new URL("../skills/production-skeleton/scripts/probe.mjs", import.meta.url));
const NAMES = Array.from({ length: 14 }, (_, i) => `mod${i}`);

/** 14 helpers that all import each other, none loaded by the framework, one with a CSRF check. */
function tangled() {
  const imports = NAMES.map((n) => `import { x as ${n} } from "./${n}";`).join("\n");
  const files = Object.fromEntries(NAMES.map((n) => [`lib/${n}.ts`, `${imports}\nexport const x = 1;\n`]));
  files["lib/mod0.ts"] += "export const check = (req) => req.headers.get('origin');\n";
  files["package.json"] = '{"dependencies":{"express":"4"}}';
  files["HUMAN-GATES.md"] = "---\nstage: 3\n---\n";
  return makeRepo(files);
}

test("a tightly connected code base is walked once per file, and dead code stays unwired", () => {
  const r = spawnSync(process.execPath, [PROBE, tangled(), "--json", "--no-audit", "--today", TODAY], { encoding: "utf8", timeout: 20_000 });
  assert.equal(r.error, undefined, "the probe did not finish in 20 s");
  const out = JSON.parse(r.stdout);
  const g10 = out.results.find((x) => x.id === 10);
  assert.equal(g10.status, "FAIL");
  assert.match(g10.note, /not reachable from a recognized entry point/);
});

test("reachability still goes through a chain to an entry file", () => {
  const files = {
    "lib/guard.ts": "export const guard = (req) => req.headers.get('origin');\n",
    "lib/a.ts": 'import { guard } from "./guard";\nexport const a = guard;\n',
    "lib/b.ts": 'import { a } from "./a";\nexport const b = a;\n',
    "middleware.ts": 'import { b } from "./lib/b";\nexport default b;\n',
    "package.json": '{"dependencies":{"express":"4"}}',
    "HUMAN-GATES.md": "---\nstage: 3\n---\n",
  };
  const r = spawnSync(process.execPath, [PROBE, makeRepo(files), "--json", "--no-audit", "--today", TODAY], { encoding: "utf8", timeout: 20_000 });
  assert.equal(JSON.parse(r.stdout).results.find((x) => x.id === 10).status, "PASS");
});
