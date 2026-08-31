---
title: Cache
import: "@ecosy/core/cache"
order: 4
---

# Cache

```ts
import { DiskCache, RedisCache, MemoryCache, type Cacher } from "@ecosy/core/cache";
```

Node-only, and not re-exported from the package index — you must name the
subpath. That is what keeps `node:fs` out of a browser bundle for anyone
importing `@ecosy/core` for utilities.

## `Cacher`

```ts
interface Cacher {
  get<Value>(key: string): Promise<Value | null>;
  set<Value>(key: string, value: Value): Promise<void>;
  delete(key: string): Promise<void>;
}
```

The interface every implementation here satisfies, and the one to declare if
you write your own. Two rules hold across all of them:

- **A miss is `null`, never a throw.** Branch on the value.
- **Writes are best-effort.** A write that fails calls `onError` and resolves;
  it does not reject.

So no caller needs `try`/`catch` around cache access. Three methods and
structural typing also mean a consumer can declare this shape itself and take
no dependency on this package.

## `CacherClass`

```ts
type CacherClass = new () => Cacher;
```

A cache constructible with no arguments — what an injector needs from a token.
`DiskCache` and `RedisCache` are factories that capture configuration and hand
one of these back.

## `MemoryCache`

```ts
class MemoryCache implements Cacher
```

Held in a `Map` in process memory. Already zero-argument, so it is injected as
itself, not called:

```ts
Pack(EsmAdapter).cache(MemoryCache)
```

Values are stored by reference with no JSON round trip. Dies with the process
and is not shared between instances — for tests and short-lived work.

## `DiskCache`

```ts
function DiskCache(dir?: string, init?: DiskCacheInit): CacherClass
```

```ts
interface DiskCacheInit {
  onError?: (error: unknown, key: string) => void;
}
```

| | |
|---|---|
| `dir` | Directory holding the files. Defaults to `<cwd>/.cache`. |
| `init.onError` | Called when a write fails. Defaults to `console.warn`. |
| **returns** | A `CacherClass` — pass the class, do not instantiate it. |

```ts
Pack(EsmAdapter).cache(DiskCache(configs.env.cache.dir))
```

One JSON file per key. Survives a restart, which is what separates it from
`MemoryCache`; it does **not** survive the instance being replaced, and two
instances do not share it.

Values go through `JSON.stringify`, so they must survive the round trip — plain
objects, arrays, strings, numbers. Not `Date`, `Map`, or class instances.

Keys are percent-encoded into filenames, so any string is accepted, but the
result still has to be a legal filename. Keep keys under ~200 characters and
hash anything derived from arbitrary input.

## `RedisCache`

```ts
function RedisCache(client: RedisLike, init?: RedisCacheInit): CacherClass
```

```ts
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

interface RedisCacheInit {
  prefix?: string;
  ttlSeconds?: number;
  onError?: (error: unknown, key: string) => void;
}
```

| | |
|---|---|
| `client` | Anything matching `RedisLike`. |
| `init.prefix` | Prepended to every key. Include your own separator, e.g. `"vendor:"`. |
| `init.ttlSeconds` | Expiry for written keys. Omit for none. |
| `init.onError` | Called when a write fails. Defaults to `console.warn`. |
| **returns** | A `CacherClass`. |

```ts
Pack(EsmAdapter).cache(RedisCache(client, { prefix: "vendor:" }))
```

`RedisLike` is a port, not an import — this package has no dependencies. Both
`ioredis` and `node-redis` already match `get`, `set(key, value)` and `del`, so
either can be passed directly when you do not use a TTL.

TTL is where the two clients diverge (`ioredis.setex(key, seconds, value)`
against `node-redis.setEx(key, seconds, value)`), so adapt at the call site:

```ts
RedisCache({
  get: (k) => redis.get(k),
  set: (k, v, ttl) => (ttl ? redis.setex(k, ttl, v) : redis.set(k, v)),
  del: (k) => redis.del(k),
}, { prefix: "vendor:", ttlSeconds: 3600 })
```

Omitting `ttlSeconds` is reasonable for content addressed by an immutable key
and a mistake for anything else — a shared Redis has no other bound on growth.

Values go through `JSON.stringify`, the same as `DiskCache`, so a key written
by one is readable by the other. A value that is missing, or present but not
valid JSON, comes back as `null`.

## `defaultOnError`

```ts
const defaultOnError: CacheErrorHandler
```

Writes the failure to `console.warn`. Note that this package is built with
terser's `drop_console`, so in the published build a failed write is **silent**
— pass your own `onError` if you need visibility.

## Writing your own

Satisfy `Cacher` and keep the two rules. A zero-argument class is injectable
directly; anything needing configuration follows the factory shape:

```ts
export function S3Cache(bucket: string): CacherClass {
  return class implements Cacher {
    async get<V>(key: string): Promise<V | null> { /* ... */ }
    async set<V>(key: string, value: V): Promise<void> { /* ... */ }
    async delete(key: string): Promise<void> { /* ... */ }
  };
}
```
