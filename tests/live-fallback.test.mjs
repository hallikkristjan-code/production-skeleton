import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { probeUrl } from "../skills/production-skeleton/scripts/lib/live.mjs";
import { gateById } from "../skills/production-skeleton/scripts/lib/gates.mjs";
import { loadRepo } from "../skills/production-skeleton/scripts/lib/repo.mjs";
import { makeRepo, TODAY } from "./helpers.mjs";

// Found on a real Cloudflare Worker (2026-11-15): /api/* sits behind a session, so
// /api/health answers 401 while the public /health answers 200 with a version; and
// the front page is a 404 with no HTML, while every real page sends all three headers.

const SECURE = { "strict-transport-security": "max-age=15552000", "x-content-type-options": "nosniff" };
const routes = {
  "/api/health": [401, { "content-type": "application/json" }, '{"error":"unauthenticated"}'],
  "/health": [200, { "content-type": "application/json" }, '{"ok":true,"version":"6e3eec6"}'],
  "/": [404, { ...SECURE }, "Not found"],
  "/privacy": [200, { ...SECURE, "content-type": "text/html; charset=UTF-8", "content-security-policy": "frame-ancestors 'none'" }, "<!doctype html><p>privacy</p>"],
};

async function withServer(table, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const [status, headers, body] = table[req.url] ?? [404, {}, "Not found"];
    res.writeHead(status, headers);
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`, seen); }
  finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
}

const ctx = (live) => ({ today: TODAY, config: {}, live, audit: null });
const empty = () => loadRepo(makeRepo({}));

test("health: a 401 on /api/health falls back to the public /health", async () => {
  await withServer(routes, async (url) => {
    const live = await probeUrl(url);
    assert.deepEqual(live.health, { status: 200, path: "/health", body: '{"ok":true,"version":"6e3eec6"}' });
    assert.equal(gateById(6).run(empty(), ctx(live)).status, "PASS");
  });
});

test("health: when both paths fail, the note names the path that answered first", async () => {
  await withServer({ "/api/health": [401, {}, ""], "/health": [404, {}, ""] }, async (url) => {
    const live = await probeUrl(url);
    assert.equal(live.health.path, "/api/health");
    const r = gateById(6).run(empty(), ctx(live));
    assert.equal(r.status, "FAIL");
    assert.match(r.note, /401 from \/api\/health/);
  });
});

test("health: a 500 on /api/health is a broken route, not a missing one: no fallback", async () => {
  await withServer({ ...routes, "/api/health": [500, {}, "boom"] }, async (url, seen) => {
    const live = await probeUrl(url);
    assert.equal(live.health.status, 500);
    assert.ok(!seen.includes("GET /health"));
  });
});

test("headers: a front page that is not HTML falls back to /privacy, GET only", async () => {
  await withServer(routes, async (url, seen) => {
    const live = await probeUrl(url);
    assert.equal(live.headersFrom, "/privacy");
    assert.ok(seen.every((s) => s.startsWith("GET ")));
    assert.ok(seen.includes("GET /privacy"));
    // http in the test, so HSTS cannot be judged on transport; all three headers are seen.
    const r = gateById(11).run(empty(), ctx(live));
    assert.notEqual(r.status, "FAIL", r.note);
  });
});

test("headers: no HTML page anywhere: frame-ancestors is not judged on a 404, HSTS and nosniff still are", async () => {
  const noPages = { ...routes, "/privacy": [404, { ...SECURE }, "Not found"] };
  await withServer(noPages, async (url) => {
    const live = await probeUrl(url);
    assert.equal(live.headersFrom, "/");
    assert.equal(live.headersHtml, false);
    const r = gateById(11).run(empty(), ctx(live));
    assert.equal(r.status, "UNKNOWN");
    assert.match(r.note, /not an HTML page/);
  });
  const bare = { ...routes, "/": [404, {}, "Not found"], "/privacy": [404, {}, ""] };
  await withServer(bare, async (url) => {
    const r = gateById(11).run(empty(), ctx(await probeUrl(url)));
    assert.equal(r.status, "FAIL");
    assert.match(r.note, /Strict-Transport-Security/);
    assert.match(r.note, /nosniff/);
  });
});

test("headers: an HTML front page is used as is, no extra request", async () => {
  const html = { ...routes, "/": [200, { ...SECURE, "content-type": "text/html" }, "<html></html>"] };
  await withServer(html, async (url, seen) => {
    const live = await probeUrl(url);
    assert.equal(live.headersFrom, "/");
    assert.ok(!seen.includes("GET /privacy"));
    assert.match(gateById(11).run(empty(), ctx(live)).note, /frame-ancestors/);
  });
});
