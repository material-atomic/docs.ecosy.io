---
title: Serialize
import: "@ecosy/core/serialize"
order: 2
---

# Serialize

```ts
import { Serialize } from "@ecosy/core/serialize";

Serialize.JSON.stringify({ date: new Date(), big: 123n });
Serialize.URL.encode("hello world");
Serialize.queryString.stringify({ page: 1, tags: ["a", "b"] });
```

`Serialize` is a convenience surface gathering every part under one name. It is
a single binding, so a bundler cannot drop the half you do not use. To ship
less, import the part directly — each has its own module:

```ts
import { Primitive } from "@ecosy/core/serialize/primitive";
import { queryString } from "@ecosy/core/serialize/query-string";
```

Both routes give you the same objects, so mixing them is free.

| on `Serialize` | direct import | subpath |
|---|---|---|
| `Serialize.Primitive` | `Primitive` | `@ecosy/core/serialize/primitive` |
| `Serialize.JSON` | `Json` | `@ecosy/core/serialize/json` |
| `Serialize.URL` | `Url` | `@ecosy/core/serialize/url` |
| `Serialize.queryString` | `queryString` | `@ecosy/core/serialize/query-string` |
| `Serialize.interpolate` | `interpolate` | `@ecosy/core/serialize/interpolate` |

## `Json`

Safe `JSON` that never throws.

### `Json.stringify`

```ts
stringify(value: unknown, space?: number): string
```

Runs `Primitive.normalize` first, so `BigInt` and `Date` survive instead of
throwing or serialising as `{}`. Returns `""` on any failure, including
circular references.

```ts
Json.stringify({ big: 123n, at: new Date("2024-01-01") });
// '{"big":"123","at":"2024-01-01T00:00:00.000Z"}'

const a = {}; a.self = a;
Json.stringify(a); // ""
```

### `Json.parse`

```ts
parse<T = unknown>(text: string, reviver?: (key: string, value: any) => any): T | null
```

Returns `null` for empty input and for anything that does not parse — never
throws.

```ts
Json.parse<User>(text);   // User | null
Json.parse("not json");   // null
Json.parse("");           // null
```

## `Primitive`

Type guards plus one deep normaliser.

```ts
isString(value: unknown): value is string
isNumber(value: unknown): value is number
isBoolean(value: unknown): value is boolean
isDate(value: unknown): value is Date
isPrimitive(value: unknown): value is PrimitiveValue
isPlainObject(value: unknown): value is LiteralObject
```

```ts
type PrimitiveValue = string | number | boolean | null | undefined | symbol | bigint;
```

### `Primitive.normalize`

```ts
normalize<T, R = unknown>(data: T): R
```

Walks a value and rewrites what `JSON.stringify` handles badly. Recurses
through arrays and plain objects.

| input | output |
|---|---|
| `bigint` | decimal string |
| `Date` | ISO string |
| object with `toJSON()` | result of `toJSON()` |
| `undefined` object properties | key dropped |
| other primitives | unchanged |

```ts
Primitive.normalize({ id: 9007199254740993n, at: new Date(0), skip: undefined });
// { id: "9007199254740993", at: "1970-01-01T00:00:00.000Z" }
```

## `Url`

### `Url.encode`

```ts
encode(value: string, component?: boolean | ((value: string) => string)): string
```

| `component` | behaviour |
|---|---|
| `true` (default) | `encodeURIComponent` |
| `false` | `encodeURI` |
| function | your encoder, called directly |

Empty input gives `""`. If encoding throws — a lone surrogate in the string —
the broken characters are stripped and it retries rather than propagating the
`URIError`.

```ts
Url.encode("hello world");        // "hello%20world"
Url.encode("a/b?c=1", false);     // "a/b?c=1"
```

### `Url.decode`

```ts
decode(value: string, component?: boolean | ((value: string) => string)): string
```

Decodes each `%XX` run separately, so one malformed sequence does not lose the
rest of the string — it is left as-is and the surrounding text still decodes.
With `component: true`, `+` is treated as a space first.

```ts
Url.decode("hello%20world");     // "hello world"
Url.decode("a+b");               // "a b"
Url.decode("ok%20then%ZZ");      // "ok then%ZZ"
```

### `Url.build`

```ts
build(uri: string, params?: Record<string, PrimitiveValue> | null): string
```

Fills `:name` placeholders, encoding each value. A placeholder with no matching
param is **left in place** rather than blanked, so a missing value shows up as
a visibly wrong URL instead of a silently wrong one.

```ts
Url.build("/users/:id/posts/:postId", { id: 42, postId: "a b" });
// "/users/42/posts/a%20b"

Url.build("/users/:id", {});
// "/users/:id"
```

## `queryString`

### `queryString.parse`

```ts
parse(query: string): Record<string, string>
```

A leading `?` is optional. Keys and values are decoded; a key with no `=` gives
`""`. Values are always strings, and repeated keys keep the last one.

```ts
queryString.parse("?page=1&q=hello%20world");
// { page: "1", q: "hello world" }
```

### `queryString.stringify`

```ts
stringify(params: Record<string, unknown>, options?: SerializeQueryOptions): string
```

```ts
interface SerializeQueryOptions {
  arrayFormat?: "bracket" | "index" | "comma" | "separator" | "none";  // "none"
  arrayFormatSeparator?: string;                                        // ","
  skipNull?: boolean;                                                   // false
  skipEmptyString?: boolean;                                            // false
  encode?: boolean | ((value: string) => string);                       // true
  strict?: boolean;                                                     // true
  sort?: boolean | ((a: string, b: string) => number);                  // false
}
```

Array formats for `{ tags: ["a", "b"] }`:

| `arrayFormat` | result |
|---|---|
| `"none"` (default) | `tags=a&tags=b` |
| `"bracket"` | `tags[]=a&tags[]=b` |
| `"index"` | `tags[0]=a&tags[1]=b` |
| `"comma"` | `tags=a,b` |
| `"separator"` | `tags=a,b`, separator from `arrayFormatSeparator` |

Nested objects are traversed into bracketed keys — `{ a: { b: 1 } }` gives
`a[b]=1`. `strict: true` drops top-level keys outside `[a-zA-Z0-9_-.[]]`.
`sort` orders **top-level keys only**, which is enough to make the result
stable for the same input when you use it as a cache key.

Leaf values:

| value | result |
|---|---|
| `null` / `undefined` | `key=`, or dropped with `skipNull` |
| `""` | `key=`, or dropped with `skipEmptyString` |
| `boolean` | `key=true` / `key=false` |
| `Date` | ISO string |
| everything else | `String(value)` |

```ts
queryString.stringify(
  { page: 1, tags: ["a", "b"], empty: "" },
  { arrayFormat: "bracket", skipEmptyString: true },
);
// "page=1&tags[]=a&tags[]=b"
```

## `interpolate`

```ts
function interpolate(pattern: string, params?: Record<string, unknown> | unknown[]): string
```

Fills `{key}` placeholders. Paths resolve through
[`get`](/core/utilities), so `{a.b.0.c}` works.

```ts
interpolate("Hello {name}, you have {stats.unread} unread", {
  name: "Alice",
  stats: { unread: 3 },
});
// "Hello Alice, you have 3 unread"
```

Unresolved placeholders and object values both become `""` — never
`[object Object]`, never a literal `undefined` in user-facing text.

```ts
interpolate("Hi {missing}", {});      // "Hi "
interpolate("Hi {obj}", { obj: {} }); // "Hi "
```

Placeholder names match `[a-zA-Z0-9_.-]+`. A string with no `{` or `}` is
returned untouched without scanning.
