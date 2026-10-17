import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

/** Write { "rel/path": "content" } into a fresh temp dir and return its root. */
export function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "skeleton-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

export const TODAY = "2026-09-12";
