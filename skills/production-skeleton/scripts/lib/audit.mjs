import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** { high, critical } from `npm audit --json` (npm 7+), or null if unparseable. */
export function parseNpmAudit(text) {
  try {
    const v = JSON.parse(text)?.metadata?.vulnerabilities;
    if (!v || typeof v.high !== "number") return null;
    return { high: v.high, critical: v.critical ?? 0 };
  } catch {
    return null;
  }
}

/** { findings } from `pip-audit -f json`, or null if unparseable. pip-audit reports no severity. */
export function parsePipAudit(text) {
  try {
    const deps = JSON.parse(text)?.dependencies;
    if (!Array.isArray(deps)) return null;
    return { findings: deps.reduce((n, d) => n + (d.vulns?.length ?? 0), 0) };
  } catch {
    return null;
  }
}

function pipAudit(tool, reqArg, flags, cwd) {
  // The console script may be missing from PATH (Windows Scripts dir); the module form is the fallback.
  let res;
  for (const bin of ["pip-audit", "python -m pip_audit"]) {
    res = spawn(`${bin} -r ${reqArg} ${flags} -f json --progress-spinner off`, cwd);
    const parsed = res.error ? null : parsePipAudit(res.stdout ?? "");
    if (parsed) return { tool, ...parsed };
  }
  const reason = skipReason(res, "no JSON from pip-audit");
  return { tool, skipped: /not found|not recognized|No such file|No module named/i.test(reason) ? "pip-audit not installed (pip install pip-audit)" : reason };
}

function spawn(cmd, cwd) {
  return spawnSync(cmd, { cwd, shell: true, encoding: "utf8", timeout: 60_000 });
}

function skipReason(res, fallback) {
  if (res.error?.code === "ETIMEDOUT") return "timed out after 60 s";
  if (res.error) return res.error.message;
  return (res.stderr ?? "").trim().split("\n")[0] || fallback;
}

/**
 * Run the ecosystem's dependency audit against the lockfile. Read-only, needs
 * the registry (network). Returns { tool, high, critical } (npm),
 * { tool, findings } (pip-audit, which has no severity) or { tool, skipped }.
 */
export function runAudit(repo) {
  if (repo.exists("package.json")) {
    const tool = "npm audit";
    let pkg = {};
    try { pkg = JSON.parse(repo.read("package.json")); } catch {}
    if (!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }).length) return { tool, nothing: "no dependencies declared" };
    if (!repo.exists("package-lock.json") && !repo.exists("npm-shrinkwrap.json")) return { tool, skipped: "no package-lock.json" };
    // `npm audit` exits 1 when it finds anything, so ignore the exit code and read the JSON.
    const res = spawn("npm audit --json --audit-level=high", repo.root);
    const parsed = res.error ? null : parseNpmAudit(res.stdout ?? "");
    return parsed ? { tool, ...parsed } : { tool, skipped: skipReason(res, "no JSON from npm audit (offline?)") };
  }
  if (repo.exists("requirements.txt")) return pipAudit("pip-audit", "requirements.txt", "", repo.root);
  if (repo.exists("uv.lock")) {
    const tool = "pip-audit (uv export)";
    // Export the lock to a pinned requirements file outside the repo; the probe stays read-only.
    const dir = mkdtempSync(join(tmpdir(), "skeleton-uv-"));
    const req = join(dir, "requirements.txt");
    try {
      const exp = spawn(`uv export --frozen --no-hashes --no-emit-project --format requirements-txt -o "${req}"`, repo.root);
      if (exp.status !== 0) return { tool, skipped: skipReason(exp, "uv export failed (is uv installed?)") };
      // Fully pinned by the lock: no resolution, no pip.
      return pipAudit(tool, `"${req}"`, "--no-deps --disable-pip", repo.root);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (repo.exists("pyproject.toml")) return { tool: "pip-audit", skipped: "Python project without requirements.txt or uv.lock" };
  return { tool: "npm audit", skipped: "not an npm project" };
}
