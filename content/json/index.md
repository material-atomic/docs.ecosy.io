---
name: "@ecosy/json"
type: module
status: stable
repo: material-atomic/ecosy-json
npm: "@ecosy/json"
summary: A JSONPath engine, plus a query layer with pipes, aggregations, fallbacks and string interpolation.
---

# @ecosy/json

```bash
yarn add @ecosy/json
```

```ts
import { JSONPath, JSONQuery } from "@ecosy/json";

JSONPath.query(data, "$.store.book[?(@.price < 10)].title");

JSONQuery.evaluate(data, "SUM($.cart[*].price) | currency('$')");
```

Zero dependencies. Two layers: `JSONPath` implements the specification;
`JSONQuery` extends it with expressions a template needs.

## `JSONPath`

```ts
class JSONPath {
  constructor(expression: string)
  readonly expression: string;
}
```

Compiles once, evaluates many times. Reuse an instance when the same expression
runs against many documents:

```ts
const authors = new JSONPath("$.store.book[*].author");

for (const doc of documents) {
  authors.query(doc);
}
```

### Syntax

| | |
|---|---|
| `$` | root |
| `.key` · `['key']` | property |
| `[0]` · `[-1]` | index, negative counts from the end |
| `.*` · `[*]` | all children |
| `..key` | recursive descent |
| `[0:5]` · `[::2]` | slice `[start:end:step]` |
| `[0,1,2]` · `['a','b']` | union |
| `[?(@.price < 10)]` | filter |

Filters support `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&` and `||`, with `@` as the
current element.

```ts
JSONPath.query(data, "$..book[?(@.price < 10 && @.category == 'fiction')].title");
```

### Instance methods

```ts
query<T>(data: any): T[]
first<T>(data: any): T | undefined
last<T>(data: any): T | undefined
matches(data: any): JSONPathMatch[]
paths(data: any): string[]
exists(data: any): boolean
count(data: any): number
map<T, R>(data: any, fn: (value: T, path: string, index: number) => R): R[]
forEach(data: any, fn: (value: any, path: string, index: number) => void): void
toAST(): ReadonlyArray<PathNode>
toString(): string
```

`matches` returns values **with** their locations:

```ts
interface JSONPathMatch {
  value: any;
  path: string;   // "$['store']['book'][0]['title']"
}
```

Use it when you need to know where a value came from — building an editor, or
reporting which field failed validation. `paths` is the same thing with the
values dropped.

No match is an empty array from `query`, `undefined` from `first`/`last`, and
`false` from `exists` — nothing throws at evaluation time. A malformed
**expression** does throw, at construction.

### Statics

```ts
JSONPath.query<T>(data: any, expression: string): T[]
JSONPath.first<T>(data: any, expression: string): T | undefined
JSONPath.exists(data: any, expression: string): boolean
JSONPath.tokenize(expression: string): Token[]
JSONPath.parse(expression: string): PathNode[]
```

The first three compile on every call. For a hot path, construct once instead.

## `JSONQuery`

```ts
class JSONQuery extends JSONPath {
  constructor(expression?: string)   // defaults to "$"
}
```

Everything `JSONPath` does, plus five layers applied in this order:

| | example |
|---|---|
| string interpolation | `` `Hello {$.user.name}` `` |
| fallback `??` | `$.nickname ?? $.name ?? 'anonymous'` |
| pipes `\|` | `$.user.name \| uppercase` |
| aggregations | `SUM($.items[*].price)` |
| auto-root | `user.name` → `$.user.name` |

```ts
JSONQuery.evaluate(data, "$.user.name | uppercase");
JSONQuery.evaluate(data, "SUM($.cart[*].price) | currency('$')");
JSONQuery.evaluate(data, "`Total: {SUM($.cart[*].price)} items`");
```

### Instance use

```ts
const q = new JSONQuery();
q.set(data);

q.eval("$.user.name | uppercase");   // "KEN"
q.eval("COUNT($.orders[*])");        // 3
q.get();                             // the data
```

```ts
set(data: any): void
get(): any
eval(expr: string): any
```

Set the document once and run many expressions against it — which is the shape
a template engine wants.

### `JSONQuery.evaluate`

```ts
static evaluate(data: any, expr: string): any
```

One-shot: data and expression together.

## Pipes

```ts
const PIPES: Record<string, (val: any, ...args: any[]) => any>
```

| pipe | |
|---|---|
| `uppercase` | |
| `lowercase` | |
| `currency(symbol = '$', locale = 'en-US')` | locale number plus symbol |
| `date(locale = 'en-US')` | ISO string → locale date |
| `json(spaces = 2)` | `JSON.stringify` |
| `default(fallback)` | fallback when `null`, `undefined` or `""` |
| `limit(n)` | first `n` array items |
| `join(separator = ',')` | array → string |

```ts
JSONQuery.evaluate(data, "$.tags | limit(3) | join(', ')");
JSONQuery.evaluate(data, "$.price | currency('€', 'de-DE')");
JSONQuery.evaluate(data, "$.bio | default('No bio yet')");
```

Pipes chain left to right. A pipe given a value it cannot handle passes it
through unchanged rather than throwing — `join` on a non-array returns the
value.

### `registerPipe`

```ts
static registerPipe(name: string, fn: (val: any, ...args: any[]) => any): void
```

```ts
JSONQuery.registerPipe("truncate", (v, n = 50) =>
  String(v).length > n ? `${String(v).slice(0, n)}…` : String(v),
);

JSONQuery.evaluate(data, "$.description | truncate(100)");
```

Registration is **global** — it affects every `JSONQuery` in the process, so
register at startup and treat names as a shared namespace.

## Aggregations

```ts
const AGGREGATIONS: Record<string, (arr: any[]) => any>
```

| | |
|---|---|
| `SUM` | sum, non-numbers as 0 |
| `COUNT` | length |
| `AVG` | mean, `0` when empty |
| `MIN` · `MAX` | `0` when empty |

```ts
JSONQuery.evaluate(data, "AVG($.reviews[*].rating)");
```

Note each returns `0` rather than `null` for an empty input, so an empty cart
gives `SUM` of `0` — but `MIN` of `0` too, which is not the same as "no
minimum". Check `COUNT` first where that distinction matters.

### `registerAggregation`

```ts
static registerAggregation(name: string, fn: (arr: any[]) => any): void
```

```ts
JSONQuery.registerAggregation("MEDIAN", (arr) => {
  const sorted = [...arr].map(Number).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
});
```

Also global.

## Low-level

```ts
import { tokenize, parse, evaluate, TokenType } from "@ecosy/json";

const ast = parse(tokenize("$.store.book[*].title"));
const matches = evaluate(ast, data);
```

```ts
function tokenize(expression: string): Token[]
function parse(tokens: Token[]): PathNode[]
function parseExpression(expression: string): PathNode[]
function evaluate(nodes: PathNode[], data: any): JSONPathMatch[]
```

Evaluation is generator-based internally, so intermediate stages are not
materialised — only the final array is. Node types (`RootNode`, `PropertyNode`,
`IndexNode`, `WildcardNode`, `RecursiveNode`, `SliceNode`, `UnionNode`,
`FilterNode` and the filter expression types) are all exported for anyone
walking or rewriting an AST.

## Subpath imports

```ts
import { JSONPath } from "@ecosy/json/json-path";
import { JSONQuery } from "@ecosy/json/json-query";
import { tokenize } from "@ecosy/json/tokenizer";
import { parse } from "@ecosy/json/parser";
import { evaluate } from "@ecosy/json/evaluator";
```

Importing `JSONPath` alone leaves the pipes and aggregations out of the bundle.
