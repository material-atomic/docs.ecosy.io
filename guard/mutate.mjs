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
 * All ten cases below build their own inputs from THIS commit's content/ —
 * none of them depend on anything outside the repo (no pre-fetched live
 * files, no scratchpad directory). Reviewer found the previous version's M5
 * silently SETUP-FAILED for exactly that reason on a fresh checkout; the
 * off-page fixtures (llms.txt / llms-full.txt / search.json) are now built
 * by synthesizeOffPage() below, in the same shape the real site generates
 * (Source: lines, markdown links, a JSON array), from content/ itself.
 *
 * Usage: node guard/mutate.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadContent } from "./lib/content.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const REAL_CONTENT = path.join(ROOT, "content");
const REAL_CACHE = path.join(ROOT, "guard", ".cache");

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
  try {
    const out = execFileSync("node", [path.join(ROOT, "guard", "check.mjs"), ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
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
    return { args: ["--content-dir", dir, "--skip-live", "--skip-live-ok"] };
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
    return { args: ["--content-dir", dir, "--skip-live", "--skip-live-ok"] };
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
    return { args: ["--content-dir", dir, "--skip-live", "--skip-live-ok"] };
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
    return { args: ["--content-dir", dir, "--skip-live", "--skip-live-ok"] };
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
    return { args: ["--content-dir", dir, "--skip-live", "--skip-live-ok"] };
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
    return { args: ["--content-dir", dir, "--skip-live", "--skip-live-ok"] };
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
for (const c of cases) {
  let result;
  try {
    const { args, env } = c.setup();
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
  const kindSeen = hasFinding(result.out, c.expectKind, c.expectPage);
  const verdict = kindSeen ? "CAUGHT" : actual === "RED" ? "RED-BUT-WRONG-KIND" : "SURVIVED";
  rows.push({ name: c.name, outcome: verdict, actual, detail: c.expectKind });
}

for (const r of rows) console.log(`  [${r.outcome.padEnd(22)}] ${r.name}`);

const caught = rows.filter((r) => r.outcome === "CAUGHT").length;
const wanted = cases.filter((c) => c.expectKind).length;
console.log(`\n${caught}/${wanted} required mutations caught with the expected finding kind.`);
const survivors = rows.filter((r) => r.outcome === "SURVIVED" || r.outcome === "RED-BUT-WRONG-KIND" || r.outcome.startsWith("SKIP"));
if (survivors.length) {
  console.log("Unhandled (printed, not hidden):");
  for (const s of survivors) console.log(`  - ${s.name}: ${s.outcome}${s.detail ? " — " + s.detail : ""}`);
}
