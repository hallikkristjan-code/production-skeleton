import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A clone with core.autocrlf=true checks the file out with CRLF; the structure is the same.
const md = readFileSync(new URL("../skills/skeptic-review/SKILL.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("frontmatter: name and a description with English and Estonian triggers", () => {
  assert.match(md, /^---\nname: skeptic-review\ndescription: .+\n---\n/);
  const description = md.match(/^description: (.+)$/m)[1];
  for (const phrase of ["/skeptic-review", "production readiness", "skeptiku audit"]) assert.ok(description.includes(phrase), phrase);
});

test("13 numbered checklist sections, Architecture first, Top-3 risks last", () => {
  const checklist = md.slice(md.indexOf("## Checklist"), md.indexOf("## Red flags"));
  const items = [...checklist.matchAll(/^(\d+)\. \*\*([^*]+)\*\*/gm)].map((m) => [Number(m[1]), m[2]]);
  assert.equal(items.length, 13);
  assert.deepEqual(items.map(([n]) => n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(items[0][1], "Architecture");
  assert.equal(items[12][1], "Top-3 risks");
});

test("mandatory blocks are present in order", () => {
  const order = ["## Process", "## Report shape", "### \"I can do this now\"", "## Checklist", "## Red flags", "## Typical mistakes"];
  let last = -1;
  for (const h of order) { const i = md.indexOf(h); assert.ok(i > last, `${h} missing or out of order`); last = i; }
});

test("probe is wired in as evidence and as a verdict gate", () => {
  assert.match(md, /probe\.mjs .*--json/);
  assert.match(md, /no\s+required skeleton gate is FAIL, STALE or UNKNOWN/);
  assert.match(md, /❓/); // not verified is its own grade, not ❌ and not ✅
  assert.ok(md.indexOf("- **Verdict.**") < md.indexOf("- **I can do this now:**"), "verdict comes before the last block");
  assert.match(md, /docs\/ops\/skeptic-review-YYYY-MM-DD\.md/);
});

test("no private names, no dated internal notes", () => {
  assert.doesNotMatch(md, /ERSO|tuur|2026-07-28|Arendus/);
});

test("checklist asks for the seams a breadth audit misses: every path, side paths, read-then-write", () => {
  assert.match(md, /every (read|write)? ?path/i);
  assert.match(md, /side path/i);
  assert.match(md, /read-then-write/i);
});
