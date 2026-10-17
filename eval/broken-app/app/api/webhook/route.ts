import { admin } from "@/lib/supabase";
export async function POST(req: Request) {
  const event = await req.json();
  // webhook_events.id is a primary key, but nothing checks it before acting:
  // a redelivered event runs the side effect twice.
  await admin().from("audit_log").insert({ body: event });
  await admin().from("webhook_events").insert({ id: event.id });
  return Response.json({ received: true });
}
