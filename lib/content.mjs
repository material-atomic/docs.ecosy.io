/* Reading and rendering content/. Plain JS so the build-time search-index script
   and the app itself load exactly the same module. */

import { marked } from "marked";
import { highlight } from "./highlight.mjs";

/* Every markdown file is inlined into the bundle at build time. A Worker has no
   filesystem, so reading content/ from disk at request time returns 500 for
   every route — this is the same content, resolved by the bundler instead. */
const FILES = import.meta.glob("/content/**/*.md", { query: "?raw", import: "default", eager: true });

/* Curated, not alphabetical: someone meeting the ecosystem should hit core
   before the things built on it. */
const ORDER = {
  module: ["core", "http", "next", "orm", "schedule", "pack", "store", "react", "styled", "logger", "json", "datekit", "mailer"],
  framework: ["hoapp", "markdoc"],
  fork: ["next-themes", "flipbook"],
};

export const GROUPS = [
  { type: "module", label: "Packages" },
  { type: "framework", label: "Frameworks" },
  { type: "fork", label: "Forks" },
];

/* ---------- frontmatter ---------- */

/** Minimal YAML: scalars, quoted strings, and one level of nesting. */
function frontmatter(source) {
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

function unquote(value) {
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
  return value;
}

/* ---------- helpers ---------- */

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const slugify = (s) =>
  s
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

/* ---------- markdown ---------- */

const COPY_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

export function render(markdown) {
  /* The page header already carries the title, so a leading H1 in the body is a
     duplicate heading — drop it rather than rendering the name twice. */
  const source = markdown.replace(/^#\s+.*\n+/, "");
  const html = marked.parse(source, { gfm: true, mangle: false, headerIds: false });

  const toc = [];
  const seen = new Map();

  const withHeadings = html.replace(/<(h2|h3)>([\s\S]*?)<\/\1>/g, (_all, tag, inner) => {
    let id = slugify(inner) || "section";
    const hits = seen.get(id) ?? 0;
    seen.set(id, hits + 1);
    if (hits) id = `${id}-${hits + 1}`;

    toc.push({ id, depth: Number(tag[1]), label: inner.replace(/<[^>]+>/g, "") });

    return `<${tag} id="${id}">${inner}<a class="docs-anchor" href="#${id}" aria-label="Link to this section">#</a></${tag}>`;
  });

  /* Code fences become CodeBlock: language label plus a copy button. No colour
     highlighting — the system has no token palette for it. */
  /* marked hands back escaped HTML; the tokenizer needs the source, so unescape
     first. Only the JS family is coloured — bash and JSON have no palette here
     and a half-highlighted shell line reads worse than a plain one. */
  const unescape = (s) =>
    s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
     .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  const HIGHLIGHTED = new Set(["ts", "tsx", "js", "jsx", "typescript", "javascript"]);

  const withCode = withHeadings.replace(
    /<pre><code(?: class="language-([\w-]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_all, lang, code) => `<div class="docs-code" data-slot="docs-code-block">
${lang ? `<span class="docs-code-lang">${escapeHtml(lang)}</span>` : ""}
<button class="docs-copy" type="button" aria-label="Copy code">${COPY_ICON}</button>
<pre><code${lang ? ` class="language-${lang}"` : ""}>${
  HIGHLIGHTED.has(lang) ? highlight(unescape(code)) : code
}</code></pre>
</div>`,
  );

  /* A headerless markdown table still emits a <thead> of empty cells, which
     paints as a band above the table. */
  const html2 = withCode.replace(
    /<thead>\s*<tr>((?:\s*<th[^>]*>\s*<\/th>)+)\s*<\/tr>\s*<\/thead>/g,
    "",
  );

  return { html: html2, toc };
}

/* ---------- content ---------- */

let cache = null;

export function getPackages() {
  if (cache) return cache;

  /* "/content/core/utilities.md" -> { slug: "core", file: "utilities.md" } */
  const bySlug = new Map();
  for (const path of Object.keys(FILES)) {
    const match = path.match(/^\/content\/([^/]+)\/([^/]+)\.md$/);
    if (!match) continue;
    const [, slug, file] = match;
    if (!bySlug.has(slug)) bySlug.set(slug, new Map());
    bySlug.get(slug).set(file, FILES[path]);
  }

  const packages = [];

  for (const [slug, files] of bySlug) {
    const indexSource = files.get("index");
    if (!indexSource) continue;

    const index = frontmatter(indexSource);
    if (index.data.status === "hidden") continue;

    const pages = [];
    for (const [name, source] of files) {
      if (name === "index") continue;
      const parsed = frontmatter(source);
      pages.push({
        slug: name,
        title: parsed.data.title ?? name,
        order: Number(parsed.data.order ?? 99),
        importPath: parsed.data.import ?? null,
        body: parsed.body,
      });
    }
    pages.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

    packages.push({ slug, meta: index.data, body: index.body, pages });
  }

  const rank = (pkg) => {
    const list = ORDER[pkg.meta.type] ?? [];
    const at = list.indexOf(pkg.slug);
    return at === -1 ? 999 : at;
  };

  packages.sort((a, b) => rank(a) - rank(b) || a.slug.localeCompare(b.slug));
  cache = packages;
  return packages;
}

/** Flattened reading order — what the pager walks. */
export function reading(packages) {
  const flat = [];
  for (const pkg of packages) {
    flat.push({ href: `/${pkg.slug}`, label: pkg.meta.name ?? pkg.slug });
    for (const page of pkg.pages) flat.push({ href: `/${pkg.slug}/${page.slug}`, label: page.title });
  }
  return flat;
}

export function searchIndex() {
  const packages = getPackages();
  const entries = [];

  for (const pkg of packages) {
    const name = pkg.meta.name ?? pkg.slug;
    entries.push({ title: name, path: `/${pkg.slug}`, section: pkg.meta.type });

    for (const h of render(pkg.body).toc)
      entries.push({ title: h.label, path: `/${pkg.slug}#${h.id}`, section: name });

    for (const page of pkg.pages) {
      entries.push({ title: `${name} ${page.title}`, path: `/${pkg.slug}/${page.slug}`, section: name });
      for (const h of render(page.body).toc)
        entries.push({ title: h.label, path: `/${pkg.slug}/${page.slug}#${h.id}`, section: page.title });
    }
  }

  return entries;
}
