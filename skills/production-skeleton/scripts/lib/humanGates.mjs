export const DEFAULTS = { stale_days: 7, drill_max_days: 90 };

const LINE_RE = /^- \[( |x|X)\] (\d{4}-\d{2}-\d{2}) (.*)$/;
const DUE_RE = /\s*\(due:\s*([^)]*)\)\s*$/;

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

/** True for a real calendar day in YYYY-MM-DD form. 2026-02-31 and 2026-99-99 are not: the
 * engine either rolls them over into March or returns NaN, and NaN compares false with everything. */
export function isDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** The frontmatter with unusable settings removed, so the defaults apply, plus one line per
 * removed setting. `stale_days: soon` must not switch staleness off by comparing with a string. */
export function checkConfig(raw) {
  const config = { ...raw };
  const errors = [];
  for (const key of ["stale_days", "drill_max_days"]) {
    if (key in config && !(Number.isInteger(config[key]) && config[key] > 0)) {
      errors.push(`${key}: ${raw[key]} is not a number of days`);
      delete config[key];
    }
  }
  if ("stage" in config && ![0, 1, 2, 3].includes(config.stage)) {
    errors.push(`stage: ${raw.stage} is not 0, 1, 2 or 3`);
    delete config.stage;
  }
  return { config, errors };
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}

export function humanGateState(parsed, today) {
  const staleDays = parsed.config.stale_days ?? DEFAULTS.stale_days;
  const open = parsed.lines.filter((l) => !l.done);
  // A line whose date is not a calendar day can never turn stale, so it is reported instead.
  const invalid = open.filter((l) => !isDate(l.created) || daysBetween(l.created, today) < 0 || (l.due !== null && !isDate(l.due)));
  const stale = open.filter((l) => !invalid.includes(l) &&
    (l.due ? daysBetween(l.due, today) > 0 : daysBetween(l.created, today) > staleDays),
  );
  return { open, stale, invalid, staleDays };
}
