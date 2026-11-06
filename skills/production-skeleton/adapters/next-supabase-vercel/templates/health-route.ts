import { NextResponse, connection } from "next/server";

/**
 * Liveness + database reachability for an uptime monitor. Public and cheap:
 * one request to the PostgREST root, answering only ok/error and the deployed
 * version — no row counts, no error texts, nothing that describes the schema.
 *
 * No `export const dynamic`: Next.js 16 rejects route segment config when
 * `cacheComponents` is on (the create-next-app default). `connection()`
 * (Next.js 15+) says the same thing in a way every mode accepts: wait for a
 * real request, never answer from a build-time prerender.
 */
export async function GET() {
  await connection();
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
  let dbOk = false;
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    dbOk = res.ok;
  } catch (error) {
    console.error(`[health] database check failed: ${String(error)}`);
  }
  return NextResponse.json(
    { ok: dbOk, db: dbOk ? "ok" : "error", version },
    { status: dbOk ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
