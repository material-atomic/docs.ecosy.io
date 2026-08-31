---
name: "@ecosy/core"
type: module
status: stable
repo: material-atomic/ecosy-core
npm: "@ecosy/core"
summary: Utilities, serialisation, a state-and-events primitive, caching, and in-process monitoring — each reachable on its own.
---

# @ecosy/core

```bash
yarn add @ecosy/core
```

Zero dependencies.

## Entry points

| Import | Holds |
|---|---|
| `@ecosy/core` | Everything from `utilities`, `serialize` and `subscriber` |
| [`@ecosy/core/utilities`](/core/utilities) | `clone`, `merge`, `freeze`, `isEqual`, `get`, `flatten`, `slugify`, `searchify`, type guards |
| [`@ecosy/core/serialize`](/core/serialize) | Safe JSON, URL encoding, query strings, `{key}` interpolation |
| [`@ecosy/core/subscriber`](/core/subscriber) | State plus typed event channels |
| [`@ecosy/core/cache`](/core/cache) | `Cacher` with disk, memory and Redis implementations |
| [`@ecosy/core/syhemo`](/core/syhemo) | Runtime monitoring, Prometheus-shaped |
| [`@ecosy/core/types`](/core/types) | Shared type helpers |

`cache` and `syhemo` are **not** in the root export. Both use `node:fs`, `v8`
and `os`, and a browser bundle that imported `freeze` should not have to carry
them. Import those two by subpath.

Finer subpaths exist for the parts most often wanted alone:

```ts
import { slugify } from "@ecosy/core/slugify";
import { searchify } from "@ecosy/core/searchify";
import { Primitive } from "@ecosy/core/serialize/primitive";
import { queryString } from "@ecosy/core/serialize/query-string";
import { BufferedLogger } from "@ecosy/core/syhemo/logger";
```

These are the same objects as on the wider entry points, so mixing import
styles is free.

## Quick reference

```ts
import { clone, merge, get, Serialize, Subscriber } from "@ecosy/core";

clone({ a: { b: 1 } });                          // deep copy, cycle-safe
merge({ a: 1 }, { b: 2 });                       // { a: 1, b: 2 }
get(data, "users[0].name", "N/A");               // safe path read

Serialize.JSON.stringify({ big: 1n });           // never throws
Serialize.queryString.stringify({ page: 1 });    // "page=1"

const sub = new Subscriber({ count: 0 });
sub.onStateChange((state) => render(state));
sub.setState({ count: 1 });
```

```ts
import { DiskCache } from "@ecosy/core/cache";
import { Syhemo, CONTENT_TYPE } from "@ecosy/core/syhemo";
```

## Requirements

TypeScript 5.0+ for the type helpers. `cache` and `syhemo` need Node 18+;
everything else runs in any ES2020 environment, browsers included.
