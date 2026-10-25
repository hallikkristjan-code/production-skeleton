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
// A whole-line comment is never evidence: "// TODO: add csrf" must not pass gate 10.
// Markdown is exempt — there `#` starts a heading.
const COMMENT_LINE_RE = /^\s*(\/\/|#|\/\*|\*|--|<!--)/;
export const isCommentLine = (file, line) => !/\.md$/i.test(file) && COMMENT_LINE_RE.test(line);

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });

export function loadRepo(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        // .claude/worktrees holds other checkouts of this repo: their files are not evidence.
        const worktrees = entry.name === "worktrees" && dir === join(root, ".claude");
        if (!IGNORE_DIRS.has(entry.name) && !worktrees) walk(abs);
      } else if (entry.isFile()) {
        files.push(relative(root, abs).replaceAll("\\", "/"));
      }
    }
  };
  walk(root);
  files.sort();

  const read = (rel) => {
    try { return readFileSync(join(root, rel), "utf8"); } catch { return null; }
  };
  const exists = (rel) => existsSync(join(root, rel));
  const isTestPath = (rel) => TEST_PATH_RE.test(rel) || TEST_FILE_RE.test(rel) ||
    (SCAFFOLD_PATH_RE.test(rel) && !PAGE_TEMPLATE_RE.test(rel));
  const sourceFiles = () => files.filter((f) => SOURCE_EXT_RE.test(f) && !isTestPath(f));
  const grep = (re, filter = files) => {
    const hits = [];
    for (const file of filter) {
      const text = read(file);
      if (text === null) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!isCommentLine(file, lines[i]) && re.test(lines[i])) hits.push({ file, line: i + 1, text: lines[i].trim() });
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

  return { root, files, read, exists, grep, isTestPath, sourceFiles, tracked, firstCommitDate };
}
