---
title: Adapters
import: "@ecosy/pack"
order: 1
---

# Adapters

```ts
import { EsmAdapter, JsDelivrAdapter, type Adapter } from "@ecosy/pack";
```

An adapter says **where packages come from**. It is the one required
dependency — every registry answers a different URL shape and emits a different
kind of specifier, so there is no sensible default.

## `Adapter`

```ts
interface Adapter {
  readonly name: string;
  readonly upstream: string;
  readonly headers?: Record<string, string>;

  resolve(segments: string | string[] | undefined, search?: string): string | null;
  rewrite(source: string, mount: string): string;
}
```

| | |
|---|---|
| `name` | Short identifier, used as the default cache namespace. |
| `upstream` | Origin fetched from. |
| `headers` | Sent with every upstream request. |
| `resolve` | Request path → upstream URL, or `null` when the path is unsafe. |
| `rewrite` | Points the module's own specifiers back at `mount`. |

## `EsmAdapter`

```ts
class EsmAdapter implements Adapter {
  readonly name = "esm";
  static readonly upstream = "https://esm.sh";
}
```

npm packages built and dependency-resolved on the fly.

```ts
Pack(EsmAdapter).mount("/services/vendor")
```

```
/services/vendor/marked@14.1.3  →  https://esm.sh/marked@14.1.3
```

Because esm.sh resolves dependencies, the modules it returns import each other
by root-absolute path, and `rewrite` redirects those:

```js
// upstream
export * from "/marked@14.1.3/es2022/marked.mjs";
// served
export * from "/services/vendor/marked@14.1.3/es2022/marked.mjs";
```

### The User-Agent matters

```ts
readonly headers = { "User-Agent": "Mozilla/5.0 (ecosy-pack)" };
```

esm.sh varies its build on User-Agent. Without a browser one it serves a
Node-targeted module to what is ultimately a browser, and the failure surfaces
much later as a missing global. If you write your own `Fetcher`, make sure it
actually forwards `init.headers`.

`upstream` is available as a static, so you can wire the origin into a fetcher
without constructing the adapter — which would defeat passing the adapter class
itself as a token:

```ts
Pack(EsmAdapter).fetch(Fetcher(EsmAdapter.upstream))
```

## `JsDelivrAdapter`

```ts
class JsDelivrAdapter implements Adapter {
  readonly name = "jsdelivr";
  static readonly upstream = "https://cdn.jsdelivr.net";
}
```

npm files served raw, plus a `/+esm` build. The `/npm/` prefix is added on the
way out and stripped on the way back, so a mount path looks the same whichever
adapter is behind it.

```
/services/vendor/marked@14.1.3/+esm  →  https://cdn.jsdelivr.net/npm/marked@14.1.3/+esm
```

The two upstream paths behave differently, and the difference decides whether
mirroring works at all:

| path | imports | mirror-able |
|---|---|---|
| raw file, e.g. `/npm/marked@14.1.3/lib/marked.esm.js` | bare specifiers (`"react"`) | no — the page needs an import map |
| `/+esm` | root-absolute (`"/npm/react@19.2.8/+esm"`) | yes — `rewrite` handles it |

Nothing here can rewrite a bare specifier, because resolving it is the job of
whoever loads the module. Use `/+esm` paths when you want the mirror to be
self-contained.

## Choosing

| | esm.sh | jsDelivr |
|---|---|---|
| dependency resolution | always | on `/+esm` only |
| raw published files | no | yes |
| build varies on UA | yes | no |
| self-contained mirror | yes | `/+esm` only |

Neither has a search endpoint — that is [npm's job](/pack/search), which is why
`Searcher` is a separate port rather than part of `Adapter`.

## Writing one

```ts
import type { Adapter } from "@ecosy/pack";

export class UnpkgAdapter implements Adapter {
  readonly name = "unpkg";
  static readonly upstream = "https://unpkg.com";
  readonly upstream = UnpkgAdapter.upstream;

  resolve(segments: string | string[] | undefined, search = ""): string | null {
    const parts = Array.isArray(segments) ? segments : segments ? [segments] : [];
    if (parts.length === 0) return null;
    if (parts.some((p) => !p || p === "." || p === "..")) return null;
    return `${this.upstream}/${parts.join("/")}${search}`;
  }

  rewrite(source: string, mount: string): string {
    return source.replace(
      /(\bfrom\s*|\bimport\s*\(?\s*)(["'])\/(?!\/)/g,
      (_m, keyword: string, quote: string) => `${keyword}${quote}${mount}/`,
    );
  }
}
```

Two things `resolve` must do:

- Return `null` for empty segments and for `.` / `..`, so path traversal cannot
  reach outside the upstream namespace.
- Leave segments encoded exactly as the router handed them over.

And `rewrite` must not touch `//` — a protocol-relative URL is already
absolute, and rewriting it would point a cross-origin import at your mount.
