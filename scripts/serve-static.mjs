import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * A local static file server for dist/client, implementing the ONE rewrite
 * rule task 0063 (mục 4.3) documents as a requirement on whatever host this
 * directory ends up on:
 *
 *   GET /<path>   ->  <path>.html   (when that file exists)
 *   GET /         ->  index.html
 *
 * vinext's export build writes `href="/anchor"` into every link, but the
 * file on disk is `anchor.html` — there is no vinext option that changes
 * this (`trailingSlash: true` was tried and made the build fail outright,
 * see task 0063 mục 2.5/README). Every other host that will ever serve this
 * folder needs to do exactly what this script does; this file exists so
 * that requirement is runnable and testable locally instead of only being a
 * sentence in a README.
 *
 * Not a general-purpose static server: no directory listings, no conditional
 * requests, no compression. Its one job is to reproduce the rewrite above so
 * `npm run start` and the guard's manual checks (task 0063 mục 9.4a) see the
 * same shape a real static host will.
 */

const ROOT = path.join(import.meta.dirname, "..", "dist", "client");
const PORT = Number(process.env.PORT) || 4173;

// _headers (Cloudflare Pages' own syntax, see scripts/emit-markdown.mjs) is
// not read here — it is meaningless outside Cloudflare Pages (task 0063
// mục 6.2). This map is this script's OWN opinion about content-type, kept
// deliberately narrow to the extensions this build actually produces.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".rsc": "text/x-component; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/vnd.microsoft.icon",
  ".webmanifest": "application/manifest+json",
};

async function readIfFile(filePath) {
  try {
    const st = await stat(filePath);
    if (!st.isFile()) return null;
    return await readFile(filePath);
  } catch {
    return null;
  }
}

async function resolveFile(pathname) {
  // Reject anything that could climb out of ROOT before it ever touches the
  // filesystem — decodeURIComponent runs first so an encoded "%2e%2e" can't
  // slip past a plain string check.
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes("..")) return null;

  if (decoded === "/") return readIfFile(path.join(ROOT, "index.html")).then((buf) => buf && { buf, file: "index.html" });

  const direct = path.join(ROOT, decoded);
  const directBuf = await readIfFile(direct);
  if (directBuf) return { buf: directBuf, file: decoded };

  const rewritten = decoded + ".html";
  const rewrittenBuf = await readIfFile(path.join(ROOT, rewritten));
  if (rewrittenBuf) return { buf: rewrittenBuf, file: rewritten };

  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const found = await resolveFile(url.pathname);

  if (!found) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 not found\n");
    return;
  }

  const ext = path.extname(found.file);
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  res.end(found.buf);
});

server.listen(PORT, () => {
  console.log(`[serve-static] dist/client on http://localhost:${PORT} (rewrite: /x -> x.html)`);
});
