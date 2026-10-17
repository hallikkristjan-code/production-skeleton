import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("package.json is ESM and dependency-free", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.dependencies, undefined);
});
