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
 * four required regions (code / prose / bash / off-page) it covers.
 *
 * The zero-count self-check (`zeroFloors` in run()) covers code, prose and
 * bash, plus the off-page URL count SPECIFICALLY WHEN off-page wasn't
 * skipped. It deliberately does NOT claim to cover everything an extractor
 * could go blind on: memberNamesOf() (the Foo.bar()/heading-member check)
 * legitimately returns "unknown" for shapes a text scan can't read, and that
 * rate is reported (`memberLookupCalls`/`memberLookupUnknown` in `counts`),
 * not gated — a Reviewer measured 59% unknown before three real bugs in
 * memberNamesOf() itself were fixed (see guard/lib/dts.mjs), and confirmed
 * that number alone changes neither findings nor exit code either way. An
 * off-page run that was skipped or only partially probed is a SEPARATE
 * failure mode from an empty extractor — see `unverifiedRegions` below and
 * `--skip-live-ok`.
 *
 * Usage:
 *   node guard/check.mjs                  # full run against content/, live off-page checks
 *   node guard/check.mjs --content-dir X  # run against a different content tree (mutation testing)
 *   node guard/check.mjs --dist-dir X     # check a different dist/client (default: <root>/dist/client)
 *                                         # — runs UNCONDITIONALLY; a missing dir is DIST-MISSING, not skipped
 *   node guard/check.mjs --skip-live      # skip off-page entirely — reports RED (unverified), not green
 *   node guard/check.mjs --skip-live --skip-live-ok
 *                                         # same, but acknowledged: off-page's absence won't force RED
 *   node guard/check.mjs --llms-txt FILE --llms-full FILE --search-json FILE --md-probe FILE
 *                                         # feed off-page checks from local fixtures instead of the network
 *   node guard/check.mjs --quiet          # summary line + exit code only
 */

import fs from "node:fs";
import path from "node:path";
import {
  loadContent,
  apiHeadings,
  inlineSpans,
  longestProseLine,
  markdownInlineToPlain,
  stripTags,
  hrefToHtmlPath,
  hrefToMdPath,
} from "./lib/content.mjs";
import {
  resolveTypes,
  namesOf,
  codeEntries,
  memberNamesOf,
  isFunctionDeclaration,
  memberLookupStats,
  resetMemberLookupStats,
  matchExportKey,
  declShapesOf,
  compareSurfaces,
} from "./lib/dts.mjs";
import { resolvePackage } from "./lib/registry.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const DEFAULT_CONTENT_DIR = path.join(ROOT, "content");
const DEFAULT_DIST_DIR = path.join(ROOT, "dist", "client");
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
  const a = { contentDir: DEFAULT_CONTENT_DIR, distDir: DEFAULT_DIST_DIR, skipLive: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--content-dir") a.contentDir = path.resolve(argv[++i]);
    else if (arg === "--dist-dir") a.distDir = path.resolve(argv[++i]);
    else if (arg === "--skip-live") a.skipLive = true;
    else if (arg === "--skip-live-ok") a.skipLiveOk = true; // explicit "I know off-page wasn't verified this run"
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

/**
 * The module specifiers a set of pages actually CITE — not words that happen
 * to look like one.
 *
 * Three sources, all of them places a writer had to name a subpath on
 * purpose:
 *   - a real specifier position in a fenced block: `from "…"`, `import("…")`,
 *     `require("…")`;
 *   - an `@scope/pkg/sub` inside an inline code span in running prose, which
 *     is this site's convention for citing one without a code block;
 *   - the hand-written frontmatter `import:` / `name:`, which is independent
 *     of the body entirely (the same field pageOwnEntry() already trusts).
 *
 * English cannot produce any of these by accident, which is the entire point:
 * `"a batch of entries can be lost"` is a sentence about log buffering and
 * `@ecosy/core/batch` is a debounce module, and the old coverage test could
 * not tell them apart.
 */
function citedSpecifiers(pages) {
  const out = new Set();
  for (const page of pages) {
    for (const block of page.codeBlocks.concat(page.bashBlocks))
      for (const m of block.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)) out.add(m[1]);
    for (const span of inlineSpans(page.prose)) {
      const t = span.trim();
      if (/^@[\w-]+\/[\w-]+(?:\/[\w.-]+)*$/.test(t)) out.add(t);
    }
    if (page.data.import) out.add(page.data.import);
    if (page.data.name) out.add(page.data.name);
  }
  return out;
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
          if (members !== null && !members.has(member)) {
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
  // Only the command itself, NOT the package list: `yarn add a b c` installs
  // THREE packages on one line, and a regex that captures a single `(\S+)`
  // after it only ever sees the first. That was a real, reviewer-proven hole:
  // `yarn add @ecosy/hoapp @ecosy/nextjs hono` survived because only
  // `@ecosy/hoapp` (token one) was ever checked — the exact shape of the
  // 0055 bug (`yarn add @ecosy/nextjs`), just one token later.
  const INSTALL_CMD_RE = /(?:yarn add|npm (?:i|install)|pnpm add|bun add)\s+(.+)/g;

  for (const g of Object.values(groups))
    for (const page of g.pages)
      for (const block of page.bashBlocks)
        for (const m of block.matchAll(INSTALL_CMD_RE)) {
          const rest = m[1].split(/\s+#/)[0]; // drop a trailing shell comment, if any
          for (const token of rest.split(/\s+/)) {
            if (!token || token.startsWith("-")) continue; // flag, not a package (-D, --save-dev, …)
            const pkgToken = token.replace(/^(@[^/]+\/[^@\s]+|[^@\s]+)@.*$/, "$1"); // strip a version pin, keep scope intact
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
  let dottedProseChecked = 0;

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
            if (members !== null && !members.has(h.member))
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
      //
      // This checks the MEMBER, not just the base's existence somewhere on the
      // site. An earlier version stopped at "is `Foo` real anywhere" (renamed
      // from PROSE-STALE-NAME, which promised more than that one line did) —
      // reviewer-proven survivor: it could not catch a WRONG member on a REAL
      // base, which is the actual shape a name goes stale in (heading-based
      // checking already covers this for headings; running prose had nothing).
      for (const span of inlineSpans(page.prose)) {
        const m = span.match(/^([A-Z][A-Za-z0-9]*)\.([A-Za-z_$][\w$]*)(\(\))?$/);
        if (!m) continue;
        const [, base, member] = m;
        if (BUILTIN_NAMESPACES.has(base)) continue;
        dottedProseChecked++;

        const negatedHere = () => {
          const sentence = sentencesOf(page.prose).find((s) => s.includes("`" + span + "`"));
          return sentence && NEGATION.test(sentence);
        };

        // Prefer this page's own package for an owner (matches its
        // frontmatter/heading conventions); fall back to whichever OTHER
        // package on the site actually declares `base`, since prose
        // legitimately cross-references another package's real class
        // (e.g. /store citing @ecosy/core's `Subscriber`).
        const ownerName = surface && surface.allNames.has(base) ? g.meta.npm : Object.keys(surfaces).find((n) => surfaces[n].allNames.has(base));
        if (!ownerName) {
          if (negatedHere()) continue;
          bad.push({ page: page.href, region: "prose", kind: "PROSE-UNKNOWN-BASE", detail: span });
          continue;
        }
        const ownerSurface = surfaces[ownerName];
        const entryKey = findDeclaringEntry(ownerSurface, base, ownerName === g.meta.npm ? pageOwnEntry(g, page) : undefined);
        const info = ownerSurface.entryNames[entryKey];
        if (isFunctionDeclaration(ownerSurface.dir, info.typesFile.replace(/^\.\//, ""), base)) {
          if (negatedHere()) continue;
          bad.push({ page: page.href, region: "prose", kind: "PROSE-MEMBER-ON-FUNCTION", detail: span });
          continue;
        }
        const members = memberNamesOf(ownerSurface.dir, info.typesFile.replace(/^\.\//, ""), base);
        if (members !== null && !members.has(member)) {
          if (negatedHere()) continue;
          bad.push({ page: page.href, region: "prose", kind: "PROSE-MEMBER-NOT-FOUND", detail: span });
        }
      }
    }
  }

  return { bad, headingsChecked, pseudoDeclsChecked, inlineSpansChecked, dottedProseChecked };
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
      // Table rows AND bullet-list items — this is specifically the
      // "Contents" style index of a package's own API (which this site
      // writes as either), not every cross-link in running prose (which
      // legitimately points elsewhere, e.g. /mailer linking to /logger).
      // Reviewer proof this needed broadening: the identical mismatch in a
      // bullet line survived when only `|` rows were checked.
      for (const line of page.prose.split("\n")) {
        if (!/^\s*(\||[-*]\s)/.test(line)) continue;
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

/**
 * Every exported name of a package WITH its shape, merged across entry
 * points. Read lazily and memoised per surface object: only the handful of
 * entry points that have a slug-collision candidate ever need it, and paying
 * declShapesOf() for all sixteen packages up front would roughly double the
 * guard's local work for nothing.
 *
 * The cache is kept outside the surface object on purpose — the surfaces are
 * serialised into guard/last-run.json, and a Map stringifies to `{}`, so
 * hanging it off the surface would write a permanent, meaningless field into
 * the artifact people read.
 */
const shapeCache = new WeakMap();

function surfaceShapes(surface) {
  const hit = shapeCache.get(surface);
  if (hit) return hit;
  const merged = new Map();
  for (const info of Object.values(surface.entryNames)) {
    if (!info.typesFile) continue;
    for (const [n, s] of declShapesOf(surface.dir, info.typesFile.replace(/^\.\//, ""))) if (!merged.has(n)) merged.set(n, s);
  }
  shapeCache.set(surface, merged);
  return merged;
}

function checkEntryPoints(groups, surfaces) {
  const bad = [];
  const boundary = [];
  let entriesChecked = 0;
  let citationsResolved = 0;

  // slug -> npm name, for the boundary check ("did this get absorbed into another package's exports?")
  const npmBySlug = {};
  for (const g of Object.values(groups)) if (g.meta.npm) npmBySlug[g.slug] = g.meta.npm;

  // One npm package can now be taught across SEVERAL content groups — the
  // core-consolidation move (B2b, 2026-09-19) put `@ecosy/core`'s `logger`
  // and `schedule` entries under their own top-level /logger and /schedule
  // groups rather than folding them into content/core/. The old version of
  // this function judged coverage per GROUP (`surfaces[g.meta.npm]` inside a
  // per-group loop), which silently assumed one npm name = one group; once
  // that broke, every entry the "core" group itself doesn't mention (crypt,
  // queue, cache, …) got re-flagged as missing AGAIN from the "logger" and
  // "schedule" groups' own narrow text — 20 brand-new false MISSING-ENTRYPOINT
  // findings for entries that were never in either page's job to cover.
  // Coverage has to be judged across every group that shares the package's
  // npm name, not one group alone. (B2b pooled those groups' page TEXT;
  // since 0062 it pools the specifiers they CITE — see the coverage test
  // below for why the text version could not be made correct.)
  const groupsByNpm = {};
  for (const g of Object.values(groups)) {
    if (!g.meta.npm) continue;
    (groupsByNpm[g.meta.npm] ??= []).push(g);
  }

  for (const [npm, npmGroups] of Object.entries(groupsByNpm)) {
    const surface = surfaces[npm];
    if (!surface) continue;
    // Which entry points this package's pages actually cite, resolved through
    // the package's OWN exports map: `@ecosy/markdoc/plugins/layout` lands on
    // the `./plugins/*` key, so a wildcard family is covered by any concrete
    // member of it, and a subpath nobody imports is covered by nothing.
    const cited = citedSpecifiers(npmGroups.flatMap((g) => g.pages));
    const coveredIds = new Set();
    for (const spec of cited) {
      if (spec !== npm && !spec.startsWith(npm + "/")) continue;
      const sub = spec === npm ? "." : "." + spec.slice(npm.length);
      const key = matchExportKey(surface.dir, sub);
      if (!key) continue; // cites a subpath this package doesn't export — CHECK A and CHECK C report that separately
      citationsResolved++;
      coveredIds.add(key.replace(/^\.\//, "").replace(/\/\*$/, ""));
    }
    // Anchor page for reporting: the group whose own slug matches the
    // package's bare name (core, http, …) when one exists, else whichever
    // group was seen first — purely cosmetic, does not affect the check.
    const bareName = npm.replace(/^@[^/]+\//, "");
    const anchorGroup = npmGroups.find((g) => g.slug === bareName) || npmGroups[0];
    const allPages = npmGroups.flatMap((g) => g.pages.map((p) => p.href));

    const ids = new Set();
    for (const key of surface.entries) {
      if (key === "." || key === "./package.json") continue;
      ids.add(key.replace(/^\.\//, "").replace(/\/\*$/, ""));
    }

    for (const id of ids) {
      entriesChecked++;
      const info = surface.entryNames[surface.entries.find((k) => k.replace(/^\.\//, "").replace(/\/\*$/, "") === id)];

      // Candidate boundary: a content slug matching the entry's first path
      // segment, with its OWN standalone npm package. This alone is a string
      // coincidence, not a measurement — `@ecosy/styled`'s `./react` entry
      // shares a slug with `@ecosy/react`'s docs page, but the two share ZERO
      // names (an unrelated React integration, not the same functionality
      // moved). Only an actual surface-name intersection with the OTHER
      // package's own exports says "this is really the same API, taught
      // twice". Once `/logger` and `/schedule` themselves declare
      // `npm: "@ecosy/core"`, `otherPkg` for their own slugs equals `npm`
      // (the package being checked) — no longer "another" package — so this
      // no longer fires for them; it still fires for a genuine cross-package
      // coincidence like `@ecosy/styled`'s `./react` vs `@ecosy/react`'s page.
      const firstSeg = id.split("/")[0];
      const otherPkg = npmBySlug[firstSeg];
      const otherSurface = otherPkg && otherPkg !== npm ? surfaces[otherPkg] : null;

      // Overlap is scored by SHAPE, not by intersecting name strings. A name
      // set intersection is wrong in both directions at once, and the
      // `@ecosy/schedule` -> `@ecosy/core/schedule` move proved both on the
      // same day: `Hook` -> `HookPort` and `Source` -> `SourceClass` were
      // real renames the intersection could not see (so it reported 38/52,
      // "divergent", when core was a superset), while the strings `Hook` and
      // `Source` did still exist on both sides carrying UNRELATED meanings
      // (so part of that 38 was counted for nothing). compareSurfaces()
      // separates the four cases and only `same + renamed` is evidence.
      const cmp =
        otherSurface && info && info.typesFile
          ? compareSurfaces(declShapesOf(surface.dir, info.typesFile.replace(/^\.\//, "")), surfaceShapes(otherSurface))
          : null;
      const matched = cmp ? cmp.same.length + cmp.renamed.length : 0;

      if (otherSurface && matched > 0) {
        boundary.push({
          kind: "ENTRYPOINT-OVERLAPS-PACKAGE",
          page: groups[firstSeg].pages[0].href,
          pkg: npm,
          entry: id,
          taughtAsPackage: otherPkg,
          overlap: matched,
          sameName: cmp.same.length,
          renamed: cmp.renamed, // the actual `X->XPort` pairs, so a rename is named, not just counted
          collided: cmp.collided, // same name, different meaning — reported, never counted as overlap
          unknownShape: cmp.unknown.length,
          entrySurface: info.names.size,
          otherSurface: otherSurface.allNames.size,
          pages: groups[firstSeg].pages.map((p) => p.href),
        });
        continue; // measured overlap — this id IS documented, just under the other package's page
      }
      // No overlap (or no candidate at all): an ordinary entry point, judged
      // on its own merits — falls through to the same missing-or-not check
      // every other entry gets. A candidate that failed the overlap test
      // must NOT `continue` here, or it silently escapes MISSING-ENTRYPOINT
      // by virtue of sharing a slug with an unrelated package.
      // Coverage is a RESOLUTION, not a string search. The old test was
      // `wordIn(fullText, <last path segment>) || wordIn(fullText, <any
      // export name>)` over every pooled page body — so the English sentence
      // "a batch of entries can be lost" (about log buffering) marked
      // `@ecosy/core/batch` (a debounce module) documented, and the cron
      // handler key `"session.cleanup"` in a worked example marked
      // `@ecosy/core/session` (cookie sessions) documented. Two modules with
      // no documentation at all read as covered, which is the guard lying in
      // the dangerous direction.
      //
      // Measured on this commit's content before choosing this shape: the
      // specifier test clears 45 of the 53 entry points with ZERO entries
      // that lose coverage for being written another way, and the three the
      // word search wrongly cleared go red. The weaker shapes were measured
      // and rejected, not assumed — "appears in a code block" still clears
      // `session` (content/schedule/index.md:231 is a ```ts block containing
      // `Registry("session.cleanup", …)`), and "appears in a heading" still
      // clears `@ecosy/markdoc/imports` (`## \`imports\`` on
      // content/markdoc/index.md:317 documents an options FIELD called
      // `imports`, not the subpath).
      //
      // The export-name half is gone rather than kept as a fallback: no entry
      // point on this commit is cleared by a name hit that the specifier test
      // does not already clear, so it bought nothing and carried the same
      // coincidence risk one level deeper.
      if (!coveredIds.has(id))
        bad.push({ kind: "MISSING-ENTRYPOINT", page: anchorGroup.pages[0].href, pkg: npm, entry: id, pages: allPages });
    }
  }

  return { bad, boundary, entriesChecked, citationsResolved };
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

/**
 * llms-full.txt is `# heading`, blank, `Source: <url>`, blank, body, blank,
 * repeated per page. Extract path -> body by index, not by splitting on a
 * heading pattern: a page's OWN body legitimately opens with `# Name` (every
 * content/*.md does), so a naive "stop at the next `# `" would truncate a
 * body down to nothing the moment it starts with its own title. Anchoring
 * the strip to the END of each slice (the heading that belongs to the NEXT
 * section) avoids that.
 */
function extractLlmsFullBodies(text) {
  const marks = [...text.matchAll(/^Source: https:\/\/docs\.ecosy\.io(\/\S*)$/gm)].map((m) => ({
    path: m[1],
    end: m.index + m[0].length,
  }));
  const out = new Map();
  for (let i = 0; i < marks.length; i++) {
    const sliceEnd = i + 1 < marks.length ? findNextHeadingStart(text, marks[i].end, marks[i + 1].end) : text.length;
    out.set(marks[i].path, text.slice(marks[i].end, sliceEnd).trim());
  }
  return out;
}

/** Position of the last blank-line-separated `# ` heading line before the next Source marker — i.e. where THIS body ends. */
function findNextHeadingStart(text, from, nextSourceEnd) {
  const nextSourceLineStart = text.lastIndexOf("\nSource: ", nextSourceEnd);
  const headingMatch = /\n(#[^\n]*)\n+$/.exec(text.slice(from, nextSourceLineStart));
  return headingMatch ? from + headingMatch.index : nextSourceLineStart;
}

async function checkOffPage(groups, opts) {
  const bad = [];
  let urlsChecked = 0;
  const canon = canonicalPaths(groups);
  const pagePaths = Object.values(groups).flatMap((g) => g.pages.map((p) => p.href));
  const localBodyByPath = new Map();
  for (const g of Object.values(groups)) for (const p of g.pages) localBodyByPath.set(p.href, p.body.trim());

  // `skipped` and `verified` are both consumed by run(): a run that never
  // looked at the live/fixture off-page copies at all (skipped) must not
  // report GREEN, and neither should one where the .md-promise probe only
  // partially ran (verified: false) — see run()'s handling of `--skip-live`.
  if (opts.skipLive && !opts.llmsTxtFile) {
    return { bad: [], urlsChecked: 0, skipped: true, verified: false };
  }
  let llmsTxt, llmsFull, searchJson;
  try {
    llmsTxt = opts.llmsTxtFile ? { status: 200, text: fs.readFileSync(opts.llmsTxtFile, "utf8") } : await fetchText("/llms.txt");
    llmsFull = opts.llmsFullFile ? { status: 200, text: fs.readFileSync(opts.llmsFullFile, "utf8") } : await fetchText("/llms-full.txt");
    searchJson = opts.searchJsonFile ? { status: 200, text: fs.readFileSync(opts.searchJsonFile, "utf8") } : await fetchText("/search.json");
  } catch (e) {
    return { bad: [{ region: "offpage", kind: "FETCH-FAILED", detail: String(e) }], urlsChecked: 0, skipped: false, verified: false };
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

  // 2) the .md promise, probed on all 32 real paths UNCONDITIONALLY. The
  // previous version only ran this when llms.txt's WORDING matched a regex
  // ("appended"/"suffix") — a guard must not read its own pass/fail
  // criterion from the very file it grades. Reviewer proof: rewording the
  // promise sentence (still true, still promising `.md`, exactly the edit
  // B2 is scoped to make at lib/content.mjs:285) made `urlsChecked` drop
  // 98→66, the finding vanish, and the run print "0 empty extractors" —
  // green, on a site still serving every `.md` as a 404.
  let probe = {};
  if (opts.mdProbeFile) probe = JSON.parse(fs.readFileSync(opts.mdProbeFile, "utf8"));
  const failures = [];
  let mdProbeSkipped = 0;
  for (const href of pagePaths) {
    let status;
    if (probe[href] !== undefined) status = probe[href];
    else if (opts.skipLive) {
      mdProbeSkipped++;
      continue;
    } else status = (await fetch(ORIGIN + href + ".md")).status;
    urlsChecked++;
    if (status !== 200) failures.push(href + ".md");
  }
  if (failures.length)
    bad.push({ region: "offpage", kind: "MD-PROMISE-BROKEN", detail: `${failures.length}/${pagePaths.length} failed, e.g. ${failures[0]}` });

  // 3) three-copy PATH-LIST drift — renamed *-PATHLIST because that's the
  // limit of what this compares: whether each copy lists the same 32 paths,
  // BOTH missing (content/ has a page a copy doesn't list) and phantom (a
  // copy lists a page content/ doesn't have — search.json growing a page
  // nobody wrote is exactly as silent a drift as one going missing). Body
  // TEXT drift is (4), below — a separate, more expensive comparison.
  const llmsTxtHrefs = new Set([...llmsTxt.text.matchAll(/\]\(https:\/\/docs\.ecosy\.io(\/[^)]*)\)/g)].map((m) => m[1]));
  const missingFromLlmsTxt = pagePaths.filter((p) => !llmsTxtHrefs.has(p));
  const phantomInLlmsTxt = [...llmsTxtHrefs].filter((p) => !canon.has(p));
  if (missingFromLlmsTxt.length)
    bad.push({ region: "offpage", kind: "DRIFT-LLMSTXT-PATHLIST", detail: `missing ${missingFromLlmsTxt.length}, e.g. ${missingFromLlmsTxt[0]}` });
  if (phantomInLlmsTxt.length)
    bad.push({ region: "offpage", kind: "DRIFT-LLMSTXT-PATHLIST", detail: `phantom ${phantomInLlmsTxt.length}, e.g. ${phantomInLlmsTxt[0]}` });

  const fullSourcePaths = new Set([...llmsFull.text.matchAll(/^Source: https:\/\/docs\.ecosy\.io(\/\S*)$/gm)].map((m) => m[1]));
  const missingFromFull = pagePaths.filter((p) => !fullSourcePaths.has(p));
  const phantomInFull = [...fullSourcePaths].filter((p) => !canon.has(p));
  if (missingFromFull.length)
    bad.push({ region: "offpage", kind: "DRIFT-LLMSFULL-PATHLIST", detail: `missing ${missingFromFull.length}, e.g. ${missingFromFull[0]}` });
  if (phantomInFull.length)
    bad.push({ region: "offpage", kind: "DRIFT-LLMSFULL-PATHLIST", detail: `phantom ${phantomInFull.length}, e.g. ${phantomInFull[0]}` });

  let searchPaths = new Set();
  try {
    const entries = JSON.parse(searchJson.text);
    for (const e of entries) searchPaths.add(e.path.split("#")[0]);
  } catch {
    bad.push({ region: "offpage", kind: "SEARCH-JSON-UNPARSEABLE", detail: "" });
  }
  const missingFromSearch = pagePaths.filter((p) => !searchPaths.has(p));
  const phantomInSearch = [...searchPaths].filter((p) => !canon.has(p));
  if (missingFromSearch.length)
    bad.push({ region: "offpage", kind: "DRIFT-SEARCHJSON-PATHLIST", detail: `missing ${missingFromSearch.length}, e.g. ${missingFromSearch[0]}` });
  if (phantomInSearch.length)
    bad.push({ region: "offpage", kind: "DRIFT-SEARCHJSON-PATHLIST", detail: `phantom ${phantomInSearch.length}, e.g. ${phantomInSearch[0]}` });

  // 4) BODY drift: llms-full.txt's per-page TEXT against the actual local
  // content/*.md body for that page. (3) only asks "is this page listed" and
  // stays green if content/ is edited without a redeploy — the live copy
  // still lists every path, just with stale text underneath, which is
  // exactly what the agent audience of llms-full.txt would read. Comparing
  // against LOCAL content/ (not a second live fetch of the HTML) is
  // deliberate: it's what "content/ says right now" actually means, and it's
  // the only side of this comparison a pre-deploy CI run could ever see.
  const liveBodyByPath = extractLlmsFullBodies(llmsFull.text);
  const bodyDrift = [];
  for (const href of pagePaths) {
    const live = liveBodyByPath.get(href);
    if (live === undefined) continue; // already reported as missingFromFull above
    if (live !== localBodyByPath.get(href)) bodyDrift.push(href);
  }
  if (bodyDrift.length)
    bad.push({
      region: "offpage",
      kind: "DRIFT-LLMSFULL-BODY",
      detail: `${bodyDrift.length} page(s) where live llms-full.txt text != content/, e.g. ${bodyDrift[0]}`,
    });

  return { bad, urlsChecked, skipped: false, verified: mdProbeSkipped === 0 };
}

// ================================================================
// CHECK G — dist/client: is the thing about to SHIP actually complete?
//
// Task 0063: docs.ecosy.io moved from "sinh một Worker" to "sinh một thư
// mục HTML tĩnh", and a static-export build can drop a page with NO signal
// anywhere else a guard already looks — `vinext build` exits 0, prints
// nothing, and the page is just... not there. Every check above this one
// reads content/ and a package's .d.ts; none of them ever opens dist/. This
// region is the only one that does, and it is why it must run
// UNCONDITIONALLY (house rule: "vắng cổng = ĐỎ, không phải bỏ qua") — a
// missing or wrong --dist-dir is exactly the failure mode this exists to
// catch, not a reason to skip.
//
// Deliberately does NOT read dist/server/vinext-prerender.json for its
// counts — that file is vinext's own report about itself (house rule: "một
// bộ canh không được đọc kỳ vọng từ chính thứ nó canh"). Every count here
// comes from independently statting/reading files on disk and comparing
// against content/ + the hand-written CATALOG_PATHS, the same two sources
// of truth every other check in this file already uses.
// ================================================================

async function checkDist(groups, distDir, opts) {
  const bad = [];
  const counts = { htmlGenerated: 0, mdGenerated: 0, identityFragmentsChecked: 0 };

  if (!fs.existsSync(distDir)) {
    bad.push({ region: "dist", kind: "DIST-MISSING", detail: distDir });
    return { bad, counts };
  }

  const pages = Object.values(groups).flatMap((g) => g.pages);
  const allHtmlHrefs = pages.map((p) => p.href).concat(CATALOG_PATHS);

  // ---- G1 PAGE-NOT-GENERATED: every content page + the four catalog pages
  // + 404.html must exist on disk and be non-empty. A build that silently
  // dropped a route (skipped/dynamic, a generateStaticParams() regression,
  // …) leaves exactly one hole here — this is the positive assertion that
  // catches it, backed by the zeroFloors expression in run() as a second,
  // independent trip-wire on the same count. ----
  for (const href of allHtmlHrefs) {
    const file = path.join(distDir, hrefToHtmlPath(href));
    let size = -1;
    try {
      size = fs.statSync(file).size;
    } catch {}
    if (size > 0) counts.htmlGenerated++;
    else bad.push({ region: "dist", kind: "PAGE-NOT-GENERATED", page: href, detail: file });
  }
  {
    const file404 = path.join(distDir, "404.html");
    let size = -1;
    try {
      size = fs.statSync(file404).size;
    } catch {}
    if (size > 0) counts.htmlGenerated++;
    else bad.push({ region: "dist", kind: "PAGE-NOT-GENERATED", page: "/404", detail: file404 });
  }

  // ---- G2 MD-NOT-GENERATED: every content page's raw-markdown copy, in the
  // exact shape scripts/emit-markdown.mjs promises ("Source: <origin><href>"
  // then the body with frontmatter stripped) — task 0063 mục 6.2 draws the
  // line here rather than at "the live site serves it with the right
  // Content-Type", which needs a real host and is out of this task's reach.
  // mdGenerated only ever counts a page once it PASSES, so it is bounded
  // above by pages.length by construction — the "bằng, không phải >=" the
  // task asks for falls out of the shape of this loop rather than needing a
  // separate equality assertion. ----
  for (const page of pages) {
    const file = path.join(distDir, hrefToMdPath(page.href));
    let text = null;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {}
    if (text === null) {
      bad.push({ region: "dist", kind: "MD-NOT-GENERATED", page: page.href, detail: "file missing" });
      continue;
    }
    const expectedSource = `Source: ${ORIGIN}${page.href}`;
    if (!text.startsWith(expectedSource) || !text.includes(page.body.trim())) {
      bad.push({ region: "dist", kind: "MD-NOT-GENERATED", page: page.href, detail: "content does not match content/" });
      continue;
    }
    counts.mdGenerated++;
  }

  // ---- G3 off-page, sourced from dist/ instead of the network: reuses the
  // EXACT same comparison checkOffPage() already runs for the live site
  // (URL allowlist + the three *-PATHLIST drift checks + the BODY drift
  // check), fed from files instead of a fetch. This is what catches vinext
  // skipping the three route.ts handlers (task 0063 mục 3.1 món 1) — the
  // build exits 0 and prints nothing, so an unconditional check reading
  // dist/ directly is the only thing that goes red for it. Three missing
  // files is reported directly rather than handed to checkOffPage(), whose
  // own FETCH-FAILED path is written for a network exception, not a clear
  // "which of the three is missing" report. ----
  const offPageFiles = {
    llmsTxtFile: path.join(distDir, "llms.txt"),
    llmsFullFile: path.join(distDir, "llms-full.txt"),
    searchJsonFile: path.join(distDir, "search.json"),
  };
  const missingOffPage = Object.entries(offPageFiles).filter(([, f]) => !fs.existsSync(f));
  if (missingOffPage.length) {
    for (const [, f] of missingOffPage) bad.push({ region: "dist", kind: "DIST-OFFPAGE-MISSING", detail: f });
  } else {
    const offPage = await checkOffPage(groups, { skipLive: true, ...offPageFiles });
    for (const b of offPage.bad) bad.push({ ...b, region: "dist" });
  }

  // ---- G4 PAGE-IS-NOT-THE-PAGE: G1 counts bytes, not content. A build that
  // renders the SAME shell (or a stray 404) into every route would sail
  // through G1 with every file present and non-empty (task 0063 mục 7.2,
  // N6: the one mutation the counting alone cannot catch). Identity is
  // checked by a positive AND a negative half — the fragment must be found
  // in the page's OWN html, and must NOT be found in any other page's html
  // (house rule: "một mệnh đề khẳng định phải là cặp dương-âm"). Without
  // the negative half, a global block reproduced on every page (the nav,
  // exactly as it defeated an <h1> anchor here) would silently satisfy the
  // positive half for every page — task 0063's N7 mutation exists to prove
  // this half is real, not decorative. ----
  const htmlText = new Map();
  for (const href of allHtmlHrefs) {
    const file = path.join(distDir, hrefToHtmlPath(href));
    try {
      htmlText.set(href, stripTags(fs.readFileSync(file, "utf8")));
    } catch {}
  }

  for (const page of pages) {
    counts.identityFragmentsChecked++;
    const rawFragment = longestProseLine(page.body);
    if (!rawFragment) {
      bad.push({ region: "dist", kind: "NO-IDENTITY-FRAGMENT", page: page.href, detail: "no prose line >= 40 chars in content/" });
      continue;
    }
    // Compared as marked.js would RENDER it, not as it's spelled in
    // content/ — see markdownInlineToPlain()'s own comment for the 6/35
    // real pages that false-flagged without this.
    const fragment = markdownInlineToPlain(rawFragment);
    const own = htmlText.has(page.href) && htmlText.get(page.href).includes(fragment);
    if (!own) bad.push({ region: "dist", kind: "PAGE-IS-NOT-THE-PAGE", page: page.href, detail: `own identity fragment not found in ${hrefToHtmlPath(page.href)}` });

    const leaks = [...htmlText.entries()].filter(([h, t]) => h !== page.href && t.includes(fragment)).map(([h]) => h);
    if (leaks.length)
      bad.push({ region: "dist", kind: "PAGE-IS-NOT-THE-PAGE", page: page.href, detail: `identity fragment also present on ${leaks.join(", ")}` });
  }

  return { bad, counts };
}

// ================================================================
// runner
// ================================================================

export async function run(opts) {
  resetMemberLookupStats();
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
  const G = await checkDist(groups, opts.distDir);

  // The core-consolidation boundary (content still teaching an absorbed
  // package under its own standalone name) counts toward RED, same as any
  // other finding — the coordinator's own framing calls it "hại hơn" (more
  // harmful) than a plain missing entry point, precisely because it's a
  // page actively teaching the pre-consolidation shape, not just silent.
  const allBad = [...A.bad, ...B.bad, ...C.bad, ...E.bad, ...F.bad, ...D.bad, ...D.boundary, ...G.bad];

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
    dottedProseChecked: C.dottedProseChecked,
    entryPointsChecked: D.entriesChecked,
    // How many cited specifiers actually resolved to an exports key. This is
    // the INPUT to entry-point coverage, and it needs its own floor for the
    // reason B2b paid for: a coverage number can fall either because things
    // got documented or because the guard stopped seeing the citations, and
    // the two look identical in a findings list. Zero here with a nonzero
    // entryPointsChecked would mean every entry is "undocumented" because
    // nothing was read, not because nothing was written.
    entryCitationsResolved: D.citationsResolved,
    urlsChecked: E.urlsChecked,
    familyLinksChecked: F.linksChecked,
    // Visibility, not a pass/fail floor: how often memberNamesOf() (the
    // Foo.bar()/heading-member check) genuinely could not determine an
    // answer — a class/interface/const declaration it couldn't resolve at
    // all, or an intersection type mixing an external reference with a
    // local literal (see guard/lib/dts.mjs). This used to be invisible: a
    // memberNamesOf() that always answered "unknown" changed no count, no
    // finding, no exit code. It's printed unconditionally so that rate is
    // never silent, even though a reasonably high rate is expected (not
    // every declaration in these packages is a simple inline object/class).
    memberLookupCalls: memberLookupStats.total,
    memberLookupUnknown: memberLookupStats.unknown,
    // dist/client region (task 0063) — a page not sinh ra is hỏng im lặng,
    // so these three get their own floors below, DERIVED from pageCount at
    // run time rather than ghim cứng, exactly because content/ grew by two
    // pages (batch.md, session.md) WHILE this task was being written (task
    // 0063 mục 1/6.4) — a literal number here would already be wrong.
    htmlGenerated: G.counts.htmlGenerated,
    mdGenerated: G.counts.mdGenerated,
    identityFragmentsChecked: G.counts.identityFragmentsChecked,
  };
  const zeroFloors = {
    pagesScanned: 32,
    packagesResolved: 16, // 16 @ecosy/* + page-flip is allowed to sit outside this floor
    specifiersChecked: 1,
    namedImportsChecked: 1,
    memberCallsChecked: 1,
    bashLinesChecked: 1,
    headingsChecked: 1,
    pseudoDeclsChecked: 1,
    inlineSpansChecked: 1,
    dottedProseChecked: 1,
    entryPointsChecked: 1,
    // Floor 16, not 1: one package resolving a citation while the other
    // fifteen resolve none would sail past a floor of 1 and mark 50-odd entry
    // points missing for no reason anyone could see. Measured on this commit:
    // 71.
    entryCitationsResolved: 16,
    familyLinksChecked: 1,
    // Every content page + the 4 hand-written catalog pages + 404.html.
    // An expression, not a literal — task 0063 mục 1's whole point: content/
    // had 33 pages when the task was drafted and 35 by the time it was
    // handed off, and it will grow again.
    htmlGenerated: pageCount + CATALOG_PATHS.length + 1,
    mdGenerated: pageCount,
    identityFragmentsChecked: pageCount,
  };
  // urlsChecked is legitimately 0 when off-page was deliberately skipped
  // (--skip-live, nothing fetched at all) — it does NOT belong in the same
  // floor list as the other three regions, which have no such legitimate-0
  // state. Its absence from zeroFloors previously meant a fully blind
  // off-page region (network down, a bug zeroing the loop, anything) looked
  // IDENTICAL in `counts`/exit-code to an intentional --skip-live: both said
  // "0 empty extractors". Enforcing it only when off-page wasn't skipped
  // closes that without breaking the legitimate skip path.
  if (!E.skipped) zeroFloors.urlsChecked = 1;
  const emptyExtractors = Object.entries(zeroFloors).filter(([k, floor]) => counts[k] < floor);

  // Off-page being skipped (or only PARTIALLY probed — some .md paths had no
  // live fetch and no fixture) is a second, separate way to be wrongly
  // green, and `emptyExtractors` above doesn't cover it: `urlsChecked` can
  // be legitimately nonzero (the URL-allowlist half ran off a fixture) while
  // the .md-promise probe never completed. A run in that state must not
  // report GREEN silently — it has to be told to, via `--skip-live-ok`,
  // which is a statement "I know this run didn't verify off-page" rather
  // than the guard just not noticing.
  const offPageUnverified = E.skipped || !E.verified;
  const unverifiedRegions = offPageUnverified && !opts.skipLiveOk ? ["offpage"] : [];

  return {
    groups,
    surfaces,
    timings,
    counts,
    emptyExtractors,
    unverifiedRegions,
    offPageStatus: { skipped: E.skipped, verified: E.verified },
    boundary: D.boundary,
    findings: {
      codeImports: A.bad,
      bashInstalls: B.bad,
      prose: C.bad,
      missingEntrypoints: D.bad,
      offPage: E.bad,
      familyLinks: F.bad,
      dist: G.bad,
    },
    allBad,
    ok: allBad.length === 0 && emptyExtractors.length === 0 && unverifiedRegions.length === 0,
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
    if (result.unverifiedRegions.length)
      console.log(
        "UNVERIFIED (treated as RED — pass --skip-live-ok to acknowledge):",
        result.unverifiedRegions.join(", "),
        JSON.stringify(result.offPageStatus),
      );
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
  console.log(
    result.ok ? "GREEN" : "RED",
    `(${result.allBad.length} findings, ${result.emptyExtractors.length} empty extractors, ${result.unverifiedRegions.length} unverified regions)`,
  );
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
