---
title: Types
import: "@ecosy/core/types"
order: 6
---

# Types

```ts
import type { LiteralObject, Freezable, PartialLiteral } from "@ecosy/core/types";
```

Type-level only — nothing here emits code. They are also re-exported from the
package root.

## Values

### `primitive`

```ts
type primitive = string | number | boolean | bigint | symbol | undefined | null;
```

Lowercase deliberately, to avoid colliding with anything named `Primitive` —
including [`Serialize.Primitive`](/core/serialize#primitive).

### `PrimitiveClass`

```ts
type PrimitiveClass = Date | RegExp | File | FileList | URL | Blob | /* … */;
```

Built-in classes that deep type helpers treat as opaque values instead of
recursing into. Covers dates and regexes, binary types (`ArrayBuffer`,
`DataView`, every `TypedArray`), fetch types (`Request`, `Response`, `Headers`,
`FormData`, `URLSearchParams`), streams, DOM nodes and events, observers,
workers and channels, generators, and every built-in `Error` subclass.

Without this, `PartialLiteral<{ at: Date }>` would descend into `Date` and
produce an object of optional date methods rather than an optional `Date`.

### `BuiltInPrimitive`

```ts
type BuiltInPrimitive = primitive | PrimitiveClass;
```

## Objects

### `LiteralObject`

```ts
type LiteralObject<Keys extends PropertyKey = PropertyKey> =
  | Record<Keys, unknown>
  | { [K in Keys]: unknown }
  | object;
```

The constraint used across the ecosystem for "a plain object" —
`Subscriber<State extends LiteralObject>`, store slices, and so on.

### `AtomicObject`

```ts
type AtomicObject<Key extends PropertyKey = PropertyKey, Value = unknown> = {
  [K in Key]: Value;
};
```

A single-key object.

```ts
type UserById = AtomicObject<`user_${number}`, User>;
```

### `Objectable`

```ts
type Objectable = LiteralObject | Array<unknown> | LiteralFunction;
```

Anything object-like. The type behind
[`isObjectable`](/core/utilities#type-guards).

## Functions

### `LiteralFunction`

```ts
type LiteralFunction<R = unknown, A extends unknown[] = unknown[]> = (...args: A) => R;
```

```ts
type Handler = LiteralFunction<void, [Event]>;   // (event: Event) => void
```

### `ExtendedFunction`

```ts
type ExtendedFunction<F = LiteralFunction, O = LiteralObject> = F & O;
```

A callable carrying static properties — the shape of a function that is also a
namespace.

### `Promisable`

```ts
type Promisable<Value> = Value | Promise<Value>;
```

For a port whose implementations may be sync or async.

```ts
interface Hook {
  notify(event: Event): Promisable<void>;
}
```

## Transformers

### `Freezable`

```ts
type Freezable<T>
```

Recursively `readonly`. What [`freeze`](/core/utilities#freeze) returns at the
type level.

```ts
type Config = Freezable<{ db: { host: string; ports: number[] } }>;

config.db.host = "x";      // error
config.db.ports.push(1);   // error — ReadonlyArray
```

Functions, `Date`, `RegExp`, `Error`, `Map` and `Set` pass through unchanged
rather than being flattened into objects of readonly members. Arrays become
`ReadonlyArray`.

### `PartialLiteral`

```ts
type PartialLiteral<T>
```

Deep-partial. What `setState` accepts, so you can update one nested field
without rebuilding the branch above it.

```ts
type State = { user: { name: string; prefs: { theme: string } } };

const patch: PartialLiteral<State> = { user: { prefs: { theme: "dark" } } };
```

Unlike a hand-rolled recursive `Partial`, it keeps the generic containers
intact — `Map`, `WeakMap`, `ReadonlyMap`, `Set`, `WeakSet`, `ReadonlySet`,
`Promise`, `WeakRef`, `FinalizationRegistry` — recursing into their type
arguments instead of their members. Anything in `BuiltInPrimitive` is left
alone, and an `ExtendedFunction` keeps its call signature while its statics
become optional.

### `ToString`

```ts
type ToString<T>
```

Stringifies a type at the type level, for building template-literal types.

```ts
type Channel = `$${string}:${ToString<"login">}`;   // "$${string}:login"
```

| `T` | result |
|---|---|
| `string \| number \| bigint \| boolean` | `` `${T}` `` |
| `symbol` | `string` |
| `null` | `"null"` |
| `undefined` | `"undefined"` |
| anything else | `never` |

Used by [`Subscriber.wire`](/core/subscriber#subscriberwire) to derive
`onEventName` from an event key.
