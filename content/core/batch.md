---
title: Batch
import: "@ecosy/core/batch"
order: 7
---

# Batch

```ts
import { Batch } from "@ecosy/core/batch";
```

Not re-exported from the package index — reach it by subpath. `Batch` builds a
class whose `add` method gathers items added under the same group key, then
hands the whole group to one `flush` call together — the shape a request
coalescer needs, not a shape tied to logging or to any one caller.

Needs only `setTimeout` and `queueMicrotask`, so it runs anywhere those exist:
Node, edge runtimes, and browsers alike.

## `BatchOptions`

```ts
interface BatchOptions {
  window?: number;
  max?: number;
  storageKey?: string;
}
```

| | |
|---|---|
| `window` | Milliseconds to keep gathering after the first item of a group arrives. `0` (default) gathers whatever else arrives in the same turn of the event loop, adding next to no delay. |
| `max` | Items after which a group is flushed without waiting for the window. `0` or absent: no limit. |
| `storageKey` | Shares the groups on `globalThis` under this name, so a module evaluated more than once — Next's proxy and route layers, say — gathers into the same groups. Without it the groups belong to the class returned by this call alone. |

`window` and `max` must each be `0` or more; a negative value throws
`TypeError`.

## `Batch`

```ts
import type { BatchClass, BatchOptions } from "@ecosy/core/batch";

declare function Batch(options?: BatchOptions): BatchClass;
```

Builds a batch token class. Like a queue built the same way, the state lives
with the class, not its instances: every `new AppBatch()` gathers into the
same groups. Anchor the class with `@ecosy/anchor` where a module is
evaluated more than once.

## `BatchToken`

```ts
import type { BatchHandler } from "@ecosy/core/batch";

interface BatchToken {
  add<Item, Result = void>(group: string, item: Item, handler: BatchHandler<Item, Result>): Promise<Result | undefined>;
  pending(group: string): Promise<void>;
  flush(group: string): Promise<void>;
}
```

**`add(group, item, handler)`.** Adds `item` to `group`. The first call for a
group that is not currently gathering opens it — starting its window timer
(or, with `window: 0`, queuing a microtask) — and **that call's `handler` is
the one that flushes the whole group**; a `handler` passed by a later call
into an already-open group is never used. Returns a promise for this item's
own slot of the flush's result.

**`pending(group)`.** Resolves once every item added to `group` up to this
call has been flushed, however that flush ended — win or throw. Never
rejects, so it is safe to `await` for a clean shutdown without a `try`/`catch`.

**`flush(group)`.** Closes `group` now instead of waiting out its window or
`max`, and resolves once that flush has finished. Calling it on a group with
nothing currently gathering resolves right away — including right after
`flush` (or the window, or `max`) has already closed the group, since the
group leaves `add`'s bookkeeping the moment its flush starts, not when the
flush's own work finishes. Use `pending` to wait for a flush already under
way instead.

## `BatchHandler`

```ts
import type { Promisable } from "@ecosy/core/types";

interface BatchHandler<Item, Result = void> {
  flush(items: Item[]): Promisable<Result[] | void>;
}
```

Called once per closed group, with every item added to it, in the order they
were added. Resolve with one result per item, in the same order, to hand each
caller its own; resolve with nothing (or `undefined`) and every caller's
`add` resolves to `undefined`. Throwing rejects every caller's `add` in that
flush with the same error — a group is one unit of success or failure.

## `BatchClass`

```ts
import type { BatchToken } from "@ecosy/core/batch";
import type { ClassType } from "@ecosy/core/types";

type BatchClass = ClassType<BatchToken>;
```

A class constructible with no arguments. This is what `Batch(...)` returns,
and what a consumer expecting a batch — `@ecosy/core/session`'s `batch`
option, for one — takes.

## Usage

Requests arriving close together, coalesced into one call:

```ts
import { Batch } from "@ecosy/core/batch";

const PriceBatch = Batch({ window: 20, max: 50 });
const prices = new PriceBatch();

async function fetchPrices(skus: readonly string[]): Promise<number[]> {
  const res = await fetch(`https://example.com/prices?skus=${skus.join(",")}`);
  return (await res.json()) as number[];
}

async function priceOf(sku: string): Promise<number | undefined> {
  // Every call reaching this line while a "prices" group is still open joins
  // it; fetchPrices runs once per window with every sku gathered so far.
  return prices.add("prices", sku, { flush: (skus) => fetchPrices(skus) });
}

const [a, b] = await Promise.all([priceOf("SKU-1"), priceOf("SKU-2")]);
```

`items` and `Result` need not be the same shape — a group key can gather
whole write requests and hand back one result per request, the way
`@ecosy/core/session` gathers `set()` calls per session id and applies them
together in one flush.

Forcing a flush and waiting one out, e.g. on shutdown:

```ts
import { Batch } from "@ecosy/core/batch";

const WriteBatch = Batch({ window: 50 });
const writes = new WriteBatch();

type Row = { id: string; value: number };

async function saveRows(rows: Row[]): Promise<void> {
  // one write for every row gathered in the window
}

async function save(row: Row): Promise<void> {
  await writes.add("rows", row, { flush: saveRows });
}

async function onShutdown(): Promise<void> {
  await writes.flush("rows"); // close the window now
  await writes.pending("rows"); // catches an add() that raced in between the two calls
}
```
