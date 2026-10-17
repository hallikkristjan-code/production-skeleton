/** Gates at or below the current stage are required; stage 0 (library) still
 * requires the four stage-1 gates. N/A rows are never required. */
export function isRequired(row, stage) {
  return row.status !== "N/A" && row.stage <= Math.max(stage, 1);
}

export function score(results, stage) {
  const applicable = results.filter((r) => r.status !== "N/A");
  const required = results.filter((r) => isRequired(r, stage));
  return {
    requiredPassed: required.filter((r) => r.status === "PASS").length,
    required: required.length,
    passed: applicable.filter((r) => r.status === "PASS").length,
    total: results.length,
    na: results.length - applicable.length,
  };
}

export function badge(s) {
  const color = s.requiredPassed === s.required ? "brightgreen" : "orange";
  return `https://img.shields.io/badge/skeleton-${s.passed}%2F${s.total}-${color}`;
}

export function scoreLine(s) {
  return `${s.requiredPassed}/${s.required} required · ${s.passed}/${s.total} total, ${s.na} n/a`;
}

export function renderMarkdown(out) {
  const lines = [];
  lines.push(`## production-skeleton — stage ${out.stage} · ${scoreLine(out.score)}`);
  lines.push("");
  lines.push(`Stage: ${out.reasons.join("; ")}`);
  lines.push("");
  lines.push("| # | Gate | Stage | Status | Evidence |");
  lines.push("|---|---|---|---|---|");
  for (const r of out.results) {
    const required = isRequired(r, out.stage);
    const status = required && r.status !== "PASS" ? `**${r.status}**` : r.status;
    lines.push(`| ${r.id} | ${r.name} | ${r.stage} | ${status} | ${r.note.replaceAll("|", "\\|")} |`);
  }
  if (out.liveErrors?.length) {
    lines.push("");
    lines.push(`Live check errors (a gate that relies on them is UNKNOWN, not PASS): ${out.liveErrors.join("; ")}`);
  }
  lines.push("");
  lines.push(`Badge: \`![skeleton](${badge(out.score)})\``);
  if (out.humanGates.open.length) {
    lines.push("");
    lines.push(`Open human gates (${out.humanGates.open.length}, ${out.humanGates.stale.length} stale):`);
    for (const l of out.humanGates.open) lines.push(`- ${l.created} ${l.text}${l.due ? ` (due: ${l.due})` : ""}`);
  }
  lines.push("");
  lines.push("Read-only: nothing was changed. `fix` generates the missing files (dry-run by default).");
  return lines.join("\n");
}

export const renderJson = (out) => JSON.stringify(out, null, 2);
