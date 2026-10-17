/**
 * Response headers applied to every route by next.config.ts. Kept here, not
 * inline in the config, so a test can pin them without importing the Sentry
 * build wrapper.
 *
 * Framing is forbidden everywhere: nothing in a standard app is meant to be
 * embedded. Relax frame-ancestors only for a page you deliberately ship as a
 * widget.
 */
export const SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  /* No script-src/style-src yet: Next inlines both and a nonce setup is a
     project of its own. object-src and base-uri cost nothing and close two
     injection paths; form-action is deliberately absent - Chrome applies it
     to the redirect after a form POST, and the OAuth consent form redirects
     to the agent's own origin. */
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  /* Two years, subdomains included. Browsers ignore it over plain http, so
     localhost is unaffected. */
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];
