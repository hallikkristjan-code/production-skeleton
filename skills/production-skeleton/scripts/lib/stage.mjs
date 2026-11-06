export const SERVER_DEPS = [
  "next", "express", "fastify", "koa", "hono", "@nestjs/core", "@remix-run/node",
  "nuxt", "@sveltejs/kit", "astro", "django", "flask", "fastapi", "starlette",
];
export const DEPLOY_FILES = [
  "vercel.json", "Dockerfile", "docker-compose.yml", "fly.toml", "render.yaml",
  "netlify.toml", "Procfile", "app.yaml", "serverless.yml", "manage.py", "wsgi.py", "asgi.py",
];
// A bundled single-page app is deployed somewhere even without a deploy file.
export const SPA_FILES = ["vite.config.ts", "vite.config.js", "vite.config.mjs", "angular.json"];
export const SPA_DEPS = ["react-scripts"];
export const AUTH_LIBS = [
  "next-auth", "@auth/core", "@supabase/ssr", "@supabase/auth-helpers-nextjs",
  "@supabase/auth-js", "@clerk/nextjs", "lucia", "passport", "iron-session",
  "better-auth", "django.contrib.auth", "django-allauth", "flask-login", "authlib",
];
export const PAYMENT_DEPS = ["stripe", "paddle", "@paddle/paddle-node-sdk", "@lemonsqueezy/lemonsqueezy.js", "braintree", "@paypal/checkout-server-sdk"];
export const PII_COLUMN_RE = /(?<![A-Za-z])(email|phone|first_name|last_name|full_name|address|date_of_birth|birthdate)(?![A-Za-z])/i;
const SCHEMA_FILE_RE = /(migrations?\/.*\.sql$|\.sql$|schema\.(prisma|ts|sql)$|models\.py$)/;

function readJson(repo, rel) {
  const text = repo.read(rel);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export function declaredDeps(repo) {
  const out = new Set();
  const pkg = readJson(repo, "package.json");
  if (pkg) for (const k of ["dependencies", "devDependencies", "optionalDependencies"]) for (const n of Object.keys(pkg[k] ?? {})) out.add(n);
  const req = repo.read("requirements.txt");
  if (req) for (const line of req.split("\n")) {
    const m = line.trim().match(/^([A-Za-z0-9_.-]+)/);
    if (m && !line.trim().startsWith("#")) out.add(m[1].toLowerCase());
  }
  const py = repo.read("pyproject.toml");
  if (py) {
    // Deliberately limited TOML extraction. Only dependency fields, never classifiers/keywords.
    const clean = repo.code("pyproject.toml").join("\n");
    for (const section of clean.split(/(?=^\[)/m)) {
      const heading = section.match(/^\[([^\]]+)\]/)?.[1] ?? "";
      if (heading === "project" || heading === "project.optional-dependencies") {
        const arrays = heading === "project" ? [...section.matchAll(/^dependencies\s*=\s*\[((?:"[^"\n]*"|'[^'\n]*'|[^\]"'])*)\]/gm)] : [...section.matchAll(/^[-\w]+\s*=\s*\[((?:"[^"\n]*"|'[^'\n]*'|[^\]"'])*)\]/gm)];
        for (const [, body] of arrays) for (const m of body.matchAll(/["']([A-Za-z0-9_.-]+)[^"']*["']/g)) out.add(m[1].toLowerCase());
      }
      if (/^tool\.poetry(\.group\.[^.]+)?\.dependencies$/.test(heading)) {
        for (const m of section.matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)) if (m[1] !== "python") out.add(m[1].toLowerCase());
      }
    }
  }
  for (const f of repo.files.filter((f) => f.endsWith("settings.py") && !repo.isTestPath(f))) {
    for (const m of (repo.read(f) ?? "").matchAll(/["'](django\.contrib\.auth|allauth)["']/g)) out.add(m[1]);
  }
  return out;
}

export const packageJson = (repo) => readJson(repo, "package.json") ?? {};
export const packageScripts = (repo) => packageJson(repo).scripts ?? {};

export function hasBuildScript(repo) {
  return Boolean(packageScripts(repo).build);
}

export function detectStage(repo) {
  const deps = declaredDeps(repo);
  const origins = new Map();
  for (const f of repo.files.filter((f) => /\/(package\.json|pyproject\.toml|requirements[^/]*\.txt)$/.test(f) && !repo.isTestPath(f))) {
    const dir = f.slice(0, f.lastIndexOf("/"));
    const nested = { ...repo, files: [], read: (p) => repo.read(`${dir}/${p}`), code: (p) => repo.code(`${dir}/${p}`) };
    for (const d of declaredDeps(nested)) { if (!deps.has(d)) origins.set(d, f); deps.add(d); }
  }
  const suffix = (d) => origins.has(d) ? ` (${origins.get(d)})` : "";
  const reasons = [];
  const server = SERVER_DEPS.find((d) => deps.has(d));
  const deployFile = DEPLOY_FILES.find((f) => repo.exists(f));
  const spa = SPA_FILES.find((f) => repo.exists(f)) ?? SPA_DEPS.find((d) => deps.has(d));
  if (!server && !deployFile && !spa) {
    return { stage: 0, reasons: unreadManifests(repo).length ? [`stage not detected: unread manifests ${unreadManifests(repo).join(", ")}`] : ["no deploy target (no server framework, no deploy file)"] };
  }
  reasons.push(`deploy target: ${server ?? deployFile ?? `static site (${spa})`}${suffix(server)}`);
  let stage = 1;

  const auth = AUTH_LIBS.find((d) => deps.has(d));
  if (auth) { stage = 2; reasons.push(`personal data: auth library ${auth}${suffix(auth)}`); }
  else {
    const schemaFiles = repo.files.filter((f) => SCHEMA_FILE_RE.test(f) && !repo.isTestPath(f));
    const hit = repo.grep(PII_COLUMN_RE, schemaFiles)[0];
    if (hit) {
      stage = 2;
      reasons.push(`personal data: column ${hit.text.match(PII_COLUMN_RE)[1]} in ${hit.file}:${hit.line}`);
    }
  }

  const pay = PAYMENT_DEPS.find((d) => deps.has(d));
  if (pay) { stage = 3; reasons.push(`payments: ${pay}${suffix(pay)}`); }
  return { stage, reasons };
}

export const MANIFEST_RE = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|uv\.lock|go\.mod|Cargo\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?)$/;

/** declaredDeps reads [project] and Poetry tables. Dependencies declared any other way (PDM, Flit,
 * `dynamic = ["dependencies"]`) are out of its reach. */
function pyprojectIsRead(text) {
  if (/^\[tool\.poetry(\.group\.[^.\]]+)?\.dependencies\]/m.test(text)) return true;
  return /^\[project\]/m.test(text) && !/^(dynamic\s*=[^\n]*dependencies|["']dependencies["'])/m.test(text);
}

export function unreadManifests(repo) {
  return repo.files.filter((f) => MANIFEST_RE.test(f) && !repo.isTestPath(f)
    && !/(^|\/)(package\.json|requirements[^/]*\.txt|uv\.lock)$/.test(f)
    && !(f.endsWith("pyproject.toml") && pyprojectIsRead(repo.read(f) ?? "")));
}
