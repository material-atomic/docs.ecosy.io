import { readFile, readdir, writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

/**
 * Writes every documentation page out as raw Markdown next to the built site.
 *
 * These land in dist/client, which is the Cloudflare assets directory, so
 * `/next/route.md` is served straight off the asset store — no route, no
 * Worker invocation, no CPU time.
 *
 * It reads content/ from disk rather than through lib/content.mjs: that module
 * uses import.meta.glob, which only exists inside Vite. Here we are a plain
 * build step, and the filesystem is right there.
 */

const ROOT = path.join(import.meta.dirname, "..");
const CONTENT = path.join(ROOT, "content");
const OUT = path.join(ROOT, "dist", "client");
const ORIGIN = "https://docs.ecosy.io";

/** Splits `---` frontmatter off the body, without pulling in a parser. */
function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, body: source };

  const data = {};
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at === -1 || line.startsWith(" ")) continue;
    data[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }

  return { data, body: source.slice(match[0].length) };
}

const written = [];

for (const slug of await readdir(CONTENT)) {
  const dir = path.join(CONTENT, slug);

  for (const file of await readdir(dir)) {
    if (!file.endsWith(".md")) continue;

    const source = await readFile(path.join(dir, file), "utf8");
    const { body } = frontmatter(source);

    const isIndex = file === "index.md";
    const href = isIndex ? `/${slug}` : `/${slug}/${file.replace(/\.md$/, "")}`;
    const target = path.join(OUT, `${href.slice(1)}.md`);

    /* A line pointing back at the rendered page, so a file that ends up
       somewhere on its own still says where it came from. No heading of our
       own: the body already opens with one, and two would just disagree. */
    const out = `Source: ${ORIGIN}${href}\n\n${body.trim()}\n`;

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, out, "utf8");
    written.push(`${href}.md`);
  }
}

/* Served as text rather than downloaded. Cloudflare gives .md an octet-stream
   type otherwise, which makes a browser save the file instead of showing it. */
await appendFile(
  path.join(OUT, "_headers"),
  `\n/*.md\n  Content-Type: text/plain; charset=utf-8\n`,
  "utf8",
);

console.log(`[markdown] wrote ${written.length} pages into dist/client`);
