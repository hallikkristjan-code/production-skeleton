#!/usr/bin/env node
/**
 * production-skeleton probe — read-only scorecard for 13 production gates.
 *
 *   node probe.mjs [path] [--json] [--url https://app.example] [--today YYYY-MM-DD] [--no-audit]
 *
 * Never writes to the target repo. Gate 2 runs `npm audit` against the lockfile
 * (network); --no-audit skips it. Exit code is 0 unless the probe itself
 * crashes, or the arguments are unusable; the scorecard is the result, not the
 * exit code.
 */
import { resolve } from "node:path";
import { runProbe } from "./lib/run.mjs";
import { renderMarkdown, renderJson } from "./lib/report.mjs";
import { parseArgs } from "./lib/cli.mjs";

const USAGE = "usage: probe.mjs [path] [--json] [--url <url>] [--today YYYY-MM-DD] [--no-audit]";

const args = parseArgs(process.argv.slice(2), { json: "boolean", url: "string", today: "string", "no-audit": "boolean" });
if (args.error) {
  process.stderr.write(`${args.error}\n${USAGE}\n`);
  process.exit(2);
}

const root = resolve(args.path ?? ".");
const out = await runProbe(root, { url: args.url, today: args.today, audit: !args["no-audit"] });
process.stdout.write((args.json ? renderJson(out) : renderMarkdown(out)) + "\n");
if (out.liveErrors.length) process.stderr.write("live probe errors: " + out.liveErrors.join("; ") + "\n");
