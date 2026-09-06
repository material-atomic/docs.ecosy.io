---
title: Bootstrap
import: "@ecosy/next"
order: 2
---

# Bootstrap

`Bootstrap` runs startup steps in order and keeps what they produce, and
`instrumentation.ts` is where you call it.

```ts
// src/bootstrap.ts
import { Bootstrap } from "@ecosy/next";

export const bootstrap = Bootstrap()
  .register("db", async () => DataSource.entities([User, Post]).initialize({ /* … */ }))
  .register("schedule", async () => new AppSchedule().start())
  .start(async (ctx) => {
    console.log("ready");
  });
```

```ts
// src/instrumentation.ts
import { Bootstrap } from "@ecosy/next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await Bootstrap.boost(() => import("@/bootstrap"));
  }
}
```

The runtime check belongs in this file and nowhere else. Next reads it **at
build time** to decide what each runtime's bundle carries, so a guard hidden
behind a helper — in this package or your own — leaves the import
unconditional, and everything behind it lands in the edge bundle too.

## `Bootstrap(injects?)`

```ts
function Bootstrap<Injects extends InjectMap>(injects?: Injects): IBootstrapBuilder<Injects>
```

Tokens are constructed once, when the steps run, and appear on the context each
step receives. Same contract as [`Inject`](/next/inject).

### `push`

```ts
push(fn: BootstrapInitialize<Injects>): IBootstrapBuilder<Injects>
```

Adds a step whose result is discarded.

### `register`

```ts
register(key: string, fn: BootstrapInitialize<Injects>): IBootstrapBuilder<Injects>
```

Adds a step and stores its result under `key` — unless it returns `undefined`,
in which case nothing is stored.

Steps run **in registration order, awaited**. That ordering is how dependencies
are expressed: register `db` before `schedule` and the pool exists by the time
the scheduler starts.

Both methods return a new builder rather than mutating.

### `start`

```ts
start(fn?: (context) => Promisable<void>): { init: () => Promise<void> }
```

Returns an object with `init()`, which runs every step and then `fn`. That is
the shape [`Bootstrap.boost`](#bootstrapboost) looks for, so export the result.

Note `fn` receives a **fresh** context — its tokens are constructed again, not
shared with the steps.

### `execute`

```ts
execute(): Promise<void>
```

Runs the steps immediately with no final callback. Use it when you drive
startup yourself rather than through `boost`.

### `Bootstrap.get`

```ts
Bootstrap.get<T>(key: string): T | undefined
```

Reads what a `register` step stored.

```ts
const db = Bootstrap.get<DataSource>("db");
```

The store lives on `globalThis` under `Symbol.for("SNIP_RENDER_BOOTSTRAP_STORE")`,
so it survives Next compiling the same module into several bundles — a
module-level variable does not.

### `Bootstrap.boost`

```ts
Bootstrap.boost(loader: () => Promise<any>): Promise<void>
```

Imports a module and starts whatever it finds, in this order:

1. a top-level `init()` export
2. `default.init()`, then `default.execute()`
3. any named export with `init()`, or with both `execute()` and `register()`

Useful when a bootstrap module's export name is not fixed. Where it is,
importing and calling `init()` yourself is clearer.
