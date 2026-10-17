import { NextResponse } from "next/server";
import { isTrustedOrigin } from "./lib/csrf";

export function middleware(req: Request) {
  if (req.method !== "GET" && !isTrustedOrigin(req)) return new NextResponse(null, { status: 403 });
  return NextResponse.next();
}
