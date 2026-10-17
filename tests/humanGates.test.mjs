import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHumanGates, humanGateState, daysBetween } from "../skills/production-skeleton/scripts/lib/humanGates.mjs";

const DOC = `---
stage: 2
stale_days: 10
na:
  4: solo project, no second human
  13: "no personal data"
---
# Human gates

- [ ] 2026-09-01 Add SENTRY_DSN to Vercel env (due: 2026-09-20)
- [x] 2026-09-01 GPG passphrase for backup key
- [ ] 2026-09-10 Rotate the admin password
not a gate line
`;

test("parses frontmatter with numbers and a nested na map", () => {
  const { config } = parseHumanGates(DOC);
  assert.deepEqual(config, {
    stage: 2, stale_days: 10,
    na: { 4: "solo project, no second human", 13: "no personal data" },
  });
});

test("parses checkbox lines with created date, due and done", () => {
  const { lines } = parseHumanGates(DOC);
  assert.deepEqual(lines, [
    { done: false, created: "2026-09-01", due: "2026-09-20", text: "Add SENTRY_DSN to Vercel env" },
    { done: true, created: "2026-09-01", due: null, text: "GPG passphrase for backup key" },
    { done: false, created: "2026-09-10", due: null, text: "Rotate the admin password" },
  ]);
});

test("no frontmatter → empty config", () => {
  assert.deepEqual(parseHumanGates("- [ ] 2026-01-01 x\n").config, {});
});

test("daysBetween", () => {
  assert.equal(daysBetween("2026-09-01", "2026-09-12"), 11);
});

test("stale: past due wins over age; age uses stale_days", () => {
  const parsed = parseHumanGates(DOC);
  // today 2026-09-12: line 1 due 09-20 → not stale (age 11 > 10 but due overrides)
  // line 3 created 09-10, age 2 → not stale
  let s = humanGateState(parsed, "2026-09-12");
  assert.equal(s.open.length, 2);
  assert.deepEqual(s.stale, []);
  assert.equal(s.staleDays, 10);
  // today 2026-09-21: line 1 past due → stale; line 3 age 11 > 10 → stale
  s = humanGateState(parsed, "2026-09-21");
  assert.deepEqual(s.stale.map((l) => l.text), ["Add SENTRY_DSN to Vercel env", "Rotate the admin password"]);
});

test("defaults stale_days to 7", () => {
  const parsed = parseHumanGates("- [ ] 2026-09-01 old thing\n");
  const s = humanGateState(parsed, "2026-09-12");
  assert.equal(s.staleDays, 7);
  assert.equal(s.stale.length, 1);
});
