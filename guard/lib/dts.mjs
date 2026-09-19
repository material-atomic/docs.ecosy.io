/*
 * Reading a package's real public surface out of its .d.ts (and its runtime
 * .mjs twin), the same way a person importing the package would discover it:
 * follow package.json#exports to find the file for a subpath, then read
 * what that file actually exports.
 *
 * Adapted from the R&D 0057 scripts (imports.mjs / surface.mjs) with one
 * addition: memberNamesOf(), which looks *inside* a class/interface/const
 * declaration for its members. Named-import resolution alone would have
 * missed the /mailer bug (`Mailer` the export exists — it used to be a class
 * with `static from`, now it's a plain function with no such member) because
 * that bug lives one level deeper than "does this name exist".
 */

import fs from "node:fs";
import path from "node:path";

function resolveFile(pkgDir, rel) {
  let f = path.join(pkgDir, rel);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
    rel = path.join(rel, "index.d.ts");
    f = path.join(pkgDir, rel);
  }
  if (!fs.existsSync(f)) {
    for (const alt of [rel + ".d.ts", rel + "/index.d.ts"]) {
      if (fs.existsSync(path.join(pkgDir, alt))) {
        f = path.join(pkgDir, alt);
        rel = alt;
        break;
      }
    }
  }
  return fs.existsSync(f) ? { f, rel } : null;
}

/** Every name a .d.ts file exports, following relative `export * from`/`export {} from`,
 * unioned with whatever its runtime .mjs twin actually exports at the top level. */
export function namesOf(pkgDir, rel, seen = new Set()) {
  const found = resolveFile(pkgDir, rel);
  if (!found || seen.has(found.f)) return new Set();
  seen.add(found.f);
  const { f, rel: relResolved } = found;
  const src = fs.readFileSync(f, "utf8");
  const out = new Set();

  for (const m of src.matchAll(
    /^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|enum|function|const|let|var|namespace)\s+([A-Za-z_$][\w$]*)/gm,
  ))
    out.add(m[1]);

  for (const m of src.matchAll(/^\s*export\s+(?:type\s+)?\{([^}]*)\}/gms))
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      const as = t.match(/\bas\s+([A-Za-z_$][\w$]*)/);
      out.add(as ? as[1] : t.replace(/^type\s+/, "").trim());
    }

  for (const m of src.matchAll(/export\s+(?:type\s+)?\*\s+from\s+["'](\.[^"']*)["']/g))
    for (const n of namesOf(pkgDir, path.join(path.dirname(relResolved), m[1]), seen)) out.add(n);

  for (const m of src.matchAll(/export\s+(?:type\s+)?\{[^}]*\}\s*from\s*["'](\.[^"']*)["']/g))
    for (const n of namesOf(pkgDir, path.join(path.dirname(relResolved), m[1]), seen)) out.add(n);

  const mjs = f.replace(/\.d\.ts$/, ".mjs");
  if (fs.existsSync(mjs)) {
    const r = fs.readFileSync(mjs, "utf8");
    for (const m of r.matchAll(/export\s*\{([^}]*)\}/g))
      for (const part of m[1].split(",")) {
        const t = part.trim();
        if (!t) continue;
        const as = t.match(/\bas\s+([A-Za-z_$][\w$]*)/);
        out.add(as ? as[1] : t);
      }
  }
  return out;
}

/** Resolve a specifier subpath ("." or "./x/y") to its `types` file via package.json#exports. */
export function resolveTypes(pkgDir, sub) {
  const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const exp = pj.exports;
  const pick = (v) => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") return v.types || v.import || v.default || v.require || null;
    return null;
  };
  if (!exp) return sub === "." ? pj.types || pj.typings || null : null;
  if (typeof exp === "string") return sub === "." ? exp : null;
  if (exp[sub] !== undefined) return pick(exp[sub]);
  for (const k of Object.keys(exp)) {
    if (!k.includes("*")) continue;
    const [pre, post] = k.split("*");
    if (sub.startsWith(pre) && sub.endsWith(post)) {
      const star = sub.slice(pre.length, sub.length - (post.length || 0));
      const t = pick(exp[k]);
      return t ? t.replace("*", star) : null;
    }
  }
  return null;
}

/** All subpaths declared in package.json#exports, minus the ones that carry no code. */
export function codeEntries(pkgDir) {
  const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const exp = pj.exports;
  if (!exp || typeof exp === "string") return ["."];
  return Object.keys(exp).filter((k) => k !== "./package.json");
}

/**
 * How often memberNamesOf() could and couldn't tell — reset per guard run by
 * check.mjs, read back into the report. This exists because the return value
 * alone hid the rate: making memberNamesOf() answer "unknown" on every call
 * changed neither the finding count nor the exit code on a real run (81/138
 * calls, 59%, were already "unknown" the day this was measured) — a blind
 * checker and a working one looked identical. See the CALLED-BUT-UNKNOWN
 * count in check.mjs's report.
 */
export const memberLookupStats = { total: 0, unknown: 0 };

export function resetMemberLookupStats() {
  memberLookupStats.total = 0;
  memberLookupStats.unknown = 0;
}

/**
 * Members declared textually inside a class/interface/const/type-alias
 * block. Returns:
 *   - a `Set` (possibly EMPTY) when the shape was fully read — an empty Set
 *     is a real assertion ("this has zero members", e.g. `type X = string`),
 *     and a `.member` access against it is wrong, same as against a Set that
 *     has members but not this one.
 *   - `null` when the shape could not be determined at all (declaration not
 *     found even after chasing re-exports, or a shape this text scan can't
 *     read — e.g. `const x: A & B` mixing an external class reference with a
 *     local object literal). `null` must never be treated as "no members" —
 *     that conflation is exactly what let the /orm and /schedule members
 *     briefly read as missing after an earlier version of this function's
 *     bugs (see the two comments below) before they were found and fixed.
 *
 * A plain `function` has no member namespace at all — checked separately by
 * isFunctionDeclaration(), not here, since a function isn't matched by
 * memberNamesOf()'s own class/interface/const/type declRe and would
 * otherwise fall into the same "unknown" bucket as a shape this scan just
 * can't read, losing the distinction between "definitely wrong" (a function
 * has no `.member`) and "can't tell".
 *
 * This is a brace-depth scan, not a real TS parser — good enough to name
 * top-level members of a declaration block without pulling in a type checker.
 */
export function memberNamesOf(pkgDir, rel, name) {
  memberLookupStats.total++;
  const result = memberNamesOfInner(pkgDir, rel, name, new Set());
  if (result === null) memberLookupStats.unknown++;
  return result;
}

function memberNamesOfInner(pkgDir, rel, name, seen) {
  const found = resolveFile(pkgDir, rel);
  if (!found) return null;
  const key = found.f + "#" + name;
  if (seen.has(key)) return null;
  seen.add(key);
  const src = fs.readFileSync(found.f, "utf8");

  // Only match the keyword+name here, NOT up through the opening brace: a
  // generic parameter default like `class Subscriber<State, Events = {}>`
  // carries its own `{}` before the real body ever starts, and a naive
  // `[^{]*\{` stops there — every member of `Subscriber` came back empty
  // this way, because the "body" it thought it found was an empty object
  // type literal, not the class.
  const declRe = new RegExp(
    "export\\s+(?:declare\\s+)?(?:abstract\\s+)?(class|interface|const|type)\\s+" + name.replace(/[$]/g, "\\$") + "\\b",
    "m",
  );
  const m = declRe.exec(src);
  if (!m) {
    // Not declared with a body here — maybe re-exported from elsewhere.
    for (const rm of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](\.[^"']*)["']/g)) {
      const names = rm[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/));
      if (names.some(([orig, alias]) => (alias || orig) === name))
        return memberNamesOfInner(pkgDir, path.join(path.dirname(found.rel), rm[2]), names.find(([orig, alias]) => (alias || orig) === name)[0], seen);
    }
    for (const rm of src.matchAll(/export\s+(?:type\s+)?\*\s+from\s+["'](\.[^"']*)["']/g)) {
      const r = memberNamesOfInner(pkgDir, path.join(path.dirname(found.rel), rm[1]), name, seen);
      if (r !== null) return r;
    }
    return null; // couldn't find the declaration at all — unknown, not "no members"
  }
  // `export declare const Json: SerializeJSON;` — a const typed by reference
  // to a separately-declared interface, not an inline object literal. There
  // is no `{` in this statement at all, so the brace-scan below would run
  // off into whatever the next declaration happens to be. Detect the
  // no-brace-before-semicolon shape first and chase the type name instead —
  // to whatever module its own `import type` brought it in from, since
  // that's where `@ecosy/core/serialize`'s `Json`/`Url`/`Primitive`/
  // `queryString` (all this shape) actually declare their members.
  if (m[1] === "const") {
    const stop = src.indexOf(";", m.index + m[0].length);
    const window = stop === -1 ? src.slice(m.index + m[0].length) : src.slice(m.index + m[0].length, stop);
    if (!window.includes("{")) {
      const aliasMatch = window.match(/^\s*:\s*([A-Za-z_$][\w$]*)\s*$/);
      if (!aliasMatch) return null;
      const aliasName = aliasMatch[1];
      const localDecl = new RegExp("export\\s+(?:declare\\s+)?(?:interface|type)\\s+" + aliasName + "\\b").exec(src);
      if (localDecl) return memberNamesOfInner(pkgDir, found.rel, aliasName, seen);
      const importMatch = src.match(
        new RegExp("import\\s+(?:type\\s+)?\\{[^}]*\\b" + aliasName + "\\b[^}]*\\}\\s*from\\s*[\"'](\\.[^\"']*)[\"']"),
      );
      if (importMatch) return memberNamesOfInner(pkgDir, path.join(path.dirname(found.rel), importMatch[1]), aliasName, seen);
      return null;
    }
  }

  let j;
  if (m[1] === "type") {
    // `type SerializeJSON = Freezable<{ stringify(...): string; ... }>;` — the
    // member-bearing object literal sits INSIDE a wrapper generic, at angle
    // depth 1, not 0. There's no extends/implements clause to protect
    // against here, so just take the first `{` after the `=` sign, wherever
    // it sits.
    const eq = src.indexOf("=", m.index + m[0].length);
    j = eq === -1 ? src.length : src.indexOf("{", eq);
    if (j === -1) return new Set(); // a union/primitive alias — REAL assertion: genuinely no members
  } else {
    // class/interface/const: scan forward from the name past any generic
    // parameter list / extends / implements clause to find the REAL opening
    // brace — a `{` only means "the body" once we're outside any `<...>`,
    // since generics can themselves contain object-type literal defaults.
    let angle = 0;
    j = m.index + m[0].length;
    while (j < src.length) {
      if (src[j] === "<") angle++;
      else if (src[j] === ">") angle = Math.max(0, angle - 1);
      else if (src[j] === "{" && angle === 0) break;
      j++;
    }
    // `const store: import("@ecosy/core").Subscriber<ThemeState, {}> & { ... }`
    // — an intersection of an external class reference with a local object
    // literal. The `{` this loop finds is only the local half; the other
    // half's members (`Subscriber`'s `dispatch`, `subscribe`, `wire`, …)
    // are real but invisible from here, and reporting the local half alone
    // as the complete member set would flag every one of them as missing.
    // Honest answer: this shape can't be verified with a text scan, so say
    // so (return null = "unknown", not "not found") rather than
    // pretend to a completeness this parser doesn't have.
    if (/[&|]\s*$/.test(src.slice(m.index + m[0].length, j)) || /\bimport\s*\(/.test(src.slice(m.index + m[0].length, j)))
      return null;
  }
  let depth = 1;
  let i = j + 1;
  const start = i;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  const body = src.slice(start, i - 1);

  const members = new Set();
  // A .d.ts class/interface body has no method implementations, so every
  // member — however many lines its generic signature spans — ends at a
  // top-level `;`. Angle brackets are deliberately NOT tracked as depth: a
  // lone `<T>` generic, an `=>` arrow, and a `Record<string, X>>` all use
  // `<`/`>` in ways that don't nest consistently, and counting them was the
  // bug that made `static create<TName extends string, TCols extends
  // Record<...>>(entityName, schema: {...}): ...;` (ecosy/orm's `Entity`)
  // read as split across a false statement boundary and lose its name.
  //
  // JSDoc is stripped BEFORE splitting, not after: `@param {string} x`-style
  // tags carry their own `{`/`}`, and counting those desynced the bracket
  // depth for every member declared after the first commented one — every
  // member of `Subscriber` (all JSDoc'd) came back empty this way.
  const bodyNoComments = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  let depthInner = 0;
  const statements = [];
  let cur = "";
  for (const ch of bodyNoComments) {
    if (ch === "{" || ch === "(" || ch === "[") depthInner++;
    else if (ch === "}" || ch === ")" || ch === "]") depthInner--;
    cur += ch;
    if (ch === ";" && depthInner <= 0) {
      statements.push(cur);
      cur = "";
    }
  }
  if (cur.trim()) statements.push(cur);
  for (const stmt of statements) {
    const t = stmt.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").trim();
    const mm = t.match(/^(?:static\s+)?(?:readonly\s+)?(?:get\s+|set\s+)?(#?[A-Za-z_$][\w$]*)\s*[(:?<;]/);
    if (mm) members.add(mm[1]);
  }
  return members;
}

/**
 * `true` when `name` is declared as a plain `function` — no member namespace
 * at all, so any `.member` reference on it is automatically wrong. Chases
 * relative re-exports the same way `memberNamesOf` does: `@ecosy/mailer`'s
 * root `index.d.ts` is `export { Mailer } from './mailer'`, not the
 * declaration itself, and the true bug here (`Mailer` used to be a class
 * with `static from`, is now a bare factory function) is invisible unless
 * this follows that one hop.
 */
export function isFunctionDeclaration(pkgDir, rel, name, seen = new Set()) {
  const found = resolveFile(pkgDir, rel);
  if (!found || seen.has(found.f + "#" + name)) return false;
  seen.add(found.f + "#" + name);
  const src = fs.readFileSync(found.f, "utf8");
  if (new RegExp("export\\s+(?:declare\\s+)?function\\s+" + name.replace(/[$]/g, "\\$") + "\\b").test(src)) return true;

  for (const rm of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](\.[^"']*)["']/g)) {
    const names = rm[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/));
    const hit = names.find(([orig, alias]) => (alias || orig) === name);
    if (hit && isFunctionDeclaration(pkgDir, path.join(path.dirname(found.rel), rm[2]), hit[0], seen)) return true;
  }
  for (const rm of src.matchAll(/export\s+(?:type\s+)?\*\s+from\s+["'](\.[^"']*)["']/g)) {
    if (isFunctionDeclaration(pkgDir, path.join(path.dirname(found.rel), rm[1]), name, seen)) return true;
  }
  return false;
}
