---
name: "@ecosy/anchor"
type: module
status: beta
repo: material-atomic/ecosy-anchor
npm: "@ecosy/anchor"
summary: Keep one value per name for the whole runtime, however many times the module defining it is evaluated. No dependencies.
---

# @ecosy/anchor

```bash
yarn add @ecosy/anchor
```

```ts
import { Anchor } from "@ecosy/anchor";

export const AppLogger = Anchor({
  name: "app:logger",
  factory: () => Logger({ service: "shop" }),
});
```

Zero dependencies — needs `globalThis` and nothing else.

## Why

A module is not always evaluated once per runtime:

- a bundler can compile the same file into several module graphs of one
  server, each evaluating it separately;
- a hot reload evaluates it again;
- a package installed as both its CommonJS and ESM build is two module
  instances;
- two versions of a package sit side by side in `node_modules`.

Every evaluation runs the module's top level again. A factory building a class
then returns a new class each time, and a class that is not the same object is
a different class to anything keyed by it — a dependency-injection container
builds one instance per copy, `instanceof` fails across copies, a cache keyed
by the class misses.

`Anchor` stores the first value on `globalThis` and hands it to every later
evaluation, so all copies of the module export the same object.

## `Anchor`

```ts
function Anchor<Value>(options: AnchorOptions<Value>): Value
```

```ts
interface AnchorOptions<Value> {
  name: string;          // where the value is anchored — global to the realm
  factory: () => Value;  // builds the value; pass a function, not the value
}
```

Returns the value anchored under `name`, building it with `factory` only if
nothing is anchored there yet.

Throws `TypeError` when `name` is not a non-empty string or `factory` is not a
function, and `Error` when `factory` reaches `Anchor` for its own name while
running.

## Behaviour

**Lazy.** `factory` runs on the first `Anchor` call for the name, and not again
while the value is kept.

**Development** (`NODE_ENV=development`): `Anchor` remembers the factory's
source text. A reload that brings a factory with different text — an edited
config literal, say — builds a new value; one with the same text keeps the old
one.

- An edit outside the factory, in a module it imports, does not change the
  text and keeps the old value until restart.
- A module that is not re-evaluated after the edit keeps the value it already
  holds.
- Minified copies of one factory rarely read alike, so this mode is for
  unminified code only.

**Anywhere else** — production, tests, `NODE_ENV` unset, a runtime with no
`process` at all — the first value is kept for the life of the realm.
Rebuilding is never assumed: a runtime that cannot say it is in development
gets the behaviour that is safe everywhere.

**Failures.** A factory that throws anchors nothing, and the next call runs it
again. A factory that reaches `Anchor` for its own name while running throws
instead of recursing. A promise is stored as returned, rejected or not.

**Runtimes and realms.** Node and edge runtimes behave alike. Worker threads
and isolates each have their own `globalThis`, and so their own anchors.

## Rules

**Server-side only** — Node or edge. In a browser `globalThis` is `window`,
where the anchored value is readable by every script on the page — and a
module that calls `Anchor` ships its factory's source, config included, in the
bundle. Keep such modules out of client code.

**Names are global.** Two anchors with the same name share one value,
whichever ran first. Choosing unique names is up to the application; prefix
them — `"app:logger"`, not `"logger"`.

**Anchor definitions, not lookups.** The name only tells `Anchor` where to keep
the value. Everything else uses the exported binding — import `AppLogger`, do
not look it up by name.
