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
