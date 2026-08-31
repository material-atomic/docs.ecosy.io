---
title: Utilities
import: "@ecosy/core/utilities"
order: 1
---

# Utilities

```ts
import { clone, merge, freeze, isEqual, get } from "@ecosy/core/utilities";
```

Every export is a standalone function with no shared state. `slugify` and
`searchify` also have their own subpaths (`@ecosy/core/slugify`,
`@ecosy/core/searchify`) if you want only those.

## Values

### `clone`

```ts
function clone<T>(data: T, cache?: WeakMap<object, unknown>): T
```

Deep copy.

| | |
|---|---|
| `data` | Value to copy. |
| `cache` | Circular-reference tracker. Internal — omit it. |
| **returns** | A copy of `data`. Non-cloneable inputs are returned as-is. |

```ts
const original = { a: 1, b: { c: 2 } };
const cloned = clone(original);

cloned.b.c = 3;
original.b.c; // 2
```

Copied by value: plain objects, arrays, `Date`, `RegExp`, `Map`, `Set`,
`ArrayBuffer`, all `TypedArray`s and `DataView`.

Returned by reference: functions, `Error`, `Promise`, `Blob`, `File`,
`FileList`, `FormData`, `Headers`, `Request`, `Response`, `Worker`,
`AbortController`, `WeakMap`, `WeakSet`, `Symbol`, DOM nodes, `Window`, and
React elements (anything carrying `$$typeof`).

Circular references are preserved — `a.self === a` in the input gives
`b.self === b` in the copy, not an infinite expansion.

### `merge`

```ts
function merge<T>(source: unknown, target: unknown, cloneDeep?: typeof clone): T
```

Deep merge. Values from `target` win. Neither argument is mutated.

```ts
merge({ a: 1, b: { c: 2 } }, { b: { d: 3 } });
// { a: 1, b: { c: 2, d: 3 } }
```

Pass `cloneDeep` to substitute your own clone implementation.

### `freeze`

```ts
function freeze<T>(data: T, cloneDeep?: typeof clone): Freezable<T>
```

Deep-freezes a **copy** and returns it. The argument you passed in stays
mutable.

```ts
const frozen = freeze({ a: { b: 1 } });
frozen.a.b = 2; // TypeError in strict mode
```

### `isEqual`

```ts
function isEqual(value1: unknown, value2: unknown): boolean
```

Structural comparison, recursive.

```ts
isEqual({ a: 1 }, { a: 1 });      // true
isEqual([1, 2], [1, 3]);          // false
isEqual(new Date(0), new Date(0)); // true
```

### `get`

```ts
function get<T = unknown>(data: unknown, path: string | string[], defaultValue?: T): T
```

Reads a nested value. Both dot and bracket notation work, and an array of keys
is accepted.

```ts
const obj = { users: [{ name: "Alice" }] };

get(obj, "users[0].name");        // "Alice"
get(obj, "users.0.name");         // "Alice"
get(obj, ["users", "0", "name"]); // "Alice"
get(obj, "users[1].name", "N/A"); // "N/A"
```

Returns `defaultValue` (or `undefined`) when the path does not resolve, and
when `data` itself is `null`/`undefined`. It never throws.

## Shapes

### `flatten`

```ts
function flatten(data: unknown, prefix?: string, acc?: Record<string, unknown>): Record<string, unknown>
```

Collapses nesting into dot-separated keys. `prefix` and `acc` are recursion
parameters — omit both.

```ts
flatten({ users: [{ name: "Alice" }] });
// { "users.0.name": "Alice" }

flatten({ a: { b: { c: 1 } } });
// { "a.b.c": 1 }
```

### `flattenToArray`

```ts
function flattenToArray(data: Record<string, unknown>, path: string): unknown[]
```

The inverse for one branch: pulls a flattened prefix back into an array.

```ts
const flat = flatten({ users: [{ name: "Alice" }, { name: "Bob" }] });

flattenToArray(flat, "users");
// [{ name: "Alice" }, { name: "Bob" }]
```

### `escapeRegexKey`

```ts
function escapeRegexKey(key: string): string
```

Escapes `.` `[` `]` `{` `}` so a flattened key can be used inside a pattern.

```ts
escapeRegexKey("users[0].name"); // "users\\[0\\]\\.name"
```

### `objectToFormData`

```ts
function objectToFormData(data: unknown, formData?: FormData, parentKey?: string): FormData
```

Builds `FormData` from a plain object, including nested objects, arrays and
files. Pass an existing `FormData` as the second argument to append to it.
`null` and `undefined` values are skipped.

```ts
const fd = objectToFormData({
  name: "Alice",
  avatar: someFile,
  tags: ["a", "b"],
  meta: { role: "admin" },
});

// name        → "Alice"
// avatar      → File
// tags[0]     → "a"
// tags[1]     → "b"
// meta[role]  → "admin"
```

### `isFormData`

```ts
function isFormData(body: unknown): body is FormData
```

## Text

### `slugify`

```ts
function slugify(str: string, options?: SlugifyOptions): string
```

```ts
interface SlugifyOptions {
  separator?: string;                     // default "-"
  transformer?: Record<string, string>;   // merged into DEFAULT_TRANSFORMER
  silent?: boolean;                       // drop multi-char replacements
}
```

```ts
slugify("Xin Chào Việt Nam");                  // "xin-chao-viet-nam"
slugify("Xin Chào Việt Nam", { separator: "_" }); // "xin_chao_viet_nam"
```

### `DEFAULT_TRANSFORMER`

```ts
const DEFAULT_TRANSFORMER: Record<string, string>
```

The character map `slugify` folds through. A `transformer` you pass is merged
over it, so you only need to list the characters you want to change.

### `searchify`

```ts
function searchify(original: string, searchStr: string): SearchResult
```

```ts
interface SearchResult {
  matches: string[];
  positions: SearchPosition[];  // { start: number; length: number }
}
```

Diacritic-insensitive substring search. Matching runs on folded characters, but
`positions` are indices into `original` — which is what highlighting needs.

```ts
searchify("Xin Chào Việt Nam", "viet");
// { matches: ["Việt"], positions: [{ start: 9, length: 4 }] }

searchify("Crème Brûlée", "brulee");
// { matches: ["Brûlée"], positions: [{ start: 6, length: 6 }] }
```

### `toString`

```ts
function toString(value: unknown): string
```

`Object.prototype.toString` tag.

```ts
toString([]);   // "[object Array]"
toString(null); // "[object Null]"
```

### `ucfirst`

```ts
function ucfirst<T extends string>(str: T): Capitalize<T>
```

```ts
ucfirst("hello"); // "Hello"
```

### `pascalToKebab`

```ts
function pascalToKebab(text: string): string
```

```ts
pascalToKebab("MyComponent"); // "my-component"
pascalToKebab("HTMLParser");  // "html-parser"
pascalToKebab("camelCase");   // "camel-case"
```

### `sanitizeMime`

```ts
function sanitizeMime(value: string): string
```

Returns `value` if it matches `MIME_REGEX`, otherwise `""`. Use it on any
content type that came from outside the process — an empty string lets the
receiving server reject the payload rather than acting on a smuggled value like
`application/php/jpeg`.

### `MIME_REGEX`

```ts
const MIME_REGEX: RegExp
```

RFC 2045 `type/subtype` with optional `;parameter=value`.

## Timing

### `defer`

```ts
function defer(callback: () => void, delay?: number): { ids: DeferIds; cancel: () => void }
```

Schedules `callback` on `requestAnimationFrame` plus `setTimeout(delay)`, so it
runs after the browser has painted. Falls back to plain `setTimeout` where
`requestAnimationFrame` does not exist.

```ts
const { cancel } = defer(() => console.log("done"), 100);

cancel(); // no-op if it already ran
```

### `deferAsync`

```ts
function deferAsync(delay?: number): CancelablePromise
```

`CancelablePromise` is a `Promise<void>` with an added `cancel()`. Cancelling
leaves the promise unresolved.

```ts
await deferAsync(500);

const wait = deferAsync(5000);
wait.cancel();
```

## Type guards

```ts
function isObject(value: unknown): value is object
function isLiteralObject(value: unknown): value is LiteralObject
function isComplexObject<T extends LiteralObject>(value: unknown): value is T
function isObjectable(value: unknown): value is Objectable
function isFunction(value: unknown): value is LiteralFunction
function isFileList(data: unknown): data is FileListLike
function hasOwnProperty<Obj, Key extends PropertyKey, As = unknown>(obj: Obj, key: Key): boolean
```

| | |
|---|---|
| `isObject` | Any non-null object, arrays and instances included. |
| `isLiteralObject` | Only `{}` or `Object.create(null)` — excludes arrays, dates and class instances. |
| `isComplexObject` | A non-array object such as a class instance. |
| `isObjectable` | Object, array, or function. |

```ts
hasOwnProperty({ a: 1 }, "a"); // true
hasOwnProperty({ a: 1 }, "b"); // false
```

`hasOwnProperty` narrows the key on `Obj` for TypeScript, which the global
`Object.prototype.hasOwnProperty` does not.

`isFileList` matches a real `FileList` or anything tagged `[object FileList]`,
so it works across realms (an iframe's `FileList` fails `instanceof`).

```ts
isFileList(input.files); // true
isFileList([]);          // false
```
