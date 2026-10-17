import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, TODAY } from "./helpers.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { gateById, GATES } from "../skills/production-skeleton/scripts/lib/gates.mjs";

const base = { today: TODAY, config: {}, live: null };
const run = (id, files, ctx = base) => gateById(id).run(loadRepo(makeRepo(files)), ctx);

test("13 gates, ids 1..13, stages 1-4 / 2-9 / 3-13", () => {
  assert.deepEqual(GATES.map((g) => g.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(GATES.map((g) => g.stage), [1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3]);
});

test("gate 10: origin/CSRF check in source; live 403 required", () => {
  assert.equal(run(10, { "middleware.ts": 'const origin = req.headers.get("origin");' }).status, "PASS");
  assert.equal(run(10, { "settings.py": "CSRF_TRUSTED_ORIGINS = []" }).status, "PASS");
  assert.equal(run(10, { "a.ts": "" }).status, "FAIL");
  assert.equal(run(10, { "a.ts": "" }, { ...base, live: { csrf: { status: 403 } } }).status, "PASS");
  const open = run(10, { "middleware.ts": "csrf" }, { ...base, live: { csrf: { status: 200 } } });
  assert.equal(open.status, "PASS");
  assert.match(open.note, /inconclusive/);
  const none = run(10, { "a.ts": "" }, { ...base, live: { csrf: { status: 200 } } });
  assert.equal(none.status, "FAIL");
  assert.match(none.note, /inconclusive/);
});

test("gate 11: three headers in source or helmet; live headers override", () => {
  const src = 'Strict-Transport-Security\nframe-ancestors\nX-Content-Type-Options: nosniff';
  assert.equal(run(11, { "next.config.ts": src }).status, "PASS");
  assert.equal(run(11, { "server.js": "app.use(helmet())" }).status, "PASS");
  const partial = run(11, { "lib/headers.ts": "Strict-Transport-Security" });
  assert.equal(partial.status, "FAIL");
  assert.match(partial.note, /frame-ancestors/);
  const live = run(11, {}, { ...base, live: { headers: { "strict-transport-security": "max-age=1", "content-security-policy": "frame-ancestors 'none'", "x-content-type-options": "nosniff" } } });
  assert.equal(live.status, "PASS");
  assert.equal(run(11, { "next.config.ts": src }, { ...base, live: { headers: {} } }).status, "FAIL");
});

test("gate 12: input size limit AND retention job", () => {
  const ok = run(12, {
    "lib/schema.ts": "z.string().max(500)",
    "scripts/cleanup.mjs": "delete from audit_log where created_at < now() - interval '1 year'",
  });
  assert.equal(ok.status, "PASS");
  const noRet = run(12, { "lib/schema.ts": "z.string().max(500)" });
  assert.equal(noRet.status, "FAIL");
  assert.match(noRet.note, /retention/);
  const noLimit = run(12, { "scripts/cleanup.mjs": "purge rows older than 30 days" });
  assert.equal(noLimit.status, "FAIL");
  assert.match(noLimit.note, /size limit/);
});

test("gate 12: a lone prune/cleanup mention without a schedule/date/interval companion does not pass", () => {
  const ciPrune = run(12, {
    "lib/schema.ts": "z.string().max(500)",
    ".github/workflows/ci.yml": "on:\n  push:\n    branches: [main]\njobs:\n  test:\n    steps:\n      - run: docker image prune -af\n",
  });
  assert.equal(ciPrune.status, "FAIL");
  assert.match(ciPrune.note, /retention/);
});

test("gate 13: privacy page exists and is linked", () => {
  assert.equal(run(13, { "app/privacy/page.tsx": "", "app/layout.tsx": '<a href="/privacy">' }).status, "PASS");
  const unlinked = run(13, { "app/privacy/page.tsx": "" });
  assert.equal(unlinked.status, "FAIL");
  assert.match(unlinked.note, /not linked/);
  assert.equal(run(13, { "a.ts": "" }).status, "FAIL");
});

test("gate 13: tries every candidate page, not just the first match", () => {
  const decoyThenLinked = run(13, {
    "aaa/gdpr-notes.ts": "",
    "app/privacy/page.tsx": "",
    "app/layout.tsx": '<a href="/privacy">',
  });
  assert.equal(decoyThenLinked.status, "PASS");

  const noneLinked = run(13, {
    "aaa/gdpr-notes.ts": "",
    "app/privacy/page.tsx": "",
  });
  assert.equal(noneLinked.status, "FAIL");
  assert.match(noneLinked.note, /not linked/);
});

test("gate 13: localized name, config override, and README-only mention no longer counts", () => {
  const localized = run(13, {
    "app/andmekaitse/page.tsx": "",
    "app/layout.tsx": '<a href="/andmekaitse">Andmekaitse</a>',
  });
  assert.equal(localized.status, "PASS");

  const overrideOk = run(13, {
    "pages/legal.tsx": "",
    "app/layout.tsx": '<a href="/legal">Legal</a>',
  }, { ...base, config: { privacy: "pages/legal.tsx" } });
  assert.equal(overrideOk.status, "PASS");

  const overrideMissing = run(13, { "app/layout.tsx": "" }, { ...base, config: { privacy: "pages/legal.tsx" } });
  assert.equal(overrideMissing.status, "FAIL");
  assert.match(overrideMissing.note, /not found: pages\/legal\.tsx/);

  const readmeOnly = run(13, {
    "app/privacy/page.tsx": "",
    "README.md": "See our /privacy page.",
  });
  assert.equal(readmeOnly.status, "FAIL");
  assert.match(readmeOnly.note, /not linked/);
});
