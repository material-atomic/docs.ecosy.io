/*
 * npm surface acquisition — the "sự thật" half of the guard.
 *
 * Two known traps, both paid for by R&D 0057 and recorded here so nobody
 * pays for them twice:
 *
 *   1. `npm view <pkg> readme` reads the ABBREVIATED packument and always
 *      comes back empty. We never read READMEs here, but the same
 *      abbreviated-packument trap applies to `versions` — fetch the FULL
 *      packument (https://registry.npmjs.org/<pkg>, no Accept header trick)
 *      instead of trusting `npm view --json`, which is fine for a single
 *      scalar like `version` but not guaranteed complete for arrays.
 *
 *   2. A package "in the workspace" (still unreleased — @ecosy/next 2.0.0 at
 *      the time of writing) is read from its local `dist/`, read-only, never
 *      from npm. `resolvePackage()` takes an explicit override map for this.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Overridable so the mutation harness (guard/mutate.mjs) can point a run at a
// throwaway copy of the cache with one package.json deliberately altered,
// without ever touching the real cache other runs share.
const CACHE_DIR = process.env.GUARD_CACHE_DIR || path.join(import.meta.dirname, "..", ".cache");

function slug(name) {
  return "pkg-" + name;
}

/** Full packument, not the abbreviated one `npm view` hands back. */
export async function fetchPackument(name) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`);
  if (!res.ok) throw new Error(`registry ${name}: HTTP ${res.status}`);
  return res.json();
}

/** Download+extract `latest` into the cache dir if not already there. Returns the package dir. */
export function ensureTarball(name, version) {
  const dir = path.join(CACHE_DIR, slug(name));
  const pkgDir = path.join(dir, "package");
  if (fs.existsSync(pkgDir)) return pkgDir;
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("npm", ["pack", `${name}@${version}`, "--pack-destination", dir], { stdio: "pipe" });
  const tgz = fs.readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`npm pack produced no tarball for ${name}@${version}`);
  execFileSync("tar", ["-xzf", path.join(dir, tgz), "-C", dir], { stdio: "pipe" });
  return pkgDir;
}

/**
 * Resolve one package's "surface source": either the workspace dist (for a
 * package still unreleased) or a freshly-fetched npm tarball of `latest`.
 * Returns { dir, version, source: "workspace"|"npm", versions: string[] }.
 */
export async function resolvePackage(name, { workspaceOverrides = {} } = {}) {
  if (workspaceOverrides[name]) {
    const dir = workspaceOverrides[name];
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return { dir, version: pj.version, source: "workspace", versions: [pj.version] };
  }
  const packument = await fetchPackument(name);
  const version = packument["dist-tags"].latest;
  const dir = ensureTarball(name, version);
  return { dir, version, source: "npm", versions: Object.keys(packument.versions || {}) };
}
