---
title: Bootstrap and Instrument
import: "@ecosy/next"
order: 2
---

# Bootstrap and Instrument

`Bootstrap` runs startup steps in order and keeps what they produce.
`Instrument` wires that into Next's `instrumentation.ts`, split by runtime.

```ts
// src/app/api/bootstrap.ts
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
import { Instrument } from "@ecosy/next";

export const { register, onRequestError } = Instrument
  .nodejs({ bootstrap: [() => import("@/app/api/bootstrap")] })
  .error((err, req, ctx) => report(err))
  .start();
```

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

Returns an object with `init()`, which runs every step and then `fn`. This is
the shape `Instrument`'s `bootstrap` importers look for, so export the result.

Note `fn` receives a **fresh** context — its tokens are constructed again, not
shared with the steps.

### `execute`

```ts
execute(): Promise<void>
```

Runs the steps immediately with no final callback. Use it when you drive
startup yourself instead of going through `Instrument`.

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

## `Instrument`

A builder registering work per runtime.

```ts
Instrument.nodejs(param)    // NEXT_RUNTIME === "nodejs"
Instrument.edge(param)      // NEXT_RUNTIME === "edge"
Instrument.browser(param)   // typeof window !== "undefined"
Instrument.error(fn)
Instrument.start()
Instrument.execute()
```

Each returns a new builder. `param` is either a function or a config:

```ts
type InstrumentParam = (() => Promisable<unknown>) | { bootstrap?: (() => Promisable<unknown>)[] };
```

```ts
Instrument.nodejs(async () => { await connect(); })
Instrument.nodejs({ bootstrap: [() => import("@/app/api/bootstrap")] })
```

A `bootstrap` importer that throws is caught and warned about — the remaining
importers still run.

Only the branch matching the current runtime executes, so Node-only work — a
database, the filesystem, a scheduler — belongs under `.nodejs(...)` and never
reaches an edge bundle.

### `start`

```ts
start(): {
  register: () => Promise<void>;
  onRequestError: (err: unknown, req: unknown, ctx: unknown) => Promise<void>;
}
```

Exactly the two exports Next's `instrumentation.ts` expects. Handlers given to
`.error()` run in registration order on every request error.

## Guard anything with a lifetime

`register()` is called once per server process, and in development a hot reload
re-evaluates the module. A boot step that starts a timer, opens a pool or
registers a scheduler will do so **again** on each of those.

Guard with the same global-symbol trick the store uses:

```ts
const KEY = Symbol.for("app:booted");
const g = globalThis as any;

Bootstrap().push(async () => {
  if (g[KEY]) return;
  g[KEY] = true;
  startScheduler();
});
```

Without a guard, the symptom is a timer firing twice, then four times — which
reads like a scheduling bug rather than a boot one.

## Types

```ts
type BootstrapInitialize<Injects extends InjectMap = {}> =
  (context: Injected<BootstrapContext, Injects>) => Promisable<unknown>;

type InstrumentHandler = () => Promisable<unknown>;
type InstrumentErrorHandler = (err: any, req: any, ctx: any) => Promisable<unknown>;
type InstrumentParam = InstrumentHandler | InstrumentConfig;

interface InstrumentConfig {
  bootstrap?: (() => Promisable<unknown>)[];
}
```
