---
title: Search
import: "@ecosy/pack/search"
order: 2
---

# Search

```ts
import { NpmSearcher, AlgoliaSearcher } from "@ecosy/pack/search";
```

Finding a package is separate from serving one. Neither esm.sh nor jsDelivr has
a search endpoint, and both serve npm packages, so one npm-backed searcher
covers every adapter — which is why `Searcher` is its own port rather than part
of [`Adapter`](/pack/adapters).

Both implementations are on the `/search` subpath, so a build that only mirrors
does not carry them.

```ts
export const Vendor = Pack(EsmAdapter)
  .mount("/services/vendor")
  .search(AlgoliaSearcher)
  .cache(DiskCache(".cache"));

const hits = await vendor.search("react", { limit: 10 });
```

## `Searcher`

```ts
interface Searcher {
  search(query: string, options?: PackSearchOptions): Promise<PackSearchHit[]>;
}

interface PackSearchOptions {
  limit?: number;       // default 20
  signal?: AbortSignal;
}

interface PackSearchHit {
  name: string;
  version: string;
  description: string;
  types?: "included" | "definitely-typed" | "none";
  deprecated?: boolean;
  downloadsLastMonth?: number;
  links?: { npm?: string; homepage?: string; repository?: string };
}
```

## `AlgoliaSearcher`

The index behind npmjs.com, yarnpkg.com and jsdelivr.com. Better relevance than
the registry endpoint, and it carries what a package picker wants to show.

```ts
Pack(EsmAdapter).search(AlgoliaSearcher)
```

Fills every field of `PackSearchHit`, including `types`, `deprecated` and
`downloadsLastMonth`.

Uses the public search-only credentials those sites ship in their own client
bundles — they permit queries against the `npm-search` index and nothing else.
Nothing to configure, and no account of your own.

## `NpmSearcher`

The npm registry's own search endpoint.

```ts
Pack(EsmAdapter).search(NpmSearcher)
```

Fills `name`, `version`, `description` and `links` only — no `types`, no
`deprecated`, no download counts.

Sends `access-control-allow-origin: *`, so it works from a browser without a
proxy. Prefer it when you want no third-party credentials in play, even public
ones.

| | `AlgoliaSearcher` | `NpmSearcher` |
|---|---|---|
| relevance | better | plain |
| TypeScript flag | yes | no |
| deprecation flag | yes | no |
| download counts | yes | no |
| credentials | public, embedded | none |

## `loader.search`

```ts
search(query: string, options?: PackSearchOptions): Promise<PackSearchHit[]>
```

Goes through the cache when there is one. An empty or whitespace-only query
returns `[]` without a request.

**Throws** when no searcher was configured — returning an empty list would read
as "no such package".

### Caching

Caching matters more here than it looks. A search box debounced per keystroke
asks for every prefix of what the user types, and each is a request to a third
party that also rate-limits.

Keys are namespaced separately from module keys (`<namespace>-search-<hash>`),
so the two can never collide, and normalised — `"React"`, `"react"` and
`" react "` are one entry, not three.

Entries carry their own `expiresAt` rather than relying on the cache to hold a
TTL, so any `Cacher` works, including one configured to keep module files
forever. That is the right setting for modules and the wrong one for searches:

```ts
Pack(EsmAdapter)
  .cache(DiskCache(".cache"))   // no TTL — right for pinned modules
  .searchTtl(600)               // 10 min — searches expire on their own
```

Default `searchTtl` is 600 seconds. The searcher receives the query **as
typed**, since case can affect relevance; only the cache key is normalised.

## Writing one

```ts
import type { Searcher, PackSearchHit, PackSearchOptions } from "@ecosy/pack";

export class MyRegistrySearcher implements Searcher {
  async search(query: string, options: PackSearchOptions = {}): Promise<PackSearchHit[]> {
    const text = query.trim();
    if (!text) return [];

    const res = await fetch(`https://registry.internal/search?q=${encodeURIComponent(text)}`, {
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`registry returned ${res.status}`);

    const data = await res.json();
    return data.results.map(/* … */);
  }
}
```

Unlike [`Fetcher`](/pack#fetcher), a searcher **may throw** — a failed search is
reported to the user, while a failed module fetch has to be distinguishable
from an upstream error status. Honour `options.signal` so a superseded
keystroke cancels its request.
