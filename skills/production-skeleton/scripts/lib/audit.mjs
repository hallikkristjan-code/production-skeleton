import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MANIFEST_RE } from "./stage.mjs";

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

/** { findings } from `pip-audit -f json`, or null if unparseable. pip-audit reports no severity.
 * A package pip-audit could not look up carries `skip_reason`; it comes back in `skippedPackages`,
 * because a package nobody checked is not a clean package. */
export function parsePipAudit(text) {
  try {
    const deps = JSON.parse(text)?.dependencies;
    if (!Array.isArray(deps)) return null;
    const skippedPackages = deps.filter((d) => d.skip_reason).map((d) => ({ name: d.name, reason: d.skip_reason }));
    return {
      findings: deps.reduce((n, d) => n + (d.vulns?.length ?? 0), 0),
      ...(skippedPackages.length ? { skippedPackages } : {}),
    };
  } catch {
    return null;
  }
}

// name, optional [extras], == one exact version, optional ; marker, optional --hash options.
const PINNED_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\s*(\[[A-Za-z0-9._,\s-]*\])?\s*===?\s*[A-Za-z0-9][A-Za-z0-9._+!-]*\s*(;[^#]*?)?(\s+--hash[=\s]\S+)*$/;
// Options that say where an index is. They name no package and make pip-audit fetch nothing.
const INDEX_OPTION_RE = /^(-i|--index-url|--extra-index-url|--trusted-host|--require-hashes)\b/;

/**
 * The first line of a requirements file that is not an exact pin, or null when every line is.
 * Anything else (a range, a bare name, a path, a URL, `-e .`, `-r other.txt`) makes pip resolve,
 * download or build, and building runs the package's own code. The probe reads a repository; it
 * does not run it. So only a fully pinned file is audited.
 */
export function requirementsProblem(text) {
  // A trailing backslash continues the line (pip-compile writes hashes that way).
  for (const raw of text.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (line && !INDEX_OPTION_RE.test(line) && !PINNED_RE.test(line)) return line;
  }
  return null;
}

/** pip-audit over one fully pinned requirements file: no resolution, no pip, no builds. */
function pipAudit(tool, manifest, reqArg, text, cwd) {
  const problem = requirementsProblem(text);
  if (problem !== null) {
    return { manifest, tool, skipped: `${manifest} is not pinned to exact versions (first: "${problem.slice(0, 80)}"); the probe does not let pip resolve or build packages, which runs their code — audit a pinned export (pip freeze, pip-compile, uv export)` };
  }
  // The console script may be missing from PATH (Windows Scripts dir); the module form is the fallback.
  let res;
  for (const [bin, prefix] of [["pip-audit", []], ["python", ["-I", "-m", "pip_audit"]]]) {
    res = spawnSync(bin, [...prefix, "-r", reqArg, "--no-deps", "--disable-pip", "-f", "json", "--progress-spinner", "off"], { cwd, encoding: "utf8", timeout: 60_000 });
    const parsed = res.error ? null : parsePipAudit(res.stdout ?? "");
    if (parsed) return { manifest, tool, ...parsed };
  }
  const reason = skipReason(res, "no JSON from pip-audit");
  return { manifest, tool, skipped: /not found|not recognized|No such file|No module named/i.test(reason) ? "pip-audit not installed (pip install pip-audit)" : reason };
}

function spawn(cmd, cwd) {
  return spawnSync(cmd, { cwd, shell: true, encoding: "utf8", timeout: 60_000 });
}

function skipReason(res, fallback) {
  if (res.error?.code === "ETIMEDOUT") return "timed out after 60 s";
  if (res.error) return res.error.message;
  return (res.stderr ?? "").trim().split("\n")[0] || fallback;
}

function readPackage(repo) {
  try { return JSON.parse(repo.read("package.json")) ?? {}; } catch { return null; }
}

function auditNpm(repo, pkg) {
  const manifest = "package.json";
  const tool = "npm audit";
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }).length;
  // A workspace root may declare nothing itself: its apps do, and the root lockfile holds them.
  if (!declared && !pkg.workspaces) return { manifest, tool, nothing: "no dependencies declared" };
  if (!repo.exists("package-lock.json") && !repo.exists("npm-shrinkwrap.json")) return { manifest, tool, skipped: "no package-lock.json" };
  // `npm audit` exits 1 when it finds anything, so ignore the exit code and read the JSON.
  const res = spawn("npm audit --json --audit-level=high --ignore-scripts", repo.root);
  const parsed = res.error ? null : parseNpmAudit(res.stdout ?? "");
  return parsed ? { manifest, tool, ...parsed } : { manifest, tool, skipped: skipReason(res, "no JSON from npm audit (offline?)") };
}

function auditPython(repo) {
  const requirements = repo.files.filter((f) => /^requirements[^/]*\.txt$/.test(f));
  if (requirements.length) return requirements.map((f) => pipAudit("pip-audit", f, f, repo.read(f) ?? "", repo.root));
  if (repo.exists("uv.lock")) {
    const tool = "pip-audit (uv export)";
    // Export the lock to a pinned requirements file outside the repo; the probe stays read-only.
    const dir = mkdtempSync(join(tmpdir(), "skeleton-uv-"));
    const req = join(dir, "requirements.txt");
    try {
      const exp = spawnSync("uv", ["export", "--frozen", "--no-hashes", "--no-emit-project", "--format", "requirements-txt", "-o", req], { cwd: repo.root, encoding: "utf8", timeout: 60_000 });
      if (exp.status !== 0) return [{ manifest: "uv.lock", tool, skipped: skipReason(exp, "uv export failed (is uv installed?)") }];
      return [pipAudit(tool, "uv.lock", req, readFileSync(req, "utf8"), repo.root)];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (repo.exists("pyproject.toml")) return [{ manifest: "pyproject.toml", tool: "pip-audit", skipped: "Python project without requirements.txt or uv.lock" }];
  return [];
}

/**
 * Run each ecosystem's dependency audit against its lockfile. Reads only, needs the registry
 * (network), and never installs, resolves or builds a package.
 *
 * One manifest gives one result: { manifest, tool, high, critical } (npm), { manifest, tool,
 * findings } (pip-audit, which has no severity), { …, nothing } or { …, skipped: reason }. More
 * than one gives { parts: [those] }. Every dependency manifest in the repository is in the list:
 * one the probe has no audit for, or that sits in a subdirectory, is there as `skipped`, so that
 * "audited" never quietly means "the root package.json only".
 */
export function runAudit(repo) {
  const parts = [];
  const pkg = repo.exists("package.json") ? readPackage(repo) : null;
  if (pkg) parts.push(auditNpm(repo, pkg));
  else if (repo.exists("package.json")) parts.push({ manifest: "package.json", skipped: "invalid package.json" });
  parts.push(...auditPython(repo));
  if (repo.exists("pyproject.toml") && !parts.some((p) => p.manifest === "pyproject.toml")) {
    parts.push({ manifest: "pyproject.toml", skipped: "export/lock audited separately; completeness against pyproject.toml is not verified" });
  }

  const covered = new Set([...parts.map((p) => p.manifest), "package.json", "pyproject.toml"]);
  for (const f of repo.files) {
    if (!MANIFEST_RE.test(f) || repo.isTestPath(f)) continue;
    const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
    if (!dir) {
      if (!covered.has(f)) parts.push({ manifest: f, skipped: `no audit for ${f} in this probe` });
      continue;
    }
    // Do not infer workspace coverage from a glob prefix or an unvalidated root lockfile.
    parts.push({ manifest: f, skipped: `nested manifest, not audited from here: run the probe in ${dir}` });
  }

  if (!parts.length) return { tool: "npm audit", skipped: "not an npm project" };
  return parts.length === 1 ? parts[0] : { parts };
}
