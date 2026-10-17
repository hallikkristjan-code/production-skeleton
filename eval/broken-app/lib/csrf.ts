export function isTrustedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !origin || origin === process.env.SUPABASE_URL;
}
