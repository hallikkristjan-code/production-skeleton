import { NextResponse } from "next/server";

/**
 * Liveness + database reachability for an uptime monitor. Public and cheap:
 * one request to the PostgREST root, answering only ok/error and the deployed
 * version — no row counts, no error texts, nothing that describes the schema.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
  let dbOk = false;
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "" },
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
