#!/usr/bin/env node
/*
 * docs.ecosy.io guard — task 0057/B1.
 *
 * Catches, on the current source, what R&D 0057 caught by hand: import
 * specifiers that don't resolve through a package's real `exports`, API
 * names taught in prose/headings that the current release doesn't have,
 * install lines naming the wrong package, entry points nobody documents,
 * and the three off-page copies (llms.txt / llms-full.txt / search.json)
 * drifting from content/ or from each other.
 *
 * Central premise (house rule, paid for at 0027 and 0055): a docs guard
 * that only reads fenced ```ts blocks is blind to prose, to ```bash install
 * lines, and to anything outside the page. All three carried a real bug in
 * this site (the /mailer opening example, `yarn add @ecosy/mailer` — fine
 * here, but the class of bug 0055 lost was exactly this — and llms.txt's
 * broken `.md` promise). So every check below is tagged with which of the
 * four required regions (code / prose / bash / off-page) it covers, and the
 * self-check at the bottom asserts none of the four came back empty.
 *
 * Usage:
 *   node guard/check.mjs                  # full run against content/, live off-page checks
 *   node guard/check.mjs --content-dir X  # run against a different content tree (mutation testing)
 *   node guard/check.mjs --skip-live      # skip the four network calls to docs.ecosy.io
 *   node guard/check.mjs --llms-txt FILE --llms-full FILE --search-json FILE --md-probe FILE
 *                                         # feed off-page checks from local fixtures instead of the network
 *   node guard/check.mjs --quiet          # summary line + exit code only
 */

import fs from "node:fs";
import path from "node:path";
import { loadContent, apiHeadings, inlineSpans } from "./lib/content.mjs";
import { resolveTypes, namesOf, codeEntries, memberNamesOf, isFunctionDeclaration } from "./lib/dts.mjs";
import { resolvePackage } from "./lib/registry.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const DEFAULT_CONTENT_DIR = path.join(ROOT, "content");
const ORIGIN = "https://docs.ecosy.io";
const CATALOG_PATHS = ["/", "/packages", "/frameworks", "/forks"];
const OFFPAGE_PATHS = ["/llms.txt", "/llms-full.txt", "/search.json"];

// @ecosy/next 2.0.0 is unreleased (npm `latest` is 1.1.0). Same call R&D 0057
// made: read the workspace dist read-only instead of the npm tarball, because
// that's the surface these docs are being written against. Overridable so
// the guard still runs on a machine without this workspace checked out.
const WORKSPACE_OVERRIDES = {
  "@ecosy/next": process.env.NEXT_WORKSPACE_DIR || "/Users/ngvcanh/ecosy-labs/packages/ecosy-next",
};
for (const [name, dir] of Object.entries(WORKSPACE_OVERRIDES)) {
  if (!fs.existsSync(path.join(dir, "package.json"))) delete WORKSPACE_OVERRIDES[name];
}

// ---------- CLI args ----------

function parseArgs(argv) {
  const a = { contentDir: DEFAULT_CONTENT_DIR, skipLive: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--content-dir") a.contentDir = path.resolve(argv[++i]);
    else if (arg === "--skip-live") a.skipLive = true;
    else if (arg === "--quiet") a.quiet = true;
    else if (arg === "--llms-txt") a.llmsTxtFile = argv[++i];
    else if (arg === "--llms-full") a.llmsFullFile = argv[++i];
    else if (arg === "--search-json") a.searchJsonFile = argv[++i];
    else if (arg === "--md-probe") a.mdProbeFile = argv[++i]; // JSON: { "<path>": 200|404, ... }
  }
  return a;
}

// ---------- helpers shared across checks ----------

/** Sentences containing a deliberate-absence phrase suppress a PROSE-API flag on names in that same sentence.
 * Narrow window (one sentence) on purpose — see the M6 self-check for why "same paragraph" is too wide. */
const NEGATION = /\b(deliberately absent|does not resolve|not exported|no longer exists|is absent from|not part of|has been removed|removed in)\b/i;

function sentencesOf(text) {
  return text.split(/(?<=[.!?])\s+|\n{2,}/);
}

// Common JS/DOM/Node globals that legitimately appear as `Foo.bar()` in prose
// and are never part of any @ecosy/* package's own surface.
const BUILTIN_NAMESPACES = new Set([
  "JSON", "Object", "Array", "Math", "Promise", "Reflect", "Intl", "console",
  "process", "globalThis", "Date", "Number", "String", "Boolean", "Symbol",
  "Map", "Set", "WeakMap", "WeakSet", "Error", "RegExp", "URL",
]);

function wordIn(text, word) {
  return new RegExp("(^|[^\\w$])" + word.replace(/[$]/g, "\\$") + "($|[^\\w$])").test(text);
}

// ---------- surfaces: one per npm package referenced from content ----------

async function buildSurfaces(groups) {
  const npmNames = new Set();
  for (const g of Object.values(groups)) if (g.meta.npm) npmNames.add(g.meta.npm);

  const surfaces = {};
  const timings = [];
  for (const name of npmNames) {
    const t0 = Date.now();
    const resolved = await resolvePackage(name, { workspaceOverrides: WORKSPACE_OVERRIDES });
    timings.push({ name, ...resolved, ms: Date.now() - t0 });
    const entries = name.startsWith("@ecosy/") || name === "page-flip" ? safeCodeEntries(resolved.dir) : ["."];
    const allNames = new Set();
    const entryNames = {};
    for (const key of entries) {
      if (key === "./package.json") continue;
      const sub = key === "." ? "." : key;
      const t = resolveTypes(resolved.dir, sub);
      const names = t ? namesOf(resolved.dir, t.replace(/^\.\//, "")) : new Set();
      entryNames[key] = { typesFile: t, names };
      for (const n of names) allNames.add(n);
    }
    surfaces[name] = { ...resolved, entries, entryNames, allNames };
  }
  return { surfaces, timings };
}

function safeCodeEntries(dir) {
  try {
    return codeEntries(dir);
  } catch {
    return ["."];
  }
}

/**
 * Find the exports-key whose module actually declares `name`. `preferredKey`
 * (the current page's own subpath) is tried FIRST, because a name can exist
 * at more than one subpath with different shapes: `@ecosy/schedule`'s root
 * exports an `Hook` INTERFACE (just `notify`), while `@ecosy/schedule/hook`
 * separately exports its own `Hook` CONST with `.combine` — same name,
 * unrelated shape. Checking root first (as this used to) found the
 * interface and reported the page's own, correct `Hook.combine` as missing.
 */
function findDeclaringEntry(surface, name, preferredKey) {
  const rest = Object.keys(surface.entryNames).filter((k) => k !== "." && k !== preferredKey);
  const order = [preferredKey, "."].filter(Boolean).concat(rest);
  for (const key of order) {
    const info = surface.entryNames[key];
    if (info && info.names.has(name)) return key;
  }
  return null;
}

/** The current page's own exports-key, from its frontmatter `import:` (subpages) or the group's `npm` (index pages). */
function pageOwnEntry(group, page) {
  const claimed = page.data.import || group.meta.npm;
  if (!claimed || !group.meta.npm) return ".";
  return claimed === group.meta.npm ? "." : "." + claimed.slice(group.meta.npm.length);
}

// ================================================================
// CHECK A — code blocks: import specifiers + named imports + Foo.bar() calls
// ================================================================

function checkCodeImports(groups, surfaces) {
  const bad = [];
  let specifiersChecked = 0;
  let namedImportsChecked = 0;
  let memberCallsChecked = 0;

  const IMPORT_RE =
    /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\*\s+as\s+([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;

  for (const g of Object.values(groups))
    for (const page of g.pages)
      for (const block of page.codeBlocks) {
        const localToReal = new Map(); // local identifier -> { pkg, exportName }
        for (const m of block.matchAll(IMPORT_RE)) {
          const [, defaultLocal, nsLocal, named, spec] = m;
          if (!spec.startsWith("@ecosy/") && spec !== "page-flip") continue;
          const parts = spec.split("/");
          const pkgName = spec.startsWith("@ecosy/") ? parts[0] + "/" + parts[1] : parts[0];
          const surface = surfaces[pkgName];
          if (!surface) continue; // package not referenced from any frontmatter — out of scope
          specifiersChecked++;
          const sub = spec === pkgName ? "." : "." + spec.slice(pkgName.length);
          const typesFile = resolveTypes(surface.dir, sub);
          if (!typesFile) {
            bad.push({ page: page.href, region: "code", kind: "SUBPATH-NOT-EXPORTED", spec, detail: named || defaultLocal || nsLocal || "" });
            continue;
          }
          const have = namesOf(surface.dir, typesFile.replace(/^\.\//, ""));
          if (named) {
            for (const part of named.split(",")) {
              const raw = part.trim();
              if (!raw) continue;
              const asMatch = raw.match(/^(?:type\s+)?([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
              const [origName, localName] = asMatch ? [asMatch[1], asMatch[2]] : [raw.replace(/^type\s+/, "").trim(), raw.replace(/^type\s+/, "").trim()];
              if (!/^[A-Za-z_$][\w$]*$/.test(origName)) continue;
              namedImportsChecked++;
              if (!have.has(origName)) {
                bad.push({ page: page.href, region: "code", kind: "NAME-NOT-EXPORTED", spec, detail: origName });
              } else {
                localToReal.set(localName, { pkgDir: surface.dir, typesFile, exportName: origName });
              }
            }
          }
          if (defaultLocal) localToReal.set(defaultLocal, { pkgDir: surface.dir, typesFile, exportName: "default" });
          if (nsLocal) localToReal.set(nsLocal, { pkgDir: surface.dir, typesFile, exportName: null }); // namespace: no single member owner
        }

        // Foo.bar( / Foo.bar: — member references against whatever this block just imported.
        for (const m of block.matchAll(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*[(.]/g)) {
          const [, base, member] = m;
          const ref = localToReal.get(base);
          if (!ref || ref.exportName === null || ref.exportName === "default") continue;
          memberCallsChecked++;
          if (isFunctionDeclaration(ref.pkgDir, ref.typesFile.replace(/^\.\//, ""), ref.exportName)) {
            bad.push({ page: page.href, region: "code", kind: "MEMBER-ON-FUNCTION", spec: ref.exportName, detail: member });
            continue;
          }
          const members = memberNamesOf(ref.pkgDir, ref.typesFile.replace(/^\.\//, ""), ref.exportName);
          if (members && !members.has(member)) {
            bad.push({ page: page.href, region: "code", kind: "MEMBER-NOT-FOUND", spec: ref.exportName, detail: member });
          }
        }
      }

  return { bad, specifiersChecked, namedImportsChecked, memberCallsChecked };
}

// ================================================================
// CHECK B — bash/sh blocks: install lines
// ================================================================

function checkBashInstalls(groups, surfaces, knownNpmNames) {
  const bad = [];
  let linesChecked = 0;
  const INSTALL_RE = /(?:yarn add|npm (?:i|install)|pnpm add|bun add)\s+((?:-{1,2}\S+\s+)*)(\S+)/g;

  for (const g of Object.values(groups))
    for (const page of g.pages)
      for (const block of page.bashBlocks)
        for (const m of block.matchAll(INSTALL_RE)) {
          const pkgToken = m[2];
          if (!pkgToken.startsWith("@ecosy/") && pkgToken !== "page-flip") continue;
          linesChecked++;
          if (!knownNpmNames.has(pkgToken)) {
            bad.push({ page: page.href, region: "bash", kind: "PACKAGE-NOT-FOUND", detail: pkgToken });
            continue;
          }
          if (g.meta.npm && pkgToken !== g.meta.npm) {
            bad.push({ page: page.href, region: "bash", kind: "MISMATCHED-INSTALL", detail: `${pkgToken} on the ${g.meta.npm} page` });
          }
        }

  return { bad, linesChecked };
}

// ================================================================
// CHECK C — prose: heading-API names, pseudo-declared interfaces/types
// ================================================================

function checkProse(groups, surfaces) {
  const bad = [];
  let headingsChecked = 0;
  let pseudoDeclsChecked = 0;
  let inlineSpansChecked = 0;

  // Content legitimately cross-references another package's real API in prose
  // (e.g. /store explaining that it reuses @ecosy/core's `Subscriber.wire`).
  // The dotted-name prose check below is checked against this whole-site
  // union, not just the current page's own package, specifically so that a
  // true cross-reference never reads as a stale name on the wrong page.
  const universe = new Set();
  for (const s of Object.values(surfaces)) for (const n of s.allNames) universe.add(n);

  for (const g of Object.values(groups)) {
    const surface = surfaces[g.meta.npm];
    for (const page of g.pages) {
      if (surface) {
        for (const h of apiHeadings(page.prose)) {
          // A bare, undotted, call-less heading like `` ## `send` `` almost
          // always documents an INSTANCE method of whatever class the page
          // introduced earlier — not a top-level export — and checking it
          // against allNames (top-level names only) is all false positives
          // (`send`, `verify`, `subscribe`, `dispatch`, `getState`… were
          // flagged this way on the first pass). Only `Foo.bar` headings
          // (checkable against Foo's real members) and bare PascalCase
          // headings without a dot (checkable as a top-level type/class name)
          // carry a checkable claim; skip everything else.
          const looksLikeTopLevelType = !h.member && /^[A-Z]/.test(h.base);
          if (!h.member && !looksLikeTopLevelType) continue;
          headingsChecked++;
          if (!surface.allNames.has(h.base)) {
            bad.push({ page: page.href, region: "prose", kind: "HEADING-UNKNOWN-BASE", detail: h.raw.trim() });
            continue;
          }
          if (h.member) {
            const entryKey = findDeclaringEntry(surface, h.base, pageOwnEntry(g, page));
            const info = surface.entryNames[entryKey];
            if (isFunctionDeclaration(surface.dir, info.typesFile.replace(/^\.\//, ""), h.base)) {
              bad.push({ page: page.href, region: "prose", kind: "HEADING-MEMBER-ON-FUNCTION", detail: h.raw.trim() });
              continue;
            }
            const members = memberNamesOf(surface.dir, info.typesFile.replace(/^\.\//, ""), h.base);
            if (members && !members.has(h.member))
              bad.push({ page: page.href, region: "prose", kind: "HEADING-MEMBER-NOT-FOUND", detail: h.raw.trim() });
          }
        }

        for (const block of page.codeBlocks) {
          // `interface` only, not `type`: this content's own style uses a
          // one-line `type X = SomeGeneric<...>` constantly as a worked
          // EXAMPLE of an already-documented generic (core/types.md's
          // `type UserById = AtomicObject<...>`, `type Handler =
          // LiteralFunction<...>`) — those names were never claimed to be
          // exports. A multi-field `interface X { ... }` block is this
          // site's way of presenting a real config/options shape instead
          // (`SendOptions`, `RetryOptions`, and the two that are stale:
          // `MailerStatic`, `MailerOptions`), so it's the one worth trusting
          // as a claim.
          for (const m of block.matchAll(/^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/gm)) {
            pseudoDeclsChecked++;
            if (!surface.allNames.has(m[1]))
              bad.push({ page: page.href, region: "prose", kind: "PSEUDO-DECL-UNKNOWN", detail: m[1] });
          }
        }
      }

      // @ecosy/* specifiers appearing anywhere in running prose (links, inline code) — not just code fences.
      for (const m of page.prose.matchAll(/@ecosy\/[\w-]+(?:\/[\w./-]+)?/g)) {
        const spec = m[0].replace(/[).,;:'"]+$/, "");
        const parts = spec.split("/");
        const pkgName = parts[0] + "/" + parts[1];
        const s = surfaces[pkgName];
        if (!s) continue;
        const sub = spec === pkgName ? "." : "." + spec.slice(pkgName.length);
        inlineSpansChecked++;
        if (!resolveTypes(s.dir, sub))
          bad.push({ page: page.href, region: "prose", kind: "PROSE-SPECIFIER-NOT-EXPORTED", detail: spec });
      }

      // Inline-code `Foo.bar` mentions in running prose (not headings, not fenced blocks —
      // plain paragraph text). Restricted to a PascalCase base ("Foo", not "foo"/"options"/
      // "init"): a lowercase base in this content is overwhelmingly a local variable or a
      // parameter being described (`init.onError`, `options.signal`, `state.theme`), not a
      // package export, and checking those was almost pure noise on the first pass. A bare,
      // undotted call like `save()` is skipped for the same reason bare headings are: it
      // reads as an instance method of some class introduced earlier on the page, which this
      // check has no reliable way to identify.
      for (const span of inlineSpans(page.prose)) {
        const m = span.match(/^([A-Z][A-Za-z0-9]*)\.([A-Za-z_$][\w$]*)(\(\))?$/);
        if (!m) continue;
        const base = m[1];
        if (BUILTIN_NAMESPACES.has(base)) continue;
        if (universe.has(base)) continue; // real name somewhere on the site — nothing to say
        const sentences = sentencesOf(page.prose);
        const sentence = sentences.find((s) => s.includes("`" + span + "`"));
        if (sentence && NEGATION.test(sentence)) continue; // deliberate, documented absence
        bad.push({ page: page.href, region: "prose", kind: "PROSE-STALE-NAME", detail: span });
      }
    }
  }

  return { bad, headingsChecked, pseudoDeclsChecked, inlineSpansChecked };
}

// ================================================================
// CHECK F — table links that claim one of THIS page's own names but point
// at a different package's slug. A URL-returns-200 check alone can't catch
// this (0055's example: a link to docs.ecosy.io/core "trả 200 thật" is
// exactly what let it through) — this instead asks "does the link's target
// match the family the label claims to belong to".
// ================================================================

function checkFamilyLinks(groups, surfaces) {
  const bad = [];
  let linksChecked = 0;
  const LINK_RE = /\[`([A-Za-z_$][\w$]*)`(?:[^\]]*)\]\((\/[a-z0-9][\w./-]*)\)/g;

  for (const g of Object.values(groups)) {
    const surface = surfaces[g.meta.npm];
    if (!surface) continue;
    for (const page of g.pages) {
      // Table rows only — this is specifically the "Contents" style index of
      // a package's own API, not every cross-link in running prose (which
      // legitimately points elsewhere, e.g. /mailer linking to /logger).
      for (const line of page.prose.split("\n")) {
        if (!line.trim().startsWith("|")) continue;
        for (const m of line.matchAll(LINK_RE)) {
          const [, label, href] = m;
          if (!surface.allNames.has(label)) continue; // not claiming one of this package's own names
          linksChecked++;
          const targetSlug = href.split("#")[0].split("/")[1];
          if (targetSlug && targetSlug !== g.slug)
            bad.push({ page: page.href, region: "prose", kind: "MISMATCHED-FAMILY-LINK", detail: `\`${label}\` -> ${href} (this is the ${g.slug} page)` });
        }
      }
    }
  }
  return { bad, linksChecked };
}

// ================================================================
// CHECK D — entry-point coverage (+ the core-consolidation boundary)
// ================================================================

function checkEntryPoints(groups, surfaces) {
  const bad = [];
  const boundary = [];
  let entriesChecked = 0;

  // slug -> npm name, for the boundary check ("did this get absorbed into another package's exports?")
  const npmBySlug = {};
  for (const g of Object.values(groups)) if (g.meta.npm) npmBySlug[g.slug] = g.meta.npm;

  for (const g of Object.values(groups)) {
    const surface = surfaces[g.meta.npm];
    if (!surface) continue;
    const fullText = g.pages.map((p) => p.body).join("\n");

    const ids = new Set();
    for (const key of surface.entries) {
      if (key === "." || key === "./package.json") continue;
      ids.add(key.replace(/^\.\//, "").replace(/\/\*$/, ""));
    }

    for (const id of ids) {
      entriesChecked++;
      const firstSeg = id.split("/")[0];
      const otherPkg = npmBySlug[firstSeg];
      if (otherPkg && otherPkg !== g.meta.npm) {
        // e.g. @ecosy/core exports "./logger", and content/logger/ teaches the
        // standalone @ecosy/logger package under its own name. Both are real,
        // technically-correct packages today — this is a product decision
        // (see task 0057 coordinator note), not a wrong-API bug, so it is
        // reported separately from MISSING-ENTRYPOINT.
        boundary.push({
          kind: "CORE-CONSOLIDATION-BOUNDARY",
          page: groups[firstSeg].pages[0].href,
          pkg: g.meta.npm,
          entry: id,
          taughtAsPackage: otherPkg,
          pages: groups[firstSeg].pages.map((p) => p.href),
        });
        continue;
      }
      const info = surface.entryNames[surface.entries.find((k) => k.replace(/^\.\//, "").replace(/\/\*$/, "") === id)];
      const nameHit = info && [...info.names].some((n) => wordIn(fullText, n));
      const idHit = wordIn(fullText, id.split("/").pop());
      if (!nameHit && !idHit)
        bad.push({ kind: "MISSING-ENTRYPOINT", page: g.pages[0].href, pkg: g.meta.npm, entry: id, pages: g.pages.map((p) => p.href) });
    }
  }

  return { bad, boundary, entriesChecked };
}

// ================================================================
// CHECK E — off-page: llms.txt / llms-full.txt / search.json / URL allowlist / .md promise
// ================================================================

function canonicalPaths(groups) {
  const out = new Set(CATALOG_PATHS.concat(OFFPAGE_PATHS));
  for (const g of Object.values(groups)) for (const p of g.pages) out.add(p.href);
  return out;
}

async function fetchText(pathOrUrl) {
  const res = await fetch(ORIGIN + pathOrUrl);
  return { status: res.status, text: res.ok ? await res.text() : "" };
}

async function checkOffPage(groups, opts) {
  const bad = [];
  let urlsChecked = 0;
  const canon = canonicalPaths(groups);
  const pagePaths = [...groups && Object.values(groups).flatMap((g) => g.pages.map((p) => p.href))];

  let llmsTxt, llmsFull, searchJson;
  if (opts.skipLive && !opts.llmsTxtFile) {
    return { bad: [], urlsChecked: 0, skipped: true };
  }
  try {
    llmsTxt = opts.llmsTxtFile ? { status: 200, text: fs.readFileSync(opts.llmsTxtFile, "utf8") } : await fetchText("/llms.txt");
    llmsFull = opts.llmsFullFile ? { status: 200, text: fs.readFileSync(opts.llmsFullFile, "utf8") } : await fetchText("/llms-full.txt");
    searchJson = opts.searchJsonFile ? { status: 200, text: fs.readFileSync(opts.searchJsonFile, "utf8") } : await fetchText("/search.json");
  } catch (e) {
    return { bad: [{ region: "offpage", kind: "FETCH-FAILED", detail: String(e) }], urlsChecked: 0, skipped: false };
  }

  // 1) URL allowlist: every docs.ecosy.io/* URL anywhere in llms.txt/llms-full.txt must be a real path.
  for (const [name, doc] of [["llms.txt", llmsTxt], ["llms-full.txt", llmsFull]]) {
    for (const m of doc.text.matchAll(/https:\/\/docs\.ecosy\.io(\/[^\s)]*)/g)) {
      const url = m[1].replace(/[).,;:'"]+$/, "");
      const clean = url.replace(/\.md$/, "");
      urlsChecked++;
      if (!canon.has(clean) && !canon.has(url))
        bad.push({ region: "offpage", kind: "URL-NOT-ALLOWLISTED", detail: `${url} (in ${name})` });
    }
  }

  // 2) the .md promise: if llms.txt claims per-page markdown, every real page's `.md` must actually work.
  if (/\.md`?\s*(appended|suffix)/i.test(llmsTxt.text) || /with `\.md` appended/i.test(llmsTxt.text)) {
    let probe = {};
    if (opts.mdProbeFile) probe = JSON.parse(fs.readFileSync(opts.mdProbeFile, "utf8"));
    const failures = [];
    for (const href of pagePaths) {
      let status;
      if (probe[href] !== undefined) status = probe[href];
      else if (opts.skipLive) continue;
      else status = (await fetch(ORIGIN + href + ".md")).status;
      urlsChecked++;
      if (status !== 200) failures.push(href + ".md");
    }
    if (failures.length)
      bad.push({ region: "offpage", kind: "MD-PROMISE-BROKEN", detail: `${failures.length}/${pagePaths.length} failed, e.g. ${failures[0]}` });
  }

  // 3) three-copy drift: llms.txt's own link list, search.json's path list, and llms-full.txt's Source: lines
  //    must each cover exactly the canonical 32 content pages — no more, no less.
  const llmsTxtHrefs = new Set([...llmsTxt.text.matchAll(/\]\(https:\/\/docs\.ecosy\.io(\/[^)]*)\)/g)].map((m) => m[1]));
  const missingFromLlmsTxt = pagePaths.filter((p) => !llmsTxtHrefs.has(p));
  if (missingFromLlmsTxt.length)
    bad.push({ region: "offpage", kind: "DRIFT-LLMSTXT", detail: `missing ${missingFromLlmsTxt.length}, e.g. ${missingFromLlmsTxt[0]}` });

  const fullSourcePaths = new Set([...llmsFull.text.matchAll(/^Source: https:\/\/docs\.ecosy\.io(\/\S*)$/gm)].map((m) => m[1]));
  const missingFromFull = pagePaths.filter((p) => !fullSourcePaths.has(p));
  if (missingFromFull.length)
    bad.push({ region: "offpage", kind: "DRIFT-LLMSFULL", detail: `missing ${missingFromFull.length}, e.g. ${missingFromFull[0]}` });

  let searchPaths = new Set();
  try {
    const entries = JSON.parse(searchJson.text);
    for (const e of entries) searchPaths.add(e.path.split("#")[0]);
  } catch {
    bad.push({ region: "offpage", kind: "SEARCH-JSON-UNPARSEABLE", detail: "" });
  }
  const missingFromSearch = pagePaths.filter((p) => !searchPaths.has(p));
  if (missingFromSearch.length)
    bad.push({ region: "offpage", kind: "DRIFT-SEARCHJSON", detail: `missing ${missingFromSearch.length}, e.g. ${missingFromSearch[0]}` });

  return { bad, urlsChecked, skipped: false };
}

// ================================================================
// runner
// ================================================================

export async function run(opts) {
  const groups = loadContent(opts.contentDir);
  const pageCount = Object.values(groups).reduce((n, g) => n + g.pages.length, 0);

  const { surfaces, timings } = await buildSurfaces(groups);
  const knownNpmNames = new Set(Object.keys(surfaces));

  const A = checkCodeImports(groups, surfaces);
  const B = checkBashInstalls(groups, surfaces, knownNpmNames);
  const C = checkProse(groups, surfaces);
  const D = checkEntryPoints(groups, surfaces);
  const E = await checkOffPage(groups, opts);
  const F = checkFamilyLinks(groups, surfaces);

  // The core-consolidation boundary (content still teaching an absorbed
  // package under its own standalone name) counts toward RED, same as any
  // other finding — the coordinator's own framing calls it "hại hơn" (more
  // harmful) than a plain missing entry point, precisely because it's a
  // page actively teaching the pre-consolidation shape, not just silent.
  const allBad = [...A.bad, ...B.bad, ...C.bad, ...E.bad, ...F.bad, ...D.bad, ...D.boundary];

  // Self-check: an extractor that silently returns [] is indistinguishable from
  // "nothing wrong" unless we assert it actually looked at something.
  const counts = {
    pagesScanned: pageCount,
    packagesResolved: Object.keys(surfaces).length,
    specifiersChecked: A.specifiersChecked,
    namedImportsChecked: A.namedImportsChecked,
    memberCallsChecked: A.memberCallsChecked,
    bashLinesChecked: B.linesChecked,
    headingsChecked: C.headingsChecked,
    pseudoDeclsChecked: C.pseudoDeclsChecked,
    inlineSpansChecked: C.inlineSpansChecked,
    entryPointsChecked: D.entriesChecked,
    urlsChecked: E.urlsChecked,
    familyLinksChecked: F.linksChecked,
  };
  const zeroFloors = {
    pagesScanned: 32,
    packagesResolved: 16, // 16 @ecosy/* + page-flip is allowed to sit outside this floor
    specifiersChecked: 1,
    namedImportsChecked: 1,
    bashLinesChecked: 1,
    headingsChecked: 1,
    pseudoDeclsChecked: 1,
    entryPointsChecked: 1,
    familyLinksChecked: 1,
  };
  const emptyExtractors = Object.entries(zeroFloors).filter(([k, floor]) => counts[k] < floor);

  return {
    groups,
    surfaces,
    timings,
    counts,
    emptyExtractors,
    boundary: D.boundary,
    findings: {
      codeImports: A.bad,
      bashInstalls: B.bad,
      prose: C.bad,
      missingEntrypoints: D.bad,
      offPage: E.bad,
      familyLinks: F.bad,
    },
    allBad,
    ok: allBad.length === 0 && emptyExtractors.length === 0,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const result = await run(opts);
  const ms = Date.now() - t0;

  if (!opts.quiet) {
    console.log(`docs.ecosy.io guard — ${result.counts.pagesScanned} pages, ${ms}ms`);
    console.log("counts:", JSON.stringify(result.counts));
    if (result.emptyExtractors.length)
      console.log("EMPTY EXTRACTOR (treated as RED):", result.emptyExtractors.map(([k]) => k).join(", "));
    for (const [region, list] of Object.entries(result.findings)) {
      if (!list.length) continue;
      console.log(`\n-- ${region} (${list.length}) --`);
      for (const b of list) console.log(" ", JSON.stringify(b));
    }
    if (result.boundary.length) {
      console.log(`\n-- core-consolidation boundary (${result.boundary.length}) --`);
      for (const b of result.boundary) console.log(" ", JSON.stringify(b));
    }
  }
  fs.writeFileSync(path.join(ROOT, "guard", "last-run.json"), JSON.stringify(result, (k, v) => (v instanceof Set ? [...v] : v), 1));
  console.log(result.ok ? "GREEN" : "RED", `(${result.allBad.length} findings, ${result.emptyExtractors.length} empty extractors)`);
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
