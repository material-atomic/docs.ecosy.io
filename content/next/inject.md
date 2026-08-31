---
title: Inject
import: "@ecosy/next/inject"
order: 3
---

# Inject

```ts
import { Inject } from "@ecosy/next/inject";
```

The dependency-injection primitive underneath [`Route`](/next/route) and
[`Bootstrap`](/next/bootstrap), usable on its own.

## `Inject(map)`

```ts
function Inject<Injects extends InjectMap>(injects: Injects): ClassType<Injected<{}, Injects>>
```

| | |
|---|---|
| `injects` | `{ property: ClassToken }` — each token is constructed with no arguments. |
| **returns** | A class whose instances have one property per key, typed as that token's instance. |

Because it returns a class, `extends` is how dependencies arrive:

```ts
class Vendor extends Inject({ fetcher: HttpClient, cache: AppCache }) {
  async load(url: string) {
    return this.fetcher.get(url);   // typed, already constructed
  }
}

const vendor = new Vendor();
```

The subclass gets the injected members plus its own — no wrapper object, no
delegation, no container to register with.

If your subclass declares a constructor, call `super()` first; that is where
the injection happens.

## `Inject.inject(obj, map)`

```ts
function inject<Obj, Injects extends InjectMap>(obj: Obj, injects: Injects): void
```

Injects onto an existing object instead of through inheritance. This is what
`Route` uses to put tokens on a request context.

```ts
const ctx = { request };
Inject.inject(ctx, { db: Database });

ctx.db.query(/* … */);
```

Properties are defined as `enumerable` and `configurable`, not writable-guarded
— injecting a key that already exists replaces it.

## Tokens

```ts
type ClassType<Instance = unknown> = new () => Instance;
type InjectMap = { [key: string]: ClassType };
```

A token is a class constructible with **no arguments**. Anything that needs
configuration is produced by a factory that captures it and returns such a
class:

```ts
export function Fetcher(baseURL: string, init = {}): ClassType<Http> {
  return class extends Http {
    constructor() {
      super({ ...init, baseURL, allowedOrigins: [baseURL] });
    }
  };
}

class Google extends Inject({ fetcher: Fetcher("https://oauth2.googleapis.com") }) {}
```

The same shape appears across the ecosystem — [`DiskCache(dir)`](/core/cache),
[`Source(fn)`](/schedule/source), [`Pack(adapter)`](/pack) all return classes,
so all of them drop into an `InjectMap` directly.

Pass the class, not an instance:

```ts
Inject({ cache: DiskCache(".cache") })     // correct
Inject({ cache: new (DiskCache(".cache"))() })  // wrong — not a token
```

## Lifetime

A token is constructed **every time** the containing class is. For a route
that means once per request.

Anything worth reusing should be a singleton captured by the factory, with the
token handing the same instance out:

```ts
export function SharedPool(url: string): ClassType<Pool> {
  const pool = new Pool(url);            // created once
  return class {
    constructor() { return pool; }       // same instance each time
  } as ClassType<Pool>;
}
```

## `Injected`

```ts
type Injected<Context, Injects extends InjectMap> = Context & {
  [K in keyof Injects]: Injects[K] extends ClassType<infer Instance> ? Instance : never;
};
```

The result type — a context plus its injected members. This is what a
[route handler](/next/route) receives.
