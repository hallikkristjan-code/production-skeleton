import { readdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

export const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage",
  "__pycache__", ".venv", "venv", ".turbo", ".vercel", "backups",
]);

const TEST_PATH_RE = /(^|\/)(tests?|__tests__|fixtures?|__fixtures__|spec|e2e|eval)(\/|$)/;
// Scaffold templates (adapters/*/templates/health-route.ts) are not the app's code, but
// Django/Jinja page templates (core/templates/core/base.html) are where its links live.
const SCAFFOLD_PATH_RE = /(^|\/)templates?\//;
const PAGE_TEMPLATE_RE = /\.(html?|jinja2?|j2|txt)$/;
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$|_test\.py$|(^|\/)test_[^/]*\.py$|(^|\/)conftest\.py$|(^|\/)tests(_[^/]*)?\.py$/;
const SOURCE_EXT_RE = /\.([cm]?[jt]sx?|py)$/;
// A .d.ts holds type declarations, not calls: worker-configuration.d.ts must not fail gate 9.
const DECLARATION_RE = /\.d\.[cm]?ts$/;
// A comment is never evidence: "// TODO: add csrf" must not pass gate 10, "# npm test" is not a
// CI step. What starts a comment depends on the file: `#` is a comment in Python and YAML but a
// private field in JavaScript; "/*" opens a comment in TypeScript but is a path in a _headers file.
const SLASH_COMMENT_FILE_RE = /\.[cm]?[jt]sx?$/;
const HASH_COMMENT_FILE_RE = /\.(py|ya?ml|toml|sh)$|(^|\/)\.env[^/]*$/;
// Every other file (SQL, HTML, JSON, …): only a line that starts with a comment marker is dropped.
// Markdown is exempt — there `#` starts a heading.
const OTHER_COMMENT_LINE_RE = /^\s*(\/\/|#|\/\*|\*|--|<!--)/;

/** One line with its comments removed. Quote-aware: "//", "#" or a block-comment opener inside a
 * string stays. `state.block` carries an open block comment to the next line. Heuristic, not a
 * parser: a string that spans lines, a quote inside a regex literal or an apostrophe in JSX/YAML
 * text leaves the rest of that line as it is. */
function stripLine(line, { slash, hash }, state) {
  let out = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (state.block) {
      if (line.startsWith("*/", i)) { state.block = false; i++; }
      continue;
    }
    if (quote) {
      out += c;
      if (c === "\\") out += line[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; continue; }
    if (slash && line.startsWith("/*", i) && line[i - 1] !== "\\") { state.block = true; i++; continue; }
    // A line comment starts a token: `x; // note`, `- run: x # note` — not `https://…` or `a#b`.
    const startsToken = i === 0 || /[\s;,(){}]/.test(line[i - 1]);
    if (startsToken && ((slash && line.startsWith("//", i)) || (hash && c === "#"))) break;
    out += c;
  }
  return out;
}

/** The lines of a file with comments blanked or cut; line numbers stay the same. */
export function codeLines(file, text) {
  // CRLF checkouts (Windows, core.autocrlf): a trailing \r must not ride along on every line.
  const lines = text.split(/\r?\n/);
  if (/\.md$/i.test(file)) return lines;
  const family = { slash: SLASH_COMMENT_FILE_RE.test(file), hash: HASH_COMMENT_FILE_RE.test(file) };
  if (!family.slash && !family.hash) return lines.map((l) => (OTHER_COMMENT_LINE_RE.test(l) ? "" : l));
  const state = { block: false };
  return lines.map((l) => stripLine(l, family, state));
}

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });

export function loadRepo(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        // .claude/worktrees holds other checkouts of this repo: their files are not evidence.
        const worktrees = entry.name === "worktrees" && dir === join(root, ".claude");
        // A root logs/ holds run output (audit evidence, fixtures). Only the root one:
        // app/logs/route.ts is a route.
        const runLogs = entry.name === "logs" && dir === root;
        // .agents/skills, .claude/skills, .cursor/skills: `npx skills add` installs into the
        // project, and an installed skill's code is not the app's. This probe would read itself.
        const agentSkills = entry.name === "skills" && /^\.[^\\/]+$/.test(relative(root, dir));
        if (!IGNORE_DIRS.has(entry.name) && !worktrees && !runLogs && !agentSkills) walk(abs);
      } else if (entry.isFile()) {
        files.push(relative(root, abs).replaceAll("\\", "/"));
      }
    }
  };
  walk(root);
  files.sort();

  const contents = new Map();
  const read = (rel) => {
    if (!contents.has(rel)) {
      try { contents.set(rel, readFileSync(join(root, rel), "utf8")); } catch { contents.set(rel, null); }
    }
    return contents.get(rel);
  };
  const stripped = new Map();
  const strippedLines = (rel, text) => {
    if (!stripped.has(rel)) stripped.set(rel, codeLines(rel, text));
    return stripped.get(rel);
  };
  const exists = (rel) => existsSync(join(root, rel));
  const isTestPath = (rel) => TEST_PATH_RE.test(rel) || TEST_FILE_RE.test(rel) ||
    (SCAFFOLD_PATH_RE.test(rel) && !PAGE_TEMPLATE_RE.test(rel));
  const notScanned = () => {
    const counts = {};
    for (const f of files.filter((f) => !isTestPath(f))) {
      const ext = f.match(/\.(go|rs|java|kt|rb|php|cs|cpp|c|vue|svelte|astro)$/)?.[0];
      if (ext) counts[ext] = (counts[ext] ?? 0) + 1;
    }
    return counts;
  };
  const sourceFiles = () => files.filter((f) => SOURCE_EXT_RE.test(f) && !DECLARATION_RE.test(f) && !isTestPath(f));
  const grep = (re, filter = files) => {
    const hits = [];
    for (const file of filter) {
      const text = read(file);
      if (text === null) continue;
      const lines = text.split("\n");
      const code = strippedLines(file, text);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(code[i])) hits.push({ file, line: i + 1, text: lines[i].trim() });
      }
    }
    return hits;
  };

  // Git-tracked paths relative to root ([] outside a git repo or without git). A file that
  // is tracked is published to everyone with clone access, whatever .gitignore says today.
  let trackedCache;
  const tracked = () => {
    if (trackedCache) return trackedCache;
    try {
      trackedCache = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
    } catch { trackedCache = []; }
    return trackedCache;
  };
  // YYYY-MM-DD of the commit that first added rel, or null.
  const firstCommitDate = (rel) => {
    try {
      return git(root, ["log", "--diff-filter=A", "--follow", "--format=%as", "--", rel]).trim().split("\n").filter(Boolean).at(-1) ?? null;
    } catch { return null; }
  };

  // True when .gitignore hides rel from everyone who clones the repo. False outside a git repo.
  const isIgnored = (rel) => {
    try { git(root, ["check-ignore", "-q", "--", rel]); return true; } catch { return false; }
  };

  /** read() with comments blanked — what a gate may treat as evidence. */
  const code = (rel) => strippedLines(rel, read(rel) ?? "");

  return { root, files, read, code, exists, grep, isTestPath, sourceFiles, notScanned, tracked, isIgnored, firstCommitDate };
}
