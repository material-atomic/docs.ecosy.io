#!/usr/bin/env node
/*
 * Mutation self-check for the docs.ecosy.io guard (task 0057/B1).
 *
 * House rule: "một bộ canh không tìm thấy gì thì xanh y như một bộ canh thấy
 * mọi thứ đúng" — so the guard itself has to be tested. Every mutation here
 * changes the DATA the guard reads (a content/*.md copy, a package.json
 * copy, or an off-page fixture), never the guard's own source — the guard
 * under test is the exact same guard/check.mjs used for real runs.
 *
 * Six mutations, one per required category from the brief, plus a seventh
 * that widens a boundary instead of narrowing one (a TRUE statement reshaped
 * into something the guard could misjudge) — outcomes reported honestly,
 * including where the guard's boundary turns out to be real.
 *
 * Usage: node guard/mutate.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const REAL_CONTENT = path.join(ROOT, "content");
const REAL_CACHE = path.join(ROOT, "guard", ".cache");
const FIXTURES = process.env.GUARD_FIXTURES || path.join(os.tmpdir(), "docs-ecosy-guard-live-fixtures");

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

const cases = [];

// M1 — prose/pseudo-decl: a page starts teaching an API name the package doesn't have.
cases.push({
  name: "M1 prose: fabricated interface taught as real",
  expect: "RED",
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
    return { args: ["--content-dir", dir, "--skip-live"] };
  },
});

// M2 — bash: install line names a package that doesn't exist.
cases.push({
  name: "M2 bash: install line typos the package name",
  expect: "RED",
  expectKind: "PACKAGE-NOT-FOUND",
  expectPage: "/http",
  setup() {
    const dir = freshContentCopy();
    const f = path.join(dir, "http", "index.md");
    let src = fs.readFileSync(f, "utf8");
    src = src.replace("yarn add @ecosy/http", "yarn add @ecosy/htttp");
    fs.writeFileSync(f, src);
    return { args: ["--content-dir", dir, "--skip-live"] };
  },
});

// M3 — a Contents-table link for one of THIS package's own names is repointed
// at a different (real, 200-returning) page. A "does this URL resolve" check
// would never see this — /orm is a perfectly good page. This is exactly the
// 0055 shape ("link sang docs.ecosy.io/core … cũng 200").
cases.push({
  name: "M3 link: Contents entry for `Route` repointed at a different real page",
  expect: "RED",
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
    return { args: ["--content-dir", dir, "--skip-live"] };
  },
});

// M4 — the PACKAGE gains an entry point (real npm/exports data) that no page
// documents. Mutates package.json, not content: the entry point genuinely
// exists and genuinely has zero documentation, which is the real shape of
// the bug this check exists for (@ecosy/core's ./crypt, ./queue, … today).
cases.push({
  name: "M4 entrypoint: package.json gains an undocumented subpath",
  expect: "RED",
  expectKind: "MISSING-ENTRYPOINT",
  expectPage: "/http",
  setup() {
    const cacheDir = freshCacheCopy();
    const pkgRoot = path.join(cacheDir, "pkg-@ecosy", "http", "package");
    // A genuinely new file with a name that appears NOWHERE in content — not
    // a repoint at an existing, already-documented .d.ts. Reusing
    // dist/index.d.ts here would make the check trivially pass, since its
    // real names (`Http`, `HttpResponse`, …) are already mentioned on the
    // page for unrelated reasons.
    fs.writeFileSync(
      path.join(pkgRoot, "dist", "turbocharge.d.ts"),
      "export declare function turbochargeExclusiveApi(): void;\n",
    );
    const pjFile = path.join(pkgRoot, "package.json");
    const pj = JSON.parse(fs.readFileSync(pjFile, "utf8"));
    pj.exports["./turbocharge"] = { types: "./dist/turbocharge.d.ts", import: "./dist/turbocharge.d.ts", require: "./dist/turbocharge.d.ts" };
    fs.writeFileSync(pjFile, JSON.stringify(pj, null, 2));
    return { args: ["--skip-live"], env: { GUARD_CACHE_DIR: cacheDir } };
  },
});

// M5 — llms.txt (an off-page copy) drops one real page from its own link
// list, drifting from content/ without anything on an actual page changing.
cases.push({
  name: "M5 off-page: llms.txt silently drops a real page",
  expect: "RED",
  expectKind: "DRIFT-LLMSTXT",
  expectPage: null,
  setup() {
    const llmsTxt = fs.readFileSync(path.join(FIXTURES, "llms.txt"), "utf8");
    const before = llmsTxt;
    const mutated = llmsTxt.replace(/^\s*- \[.*next — Route.*\n/m, "");
    if (mutated === before) throw new Error("M5 setup: the /next/route line wasn't found in the fetched llms.txt");
    const f = path.join(FIXTURES, "llms.mutated.txt");
    fs.writeFileSync(f, mutated);
    return {
      args: [
        "--llms-txt", f,
        "--llms-full", path.join(FIXTURES, "llms-full.txt"),
        "--search-json", path.join(FIXTURES, "search.json"),
        "--md-probe", path.join(FIXTURES, "md-probe-all-200.json"),
      ],
    };
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
  expect: "unknown — reporting the true outcome",
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
    return { args: ["--content-dir", dir, "--skip-live"] };
  },
});

// ---------- baseline: confirm today's real content is clean of exactly the
// findings each mutation introduces, so a case can't "pass" only because the
// bug was already there before the mutation. ----------

console.log("Baseline (unmutated content, --skip-live):");
const baseline = runGuard(["--skip-live"]);
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
    rows.push({ name: c.name, outcome: "SETUP-FAILED", detail: String(e.message) });
    continue;
  }
  const actual = result.code === 0 ? "GREEN" : "RED";
  const kindSeen = c.expectKind ? hasFinding(result.out, c.expectKind, c.expectPage) : null;
  let verdict;
  if (c.expectKind) {
    verdict = kindSeen ? "CAUGHT" : actual === "RED" ? "RED-BUT-WRONG-KIND" : "SURVIVED";
  } else {
    verdict = `OBSERVED-${actual}`; // M6: no expectation, just report
  }
  rows.push({ name: c.name, outcome: verdict, actual, detail: c.expectKind || "(n/a)" });
}

for (const r of rows) console.log(`  [${r.outcome.padEnd(20)}] ${r.name}`);

const caught = rows.filter((r) => r.outcome === "CAUGHT").length;
const wanted = cases.filter((c) => c.expectKind).length;
console.log(`\n${caught}/${wanted} required mutations caught with the expected finding kind.`);
const survivors = rows.filter((r) => r.outcome === "SURVIVED" || r.outcome === "RED-BUT-WRONG-KIND" || r.outcome === "SETUP-FAILED");
if (survivors.length) {
  console.log("Unhandled:");
  for (const s of survivors) console.log(`  - ${s.name}: ${s.outcome}${s.detail ? " — " + s.detail : ""}`);
}
