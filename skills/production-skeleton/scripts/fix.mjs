#!/usr/bin/env node
/**
 * production-skeleton fix — generate the files behind failing gates.
 *
 *   node fix.mjs [path] [--write] [--today YYYY-MM-DD]
 *
 * Dry-run by default: prints the plan. --write creates files that do not exist
 * and appends human-gate lines. Never overwrites.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProbe } from "./lib/run.mjs";
import { loadRepo } from "./lib/repo.mjs";
import { parseArgs } from "./lib/cli.mjs";
import { declaredDeps } from "./lib/stage.mjs";
import { parseHumanGates } from "./lib/humanGates.mjs";

const ADAPTERS_DIR = fileURLToPath(new URL("../adapters/", import.meta.url));

function loadAdapters() {
  return readdirSync(ADAPTERS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ dir: join(ADAPTERS_DIR, d.name), ...JSON.parse(readFileSync(join(ADAPTERS_DIR, d.name, "manifest.json"), "utf8")) }));
}

export async function planFix(root, { today } = {}) {
  const repo = loadRepo(root);
  const deps = declaredDeps(repo);
  const adapter = loadAdapters().find((a) => a.detect.deps.every((d) => deps.has(d)));
  if (!adapter) return { adapter: null, actions: [] };
  // File planning only needs which gates lack files; the network audit adds nothing here.
  const probe = await runProbe(root, { today, audit: false });
  const status = Object.fromEntries(probe.results.map((r) => [r.id, r.status]));
  const actions = [];
  for (const f of adapter.files) {
    const base = { gate: f.gate, dest: f.dest, humanGate: f.humanGate, note: f.note };
    if (status[f.gate] === "PASS") { actions.push({ ...base, action: "skip-pass" }); continue; }
    if (status[f.gate] === "N/A") { actions.push({ ...base, action: "skip-na" }); continue; }
    if (!f.src) { actions.push({ ...base, action: "manual" }); continue; }
    const missing = (f.requires?.deps ?? []).filter((d) => !deps.has(d));
    if (missing.length) { actions.push({ ...base, action: "skip-requires", requires: `needs ${missing.join(", ")}` }); continue; }
    if (repo.exists(f.dest)) { actions.push({ ...base, action: "skip-exists" }); continue; }
    actions.push({ ...base, action: "write", src: join(adapter.dir, f.src) });
  }
  // A file this run writes may read env vars the target has never declared;
  // gate 3 was PASS only because nothing read them yet. Plan .env.example
  // alongside, from the same manifest entry, so one --write converges.
  const ENV_READ = /process\.env[.\[]|os\.environ|os\.getenv\(/;
  const envAction = actions.find((a) => a.dest === ".env.example");
  const writesEnvReader = actions.some((a) => a.action === "write" && ENV_READ.test(readFileSync(a.src, "utf8")));
  if (envAction && envAction.action === "skip-pass" && writesEnvReader && !repo.exists(".env.example")) {
    const entry = adapter.files.find((f) => f.dest === ".env.example");
    Object.assign(envAction, { action: "write", src: join(adapter.dir, entry.src), note: "planned files read env vars; declare them here" });
  }
  return { adapter: adapter.name, actions, stage: probe.stage };
}

export function applyFix(root, plan, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const written = [];
  for (const a of plan.actions) {
    if (a.action !== "write") continue;
    const abs = join(root, a.dest);
    if (existsSync(abs)) continue; // never overwrite, even if the plan is stale
    mkdirSync(dirname(abs), { recursive: true });
    let content = readFileSync(a.src, "utf8");
    if (a.dest === "HUMAN-GATES.md") content = content.replace(/^stage: \d+$/m, `stage: ${plan.stage}`);
    writeFileSync(abs, content);
    written.push(a.dest);
  }
  const hgPath = join(root, "HUMAN-GATES.md");
  if (!existsSync(hgPath)) writeFileSync(hgPath, `---\nstage: ${plan.stage}\nstale_days: 7\ndrill_max_days: 90\n---\n# Human gates\n\n`);
  const existing = parseHumanGates(readFileSync(hgPath, "utf8")).lines.map((l) => l.text);
  const humanGatesAdded = [];
  for (const a of plan.actions) {
    if (!a.humanGate || ["skip-pass", "skip-na", "skip-requires"].includes(a.action) || existing.includes(a.humanGate)) continue;
    appendFileSync(hgPath, `- [ ] ${today} ${a.humanGate}\n`);
    existing.push(a.humanGate);
    humanGatesAdded.push(a.humanGate);
  }
  return { written, humanGatesAdded };
}

export const HOOK_SNIPPET = `{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node -e \\"try{const t=require('fs').readFileSync('HUMAN-GATES.md','utf8');const o=t.split('\\\\n').filter(l=>l.startsWith('- [ ]'));if(o.length)console.log('Open human gates:\\\\n'+o.join('\\\\n'))}catch{}\\"" }] }]
  }
}`;

function renderPlan(plan, write) {
  if (!plan.adapter) return "No adapter matched this repo (adapters: " + loadAdapters().map((a) => a.name).join(", ") + "). The scorecard still works; generate files by hand.\n";
  const lines = [`## fix — adapter ${plan.adapter}, stage ${plan.stage} (${write ? "writing" : "dry-run; add --write"})`, "", "| Gate | File | Action | Note |", "|---|---|---|---|"];
  for (const a of plan.actions) lines.push(`| ${a.gate} | ${a.dest ?? "—"} | ${a.action}${a.requires ? ` (${a.requires})` : ""} | ${a.note ?? a.humanGate ?? ""} |`);
  lines.push("", "Optional SessionStart hook for .claude/settings.json (reads open human gates aloud):", "```json", HOOK_SNIPPET, "```");
  return lines.join("\n") + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const USAGE = "usage: fix.mjs [path] [--write] [--today YYYY-MM-DD]";
  const args = parseArgs(process.argv.slice(2), { write: "boolean", today: "string" });
  if (args.error) {
    process.stderr.write(`${args.error}\n${USAGE}\n`);
    process.exit(2);
  }
  const root = resolve(args.path ?? ".");
  const write = args.write;
  const plan = await planFix(root, { today: args.today });
  process.stdout.write(renderPlan(plan, write));
  if (write && plan.adapter) {
    const r = applyFix(root, plan, { today: args.today });
    process.stdout.write(`\nWrote ${r.written.length} file(s): ${r.written.join(", ") || "none"}\nAdded ${r.humanGatesAdded.length} human gate(s).\n`);
  }
}
