import { admin } from "@/lib/supabase";
export async function POST(req: Request) {
  const { prompt } = await req.json();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-5", input: prompt }),
  });
  const { output_text } = await res.json();
  // The model's answer goes straight into the table. Nobody confirms it.
  await admin().from("people").update({ name: output_text }).eq("id", prompt.id);
  return Response.json({ ok: true });
}
