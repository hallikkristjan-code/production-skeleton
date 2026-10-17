const TODAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidToday(v) {
  return TODAY_RE.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * Parse argv into { path, error, ...flags }. `spec` maps a flag's name (without
 * the leading `--`) to "string" or "boolean". Accepts `--flag value` and
 * `--flag=value`. Any `--flag` not in spec, a string flag with no value, or an
 * invalid `--today` sets `error` to a one-line message.
 */
export function parseArgs(argv, spec) {
  const result = { path: undefined, error: null };
  for (const name of Object.keys(spec)) if (spec[name] === "boolean") result[name] = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      if (result.path === undefined) result.path = a;
      continue;
    }
    const eq = a.indexOf("=");
    const name = (eq === -1 ? a : a.slice(0, eq)).slice(2);
    if (!(name in spec)) return { ...result, error: `unknown flag: --${name}` };
    if (spec[name] === "boolean") {
      if (eq !== -1) return { ...result, error: `--${name} does not take a value` };
      result[name] = true;
      continue;
    }
    const value = eq === -1 ? argv[++i] : a.slice(eq + 1);
    if (value === undefined) return { ...result, error: `missing value for --${name}` };
    result[name] = value;
  }
  if (result.today !== undefined && !isValidToday(result.today)) {
    return { ...result, error: `invalid --today: ${result.today} (expected YYYY-MM-DD)` };
  }
  return result;
}
