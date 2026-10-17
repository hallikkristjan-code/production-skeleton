import { loadRepo } from "./repo.mjs";
import { detectStage } from "./stage.mjs";
import { GATES } from "./gates.mjs";
import { parseHumanGates, humanGateState } from "./humanGates.mjs";
import { score } from "./report.mjs";
import { probeUrl } from "./live.mjs";
import { runAudit } from "./audit.mjs";

const today = () => new Date().toISOString().slice(0, 10);

export async function runProbe(root, opts = {}) {
  const repo = loadRepo(root);
  const parsed = parseHumanGates(repo.read("HUMAN-GATES.md") ?? "");
  const config = parsed.config;
  const day = opts.today ?? today();

  let { stage, reasons } = detectStage(repo);
  if (typeof config.stage === "number") { stage = config.stage; reasons = [`stage ${stage} declared in HUMAN-GATES.md`, ...reasons]; }

  const live = opts.live ?? (opts.url ? await probeUrl(opts.url) : null);
  const audit = opts.audit === false ? null : runAudit(repo);
  const ctx = { today: day, config, live, audit };
  const na = config.na ?? {};

  const results = GATES.map((g) => {
    if (na[g.id] !== undefined) {
      const reason = String(na[g.id]).trim();
      return reason
        ? { id: g.id, name: g.name, stage: g.stage, status: "N/A", note: reason }
        : { id: g.id, name: g.name, stage: g.stage, status: "FAIL", note: "declared n/a in HUMAN-GATES.md without a reason" };
    }
    if (stage === 0 && g.id >= 5) return { id: g.id, name: g.name, stage: g.stage, status: "N/A", note: "no deploy target" };
    const { status, note } = g.run(repo, ctx);
    return { id: g.id, name: g.name, stage: g.stage, status, note };
  });

  const humanGates = humanGateState(parsed, day);
  return { stage, reasons, results, score: score(results, stage), humanGates: { open: humanGates.open, stale: humanGates.stale }, liveErrors: live?.errors ?? [] };
}
