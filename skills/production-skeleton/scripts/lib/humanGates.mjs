export const DEFAULTS = { stale_days: 7, drill_max_days: 90 };

const LINE_RE = /^- \[( |x|X)\] (\d{4}-\d{2}-\d{2}) (.*)$/;
const DUE_RE = /\s*\(due:\s*(\d{4}-\d{2}-\d{2})\)\s*$/;

function coerce(value) {
  const v = value.trim().replace(/^["']|["']$/g, "");
  return /^\d+$/.test(v) ? Number(v) : v;
}

/** Minimal YAML: `key: value` and one level of `key:` + indented `k: v`. */
function parseFrontmatter(src) {
  const out = {};
  let current = null;
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const nested = line.match(/^\s+([\w-]+):\s*(.*)$/);
    if (nested && current) { out[current][nested[1]] = coerce(nested[2]); continue; }
    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (!top) continue;
    if (top[2].trim() === "") { current = top[1]; out[current] = {}; }
    else { current = null; out[top[1]] = coerce(top[2]); }
  }
  return out;
}

export function parseHumanGates(text) {
  let config = {};
  let body = text;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) { config = parseFrontmatter(fm[1]); body = text.slice(fm[0].length); }
  const lines = [];
  for (const raw of body.split(/\r?\n/)) {
    const m = raw.match(LINE_RE);
    if (!m) continue;
    let text = m[3].trim();
    let due = null;
    const d = text.match(DUE_RE);
    if (d) { due = d[1]; text = text.slice(0, d.index).trim(); }
    lines.push({ done: m[1] !== " ", created: m[2], due, text });
  }
  return { config, lines };
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

export function humanGateState(parsed, today) {
  const staleDays = parsed.config.stale_days ?? DEFAULTS.stale_days;
  const open = parsed.lines.filter((l) => !l.done);
  const stale = open.filter((l) =>
    l.due ? daysBetween(l.due, today) > 0 : daysBetween(l.created, today) > staleDays,
  );
  return { open, stale, staleDays };
}
