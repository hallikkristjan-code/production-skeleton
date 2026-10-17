/**
 * Origin check for admin mutations. The session cookie is SameSite=Lax, which
 * already keeps a cross-site POST from carrying it in every current browser;
 * this is the second lock for the case where that assumption fails (an old
 * browser, a future cookie-policy change, a subdomain takeover).
 *
 * Browsers send `Origin` on every non-GET fetch and form post. When it is
 * present it must match one of ours; when it is absent, `Referer` is checked
 * the same way; when neither is there (curl, a script, a very old client) the
 * request passes — a forged cross-site request from a browser always carries
 * at least one of the two, so the absence is not a browser attack.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** The origins a browser may legitimately send: the host the request came in
 * on (covers localhost and preview deploys) and the configured public URL. */
export function trustedOrigins(requestOrigin: string): Set<string> {
  const set = new Set([requestOrigin]);
  const configured = originOf(process.env.PUBLIC_BASE_URL);
  if (configured) set.add(configured);
  return set;
}

export function isTrustedOrigin(req: {
  method: string;
  headers: { get(name: string): string | null };
  nextUrl: { origin: string };
}): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const trusted = trustedOrigins(req.nextUrl.origin);
  const origin = req.headers.get("origin");
  if (origin) return trusted.has(originOf(origin) ?? "");
  const referer = originOf(req.headers.get("referer"));
  if (referer) return trusted.has(referer);
  return true;
}
