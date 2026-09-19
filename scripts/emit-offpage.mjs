import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Writes llms.txt, llms-full.txt and search.json into dist/client as plain
 * files.
 *
 * vinext's `output: "export"` prerender step never sees these three: they
 * are `app/**\/route.ts` handlers, and `getAppRouteRenderEntryPath()`
 * (vinext/dist/build/report.js) returns null for any route with a
 * `routePath`, so `prerender.js` marks them `skipped: "api"` before
 * classifyAppRoute() ever runs — measured on vinext 1.0.0-beta.8,
 * dist/server/vinext-prerender.json after a real build:
 *   { "route": "/llms.txt", "status": "skipped", "reason": "api" }
 * (same for /llms-full.txt and /search.json). The build still exits 0 and
 * prints nothing that says so.
 *
 * This does NOT reimplement llmsTxt()/llmsFull()/searchIndex() — the repo
 * already carries two copies of the frontmatter reader for the reason
 * documented in lib/content.mjs (import.meta.glob is a Vite-time transform,
 * so a plain Node script can't `import()` that module), and a third copy of
 * the RESPONSE BODIES themselves would be a straight path to the exact drift
 * this build is meant to stop shipping.
 *
 * Instead: dist/server/index.js, produced by this same build, is a standard
 * Cloudflare Workers module (`export default { fetch(request, env, ctx) }`)
 * whose handler runs the three GET() functions unmodified — they take no
 * `request` argument (see app/llms.txt/route.ts etc.) and read only
 * content/, resolved by the bundler at build time, not the filesystem at
 * request time. So this script imports that module directly and calls
 * .fetch() in-process, with no HTTP server and no wrangler/miniflare. Byte
 * for byte, this is confirmed identical to what `vinext start` serves on
 * the same build (task 0063 mục 2.7/9.2: sha1 of all three responses
 * matched a real `vinext start` + curl run).
 */

const ROOT = path.join(import.meta.dirname, "..");
const SERVER_ENTRY = path.join(ROOT, "dist", "server", "index.js");
const OUT = path.join(ROOT, "dist", "client");

const ROUTES = [
  { href: "/llms.txt", file: "llms.txt" },
  { href: "/llms-full.txt", file: "llms-full.txt" },
  { href: "/search.json", file: "search.json" },
];

const { default: worker } = await import(pathToFileURL(SERVER_ENTRY).href);
if (!worker || typeof worker.fetch !== "function") {
  throw new Error(`[emit-offpage] ${SERVER_ENTRY} did not export a Workers-shaped { fetch } default — did the build output change shape?`);
}

// Real Workers ExecutionContext has both; nothing this build's routes touch
// needs either to do real work (no queued cache writes, no error reporting
// hook), so a no-op stand-in is enough to run the handler in-process.
const ctx = { waitUntil() {}, passThroughOnException() {} };

for (const { href, file } of ROUTES) {
  const res = await worker.fetch(new Request("https://docs.ecosy.io" + href), {}, ctx);

  // A positive assertion, not a hope: writing an empty or error file out
  // as if it were real content is exactly the "hỏng im lặng" this whole
  // task exists to close, one route sooner than the build report would.
  if (res.status !== 200) {
    throw new Error(`[emit-offpage] ${href} returned status ${res.status}, expected 200`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    throw new Error(`[emit-offpage] ${href} returned an empty body`);
  }
  if (file === "search.json") {
    const parsed = JSON.parse(buf.toString("utf8")); // throws if not valid JSON
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(`[emit-offpage] search.json parsed but is not a non-empty array (length ${Array.isArray(parsed) ? parsed.length : "n/a"})`);
    }
  }

  await writeFile(path.join(OUT, file), buf);
  console.log(`[offpage] wrote ${file} (${buf.length} bytes, status ${res.status})`);
}
