---
name: "@ecosy/pack"
type: module
status: beta
repo: material-atomic/ecosy-pack
npm: "@ecosy/pack"
summary: Mirror an npm CDN through your own origin — resolve, fetch, rewrite specifiers, cache, and search.
---

# @ecosy/pack

```bash
yarn add @ecosy/pack
```

Serves npm packages from your own origin by proxying a CDN. It resolves a
request path to an upstream URL, rewrites the module's own specifiers back to
your mount, and caches the result.

```ts
import { Pack, EsmAdapter } from "@ecosy/pack";
import { AlgoliaSearcher } from "@ecosy/pack/search";
import { DiskCache } from "@ecosy/core/cache";

export const Vendor = Pack(EsmAdapter)
  .mount("/services/vendor")
  .namespace("vendor")
  .fetch(HttpFetcher)
  .search(AlgoliaSearcher)
  .cache(DiskCache(".cache"));
```

Zero dependencies.

## Why a mirror needs rewriting

A CDN that resolves dependencies for you emits **root-absolute** specifiers:

```js
export * from "/marked@14.1.3/es2022/marked.mjs";
```

Served from your origin, that resolves against *your* root and 404s. The entry
file loads fine and the failure appears one hop in, looking unrelated. The
adapter's `rewrite` points those back at your mount.

## `Pack(adapter | options)`

```ts
function Pack(options: Provided<Adapter> | PackOptions): PackBuilder
```

Returns a **class**, so it drops straight into an injector with no terminal
call:

```ts
export const { GET } = Route({ vendor: Vendor }).get(async (ctx) => {
  const target = ctx.vendor.resolve(ctx.params.path);
  // …
});
```

Every step returns another class, so a half-configured chain and a finished
token are the same thing. For code outside an injector, `.create()` gives one
instance, or `new Vendor()`.

| step | |
|---|---|
| `.mount(path)` | URL prefix the loader is served at. **Required.** |
| `.namespace(name)` | Cache key prefix. Defaults to the adapter's `name`. |
| `.key(extractor)` | URL → cache key. Defaults to `HashKey`. |
| `.cache(cacher)` | Without one, `read` always misses and `write` does nothing. |
| `.fetch(fetcher)` | Without one, `fetchUpstream` throws. |
| `.search(searcher)` | Without one, `search` throws. |
| `.searchTtl(seconds)` | Search cache lifetime. Default 600. |
| `.create()` | One `PackLoader` instance. |

Each accepts either an instance or a class token — a class is constructed for
you, matching [`Inject`](/next/inject).

Constructing without `.mount()` throws:

```
Pack: mount is required — call .mount('/your/prefix') before constructing.
```

## Serving a route

```ts
// app/(proxy)/services/vendor/[...path]/route.ts
export const { GET } = Route({ vendor: Vendor }).get(async (ctx) => {
  const target = ctx.vendor.resolve(ctx.params.path, ctx.url.search);
  if (!target) throw new BadRequest("Invalid package path");

  const key = ctx.vendor.cacheKey(target);
  const cached = await ctx.vendor.read(key);

  if (cached) {
    return new Response(cached.body, { headers: { "Content-Type": cached.contentType } });
  }

  const upstream = await ctx.vendor.fetchUpstream(target);

  if (upstream.status === 0) throw new BadGateway("Registry unreachable");
  if (!upstream.success) throw new Exception(upstream.status, "Upstream error", null);

  const module = ctx.vendor.toModule(upstream);
  await ctx.vendor.write(key, module);

  return new Response(module.body, { headers: { "Content-Type": module.contentType } });
});
```

## `PackLoader`

### `resolve`

```ts
resolve(segments: string | string[] | undefined, search?: string): string | null
```

Request path → upstream URL, or `null` when the path is unsafe. Empty
segments and `.`/`..` are rejected, so a caller can treat `null` as a 400 with
no path checking of its own.

Segments are used **as given**, assuming your router already decoded them —
re-encoding would turn `sucrase@3.35.1` into `sucrase%403.35.1`, which the CDN
does not serve.

### `cacheKey`

```ts
cacheKey(target: string): string
```

`<namespace>-<hash>`. Namespaced so one cache can hold several loaders.

### `read` / `write`

```ts
read(key: string): Promise<PackModule | null>
write(key: string, module: PackModule): Promise<void>
```

With no cacher, `read` always returns `null` and `write` does nothing — the
mirror still works, unchanged, just without caching.

Module files are cached with **no TTL**: a pinned version is immutable, so the
entry never goes bad.

### `fetchUpstream`

```ts
fetchUpstream(target: string): Promise<PackResponse>
```

Sends the adapter's `headers` with the request. **Throws** when no fetcher was
given — a missing dependency is a wiring mistake, not a runtime condition, and
reporting it as `status: 0` would hide it behind a retry that can never
succeed.

Check `status === 0` for "never reached upstream" and branch to a 502
separately from an upstream error status.

### `toModule`

```ts
toModule(response: PackResponse): PackModule
```

```ts
interface PackModule {
  body: string;
  contentType: string;
}
```

Applies `rewrite` when the content type is JavaScript, and passes anything else
through untouched. Content type defaults to `application/javascript` when the
response carries none.

### `search`

```ts
search(query: string, options?: PackSearchOptions): Promise<PackSearchHit[]>
```

See [Search](/pack/search).

### `isJavaScript`

```ts
isJavaScript(contentType: string): boolean
```

Matches `javascript` or `ecmascript`, case-insensitively.

## `HashKey`

```ts
const HashKey: KeyExtractor
```

The default. FNV-1a twice with different offsets, concatenated to a 64-bit hex
key — plain JavaScript, because `node:crypto` is absent in a browser and Web
Crypto is asynchronous, and depending on either would decide where this package
can run.

Not cryptographic. It defends against two ordinary URLs colliding, not against
a chosen input. Pass your own for SHA-256, a shorter key, or a readable one:

```ts
Pack(EsmAdapter).key({ extract: (url) => encodeURIComponent(url) })
```

The one hard requirement is determinism: the same URL must give the same key,
or the cache never hits and only grows.

## Ports

Everything optional is structural, so a host that already owns a cache or an
HTTP client satisfies these with no import from this package.

### `Fetcher`

```ts
interface Fetcher {
  get(url: string, init?: { headers?: Record<string, string> }): Promise<PackResponse>;
}

interface PackResponse {
  status: number;
  success: boolean;
  data: string | null;
  headers: Record<string, string>;
  error?: unknown;
}
```

**No implementation ships with this package.** An application reaching
third-party hosts already owns an HTTP client with its own origin rules,
timeouts and instrumentation; a second one here would be two to maintain.

Two requirements:

- **Resolve, never throw**, on a failed request — report it as `status: 0`, so
  the loader needs no `try`/`catch`.
- Take an **init object**, not a bare header map. A bare map type-checks
  against an existing client anyway — TypeScript compares method parameters
  bivariantly — and then silently drops the headers at runtime.

```ts
import { Fetcher as HttpFetcher } from "@ecosy/http";

const client = HttpFetcher({ baseURL: EsmAdapter.upstream });

class PackFetcher {
  get(url: string, init?: { headers?: Record<string, string> }) {
    return client.http.get<string>(url, { headers: init?.headers });
  }
}
```

### `Cacher`

```ts
interface Cacher {
  get<Value>(key: string): Promise<Value | null>;
  set<Value>(key: string, value: Value): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Identical to [`@ecosy/core/cache`](/core/cache), so `DiskCache`, `RedisCache`
and `MemoryCache` drop in directly. A miss must be `null`, and writes must be
best-effort.

### `KeyExtractor`

```ts
interface KeyExtractor {
  extract(target: string): string;
}
```

### `Adapter` and `Searcher`

See [Adapters](/pack/adapters) and [Search](/pack/search).

## Types

```ts
type ClassType<Instance = unknown> = new () => Instance;
type Provided<T> = T | ClassType<T>;

interface PackOptions {
  adapter: Provided<Adapter>;
  mount?: string;
  keyExtractor?: Provided<KeyExtractor>;
  namespace?: string;
  cacher?: Provided<Cacher>;
  fetcher?: Provided<Fetcher>;
  searcher?: Provided<Searcher>;
  searchTtlSeconds?: number;
}
```

`Pack` also accepts a full `PackOptions` object instead of a chain.
