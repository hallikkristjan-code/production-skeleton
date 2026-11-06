// Found by running the probe on real apps: a rehearsed drill and a valid due date were both refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, TODAY } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { gateById } from "../skills/production-skeleton/scripts/lib/gates.mjs";
import { detectStage } from "../skills/production-skeleton/scripts/lib/stage.mjs";

const base = { today: TODAY, config: {}, live: null };
const BACKUP = { "scripts/backup.sh": "pg_dump db" };
const drill = (text) => gateById(7).run(loadRepo(makeRepo({ ...BACKUP, "docs/ops/restore-drill.md": text })), base);
const register = (line) => gateById(4).run(loadRepo(makeRepo({ "HUMAN-GATES.md": `${line}\n` })), base);

test("gate 7: a drill date under a label in any language is a drill date", () => {
  const et = drill("# Taasteproov\n\nViimane proov: 2026-09-01 — meal 57/57, profile 1/1\n");
  assert.equal(et.status, "PASS");
  assert.match(et.note, /2026-09-01/);
  assert.equal(drill("**Last restore:** 2026-09-01\n").status, "PASS");
  assert.equal(drill("- Letzte Wiederherstellung: 2026-09-01\n").status, "PASS");
});

test("gate 7: the first done date wins over plans, and a plan alone is no drill", () => {
  const r = drill("Next drill: 2026-12-01\nJärgmine proov: 2026-12-02\nViimane proov: 2026-09-01\n");
  assert.equal(r.status, "PASS");
  assert.match(r.note, /2026-09-01/);
  for (const plan of ["Planned: 2026-09-01", "Järgmine proov: 2026-09-01", "Due: 2026-09-01", "Scheduled for: 2026-09-01", "Tähtaeg: 2026-09-01"]) {
    assert.equal(drill(plan).status, "FAIL", plan);
  }
});

test("gate 7: a date in passing is not a label: a file name, a sentence, a bare date", () => {
  for (const text of ["Download backups/2026-09-01.json.enc first.", "See the 2026-09-01 notes.", "2026-09-01"]) {
    assert.equal(drill(text).status, "FAIL", text);
  }
});

test("gate 7: the unfilled template says what to write", () => {
  const r = drill("Date: (YYYY-MM-DD)\n");
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /Date: YYYY-MM-DD/);
});

test("gate 4: a real due date followed by a remark is a due date", () => {
  assert.equal(register("- [ ] 2026-09-10 Rehearse again (due: 2027-01-24, earlier if convenient)").status, "PASS");
  assert.equal(register("- [ ] 2026-08-01 Rehearse again (due: 2026-09-01, earlier if convenient)").status, "STALE");
});

test("a pyproject.toml the probe can read is not reported as unread", () => {
  const read = (text) => detectStage(loadRepo(makeRepo({ "pyproject.toml": text })));
  assert.deepEqual(read('[project]\nname = "lib"\ndependencies = [\n  "numpy>=1.26",\n]\n'), { stage: 0, reasons: ["no deploy target (no server framework, no deploy file)"] });
  assert.equal(read('[tool.poetry.dependencies]\npython = "^3.12"\nnumpy = "^2"\n').reasons[0], "no deploy target (no server framework, no deploy file)");
  assert.match(read('[project]\nname = "lib"\ndynamic = ["dependencies"]\n').reasons[0], /unread manifests pyproject\.toml/);
  assert.match(read('[tool.pdm.dev-dependencies]\ntest = ["pytest"]\n').reasons[0], /unread manifests pyproject\.toml/);
});

test("gate 4: an impossible date stays an error, remark or not", () => {
  assert.equal(register("- [ ] 2026-09-10 Rehearse again (due: 2026-02-31, earlier if convenient)").status, "FAIL");
  assert.equal(register("- [ ] 2026-09-10 Rehearse again (due: soon)").status, "FAIL");
});
