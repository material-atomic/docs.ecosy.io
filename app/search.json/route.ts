import { searchIndex } from "@/lib/content.mjs";

/* Prerendered at build time: the index is read from content/ on disk, which a
   Worker has no access to at runtime. */
export const dynamic = "force-static";

export async function GET() {
  return Response.json(searchIndex());
}
