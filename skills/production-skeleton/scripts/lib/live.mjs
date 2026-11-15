/**
 * Requests against a running deployment. By default GET only: the health route
 * (/api/health, then /health when the first is missing or behind auth) and the
 * front page for its headers (then /privacy when the front page is not HTML),
 * following redirects. `csrfPost` adds one cross-origin POST — a write
 * request, so it is sent only when asked for: the probe cannot know what a
 * POST does on someone else's server.
 *
 * Every request has a timeout; a failed request becomes an entry in `errors`,
 * never a throw, so a flaky network degrades one gate instead of the whole
 * scorecard. A check that was not requested has no key in the result.
 */
export async function probeUrl(baseUrl, { timeoutMs = 5000, csrfPost = false } = {}) {
  const base = baseUrl.replace(/\/+$/, "");
  const result = { health: null, headers: null, errors: [] };
  const get = (path, init = {}) =>
    fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), ...init });

  // /api/health can be missing (404, 405) or sit behind the app's own auth (401, 403) while a
  // public /health exists. A 5xx is a broken health route and is reported as it is.
  try {
    const first = await get("/api/health");
    result.health = { status: first.status, path: "/api/health", body: (await first.text()).slice(0, 2000) };
    if ([401, 403, 404, 405].includes(first.status)) {
      const res = await get("/health");
      const body = (await res.text()).slice(0, 2000);
      if (res.ok || first.status === 404) result.health = { status: res.status, path: "/health", body };
    }
  } catch (e) { result.errors.push(`health: ${e.message}`); }

  // frame-ancestors only means something on an HTML page. A front page that is a 404 or JSON
  // says nothing about it, so try /privacy (gate 13 asks every stage-3 app to have one).
  try {
    let page;
    for (const path of ["/", "/privacy"]) {
      const res = await get(path, { redirect: "follow" });
      const type = res.headers.get("content-type") ?? "";
      const body = await res.text();
      const html = res.ok && (/html/i.test(type) || (!type && /^\s*</.test(body)));
      page ??= { res, path, html };
      if (html) { page = { res, path, html }; break; }
    }
    result.finalUrl = page.res.url;
    result.headersFrom = page.path;
    result.headersHtml = page.html;
    result.headers = Object.fromEntries([...page.res.headers].map(([k, v]) => [k.toLowerCase(), v]));
  } catch (e) { result.errors.push(`headers: ${e.message}`); }

  if (csrfPost) {
    result.csrf = null;
    try {
      // A write to a path that exists on most apps; a well-guarded app answers
      // 403 by Origin alone, before it ever looks at the path or the body.
      const res = await get("/api/health", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: "{}",
      });
      result.csrf = { status: res.status };
    } catch (e) { result.errors.push(`csrf: ${e.message}`); }
  }

  return result;
}
