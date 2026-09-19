#!/usr/bin/env node
/*
 * Mutation self-check for the docs.ecosy.io guard (task 0057/B1).
 *
 * House rule: "một bộ canh không tìm thấy gì thì xanh y như một bộ canh thấy
 * mọi thứ đúng" — so the guard itself has to be tested. Every mutation here
 * changes the DATA the guard reads (a content/*.md copy, a package.json
 * copy, or a synthesized off-page fixture), never the guard's own source —
 * the guard under test is the exact same guard/check.mjs used for real runs.
 *
 * Every case below builds its own inputs from THIS commit's content/ and
 * guard/.cache — none of them depend on anything outside the repo (no
 * pre-fetched live files, no scratchpad directory). Reviewer found the
 * previous version's M5
 * silently SETUP-FAILED for exactly that reason on a fresh checkout; the
 * off-page fixtures (llms.txt / llms-full.txt / search.json) are now built
 * by synthesizeOffPage() below, in the same shape the real site generates
 * (Source: lines, markdown links, a JSON array), from content/ itself.
 *
 * Three kinds of case live here:
 *   - ordinary        — mutate an input, require a specific finding KIND
 *                       carrying a literal only this mutation can produce
 *                       (`expectPage` is matched as a substring of the
 *                       finding line, so it is usually the mutated entry's
 *                       own name rather than a page path: a page that is
 *                       already red for other reasons would otherwise let a
 *                       case pass for free — 0057/B2b lost a round to
 *                       exactly that);
 *   - `control: true` — mutate an input that is CORRECT, require the finding
 *                       to be ABSENT, plus a sight-proof that the guard did
 *                       look (a count that rose, or a companion finding).
 *                       Without these, a tightened rule can only be shown to
 *                       bark, never to be right;
 *   - `widen: true`   — no fixed expectation, record what happened.
 *
 * Usage:
 *   node guard/mutate.mjs
 *   GUARD_CHECK_BIN=/path/to/older/guard/check.mjs node guard/mutate.mjs
 *     — same cases against a previous guard, which is how a new case proves
 *       it is testing the change it claims to test instead of riding along
 *       on something that already worked.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadContent, longestProseLine, markdownInlineToPlain, hrefToHtmlPath, hrefToMdPath } from "./lib/content.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const REAL_CONTENT = path.join(ROOT, "content");
const REAL_CACHE = path.join(ROOT, "guard", ".cache");

// Which check.mjs is under test. Normally this repo's own, but overridable so
// the same cases can be run against an OLDER checkout of the guard — that is
// how "this case CAUGHT because of the thing it changed" gets measured rather
// than asserted: a case that is CAUGHT here and CAUGHT on the previous guard
// too was never testing the change it claims to test. See the note on M8.
const CHECK_BIN = process.env.GUARD_CHECK_BIN || path.join(ROOT, "guard", "check.mjs");

function freshContentCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-guard-content-"));
  fs.cpSync(REAL_CONTENT, dir, { recursive: true });
  return dir;
}

function freshCacheCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-guard-cache-"));
  fs.cpSync(REAL_CACHE, dir, { recursive: true });
  return dir;
}

/** guard/.cache entries are keyed `pkg-<name>@<version>` (see lib/registry.mjs)
 * — found by prefix rather than hardcoded, so a version bump doesn't silently
 * break this at the exact moment it would matter (a fresh `latest`). */
function findCachedPackageDir(cacheDir, npmName) {
  const prefix = "pkg-" + npmName.replace(/^@/, "").replace(/\//g, "-") + "@";
  const entry = fs.readdirSync(cacheDir).find((f) => f.startsWith(prefix));
  if (!entry) throw new Error(`no cached package dir for ${npmName} under ${cacheDir} (looked for ${prefix}*)`);
  return path.join(cacheDir, entry, "package");
}

/**
 * Off-page fixtures built from content/ itself, in the shape lib/content.mjs
 * actually generates (verified against a real fetch of the live site while
 * writing this): llms.txt as nested `- [name](url): summary` bullets,
 * llms-full.txt as `# heading` / `Source: url` / body triples, search.json
 * as a flat array of `{title, path, section}`. A clean run of these against
 * an unmutated content/ must show zero drift — checked below before any
 * mutation is applied, same as the content-only cases' baseline.
 */
function synthesizeOffPage(contentDir) {
  const groups = loadContent(contentDir);
  const llmsTxtLines = ["# Ecosy", "", "> synthetic fixture for mutation testing", ""];
  const llmsFullLines = ["# Ecosy — full documentation", ""];
  const searchEntries = [];
  const mdProbe = {};
  for (const g of Object.values(groups)) {
    const name = g.meta.name || g.slug;
    const index = g.pages.find((p) => p.href === `/${g.slug}`);
    llmsTxtLines.push(`- [${name}](https://docs.ecosy.io/${g.slug}): summary`);
    for (const p of g.pages) {
      const title = p.data.title || p.href;
      if (p !== index) llmsTxtLines.push(`  - [${name} — ${title}](https://docs.ecosy.io${p.href}): detail`);
      llmsFullLines.push(`# ${name} — ${title}`, "", `Source: https://docs.ecosy.io${p.href}`, "", p.body.trim(), "");
      searchEntries.push({ title: `${name} ${title}`, path: p.href, section: g.slug });
      mdProbe[p.href] = 200;
    }
  }
  return {
    llmsTxt: llmsTxtLines.join("\n"),
    llmsFull: llmsFullLines.join("\n"),
    searchJson: JSON.stringify(searchEntries, null, 1),
    mdProbe,
  };
}

function writeOffPageFixtures(dir, fixtures) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    llmsTxt: path.join(dir, "llms.txt"),
    llmsFull: path.join(dir, "llms-full.txt"),
    searchJson: path.join(dir, "search.json"),
    mdProbe: path.join(dir, "md-probe.json"),
  };
  fs.writeFileSync(files.llmsTxt, fixtures.llmsTxt);
  fs.writeFileSync(files.llmsFull, fixtures.llmsFull);
  fs.writeFileSync(files.searchJson, fixtures.searchJson);
  fs.writeFileSync(files.mdProbe, JSON.stringify(fixtures.mdProbe, null, 1));
  return files;
}

function offPageArgs(files) {
  return ["--llms-txt", files.llmsTxt, "--llms-full", files.llmsFull, "--search-json", files.searchJson, "--md-probe", files.mdProbe];
}

function runGuard(args, env = {}) {
  return runGuardWithBin(CHECK_BIN, args, env);
}

function runGuardWithBin(bin, args, env = {}) {
  try {
    // realpathSync matters specifically for a check.mjs copied under
    // os.tmpdir() (buildWeakenedCheck, below): on macOS /tmp and
    // /var/folders/... are symlinks into /private/..., and Node resolves
    // import.meta.url through the REAL path while process.argv[1] keeps
    // whatever path was typed on the command line. check.mjs's own
    // `if (import.meta.url === \`file://${process.argv[1]}\`) main();`
    // idiom then compares unequal paths for the exact same file, so
    // `main()` silently never runs — the process exits 0 having printed
    // nothing, which looks EXACTLY like "the mutation was invisible" and
    // is actually "the harness never executed". Measured while building
    // H1/H2: every case falsely reported GREEN until this line was added.
    const out = execFileSync("node", [fs.realpathSync(bin), ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

/**
 * Builds a dist/client-SHAPED directory from a content dir — the fixture
 * task 0063's N1–N7/C1/C2 cases mutate, and the fixture every OTHER case
 * (M1…M10, which mutate content/ or package.json, not dist/) needs a CLEAN
 * copy of, or check.mjs's new dist region would compare a MUTATED
 * content/'s pages against the real project's real dist/client (built from
 * the UNMUTATED content) and report spurious drift that has nothing to do
 * with what that case is actually testing.
 *
 * Matches the exact contracts check.mjs's checkDist() verifies, not a looser
 * approximation of them:
 *   - <href>.html contains that page's own identity fragment (see
 *     guard/lib/content.mjs's longestProseLine/markdownInlineToPlain) and
 *     nothing else's — own:true, leak:0 for every page, by construction;
 *   - <href>.md is byte-for-byte the shape scripts/emit-markdown.mjs
 *     promises: "Source: <origin><href>", blank line, the body with
 *     frontmatter stripped;
 *   - the four catalog pages + 404.html exist (content-free — G4 only
 *     examines content/ pages, and G1 just needs a non-empty file);
 *   - the three off-page files, via the EXISTING synthesizeOffPage() rather
 *     than a second, drifting reimplementation.
 */
function synthesizeDist(contentDir) {
  const groups = loadContent(contentDir);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-guard-dist-"));
  const pages = Object.values(groups).flatMap((g) => g.pages);

  for (const page of pages) {
    const htmlRel = hrefToHtmlPath(page.href);
    const mdRel = hrefToMdPath(page.href);
    fs.mkdirSync(path.dirname(path.join(dir, htmlRel)), { recursive: true });
    const raw = longestProseLine(page.body);
    const fragment = raw ? markdownInlineToPlain(raw) : `(no qualifying prose line for ${page.href})`;
    fs.writeFileSync(
      path.join(dir, htmlRel),
      `<html><body><nav>synthetic nav shared by every page — deliberately carries no page's own fragment</nav><p>${fragment}</p></body></html>`,
    );
    fs.writeFileSync(path.join(dir, mdRel), `Source: https://docs.ecosy.io${page.href}\n\n${page.body.trim()}\n`);
  }
  for (const href of ["/", "/packages", "/frameworks", "/forks"]) {
    fs.writeFileSync(path.join(dir, hrefToHtmlPath(href)), `<html><body><p>synthetic catalog page ${href}</p></body></html>`);
  }
  fs.writeFileSync(path.join(dir, "404.html"), `<html><body><p>404 not found</p></body></html>`);

  const fx = synthesizeOffPage(contentDir);
  writeOffPageFixtures(dir, fx);

  return dir;
}

/**
 * Copies check.mjs (plus the guard/lib/ it imports) into a scratch tree
 * shaped like `<scratchRoot>/guard/check.mjs`, WITH one exact transform
 * applied — this is what makes H1/H2 (task 0063 mục 10.4) a genuine
 * "remove one line and see what still catches it" measurement rather than
 * a description of one.
 *
 * The nested `guard/` shape matters, not just the file: check.mjs computes
 * `ROOT = path.join(import.meta.dirname, "..")` and writes
 * `guard/last-run.json` under it on every run — a flat copy would point
 * ROOT at the scratch tree's PARENT (outside our control, likely
 * unwritable) and crash every H1/H2 subprocess for a reason that has
 * nothing to do with what's being measured.
 */
function buildWeakenedCheck(transform, label) {
  const src = fs.readFileSync(path.join(ROOT, "guard", "check.mjs"), "utf8");
  const out = transform(src);
  if (out === src) throw new Error(`buildWeakenedCheck(${label}): transform made no change — check.mjs source moved?`);
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docs-guard-weak-"));
  const guardDir = path.join(scratchRoot, "guard");
  fs.mkdirSync(guardDir, { recursive: true });
  fs.writeFileSync(path.join(guardDir, "check.mjs"), out);
  fs.cpSync(path.join(ROOT, "guard", "lib"), path.join(guardDir, "lib"), { recursive: true });
  return path.join(guardDir, "check.mjs");
}

/** Pull one number out of the guard's `counts:` line — used to tell "clean" from "blind". */
function countFromOutput(out, key) {
  const m = out.match(new RegExp(`"${key}":(\\d+)`));
  return m ? Number(m[1]) : null;
}

function hasFinding(out, kind, page) {
  // A line-level check, not "does this kind exist anywhere in the whole run"
  // — several of these kinds are already present on today's real content
  // (that's the point of B1), so the signal has to be specifically on the
  // page each mutation touched, or a case could "pass" for free.
  return out.split("\n").some((line) => line.includes(`"kind":"${kind}"`) && (!page || line.includes(`"page":"${page}"`) || line.includes(`"${page}"`)));
}

// Sanity check: synthesizeOffPage() on real, unmutated content must itself be
// drift-free, or every case built on top of it is testing a fixture bug, not
// the guard.
{
  const fx = synthesizeOffPage(REAL_CONTENT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-guard-offpage-sanity-"));
  const files = writeOffPageFixtures(dir, fx);
  const r = runGuard(offPageArgs(files));
  const driftKinds = ["DRIFT-LLMSTXT-PATHLIST", "DRIFT-LLMSFULL-PATHLIST", "DRIFT-SEARCHJSON-PATHLIST", "DRIFT-LLMSFULL-BODY", "MD-PROMISE-BROKEN"];
  const spurious = driftKinds.filter((k) => hasFinding(r.out, k));
  if (spurious.length) {
    console.log("FATAL: synthesizeOffPage() disagrees with the guard on unmutated content —", spurious.join(", "));
    console.log(r.out);
    process.exit(1);
  }
}

const cases = [];

// M1 — prose/pseudo-decl: a page starts teaching an API name the package doesn't have.
cases.push({
  name: "M1 prose: fabricated interface taught as real",
  expectKind: "PSEUDO-DECL-UNKNOWN",
  expectPage: "/http",
  setup() {
    const dir = freshContentCopy();
    const f = path.join(dir, "http", "index.md");
    let src = fs.readFileSync(f, "utf8");
    src = src.replace(
      "Zero dependencies, built on `fetch`.",
      '```ts\ninterface HttpRetryPolicyOptions {\n  maxAttempts?: number;\n}\n```\n\nZero dependencies, built on `fetch`.',
    );
    fs.writeFileSync(f, src);
    const distDir = synthesizeDist(dir);
    return { args: ["--content-dir", dir, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// M2 — bash: install line names a package that doesn't exist.
cases.push({
  name: "M2 bash: install line typos the package name",
  expectKind: "PACKAGE-NOT-FOUND",
  expectPage: "/http",
  setup() {
    const dir = freshContentCopy();
    const f = path.join(dir, "http", "index.md");
    let src = fs.readFileSync(f, "utf8");
    src = src.replace("yarn add @ecosy/http", "yarn add @ecosy/htttp");
    fs.writeFileSync(f, src);
    const distDir = synthesizeDist(dir);
    return { args: ["--content-dir", dir, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// M2b — bash, SECOND token: reviewer-proven survivor. `yarn add A B C`
// installs three packages; a check that only reads the FIRST token never
// sees a typo in the second or third. Exactly the 0055 shape, one token
// later.
cases.push({
  name: "M2b bash: SECOND token on a multi-package install line is wrong",
  expectKind: "PACKAGE-NOT-FOUND",
  expectPage: "/hoapp",
  setup() {
    const dir = freshContentCopy();
    const f = path.join(dir, "hoapp", "index.md");
    let src = fs.readFileSync(f, "utf8");
    const before = src;
    src = src.replace("yarn add @ecosy/hoapp hono", "yarn add @ecosy/hoapp @ecosy/nextjs hono");
    if (src === before) throw new Error("M2b setup: install line not found verbatim — content moved?");
    fs.writeFileSync(f, src);
    const distDir = synthesizeDist(dir);
    return { args: ["--content-dir", dir, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// M3 — a Contents-table link for one of THIS package's own names is repointed
// at a different (real, 200-returning) page. A "does this URL resolve" check
// would never see this — /orm is a perfectly good page. This is exactly the
// 0055 shape ("link sang docs.ecosy.io/core … cũng 200").
cases.push({
  name: "M3 link: Contents TABLE entry for `Route` repointed at a different real page",
  expectKind: "MISMATCHED-FAMILY-LINK",
  expectPage: "/next",
  setup() {
    const dir = freshContentCopy();
    const f = path.join(dir, "next", "index.md");
    let src = fs.readFileSync(f, "utf8");
    const before = src;
    src = src.replace("[`Route`](/next/route)", "[`Route`](/orm)");
    if (src === before) throw new Error("M3 setup: anchor text not found — content moved?");
    fs.writeFileSync(f, src);
    const distDir = synthesizeDist(dir);
    return { args: ["--content-dir", dir, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// M3b — the identical mismatch, but as a BULLET list item instead of a table
// row. Reviewer-proven survivor: the family-link check originally read only
// `|` rows.
cases.push({
  name: "M3b link: same mismatch in a BULLET list, not a table row",
  expectKind: "MISMATCHED-FAMILY-LINK",
  expectPage: "/http",
  setup() {
    const dir = freshContentCopy();
    const f = path.join(dir, "http", "index.md");
    let src = fs.readFileSync(f, "utf8");
    src = src.replace(
      "Zero dependencies, built on `fetch`.",
      "- [`Http`](/orm) — this bullet is the mutation under test\n\nZero dependencies, built on `fetch`.",
    );
    fs.writeFileSync(f, src);
    const distDir = synthesizeDist(dir);
    return { args: ["--content-dir", dir, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// M4 — the PACKAGE gains an entry point (real npm/exports data) that no page
// documents. Mutates package.json, not content: the entry point genuinely
// exists and genuinely has zero documentation, which is the real shape of
// the bug this check exists for (@ecosy/core's ./crypt, ./queue, … today).
cases.push({
  name: "M4 entrypoint: package.json gains an undocumented subpath",
  expectKind: "MISSING-ENTRYPOINT",
  expectPage: "/http",
  setup() {
    const cacheDir = freshCacheCopy();
    const pkgRoot = findCachedPackageDir(cacheDir, "@ecosy/http");
    // A genuinely new file with a name that appears NOWHERE in content — not
    // a repoint at an existing, already-documented .d.ts. Reusing
    // dist/index.d.ts here would make the check trivially pass, since its
    // real names (`Http`, `HttpResponse`, …) are already mentioned on the
    // page for unrelated reasons.
    fs.writeFileSync(path.join(pkgRoot, "dist", "turbocharge.d.ts"), "export declare function turbochargeExclusiveApi(): void;\n");
    const pjFile = path.join(pkgRoot, "package.json");
    const pj = JSON.parse(fs.readFileSync(pjFile, "utf8"));
    pj.exports["./turbocharge"] = { types: "./dist/turbocharge.d.ts", import: "./dist/turbocharge.d.ts", require: "./dist/turbocharge.d.ts" };
    fs.writeFileSync(pjFile, JSON.stringify(pj, null, 2));
    return { args: ["--skip-live", "--skip-live-ok"], env: { GUARD_CACHE_DIR: cacheDir } };
  },
});

// M4b — the boundary check must MEASURE overlap, not string-match a slug.
// `@ecosy/http` growing a `./schedule` entry shares a slug with the real
// `@ecosy/schedule` package but shares ZERO names with it — reviewer-proven
// false negative (it used to `continue` here and never reach
// MISSING-ENTRYPOINT at all). "schedule" (unlike "store"/"json") does not
// appear anywhere in /http's own text even incidentally — checked by hand,
// so idHit's word-boundary match can't accidentally save this case the way
// "no-store" would for a "./store" entry.
cases.push({
  name: "M4b entrypoint: new subpath COINCIDENTALLY shares a slug with an unrelated package",
  expectKind: "MISSING-ENTRYPOINT",
  expectPage: "/http",
  setup() {
    const cacheDir = freshCacheCopy();
    const pkgRoot = findCachedPackageDir(cacheDir, "@ecosy/http");
    fs.writeFileSync(path.join(pkgRoot, "dist", "fake-schedule.d.ts"), "export declare function httpOwnUnrelatedScheduleThing(): void;\n");
    const pjFile = path.join(pkgRoot, "package.json");
    const pj = JSON.parse(fs.readFileSync(pjFile, "utf8"));
    pj.exports["./schedule"] = { types: "./dist/fake-schedule.d.ts", import: "./dist/fake-schedule.d.ts", require: "./dist/fake-schedule.d.ts" };
    fs.writeFileSync(pjFile, JSON.stringify(pj, null, 2));
    return { args: ["--skip-live", "--skip-live-ok"], env: { GUARD_CACHE_DIR: cacheDir } };
  },
});

// M7 — entrypoint coverage must stay per-PACKAGE even once a package spans
// several content groups (B2b, 2026-09-19: @ecosy/core's `logger` and
// `schedule` entries live under their own top-level /logger and /schedule
// groups, not content/core/). checkEntryPoints() now pools every group that
// shares an npm name before judging coverage, so that a sibling group's page
// can satisfy an entry the "core" group itself never mentions — the exact
// fix this case exists to prove didn't go too far. A subpath that NO group
// sharing the package's npm documents must still be MISSING-ENTRYPOINT; if
// pooling silently marks everything covered just because the npm now has
// several groups, this case survives and the "fix" made the guard blind
// instead of accurate.
cases.push({
  name: "M7 entrypoint: a multi-group package (@ecosy/core) still flags a subpath NO sibling group documents",
  expectKind: "MISSING-ENTRYPOINT",
  // Not a page path: /core/cache already carries three real, pre-existing
  // MISSING-ENTRYPOINT findings (crypt/queue/csrf), so checking by page alone
  // would "pass" even if this mutation's own entry were silently swallowed by
  // pooling. hasFinding()'s second branch matches ANY substring in the
  // finding line, so the mutated entry's own name is the actually-specific
  // signal — it can only appear in the `"entry":"turbocharge-core"` field
  // this mutation introduces.
  expectPage: "turbocharge-core",
  setup() {
    const cacheDir = freshCacheCopy();
    const pkgRoot = findCachedPackageDir(cacheDir, "@ecosy/core");
    // Novel name and novel export key — not reused from /core, /logger or
    // /schedule (checked by hand against all three), so pooling their text
    // cannot accidentally satisfy it the way "batch"/"session" incidentally
    // do for two of the pre-existing, real gaps.
    fs.writeFileSync(
      path.join(pkgRoot, "dist", "turbocharge-core.d.ts"),
      "export declare function turbochargeCoreExclusiveApi(): void;\n",
    );
    const pjFile = path.join(pkgRoot, "package.json");
    const pj = JSON.parse(fs.readFileSync(pjFile, "utf8"));
    pj.exports["./turbocharge-core"] = {
      types: "./dist/turbocharge-core.d.ts",
      import: "./dist/turbocharge-core.d.ts",
      require: "./dist/turbocharge-core.d.ts",
    };
    fs.writeFileSync(pjFile, JSON.stringify(pj, null, 2));
    return { args: ["--skip-live", "--skip-live-ok"], env: { GUARD_CACHE_DIR: cacheDir } };
  },
});

// ---------------------------------------------------------------------------
// M8 / M8b / M9 / M10 — the entry-point coverage rule stopped being a string
// search (task 0062). Every one of these was measured against the PRE-FIX
// guard as well; see the SURVIVED-before/CAUGHT-after note on each.
// ---------------------------------------------------------------------------

// M8 — the `"a batch of entries can be lost"` shape, verbatim in structure:
// a real, undocumented entry point whose last path segment happens to be an
// ordinary English word used in running PROSE about something else entirely.
// This is the bug that shipped: `@ecosy/core/batch` (debounce) read as
// documented because content/logger/index.md:237 says a batch of log entries
// can be lost. Pre-fix guard: SURVIVED (idHit matched the prose word).
cases.push({
  name: "M8 entrypoint: undocumented subpath 'rejoinder' cleared by a coincidental PROSE word",
  expectKind: "MISSING-ENTRYPOINT",
  // The mutated entry's own id, not a page path: the specific signal is the
  // `"entry":"rejoinder"` field this mutation alone introduces. Matching on
  // "/http" would let the case pass off some unrelated finding as its own.
  expectPage: "rejoinder",
  setup() {
    const contentDir = freshContentCopy();
    const f = path.join(contentDir, "http", "index.md");
    let src = fs.readFileSync(f, "utf8");
    const before = src;
    src = src.replace(
      "Zero dependencies, built on `fetch`.",
      "A failed request carries a rejoinder of its own, so a rejoinder of retries can be\nlost on process exit — drain the queue before shutdown.\n\nZero dependencies, built on `fetch`.",
    );
    if (src === before) throw new Error("M8 setup: anchor sentence not found — content moved?");
    fs.writeFileSync(f, src);

    const cacheDir = freshCacheCopy();
    const pkgRoot = findCachedPackageDir(cacheDir, "@ecosy/http");
    fs.writeFileSync(path.join(pkgRoot, "dist", "rejoinder.d.ts"), "export declare function makeRejoinder(): void;\n");
    const pjFile = path.join(pkgRoot, "package.json");
    const pj = JSON.parse(fs.readFileSync(pjFile, "utf8"));
    pj.exports["./rejoinder"] = { types: "./dist/rejoinder.d.ts", import: "./dist/rejoinder.d.ts", require: "./dist/rejoinder.d.ts" };
    fs.writeFileSync(pjFile, JSON.stringify(pj, null, 2));
    const distDir = synthesizeDist(contentDir);
    return { args: ["--content-dir", contentDir, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"], env: { GUARD_CACHE_DIR: cacheDir } };
  },
});

// M8b — the `"session.cleanup"` shape: the same coincidence, but inside a
// FENCED ```ts BLOCK rather than prose. This case exists because "require the
// name to appear in a code block" was one of the shapes considered for the
// fix, and this is the measurement that rejected it: `@ecosy/core/session`'s
// only word hit is `Registry("session.cleanup", …)` at
// content/schedule/index.md:231, which IS a code block. A code-block rule
// would have left the shipped bug in place.
cases.push({
  name: "M8b entrypoint: undocumented subpath cleared by a coincidence inside a ```ts BLOCK",
  expectKind: "MISSING-ENTRYPOINT",
  expectPage: "tessellate",
  setup() {
    const contentDir = freshContentCopy();
    const f = path.join(contentDir, "http", "index.md");
    let src = fs.readFileSync(f, "utf8");
    const before = src;
    src = src.replace(
      "Zero dependencies, built on `fetch`.",
      '```ts\nconst job = Registry("tessellate.cleanup", { db: DataSource }, async () => {});\n```\n\nZero dependencies, built on `fetch`.',
    );
    if (src === before) throw new Error("M8b setup: anchor sentence not found — content moved?");
    fs.writeFileSync(f, src);

    const cacheDir = freshCacheCopy();
    const pkgRoot = findCachedPackageDir(cacheDir, "@ecosy/http");
    fs.writeFileSync(path.join(pkgRoot, "dist", "tessellate.d.ts"), "export declare function tessellateThings(): void;\n");
    const pjFile = path.join(pkgRoot, "package.json");
    const pj = JSON.parse(fs.readFileSync(pjFile, "utf8"));
    pj.exports["./tessellate"] = { types: "./dist/tessellate.d.ts", import: "./dist/tessellate.d.ts", require: "./dist/tessellate.d.ts" };
    fs.writeFileSync(pjFile, JSON.stringify(pj, null, 2));
    const distDir = synthesizeDist(contentDir);
    return { args: ["--content-dir", contentDir, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"], env: { GUARD_CACHE_DIR: cacheDir } };
  },
});

// M9 — POSITIVE CONTROL, and the only case here that fails by going RED.
// Tightening a coverage rule is easy to "prove" with nothing but cases that
// turn red; that only shows the guard barks. This one adds an entry point
// that IS genuinely documented — a real `import … from "@ecosy/http/parcel"`
// in a fenced block, the way every documented entry on this site is written —
// and requires that the guard does NOT flag it.
//
// A silent pass would be worthless on its own ("no finding" and "never
// looked" print identically), so the control also requires
// entryPointsChecked to have RISEN above the baseline: the guard has to have
// examined the new entry and cleared it, not skipped it.
cases.push({
  name: "M9 CONTROL: a genuinely documented new subpath must NOT be flagged",
  control: true,
  expectKind: "MISSING-ENTRYPOINT",
  expectPage: "parcel",
  requireCount: "entryPointsChecked",
  setup() {
    const contentDir = freshContentCopy();
    const f = path.join(contentDir, "http", "index.md");
    let src = fs.readFileSync(f, "utf8");
    const before = src;
    src = src.replace(
      "Zero dependencies, built on `fetch`.",
      '```ts\nimport { openParcel } from "@ecosy/http/parcel";\n```\n\nZero dependencies, built on `fetch`.',
    );
    if (src === before) throw new Error("M9 setup: anchor sentence not found — content moved?");
    fs.writeFileSync(f, src);

    const cacheDir = freshCacheCopy();
    const pkgRoot = findCachedPackageDir(cacheDir, "@ecosy/http");
    fs.writeFileSync(path.join(pkgRoot, "dist", "parcel.d.ts"), "export declare function openParcel(): void;\n");
    const pjFile = path.join(pkgRoot, "package.json");
    const pj = JSON.parse(fs.readFileSync(pjFile, "utf8"));
    pj.exports["./parcel"] = { types: "./dist/parcel.d.ts", import: "./dist/parcel.d.ts", require: "./dist/parcel.d.ts" };
    fs.writeFileSync(pjFile, JSON.stringify(pj, null, 2));
    const distDir = synthesizeDist(contentDir);
    return { args: ["--content-dir", contentDir, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"], env: { GUARD_CACHE_DIR: cacheDir } };
  },
});

// M10 — the OTHER half of "so chuỗi tên không phải là đo", in
// guard/lib/dts.mjs: cross-package overlap used to be a name-set
// intersection, which is blind to a rename. `@ecosy/schedule`'s `Hook` became
// `@ecosy/core/schedule`'s `HookPort` and `Source` became `SourceClass`; the
// intersection saw two names vanish and reported 38/52 as divergence while
// core was in fact a superset.
//
// Reproduced with the boundary candidate that really exists on this commit:
// `@ecosy/store`'s `./react` entry vs the `@ecosy/react` package (slug
// collision, zero shared names today). The mutation gives @ecosy/react a
// declaration that is `ConnectStoreResult` under a `…Port` name and the
// identical seven members. Pre-fix guard: SURVIVED — zero name intersection,
// no boundary finding, the rename invisible. Post-fix the pair is named in
// the output, which is what "phải lộ ra" means here.
cases.push({
  name: "M10 dts overlap: a RENAMED counterpart (X -> XPort) must be surfaced, not read as divergence",
  expectKind: "ENTRYPOINT-OVERLAPS-PACKAGE",
  // The rename pair itself — the one string only this mutation can produce.
  expectPage: "ConnectStoreResult->ConnectStoreResultPort",
  setup() {
    const cacheDir = freshCacheCopy();
    const reactRoot = findCachedPackageDir(cacheDir, "@ecosy/react");
    const dts = path.join(reactRoot, "dist", "index.d.ts");
    const members = ["store", "dispatch", "getState", "hydrate", "useSelector", "useDispatch", "createSelector"];
    fs.appendFileSync(
      dts,
      "\nexport interface ConnectStoreResultPort {\n" + members.map((m) => `    ${m}: unknown;`).join("\n") + "\n}\n",
    );
    return { args: ["--skip-live", "--skip-live-ok"], env: { GUARD_CACHE_DIR: cacheDir } };
  },
});

// M10b — the OTHER half of the rename bug, and the half that lies in the
// DANGEROUS direction: one coincidentally shared NAME used to be enough for
// the guard to declare an entry point "documented under the other package's
// page" and `continue` past MISSING-ENTRYPOINT entirely.
//
// Measured on the pre-fix guard: giving @ecosy/react an `interface
// ThemeState` with two unrelated members makes it emit
// `ENTRYPOINT-OVERLAPS-PACKAGE … "pkg":"@ecosy/styled","entry":"react"
// "overlap":1` — @ecosy/styled's `./react` entry declared covered on the
// strength of one string. The shapes have nothing in common.
//
// This is a control: it passes by that claim being ABSENT. Its sight-proof is
// the companion rename finding in the same run — the comparison provably ran
// against this very surface, so "no false match" cannot be "never looked".
cases.push({
  name: "M10b CONTROL: one coincidentally shared NAME must not be read as overlap",
  control: true,
  expectKind: "ENTRYPOINT-OVERLAPS-PACKAGE",
  expectPage: '"pkg":"@ecosy/styled"',
  requireFinding: { kind: "ENTRYPOINT-OVERLAPS-PACKAGE", page: "ConnectStoreResult->ConnectStoreResultPort" },
  setup() {
    const cacheDir = freshCacheCopy();
    const reactRoot = findCachedPackageDir(cacheDir, "@ecosy/react");
    const dts = path.join(reactRoot, "dist", "index.d.ts");
    const members = ["store", "dispatch", "getState", "hydrate", "useSelector", "useDispatch", "createSelector"];
    fs.appendFileSync(
      dts,
      // the rename (sight-proof, from @ecosy/store's ./react entry) …
      "\nexport interface ConnectStoreResultPort {\n" +
        members.map((m) => `    ${m}: unknown;`).join("\n") +
        "\n}\n" +
        // … and the name collision under test, from @ecosy/styled's ./react entry
        "\nexport interface ThemeState {\n    somethingCompletelyUnrelated: string;\n    anotherUnrelatedThing: number;\n}\n",
    );
    return { args: ["--skip-live", "--skip-live-ok"], env: { GUARD_CACHE_DIR: cacheDir } };
  },
});

// M5 — llms.txt (an off-page copy) drops one real page from its own link
// list, drifting from content/ without anything on an actual page changing.
cases.push({
  name: "M5 off-page: llms.txt silently drops a real page",
  expectKind: "DRIFT-LLMSTXT-PATHLIST",
  expectPage: null,
  setup() {
    const fx = synthesizeOffPage(REAL_CONTENT);
    const mutated = fx.llmsTxt.replace(/^\s*- \[.*next — [^\]]*route[^\]]*\]\([^)]*\): detail\n/im, "");
    if (mutated === fx.llmsTxt) throw new Error("M5 setup: the /next/route line wasn't found in the synthesized llms.txt");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-guard-offpage-m5-"));
    const files = writeOffPageFixtures(dir, { ...fx, llmsTxt: mutated });
    return { args: offPageArgs(files) };
  },
});

// M5b — search.json grows a PHANTOM page nobody wrote. Reviewer-proven
// survivor: the drift check only looked for pages MISSING from a copy, never
// for extra ones a copy invented.
cases.push({
  name: "M5b off-page: search.json gains a phantom page content/ doesn't have",
  expectKind: "DRIFT-SEARCHJSON-PATHLIST",
  expectPage: null,
  setup() {
    const fx = synthesizeOffPage(REAL_CONTENT);
    const entries = JSON.parse(fx.searchJson);
    entries.push({ title: "Ghost page", path: "/ghost-page-nobody-wrote", section: "module" });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-guard-offpage-m5b-"));
    const files = writeOffPageFixtures(dir, { ...fx, searchJson: JSON.stringify(entries, null, 1) });
    return { args: offPageArgs(files) };
  },
});

// M5c — llms-full.txt's PATH LIST stays intact (every Source: line still
// there), but one page's BODY TEXT no longer matches content/ — the shape of
// "content/ was edited, the site wasn't redeployed", which the path-list
// checks alone (M5/M5b's kind) cannot see.
cases.push({
  name: "M5c off-page: llms-full.txt keeps every path but one page's BODY has drifted",
  expectKind: "DRIFT-LLMSFULL-BODY",
  expectPage: null,
  setup() {
    const fx = synthesizeOffPage(REAL_CONTENT);
    const mutated = fx.llmsFull.replace(
      "Source: https://docs.ecosy.io/orm\n\n",
      "Source: https://docs.ecosy.io/orm\n\nSTALE COPY — this text no longer matches content/orm/index.md.\n\n",
    );
    if (mutated === fx.llmsFull) throw new Error("M5c setup: /orm's Source line not found in the synthesized llms-full.txt");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-guard-offpage-m5c-"));
    const files = writeOffPageFixtures(dir, { ...fx, llmsFull: mutated });
    return { args: offPageArgs(files) };
  },
});

// M6 — WIDEN, not narrow: a TRUE statement (`@ecosy/next/jwt.md`'s deliberate,
// documented absence of `Jwt` from the root) reshaped from prose into a
// fenced ```ts block while keeping the same meaning. Fenced code is checked
// literally (see check.mjs's own comment on why: the alternative is trusting
// a "this is fine, ignore it" comment inside code, which is worse). Recording
// the true outcome either way, not the expected one.
cases.push({
  name: "M6 WIDEN: true 'deliberately absent' claim moved from prose into a ```ts fence",
  widen: true,
  setup() {
    const dir = freshContentCopy();
    const f = path.join(dir, "next", "jwt.md");
    let src = fs.readFileSync(f, "utf8");
    const before = src;
    src = src.replace(
      '`Jwt` is deliberately absent from the root entry point. Import it from\n`@ecosy/next/jwt` — `import { Jwt } from "@ecosy/next"` does not resolve.',
      '`Jwt` is deliberately absent from the root entry point. Import it from\n`@ecosy/next/jwt`:\n\n```ts\n// does not resolve — Jwt is not on the root entry point\nimport { Jwt } from "@ecosy/next";\n```',
    );
    if (src === before) throw new Error("M6 setup: sentence not found verbatim — content moved?");
    fs.writeFileSync(f, src);
    const distDir = synthesizeDist(dir);
    return { args: ["--content-dir", dir, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// ---------------------------------------------------------------------------
// N1–N7 / C1 / C2 — the dist/client region task 0063 added: checkDist() in
// check.mjs. Every N case here mutates a SYNTHESIZED dist/ (synthesizeDist(),
// above), never the real project's dist/client — same reason every content
// case above builds its own tmp content/ copy: "đừng đột biến cây thật".
// ---------------------------------------------------------------------------

// N1 — the plainest shape: a page that WAS generated is simply not there.
cases.push({
  name: "N1 dist: one generated .html is deleted from dist/client",
  expectKind: "PAGE-NOT-GENERATED",
  expectPage: "/core/cache",
  setup() {
    const distDir = synthesizeDist(REAL_CONTENT);
    fs.rmSync(path.join(distDir, "core", "cache.html"));
    return { args: ["--content-dir", REAL_CONTENT, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// N2 — the `generateStaticParams().slice(0, 1)` shape: of a multi-page
// package, only the FIRST sub-page survives. /core has eight real sub-pages
// (batch, cache, serialize, session, subscriber, syhemo, types, utilities) —
// enough to tell "one page missing" (N1's shape) apart from "a whole family
// past the first got cut" (this one).
cases.push({
  name: "N2 dist: generateStaticParams().slice(0, 1) shape — every sub-page but the FIRST of a multi-page package is missing",
  expectKind: "PAGE-NOT-GENERATED",
  expectPage: "/core/cache",
  setup() {
    const distDir = synthesizeDist(REAL_CONTENT);
    const groups = loadContent(REAL_CONTENT);
    const subPages = groups.core.pages.filter((p) => p.file !== "index.md").map((p) => p.href);
    if (subPages.length < 3) throw new Error("N2 setup: /core needs several sub-pages to demonstrate slice(0,1) — content moved?");
    for (const href of subPages.slice(1)) fs.rmSync(path.join(distDir, hrefToHtmlPath(href)));
    return { args: ["--content-dir", REAL_CONTENT, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// N3 — the REAL shape, measured on a REAL build, not a synthesized fixture:
// remove `export const dynamic = "force-static";` from one page's source in
// a scratch copy of the WHOLE working tree (current, uncommitted state —
// this is what will actually ship), run the real `vinext build`, and check
// the guard against that build's real dist/client. Confirms, on THIS
// commit's code, the exact claim task 0063 mục 3.1 makes: the build still
// exits 0 and the page is just gone — not a description of that claim.
cases.push({
  name: "N3 dist: removing force-static from ONE real page — measured on a REAL vinext build, not a fixture",
  expectKind: "PAGE-NOT-GENERATED",
  expectPage: "/forks",
  setup() {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "docs-guard-n3-"));
    // clonefile (-c) on APFS: near-instant, no real copy of 360MB of
    // node_modules until something actually writes to it.
    for (const entry of [
      "app",
      "components",
      "content",
      "guard",
      "lib",
      "next.config.ts",
      "next-env.d.ts",
      "package.json",
      "public",
      "scripts",
      "src",
      "tsconfig.json",
      "vite.config.ts",
      "wrangler.jsonc",
    ]) {
      execFileSync("cp", ["-c", "-R", path.join(ROOT, entry), path.join(scratch, entry)]);
    }
    execFileSync("cp", ["-c", "-R", path.join(ROOT, "node_modules"), path.join(scratch, "node_modules")]);

    const forksPage = path.join(scratch, "app", "forks", "page.tsx");
    const src = fs.readFileSync(forksPage, "utf8");
    const marker = 'export const dynamic = "force-static";\n';
    if (!src.startsWith(marker)) throw new Error("N3 setup: app/forks/page.tsx does not start with the force-static line — moved?");
    fs.writeFileSync(forksPage, src.slice(marker.length));

    let buildResult;
    try {
      buildResult = { code: 0, out: execFileSync("npx", ["vinext", "build"], { cwd: scratch, encoding: "utf8" }) };
    } catch (e) {
      buildResult = { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
    }
    // The claim under test is specifically that the BUILD ITSELF does not
    // fail — a nonzero exit here would mean this case measured the wrong
    // thing entirely, not that the mutation "worked".
    console.log(`  (N3: real \`vinext build\` on the mutated scratch copy exited ${buildResult.code} — expected 0)`);
    if (buildResult.code !== 0) throw new Error(`N3 setup: real vinext build exited ${buildResult.code}, expected 0 — see mutate.mjs's own console output above`);

    return { args: ["--content-dir", path.join(scratch, "content"), "--dist-dir", path.join(scratch, "dist", "client"), "--skip-live", "--skip-live-ok"] };
  },
});

// N4 — search.json AS SHIPPED (in dist/, not the live site) drops a real
// page. This is what actually catches vinext skipping the three route.ts
// handlers if emit-offpage.mjs's own positive assertions (status 200,
// non-empty, valid JSON) were ever weakened or bypassed.
cases.push({
  name: "N4 dist: search.json (as shipped) drops a real page",
  expectKind: "DRIFT-SEARCHJSON-PATHLIST",
  expectPage: null,
  setup() {
    const distDir = synthesizeDist(REAL_CONTENT);
    const searchFile = path.join(distDir, "search.json");
    const entries = JSON.parse(fs.readFileSync(searchFile, "utf8"));
    const filtered = entries.filter((e) => e.path !== "/next/route");
    if (filtered.length === entries.length) throw new Error("N4 setup: /next/route not found in the synthesized search.json — content moved?");
    fs.writeFileSync(searchFile, JSON.stringify(filtered, null, 1));
    return { args: ["--content-dir", REAL_CONTENT, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// N5 — the OTHER file emit-markdown.mjs writes per page (the .md copy)
// missing, everything else (the .html) present and fine.
cases.push({
  name: "N5 dist: one page's raw .md copy is missing from dist/client",
  expectKind: "MD-NOT-GENERATED",
  expectPage: "/next/route",
  setup() {
    const distDir = synthesizeDist(REAL_CONTENT);
    fs.rmSync(path.join(distDir, "next", "route.md"));
    return { args: ["--content-dir", REAL_CONTENT, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// N6 — the one PAGE-NOT-GENERATED counting CANNOT catch: the file exists,
// is non-empty, the count adds up — it is just the WRONG page (here: a real
// 404 shell copied over a real page, the actual shape of a prerender step
// that renders successfully but resolves the wrong route).
cases.push({
  name: "N6 dist: a page's .html is overwritten with the 404 shell — file still there, the COUNT still adds up",
  expectKind: "PAGE-IS-NOT-THE-PAGE",
  expectPage: "/core/cache",
  setup() {
    const distDir = synthesizeDist(REAL_CONTENT);
    const notFoundBody = fs.readFileSync(path.join(distDir, "404.html"), "utf8");
    fs.writeFileSync(path.join(distDir, "core", "cache.html"), notFoundBody);
    return { args: ["--content-dir", REAL_CONTENT, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// N7 — the NEGATIVE half of G4, proven with its own case rather than left
// implicit: /anchor's own identity fragment is copied into EVERY OTHER
// page's html, the shape of a string living in a block reproduced on every
// page (this site's own nav, which is exactly what defeated an <h1> anchor —
// task 0063 mục 7.2). Without a leak check, this is invisible: /anchor's OWN
// html still contains its own fragment, so the positive half alone sees
// nothing wrong anywhere.
cases.push({
  name: "N7 dist: /anchor's identity fragment leaks into EVERY other page's html (simulates a string living in an always-printed block)",
  expectKind: "PAGE-IS-NOT-THE-PAGE",
  expectPage: "/anchor",
  setup() {
    const distDir = synthesizeDist(REAL_CONTENT);
    const groups = loadContent(REAL_CONTENT);
    const anchorPage = Object.values(groups)
      .flatMap((g) => g.pages)
      .find((p) => p.href === "/anchor");
    if (!anchorPage) throw new Error("N7 setup: /anchor page not found — content moved?");
    const fragment = markdownInlineToPlain(longestProseLine(anchorPage.body));
    for (const page of Object.values(groups).flatMap((g) => g.pages)) {
      if (page.href === "/anchor") continue;
      const file = path.join(distDir, hrefToHtmlPath(page.href));
      const html = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, html.replace("</body>", `<nav class="leaked">${fragment}</nav></body>`));
    }
    return { args: ["--content-dir", REAL_CONTENT, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// C1 — POSITIVE CONTROL: adding one real page must raise FOUR counts
// together by exactly 1 — pagesScanned (already existed), and the three
// task 0063 added (htmlGenerated, mdGenerated, identityFragmentsChecked).
// This is the case that proves those three floors are DERIVED, not ghim
// cứng: content/ grew by two real pages WHILE this task was being written
// (task 0063 mục 1), and a literal-number floor would have gone stale
// before the task was even handed off.
cases.push({
  name: "C1 CONTROL: adding one real page raises pagesScanned, htmlGenerated, mdGenerated AND identityFragmentsChecked together by exactly 1",
  countRise: true,
  counters: ["pagesScanned", "htmlGenerated", "mdGenerated", "identityFragmentsChecked"],
  setup() {
    const contentDir = freshContentCopy();
    const body = [
      "---",
      "title: Turbocharge",
      "order: 99",
      "---",
      "",
      "# Turbocharge",
      "",
      "This sentence exists only so the identity-fragment check has a real prose line long enough to anchor on for this brand new page.",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(contentDir, "http", "turbocharge-c1.md"), body);
    const distDir = synthesizeDist(contentDir);
    return { args: ["--content-dir", contentDir, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// C2 — POSITIVE CONTROL: a new page whose `# H1` DUPLICATES an existing
// page's H1 verbatim must NOT be flagged by G4 — proof that identity is
// anchored on prose (task 0063 mục 7.2's own measurement: `<h1>` is
// reproduced on every page by the nav, so it cannot be an identity anchor).
// Sight-proof is identityFragmentsChecked rising by 1, same shape as every
// other control in this file.
cases.push({
  name: "C2 CONTROL: a new page with a DUPLICATE `# H1` must not be flagged — proves G4 anchors on prose, not the heading",
  control: true,
  expectKind: "PAGE-IS-NOT-THE-PAGE",
  expectPage: null,
  requireCount: "identityFragmentsChecked",
  setup() {
    const contentDir = freshContentCopy();
    // "Cache" is content/core/cache.md's real H1 (task 0063 mục 7.2's own
    // example of why <h1> can't be the anchor) — duplicated here verbatim,
    // on an unrelated page, under a different package's slug.
    const body = [
      "---",
      "title: Cache",
      "order: 99",
      "---",
      "",
      "# Cache",
      "",
      "A sentence long enough to serve as this new page's own identity fragment, distinct from every other page's prose in this content tree.",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(contentDir, "http", "cache-c2.md"), body);
    const distDir = synthesizeDist(contentDir);
    return { args: ["--content-dir", contentDir, "--dist-dir", distDir, "--skip-live", "--skip-live-ok"] };
  },
});

// ---------- baseline: confirm today's real content is clean of exactly the
// findings each mutation introduces, so a case can't "pass" only because the
// bug was already there before the mutation. ----------

console.log("Baseline (unmutated content, --skip-live --skip-live-ok):");
const baseline = runGuard(["--skip-live", "--skip-live-ok"]);
for (const c of cases) {
  if (c.expectKind && hasFinding(baseline.out, c.expectKind, c.expectPage)) {
    console.log(`  WARNING: ${c.expectKind} on ${c.expectPage} already present on unmutated content — ${c.name} would not be a clean signal`);
  }
}
console.log(`  (${baseline.code === 0 ? "GREEN" : "RED"} on unmutated content, as expected: real known bugs are still there)`);

console.log("\nMutation cases:");
const rows = [];
// N1/N2/N3/N6/N7's fixtures get reused verbatim by the H1/H2 harness cases
// below — "ghép với đúng con production nó định canh", not a fresh,
// possibly-different fixture built a second time.
const caseArgsByCode = new Map();
for (const c of cases) {
  let result;
  try {
    const { args, env } = c.setup();
    const code = c.name.split(" ")[0];
    if (/^[A-Z]\d+$/.test(code)) caseArgsByCode.set(code, { args, env, expectKind: c.expectKind, expectPage: c.expectPage });
    result = runGuard(args, env);
  } catch (e) {
    rows.push({ name: c.name, outcome: "SKIP (setup failed)", detail: String(e.message) });
    continue;
  }
  const actual = result.code === 0 ? "GREEN" : "RED";
  if (c.widen) {
    rows.push({ name: c.name, outcome: `OBSERVED-${actual}`, actual, detail: "(widen — no fixed expectation)" });
    continue;
  }
  if (c.countRise) {
    // C1: a real page being added must raise EVERY named counter by exactly
    // 1 against the baseline — not ">= baseline", which a bug that stopped
    // counting entirely (stuck at a constant) could also satisfy by accident
    // if the constant happened to already exceed the old baseline.
    const deltas = c.counters.map((k) => {
      const before = countFromOutput(baseline.out, k);
      const after = countFromOutput(result.out, k);
      return { k, before, after, ok: before !== null && after !== null && after === before + 1 };
    });
    const outcome = deltas.every((d) => d.ok) ? "CAUGHT" : "SURVIVED";
    rows.push({ name: c.name, outcome, actual, detail: deltas.map((d) => `${d.k} ${d.before}->${d.after}`).join(", ") });
    continue;
  }
  if (c.control) {
    // Inverted expectation: this case passes by the finding being ABSENT. But
    // absence is only worth anything if the guard actually examined the thing
    // — so the count this case names has to have gone UP against the
    // baseline. Not-flagged plus not-looked is CONTROL-BLIND, which is a
    // failure, not a pass.
    const leaked = hasFinding(result.out, c.expectKind, c.expectPage);
    let sighted;
    let sightDetail;
    if (c.requireCount) {
      const now = countFromOutput(result.out, c.requireCount);
      const base = countFromOutput(baseline.out, c.requireCount);
      sighted = now !== null && base !== null && now > base;
      sightDetail = `${c.requireCount} ${base}→${now}`;
    } else {
      // Sight-proof by companion finding: the same run must produce a
      // finding that only the machinery under test can emit. Without it, "no
      // false alarm" could just mean the comparison never ran.
      sighted = hasFinding(result.out, c.requireFinding.kind, c.requireFinding.page);
      sightDetail = `companion ${c.requireFinding.kind} \`${c.requireFinding.page}\` present: ${sighted}`;
    }
    let outcome;
    if (!sighted) outcome = "CONTROL-BLIND";
    else if (leaked) outcome = "CONTROL-FALSE-ALARM";
    else outcome = "CAUGHT";
    rows.push({
      name: c.name,
      outcome,
      actual,
      detail: `positive control — no ${c.expectKind} for \`${c.expectPage}\`, ${sightDetail}`,
    });
    continue;
  }
  const kindSeen = hasFinding(result.out, c.expectKind, c.expectPage);
  const verdict = kindSeen ? "CAUGHT" : actual === "RED" ? "RED-BUT-WRONG-KIND" : "SURVIVED";
  rows.push({ name: c.name, outcome: verdict, actual, detail: c.expectKind });
}

for (const r of rows) console.log(`  [${r.outcome.padEnd(22)}] ${r.name}`);

const caught = rows.filter((r) => r.outcome === "CAUGHT").length;
const wanted = cases.filter((c) => c.expectKind || c.countRise).length;
console.log(`\n${caught}/${wanted} required mutations caught with the expected finding kind.`);
const survivors = rows.filter(
  (r) => r.outcome === "SURVIVED" || r.outcome === "RED-BUT-WRONG-KIND" || r.outcome.startsWith("SKIP") || r.outcome.startsWith("CONTROL-"),
);
if (survivors.length) {
  console.log("Unhandled (printed, not hidden):");
  for (const s of survivors) console.log(`  - ${s.name}: ${s.outcome}${s.detail ? " — " + s.detail : ""}`);
}

// ---------------------------------------------------------------------------
// H1 / H2 — harness mutations on check.mjs ITSELF, chấm bằng PHÉP GHÉP with
// the exact N-case fixtures they're meant to guard, per house rule ("làm yếu
// một dòng test không tự làm suite đỏ — phải ghép với con production").
// NOT counted in the 25-con floor (task 0063 mục 10.4).
// ---------------------------------------------------------------------------

console.log("\nHarness cases (ghép với N-case fixtures — NOT counted in the 25):");

// Overall exit code is USELESS as the "still caught" signal here: every N
// case checks REAL content/ (--content-dir REAL_CONTENT, so H1/H2 can reuse
// the exact same fixtures the main loop already built), and real content/
// carries 7 pre-existing, unrelated findings today (the prose heading +
// six MISSING-ENTRYPOINT bugs task 0057-0062 already know about) — every
// single run is RED regardless of what this harness does. Measured while
// building this: the first version compared raw exit codes and reported
// EVERY case "still RED", including H2 x N7, which is impossible (N7's
// mutation touches nothing G1/the other checks look at). The fix is a
// TARGETED signal per harness — the specific backup mechanism each one is
// actually asking about — not "is this run red at all".
function reportHarness(label, transform, codes, stillCaughtSignal) {
  let weakFile;
  try {
    weakFile = buildWeakenedCheck(transform, label);
  } catch (e) {
    console.log(`  ${label}: SKIP (${e.message})`);
    return;
  }
  for (const code of codes) {
    const stored = caseArgsByCode.get(code);
    if (!stored) {
      console.log(`  ${label} x ${code}: SKIP (no fixture captured — did ${code}'s setup fail above?)`);
      continue;
    }
    const r = runGuardWithBin(weakFile, stored.args, stored.env);
    const stillCaught = stillCaughtSignal(r.out, stored);
    console.log(
      `  ${label} x ${code}: ${stillCaught ? "still caught by another mechanism -> REDUNDANT so far" : "NOT caught by anything else -> this was the SOLE shield"}`,
    );
  }
}

// H1 — remove G1's two per-page PAGE-NOT-GENERATED assertions. Ghép with
// N1/N2 (dist-only) and N3 (a real build). The targeted backup signal is
// the derived zeroFloors catching htmlGenerated falling short — printed as
// an "EMPTY EXTRACTOR" line naming htmlGenerated — since the exact
// PAGE-NOT-GENERATED text is obviously gone by construction (that's the
// line removed) and is not the interesting question.
reportHarness(
  "H1",
  (src) => src.replace(/else bad\.push\(\{ region: "dist", kind: "PAGE-NOT-GENERATED",[^}]*\}\);/g, "else {} /* H1: weakened */;"),
  ["N1", "N2", "N3"],
  (out) => out.split("\n").some((line) => line.startsWith("EMPTY EXTRACTOR") && line.includes("htmlGenerated")),
);

// H2 — remove G4's NEGATIVE half (the leak check) entirely, keeping the
// positive "own fragment present" half intact. Ghép with N6 (own fragment
// missing — positive half alone still catches this, so REDUNDANT is the
// right answer) and N7 (own fragment still present, only leaked elsewhere —
// ONLY the negative half can catch this one, so H2 x N7 not being caught by
// anything else is exactly what proves the negative half is load-bearing,
// not decorative). Signal: the SAME kind+page pair the N-case itself
// expects — if the positive half alone still emits it, some other mechanism
// caught it; if not, nothing did.
reportHarness(
  "H2",
  (src) => {
    const startMarker = "    const leaks = ";
    const start = src.indexOf(startMarker);
    if (start === -1) return src;
    const tail = src.slice(start);
    const alsoIdx = tail.indexOf("also present on");
    if (alsoIdx === -1) return src;
    const pushEnd = tail.indexOf("});", alsoIdx);
    if (pushEnd === -1) return src;
    const end = start + pushEnd + 3;
    return src.slice(0, start) + "/* H2: weakened — leak/negative check removed */" + src.slice(end);
  },
  ["N6", "N7"],
  (out, stored) => hasFinding(out, stored.expectKind, stored.expectPage),
);
