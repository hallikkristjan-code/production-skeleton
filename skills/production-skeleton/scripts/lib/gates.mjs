import { parseHumanGates, humanGateState, daysBetween, DEFAULTS } from "./humanGates.mjs";
import { hasBuildScript } from "./stage.mjs";
import { isCommentLine } from "./repo.mjs";

const PASS = (note) => ({ status: "PASS", note });
const FAIL = (note) => ({ status: "FAIL", note });
const STALE = (note) => ({ status: "STALE", note });
const NA = (note) => ({ status: "N/A", note });
// Tried to verify and could not (audit offline, live request failed). Never counts as passed.
const UNKNOWN = (note) => ({ status: "UNKNOWN", note });

const loc = (h) => `${h.file}:${h.line}`;
const list = (hits, n = 5) =>
  hits.slice(0, n).map(loc).join(", ") + (hits.length > n ? `, +${hits.length - n} more` : "");

const envExample = (repo) => repo.files.find((f) => /^\.env\.(example|sample|template)$/.test(f));
// .env, .env.local, apps/web/.env.production — but not the example/sample/template files.
const ENV_FILE_RE = /(^|\/)\.env(\.[^/]+)?$/;
const ENV_EXAMPLE_RE = /\.(example|sample|template)$/;
const committedEnvFiles = (repo) => repo.tracked().filter((f) => ENV_FILE_RE.test(f) && !ENV_EXAMPLE_RE.test(f));

// ---------- stage 1 ----------

const WORKFLOW_RE = /^\.github\/workflows\/[^/]+\.ya?ml$|^\.gitlab-ci\.yml$/;
const TEST_STEP_RE = /\b(npm test|npm run test|pnpm test|yarn test|bun test|node --test|vitest|jest|pytest|python -m pytest|go test|cargo test|manage\.py test|python -m unittest|tox|nox)\b/;
const BUILD_STEP_RE = /\b(npm run build|pnpm build|pnpm run build|yarn build|bun run build|next build|vite build|tsc\b)/;

/** The text of the top-level `on:` key: its own line plus every following
 * line that is indented (or blank) until the next top-level key. */
function triggerBlock(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^on:/.test(l));
  if (start === -1) return "";
  const block = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join("\n");
}

// pull_request_target runs with repo secrets on PRs from forks; without an environment
// (and its required reviewers) any outside PR can reach them. GITHUB_TOKEN alone is scoped.
function untrustedSecrets(repo, workflows) {
  for (const wf of workflows) {
    const text = repo.read(wf) ?? "";
    if (!/\bpull_request_target\b/.test(triggerBlock(text)) || /^\s+environment:/m.test(text)) continue;
    const secret = [...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]).find((n) => n !== "GITHUB_TOKEN");
    if (secret) return `${wf}: pull_request_target exposes secrets.${secret} to fork PRs — add an environment with required reviewers`;
  }
  return null;
}

function gate1(repo) {
  const workflows = repo.files.filter((f) => WORKFLOW_RE.test(f));
  if (workflows.length === 0) return FAIL("no CI workflow (.github/workflows/*.yml or .gitlab-ci.yml)");
  const exposed = untrustedSecrets(repo, workflows);
  if (exposed) return FAIL(exposed);
  const needBuild = hasBuildScript(repo);
  const problems = [];
  for (const wf of workflows) {
    const text = repo.read(wf) ?? "";
    const triggers = /(^|[\s\[,])(push|pull_request|merge_request)\b/.test(triggerBlock(text));
    if (!triggers) { problems.push(`${wf}: no push/pull_request trigger`); continue; }
    if (!TEST_STEP_RE.test(text)) { problems.push(`${wf}: no test step`); continue; }
    if (needBuild && !BUILD_STEP_RE.test(text)) { problems.push(`${wf}: no build step`); continue; }
    return PASS(`${wf} runs tests${needBuild ? " and build" : ""} on push/PR`);
  }
  return FAIL(problems.join("; "));
}

const DEP_CONFIG_RE = /^\.github\/dependabot\.ya?ml$|^renovate\.json5?$|^\.renovaterc(\.json)?$|^\.github\/renovate\.json5?$/;
const SCANNER_RE = /osv-scanner|trivy-action|anchore\/scan-action|snyk\/actions|socket-github-action|@aikidosec\/ci-api-client/;

// Nothing to update without a manifest (a docs-only or pre-code repo).
const MANIFEST_RE = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|go\.mod|Cargo\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?)$/;

function gate2(repo, ctx = {}) {
  if (!repo.files.some((f) => MANIFEST_RE.test(f))) return NA("no dependency manifest (package.json, requirements.txt, pyproject.toml, …)");
  const config = repo.files.find((f) => DEP_CONFIG_RE.test(f))
    ?? repo.files.find((f) => WORKFLOW_RE.test(f) && SCANNER_RE.test(repo.read(f) ?? ""));
  if (!config) return FAIL("no .github/dependabot.yml, renovate config, or dependency-scanner workflow");
  const a = ctx.audit;
  if (!a) return PASS(`${config} present; audit not run (--no-audit)`);
  if (a.nothing) return PASS(`${config} present; nothing to audit (${a.nothing})`);
  if (a.skipped) return UNKNOWN(`${config} present; audit not verified: ${a.skipped}`);
  const bad = a.findings ?? a.high + a.critical;
  const summary = a.findings !== undefined ? `${a.tool}: ${a.findings} known vulnerabilities` : `${a.tool}: ${a.high} high, ${a.critical} critical`;
  return bad > 0 ? FAIL(`${config} present but ${summary}`) : PASS(`${config} present; ${summary}`);
}

const ENV_IGNORE = new Set(["NODE_ENV", "CI", "PORT", "HOME", "PATH", "TZ", "NEXT_RUNTIME", "NEXT_TELEMETRY_DISABLED", "NEXT_PHASE", "VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_GIT_COMMIT_SHA", "GITHUB_ACTIONS", "PYTHONPATH", "DJANGO_SETTINGS_MODULE"]);
const ENV_READ_RE = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])|os\.environ(?:\.get)?\(?\[?["']([A-Z][A-Z0-9_]*)["']|os\.getenv\(["']([A-Z][A-Z0-9_]*)["']/g;

function gate3(repo) {
  // A committed env file is a leak whatever .env.example says: adding it to .gitignore
  // later removes nothing from history. Rotation first, history purge second.
  const leaked = committedEnvFiles(repo);
  if (leaked.length) {
    const first = leaked[0];
    const since = repo.firstCommitDate(first);
    return FAIL(`${first} tracked in git${since ? ` since ${since}` : ""}${leaked.length > 1 ? ` (+${leaked.length - 1} more)` : ""}: rotate every key in it, then purge it from history`);
  }
  const reads = new Map(); // name → first location
  for (const f of repo.sourceFiles()) {
    const text = repo.read(f) ?? "";
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(ENV_READ_RE)) {
        const name = m[1] ?? m[2] ?? m[3] ?? m[4];
        if (!ENV_IGNORE.has(name) && !reads.has(name)) reads.set(name, `${f}:${i + 1}`);
      }
    });
  }
  if (reads.size === 0) return PASS("no environment variables read in source");
  const example = envExample(repo);
  if (!example) return FAIL(`${reads.size} env vars read but no .env.example (first: ${[...reads.keys()].slice(0, 3).join(", ")})`);
  const declared = new Set((repo.read(example) ?? "").split("\n").map((l) => l.replace(/^#\s*/, "").match(/^([A-Z][A-Z0-9_]*)=/)?.[1]).filter(Boolean));
  const missing = [...reads].filter(([name]) => !declared.has(name));
  if (missing.length) return FAIL(`missing from ${example}: ` + missing.slice(0, 5).map(([n, at]) => `${n} (${at})`).join(", "));
  return PASS(`${reads.size} env vars read, all in ${example}`);
}

function gate4(repo, ctx) {
  const text = repo.read("HUMAN-GATES.md");
  if (text === null) return FAIL("HUMAN-GATES.md missing");
  const state = humanGateState(parseHumanGates(text), ctx.today);
  if (state.stale.length) return STALE(`${state.stale.length} open line(s) older than ${state.staleDays} days or past due: ` + state.stale.slice(0, 3).map((l) => `"${l.text}"`).join(", "));
  return PASS(`${state.open.length} open, none stale`);
}

// ---------- stage 2 ----------

const TRACKER_INIT_RE = /Sentry\.init\(|sentry_sdk\.init\(|from ["']@sentry\/|new Rollbar\(|rollbar\.init|Bugsnag\.start\(|bugsnag\.start|Honeybadger\.configure|honeybadger\.configure/;
const DSN_KEY_RE = /^#?\s*[A-Z0-9_]*(DSN|SENTRY|ROLLBAR|BUGSNAG|HONEYBADGER)[A-Z0-9_]*=/m;

function gate5(repo) {
  const init = repo.grep(TRACKER_INIT_RE, repo.sourceFiles())[0];
  if (!init) return FAIL("no error tracker init (Sentry/Rollbar/Bugsnag/Honeybadger) in source");
  const example = envExample(repo);
  if (!example || !DSN_KEY_RE.test(repo.read(example) ?? "")) return FAIL(`tracker init at ${loc(init)} but no DSN key in .env.example`);
  return PASS(`tracker init at ${loc(init)}, DSN named in ${example}`);
}

const HEALTH_PATH_RE = /(^|\/)(api\/)?healthz?(\.[cm]?[jt]sx?|\/route\.[cm]?[jt]sx?|\/index\.[cm]?[jt]sx?)$/;
// "/health" in JS/Flask/FastAPI; Django writes routes without the slash: path('health', view).
const HEALTH_STRING_RE = /["'`]\/(api\/)?healthz?["'`]|\b(re_)?path\(\s*r?["']\^?(api\/)?healthz?\/?\$?["']/;

function gate6(repo, ctx) {
  const live = ctx.live?.health;
  if (live) {
    if (live.status !== 200) return FAIL(`live: ${live.status} from health endpoint`);
    if (!/version|sha|commit/i.test(live.body)) return FAIL("live: 200 but body has no version field");
    return PASS("live: 200 with version");
  }
  const byPath = repo.files.find((f) => HEALTH_PATH_RE.test(f) && !repo.isTestPath(f));
  if (byPath) return PASS(`static: route file ${byPath} (pass --url to check it live)`);
  const byString = repo.grep(HEALTH_STRING_RE, repo.sourceFiles())[0];
  if (byString) return PASS(`static: health route at ${loc(byString)} (pass --url to check it live)`);
  return FAIL("no /health route found");
}

const BACKUP_RE = /\b(pg_dump|mysqldump|mongodump|sqlite3 .* \.backup|litestream|backup)\b/i;
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

function gate7(repo, ctx) {
  const candidates = repo.files.filter((f) => /^\.github\/workflows\/|^scripts\/|^supabase\/|^\.gitlab-ci\.yml$/.test(f));
  const job = repo.grep(BACKUP_RE, candidates)[0];
  if (!job) return FAIL("no backup job (workflow or script mentioning pg_dump/mysqldump/mongodump/backup)");
  const drill = repo.read("docs/ops/restore-drill.md");
  if (drill === null) return FAIL(`backup job at ${loc(job)} but no docs/ops/restore-drill.md`);
  const date = drill.match(DATE_RE)?.[1];
  if (!date) return FAIL("docs/ops/restore-drill.md has no YYYY-MM-DD date");
  const max = ctx.config.drill_max_days ?? DEFAULTS.drill_max_days;
  const age = daysBetween(date, ctx.today);
  if (age > max) return STALE(`restore drill dated ${date} is ${age} days old (max ${max})`);
  return PASS(`backup job at ${loc(job)}; restore drill ${date} (${age} days ago)`);
}

function gate8(repo) {
  const text = repo.read("docs/ops/rollback.md");
  if (text === null) return FAIL("no docs/ops/rollback.md");
  const missing = [["code", /\b(code|deploy|release)\b/i], ["schema", /\b(schema|migration)\b/i], ["data", /\bdata\b/i]]
    .filter(([, re]) => !re.test(text)).map(([n]) => n);
  return missing.length ? FAIL(`docs/ops/rollback.md does not cover: ${missing.join(", ")}`) : PASS("docs/ops/rollback.md covers code, schema and data");
}

const CALL_RE = /\bfetch\(|\baxios(\.[a-z]+)?\(|\brequests\.(get|post|put|patch|delete|head|request)\(|\bhttpx\.(get|post|put|patch|delete|head|request|Client)\(|\burllib\.request\.urlopen\(/;
const GUARD_RE = /\bsignal\b|\btimeout\b|AbortSignal|AbortController/;
// fetch('/api/x') or fetch(`/api/${id}`) is same-origin, not an external call.
const SAME_ORIGIN_RE = /\bfetch\(\s*[`'"]\/(?!\/)/;

function gate9(repo) {
  const violations = [];
  let calls = 0;
  for (const f of repo.sourceFiles()) {
    const lines = (repo.read(f) ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!CALL_RE.test(lines[i]) || SAME_ORIGIN_RE.test(lines[i])) continue;
      calls++;
      const window = lines.slice(i, i + 7).join("\n");
      if (!GUARD_RE.test(window)) violations.push({ file: f, line: i + 1 });
    }
  }
  if (calls === 0) return PASS("no external HTTP calls found in source");
  if (violations.length) return FAIL(`${violations.length} of ${calls} calls without a timeout/signal: ${list(violations)}`);
  return PASS(`${calls} external calls, all with a timeout or abort signal`);
}

// ---------- stage 3 ----------

// Files the framework loads by convention; any other file counts only when imported.
const ENTRY_RE = /(^|\/)(middleware|next\.config|settings|urls|wsgi|asgi|manage|server|app|main|index|route|page|layout|_app|_document)\.[^/]+$|(^|\/)(vercel\.json|netlify\.toml|_headers)$/;
const stemOf = (f) => f.split("/").pop().replace(/\.[^.]+$/, "");

/** A helper is evidence only if the framework loads it or another source file imports it:
 * `fix --write` drops lib/server/csrf.ts in place, and until middleware imports it nothing is protected. */
function wired(repo, file) {
  if (ENTRY_RE.test(file)) return true;
  const importRe = new RegExp(`\\b(import|require|from)\\b.*["'./\\s]${stemOf(file)}\\b`);
  return repo.grep(importRe, repo.sourceFiles().filter((f) => f !== file)).length > 0;
}
const unwired = (file) => `${file} has the check but is not imported by any source file — wire it up`;

const CSRF_RE = /csrf|headers\.get\(["']origin["']\)|headers\[["']origin["']\]|request\.headers\.get\(["']origin["']\)|CSRF_TRUSTED_ORIGINS|CsrfViewMiddleware|csurf|sameSite:\s*["']strict["']/i;

function gate10(repo, ctx) {
  const live = ctx.live?.csrf ?? null;
  if (live && live.status === 403) return PASS("live: cross-origin POST → 403");
  const hits = repo.grep(CSRF_RE, repo.sourceFiles());
  const hit = hits.find((h) => wired(repo, h.file));
  const staticResult = hit
    ? PASS(`static: origin/CSRF check at ${loc(hit)} (pass --url to test it live)`)
    : FAIL(hits.length ? unwired(hits[0].file) : "no Origin/Referer or CSRF check in source");
  if (live && ![404, 405].includes(live.status)) {
    staticResult.note += `; live: cross-origin POST to the health route → ${live.status}, inconclusive (not a mutation route)`;
  }
  return staticResult;
}

const HEADER_CHECKS = [
  ["Strict-Transport-Security", /strict-transport-security|SECURE_HSTS_SECONDS/i],
  ["frame-ancestors", /frame-ancestors|X-Frame-Options|X_FRAME_OPTIONS/i],
  ["nosniff", /nosniff|SECURE_CONTENT_TYPE_NOSNIFF/i],
];

function gate11(repo, ctx) {
  const live = ctx.live?.headers;
  if (live) {
    const missing = [];
    if (!live["strict-transport-security"]) missing.push("Strict-Transport-Security");
    if (!/frame-ancestors/i.test(live["content-security-policy"] ?? "") && !live["x-frame-options"]) missing.push("frame-ancestors");
    if (!/nosniff/i.test(live["x-content-type-options"] ?? "")) missing.push("nosniff");
    return missing.length ? FAIL(`live: missing ${missing.join(", ")}`) : PASS("live: HSTS, frame-ancestors, nosniff present");
  }
  const files = repo.sourceFiles().concat(repo.files.filter((f) => /^(next\.config\.[cm]?[jt]s|vercel\.json|netlify\.toml|_headers)$/.test(f)));
  const wiredFiles = files.filter((f) => wired(repo, f));
  if (repo.grep(/helmet\(/, wiredFiles)[0]) return PASS("static: helmet() in use (pass --url to verify)");
  const missing = HEADER_CHECKS.filter(([, re]) => !repo.grep(re, wiredFiles)[0]).map(([n]) => n);
  if (!missing.length) return PASS("static: HSTS, frame-ancestors, nosniff configured (pass --url to verify)");
  const orphan = files.find((f) => !wiredFiles.includes(f) && HEADER_CHECKS.some(([, re]) => repo.grep(re, [f])[0]));
  return FAIL(`static: not set anywhere: ${missing.join(", ")}` + (orphan ? `; ${unwired(orphan)}` : ""));
}

const SIZE_LIMIT_RE = /\.max\(\d|maxLength|max_length\s*=|\blimit:\s*["']\d+[kKmM]?b["']|bodyLimit|DATA_UPLOAD_MAX_MEMORY_SIZE|MaxBytes|max_content_length|MAX_CONTENT_LENGTH/;
// A bare "prune"/"cleanup" mention (e.g. a Docker cache-prune CI step) is not evidence of log
// retention on its own — it must be paired, on the same line or the next 3, with something that
// names an interval, a schedule, or an actual delete.
const RETENTION_RE = /\b(retention|cleanup|clean_up|sweep|purge|prune|vacuum)\b|delete\s+from\s+\w+\s+where\s+\w+\s*</i;
const RETENTION_COMPANION_RE = /\b(interval|older than|days|ttl|retention|delete|cron|schedule)\b/i;

function findRetention(repo, files) {
  for (const file of files) {
    const text = repo.read(file);
    if (text === null) continue;
    const lines = text.split("\n").map((l) => (isCommentLine(file, l) ? "" : l));
    for (let i = 0; i < lines.length; i++) {
      if (!RETENTION_RE.test(lines[i])) continue;
      const window = lines.slice(i, i + 4).join("\n");
      if (RETENTION_COMPANION_RE.test(window)) return { file, line: i + 1 };
    }
  }
  return null;
}

function gate12(repo) {
  const limit = repo.grep(SIZE_LIMIT_RE, repo.sourceFiles())[0];
  const retentionFiles = repo.files.filter((f) => !repo.isTestPath(f) && /\.(ya?ml|sql|[cm]?[jt]sx?|py|toml)$/.test(f));
  const retention = findRetention(repo, retentionFiles);
  const missing = [];
  if (!limit) missing.push("no input size limit (validator .max(), maxLength, body limit)");
  if (!retention) missing.push("no retention/cleanup job for log tables");
  if (missing.length) return FAIL(missing.join("; "));
  return PASS(`size limit at ${loc(limit)}; retention at ${loc(retention)}`);
}

// English, eight other languages, or gdpr, so a localized privacy page counts as evidence too.
const PRIVACY_NAME_RE = /privacy|privacidad|datenschutz|andmekaitse|confidentialit|integritetspolicy|tietosuoja|personvern|privatlivspolitik|gdpr/i;
const LINK_FILE_RE = /\.([cm]?[jt]sx?|py|html|vue|svelte)$/;

/** The route stem a page is reached at: the file's own name, unless it is a generic
 * per-directory framework filename (page.tsx, +page.svelte, route.ts, index.ts), in which
 * case the parent directory names the route. */
function routeStem(page) {
  const parts = page.split("/");
  let base = parts[parts.length - 1].replace(/\.[^.]+$/, "");
  if (/^(page|index|route|\+page|\+server|\+page\.server)$/i.test(base) && parts.length > 1) {
    base = parts[parts.length - 2];
  }
  return base;
}

// Loading a template by its file path (render(request, 'core/privacy.html')) is not a link.
const TEMPLATE_LOAD_RE = /\brender(_to_string)?\(|\btemplate_name\b|\bget_template\(|\{%\s*(include|extends)\b/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the page is linked from: a /stem URL or a Django {% url 'stem' %} first, then a
 * Django path('stem', ...) route declaration. Test files and template loads do not count. */
function findLink(repo, page) {
  const stem = escapeRe(routeStem(page));
  const linkFiles = repo.files.filter((f) => f !== page && !repo.isTestPath(f) && LINK_FILE_RE.test(f));
  const hits = (re) => repo.grep(re, linkFiles).filter((h) => !TEMPLATE_LOAD_RE.test(h.text));
  return hits(new RegExp(`/${stem}\\b|\\{%\\s*url\\s+['"]${stem}['"]`, "i"))[0]
    ?? hits(new RegExp(`\\b(re_)?path\\(\\s*r?['"]\\^?${stem}\\b`, "i"))[0];
}

function gate13(repo, ctx) {
  if (typeof ctx.config.privacy === "string") {
    const page = ctx.config.privacy;
    if (!repo.exists(page)) return FAIL(`privacy page from HUMAN-GATES.md not found: ${page}`);
    const link = findLink(repo, page);
    if (!link) return FAIL(`${page} exists but is not linked as a route (no /${routeStem(page)} reference) from any source file`);
    return PASS(`${page}, linked from ${loc(link)}`);
  }

  const candidates = repo.files.filter((f) => PRIVACY_NAME_RE.test(f) && !repo.isTestPath(f));
  if (candidates.length === 0) return FAIL("no file or route named privacy (in English, eight other languages, or `gdpr`) — see SKILL.md, or set `privacy:` in HUMAN-GATES.md");
  for (const page of candidates) {
    const link = findLink(repo, page);
    if (link) return PASS(`${page}, linked from ${loc(link)}`);
  }
  const named = candidates.slice(0, 3).join(", ") + (candidates.length > 3 ? `, +${candidates.length - 3} more` : "");
  return FAIL(`${named} not linked from any route`);
}

/** With --url, a live request that failed leaves a static PASS unverified. A static FAIL stays FAIL. */
const liveOrUnknown = (key, gate) => (repo, ctx) => {
  const r = gate(repo, ctx);
  if (!ctx.live || ctx.live[key] || r.status !== "PASS") return r;
  const err = (ctx.live.errors ?? []).find((e) => e.startsWith(key)) ?? `${key}: no response`;
  return UNKNOWN(`live check failed (${err}); ${r.note.replace(/^static: /, "")}`);
};

export const GATES = [
  { id: 1, name: "CI runs tests and build on every push", stage: 1, run: gate1 },
  { id: 2, name: "Dependency security updates are automatic", stage: 1, run: gate2 },
  { id: 3, name: "Every env var is named in .env.example", stage: 1, run: gate3 },
  { id: 4, name: "Human-gates register is current", stage: 1, run: gate4 },
  { id: 5, name: "Errors reach a human", stage: 2, run: gate5 },
  { id: 6, name: "/health answers with the deployed version", stage: 2, run: liveOrUnknown("health", gate6) },
  { id: 7, name: "Independent backup with a rehearsed restore", stage: 2, run: gate7 },
  { id: 8, name: "Rollback runbook: code, schema, data", stage: 2, run: gate8 },
  { id: 9, name: "External calls time out", stage: 2, run: gate9 },
  { id: 10, name: "Cross-origin writes are refused", stage: 3, run: liveOrUnknown("csrf", gate10) },
  { id: 11, name: "HSTS, frame-ancestors, nosniff", stage: 3, run: liveOrUnknown("headers", gate11) },
  { id: 12, name: "Input size limits and log retention", stage: 3, run: gate12 },
  { id: 13, name: "Privacy page matches the code", stage: 3, run: gate13 },
];

export const gateById = (id) => GATES.find((g) => g.id === id);
