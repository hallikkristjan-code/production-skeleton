import { test } from "node:test";
import assert from "node:assert/strict";
import { score, badge, renderMarkdown } from "../skills/production-skeleton/scripts/lib/report.mjs";

const r = (id, stage, status) => ({ id, name: `g${id}`, stage, status, note: "n" });
const results = [
  r(1, 1, "PASS"), r(2, 1, "PASS"), r(3, 1, "FAIL"), r(4, 1, "STALE"),
  r(5, 2, "PASS"), r(6, 2, "PASS"), r(7, 2, "N/A"), r(8, 2, "PASS"), r(9, 2, "FAIL"),
  r(10, 3, "PASS"), r(11, 3, "PASS"), r(12, 3, "PASS"), r(13, 3, "PASS"),
];

test("score counts required (stage <= current) and total, excluding N/A", () => {
  assert.deepEqual(score(results, 2), { requiredPassed: 5, required: 8, passed: 9, total: 13, na: 1 });
  assert.deepEqual(score(results, 1), { requiredPassed: 2, required: 4, passed: 9, total: 13, na: 1 });
});

test("badge: green only when every required gate passes", () => {
  assert.equal(badge({ requiredPassed: 4, required: 4, passed: 9, total: 13, na: 1 }), "https://img.shields.io/badge/skeleton-9%2F13-brightgreen");
  assert.equal(badge({ requiredPassed: 2, required: 4, passed: 9, total: 13, na: 1 }), "https://img.shields.io/badge/skeleton-9%2F13-orange");
});

test("renderMarkdown has header line, 13 rows, badge and human gates", () => {
  const md = renderMarkdown({
    stage: 2, reasons: ["deploy target: next", "personal data: auth library next-auth"],
    results, score: score(results, 2),
    humanGates: { open: [{ text: "Add DSN", created: "2026-09-10", due: null }], stale: [] },
  });
  assert.match(md, /^## production-skeleton — stage 2 · 5\/8 required · 9\/13 total, 1 n\/a/m);
  assert.match(md, /deploy target: next/);
  assert.equal((md.match(/^\| \d+ \|/gm) ?? []).length, 13);
  assert.match(md, /\| 4 \| g4 \| 1 \| \*\*STALE\*\* \| n \|/); // required + not PASS → bold
  assert.match(md, /img\.shields\.io\/badge\/skeleton-9%2F13-orange/);
  assert.match(md, /Open human gates.*\n- 2026-09-10 Add DSN/);
});

test("stage 0 still requires gates 1-4 and bolds a failing one", () => {
  const rows = [
    r(1, 1, "PASS"), r(2, 1, "FAIL"), r(3, 1, "PASS"), r(4, 1, "STALE"),
    ...[5, 6, 7, 8, 9].map((id) => r(id, 2, "N/A")), ...[10, 11, 12, 13].map((id) => r(id, 3, "N/A")),
  ];
  const s = score(rows, 0);
  assert.deepEqual(s, { requiredPassed: 2, required: 4, passed: 2, total: 13, na: 9 });
  const md = renderMarkdown({ stage: 0, reasons: ["no deploy target"], results: rows, score: s, humanGates: { open: [], stale: [] } });
  assert.match(md, /\| 2 \| g2 \| 1 \| \*\*FAIL\*\* \| n \|/);
  assert.match(md, /\| 4 \| g4 \| 1 \| \*\*STALE\*\* \| n \|/);
  assert.match(md, /\| 5 \| g5 \| 2 \| N\/A \| n \|/);
});
