/*
 * Reading content/**\/*.md the way the site itself does — this frontmatter
 * parser is a straight copy of lib/content.mjs's `frontmatter()` (one level
 * of nesting, for `upstream: { package, version }`), not a reinvention, so a
 * page the guard reads is the same page the site renders.
 *
 * Splits each page into three regions, because the four things this guard
 * checks live in different regions of the same file:
 *   - `codeBlocks`  — fenced ```ts/tsx/js/jsx (checked for import resolution)
 *   - `bashBlocks`  — fenced ```bash/sh/shell (checked for install lines)
 *   - `prose`       — everything else, all fences stripped out
 * Headings are pulled from `prose` separately, since the heading-as-API-name
 * convention this site uses (`` ## `Mailer.from` ``) is its own signal.
 */

import fs from "node:fs";
import path from "node:path";

function unquote(value) {
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
  return value;
}

export function frontmatter(source) {
  if (!source.startsWith("---")) return { data: {}, body: source };
  const end = source.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: source };
  const head = source.slice(4, end);
  const body = source.slice(end + 4).replace(/^\n+/, "");
  const data = {};
  let parent = null;
  for (const raw of head.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indented = /^\s+/.test(raw);
    const match = raw.match(/^\s*([\w.-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, rest] = match;
    const value = unquote(rest.trim());
    if (indented && parent) {
      data[parent][key] = value;
      continue;
    }
    if (value === "") {
      data[key] = {};
      parent = key;
    } else {
      data[key] = value;
      parent = null;
    }
  }
  return { data, body };
}

const FENCE_LANGS = {
  code: new Set(["ts", "tsx", "js", "jsx", "typescript", "javascript", "mjs", "cjs"]),
  bash: new Set(["bash", "sh", "shell", "zsh"]),
};

/** Split a page body into { prose, codeBlocks, bashBlocks, otherBlocks }. */
export function splitRegions(body) {
  const codeBlocks = [];
  const bashBlocks = [];
  const otherBlocks = [];
  const prose = body.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_all, lang, content) => {
    const l = (lang || "").toLowerCase();
    if (FENCE_LANGS.code.has(l) || l === "") codeBlocks.push(content); // untagged fences on this site are always ts
    if (FENCE_LANGS.bash.has(l)) bashBlocks.push(content);
    if (!FENCE_LANGS.code.has(l) && !FENCE_LANGS.bash.has(l) && l !== "") otherBlocks.push({ lang: l, content });
    return "";
  });
  return { prose, codeBlocks, bashBlocks, otherBlocks };
}

/** `##`/`###` headings whose entire label is a single backtick-quoted identifier. */
export function apiHeadings(prose) {
  const out = [];
  for (const m of prose.matchAll(/^#{2,3}\s+`([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?(\(\))?`\s*$/gm)) {
    out.push({ base: m[1], member: m[2] || null, raw: m[0] });
  }
  return out;
}

/** Inline (single-backtick) code spans anywhere in prose — where an API name is cited in running text. */
export function inlineSpans(prose) {
  const out = [];
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
  return out;
}

/**
 * The longest line of a page's own raw markdown BODY that plausibly
 * identifies the page in running prose — used by check.mjs's dist-region
 * PAGE-IS-NOT-THE-PAGE check (task 0063 mục 7.2) and by guard/mutate.mjs's
 * synthetic dist fixtures, so both read the SAME rule instead of two
 * drifting copies.
 *
 * Anchoring identity on a page's `<h1>` was tried first and measured
 * empty: this site's nav repeats every page's title on every OTHER page too
 * (`grep -c "Cache" anchor.html` -> 2, one hit is the nav link), so a short
 * title is exactly the string LEAST able to tell one page's HTML from
 * another's. A long (>= 40 char) prose line, once fenced code / headings /
 * blockquotes / list items / table rows / inline-code spans are excluded,
 * is specific enough that it hasn't been observed to collide across pages
 * on this content (measured on 5 pages while building this check: unique
 * per page, present only in that page's own rendered HTML).
 */
export function longestProseLine(body, minLength = 40) {
  let inFence = false;
  let best = null;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line) continue;
    // Heading (#), blockquote (>), table row (|), bullet (- or *), or an
    // ordered-list item (starts with a digit) — none of these is "prose".
    if (/^[#>|*-]/.test(line) || /^\d/.test(line)) continue;
    // An inline-code span usually means the line is naming an API, not
    // describing something in the reader's own words — and it is exactly
    // the shape marked's escaping (of `'`/`"`) is most likely to interact
    // with, which is the other half of why this check must decode HTML
    // entities before comparing (see stripTags() below).
    if (line.includes("`")) continue;
    if (line.length < minLength) continue;
    if (!best || line.length > best.length) best = line;
  }
  return best;
}

/** Undo the escaping marked.js applies to `'`, `"`, `<`, `>`, `&` in rendered
 * HTML — comparing against the RAW markdown line without this decodes to
 * false on every single page (measured: 5/5 own:false undecoded, 5/5
 * own:true decoded, task 0063 mục 7.2). */
export function decodeEntities(s) {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Rendered HTML -> plain text, for substring-matching a content/ prose line
 * against it. Strips tags first, then decodes entities — order matters: a
 * tag attribute can itself contain an escaped quote. */
export function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ""));
}

/**
 * The RAW markdown line longestProseLine() picked, reduced to what it reads
 * as once marked.js has rendered it — a `**bold**` span or a `[text](url)`
 * link is still valid "prose" by longestProseLine()'s own rule (no leading
 * heading/quote/list marker, no backtick, long enough), but its RAW
 * characters never appear verbatim in the rendered page: marked turns
 * `**left in place**` into `<strong>left in place</strong>`, which
 * stripTags() reduces to "left in place" — the asterisks are simply gone.
 * Measured while building the dist identity check (task 0063 mục 7.2): 6 of
 * 35 real pages picked a fragment containing `**…**` or a `[…](…)` link,
 * and every one of them false-flagged PAGE-IS-NOT-THE-PAGE without this.
 * Uses the same two substitutions {@link summarise} in lib/content.mjs
 * already applies for the same reason, one level up (a one-line summary,
 * not a page-identity check) — not a third, independent guess at marked's
 * rendering rules.
 */
export function markdownInlineToPlain(line) {
  return line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_]/g, "");
}

/** The dist/client filename vinext's export build writes for a page href —
 * `/` -> `index.html`, everything else drops the leading slash and appends
 * `.html`. Centralised because three different places (check.mjs's dist
 * region, mutate.mjs's synthetic fixtures, scripts/*) all need to agree on
 * it without retyping the rule. */
export function hrefToHtmlPath(href) {
  return href === "/" ? "index.html" : href.slice(1) + ".html";
}

/** The dist/client filename scripts/emit-markdown.mjs writes for a page
 * href — always `<slug>[/<page>].md`, `/` has no special case here because
 * no page's href is bare "/" other than a package index, which already
 * slices cleanly. */
export function hrefToMdPath(href) {
  return href.slice(1) + ".md";
}

/** Load every content/<slug>/<file>.md, grouped by top-level slug. */
export function loadContent(contentDir) {
  const slugs = fs.readdirSync(contentDir).filter((s) => fs.statSync(path.join(contentDir, s)).isDirectory());
  const groups = {};
  for (const slug of slugs) {
    const dir = path.join(contentDir, slug);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    const pages = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      const { data, body } = frontmatter(source);
      const isIndex = file === "index.md";
      pages.push({
        slug,
        file,
        href: isIndex ? `/${slug}` : `/${slug}/${file.replace(/\.md$/, "")}`,
        data,
        body,
        ...splitRegions(body),
      });
    }
    const indexPage = pages.find((p) => p.file === "index.md");
    groups[slug] = { slug, meta: indexPage ? indexPage.data : {}, pages };
  }
  return groups;
}
