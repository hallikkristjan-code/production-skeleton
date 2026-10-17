/**
 * Three read-only requests against a running deployment. Every request has a
 * timeout; a failed request becomes an entry in `errors`, never a throw, so a
 * flaky network degrades one gate instead of the whole scorecard.
 */
export async function probeUrl(baseUrl, { timeoutMs = 5000 } = {}) {
  const base = baseUrl.replace(/\/+$/, "");
  const result = { health: null, headers: null, csrf: null, errors: [] };
  const get = (path, init = {}) =>
    fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), ...init });

  try {
    let res = await get("/api/health");
    if (res.status === 404) res = await get("/health");
    result.health = { status: res.status, body: (await res.text()).slice(0, 2000) };
  } catch (e) { result.errors.push(`health: ${e.message}`); }

  try {
    const res = await get("/", { redirect: "follow" });
    result.headers = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));
  } catch (e) { result.errors.push(`headers: ${e.message}`); }

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

  return result;
}
