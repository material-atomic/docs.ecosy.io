import { llmsTxt } from "@/lib/content.mjs";

/* Built at build time, like the search index: the content is read from
   content/ on disk, which a Worker has no access to at runtime. */
export const dynamic = "force-static";

export async function GET() {
  return new Response(llmsTxt(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
