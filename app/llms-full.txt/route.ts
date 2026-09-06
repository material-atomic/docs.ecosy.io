import { llmsFull } from "@/lib/content.mjs";

export const dynamic = "force-static";

export async function GET() {
  return new Response(llmsFull(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
