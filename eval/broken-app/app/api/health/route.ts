export const GET = () => Response.json({ ok: true, version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" });
