---
name: "@ecosy/next"
type: module
status: stable
repo: material-atomic/ecosy-next
npm: "@ecosy/next"
summary: Route handlers, dependency injection, boot ordering and typed errors for Next.js App Router.
---

# @ecosy/next

```bash
yarn add @ecosy/next
```

`next` is a peer dependency. Nothing else.

```ts
import { Route, NotFound } from "@ecosy/next";

export const GET = Route({ users: UserRepository }).get(async (ctx) => {
  const user = await ctx.users.byId(ctx.params.id as string);
  if (!user) throw new NotFound("No such user");
  return user;
});
```

## Contents

| | |
|---|---|
| [`Route`](/next/route) | route handlers with injected dependencies |
| [`Bootstrap`, `Instrument`](/next/bootstrap) | ordered startup, wired into `instrumentation.ts` |
| [`Inject`](/next/inject) | the injection primitive, on its own subpath |
| [`Proxy`](#proxy) | middleware over every matched request |
| [`Handler`](#handler) | a reusable handler with its own dependencies |
| [`Cookie`](#cookie) | cookie access with safe defaults |
| [`Res`](/next/route#responses) | response constructors |
| [`createUrl`](#createurl) | URL building |
| [`Exception`](/next/route#exceptions) and subclasses | throw a status, get a response |

Two entry points:

```ts
import { Route, Bootstrap, Proxy } from "@ecosy/next";
import { Inject } from "@ecosy/next/inject";
```

## Proxy

```ts
Proxy(handler)              // → ProxyNextHandler
Proxy(injects?)             // → callable builder
Proxy.use(...middlewares)   // → callable builder
```

Next middleware with the same injection as a route.

```ts
// src/proxy.ts
import { Proxy } from "@ecosy/next";

export const proxy = Proxy({ tokens: Tokens, jwt: Jwt }).use(bearer);

export const config = {
  matcher: ["/((?!_next/static|_next/image|.well-known|favicon.ico).*)"],
};
```

The result is callable as a Next middleware directly, and also has `.use()` and
`.proxy(fn?)`.

A middleware returning a `Response` **stops the chain** and that response is
sent; returning anything else continues to the next one. Throwing behaves as in
a route — an `Exception` becomes its status, anything else a logged 500.

```ts
const bearer = async (ctx) => {
  const token = ctx.req.headers.get("authorization");
  if (!token) throw new Unauthorized("Missing token");
  ctx.set("userId", await ctx.jwt.verify(token));
  // returns undefined → continue
};
```

Importing `Proxy` anywhere marks the app as proxied. From then on, a route whose
request lacks the `x-ecosyrequest-id` header **throws**:

```
[Ecosy] Missing 'x-ecosyrequest-id' header in a proxied environment.
```

That turns "this route was reachable without middleware" into an error at the
boundary rather than a silent hole. It also means the proxy's `matcher` must
cover every route you expect to work.

## Handler

```ts
function Handler<Ctx extends Context, Injects extends InjectMap>(injects?: Injects): IHandlerBuilder
```

A route handler with its own dependencies and middlewares, defined away from
the route file and passed in later.

```ts
// handlers/create-user.ts
export const createUser = Handler({ users: UserRepository })
  .use(requireAdmin)
  .handle(async (ctx) => ctx.users.create(await ctx.json()));

// app/api/users/route.ts
export const { POST } = Route().post(createUser);
```

`.handle()` returns a plain `RouteHandler`, so the route does not need to know
what the handler depends on. Tokens are injected onto the context when it runs.

## Cookie

```ts
Cookie.get(name): Promise<string | null>
Cookie.set(name, value, options?): Promise<void>
Cookie.delete(name): Promise<void>
Cookie.has(name): Promise<boolean>
```

Server-only — the module imports `server-only`, so importing it from a client
component is a build error.

```ts
await Cookie.set("session", token, { maxAge: 3600 });
```

Defaults, each overridable through `options`:

| | |
|---|---|
| `httpOnly` | `true` |
| `secure` | `true` in production, `false` otherwise |
| `sameSite` | `"lax"` |
| `path` | `"/"` |

`secure` follows `NODE_ENV`, so a cookie still sets over plain HTTP in
development.

## createUrl

```ts
function createUrl(options: UrlOptions): string

interface UrlOptions {
  base?: string;
  pathname?: string;
  params?: Record<string, unknown>;      // fills {name} placeholders
  search?: string | SearchParams;
}
```

```ts
createUrl({
  base: "https://example.com",
  pathname: "/users/42",
  search: { page: 2, filter: { active: true }, tags: ["a", "b"] },
});
// https://example.com/users/42?page=2&filter.active=true&tags.0=a&tags.1=b
```

An object `search` is flattened to **dot-separated** keys — `filter.active`,
`tags.0` — not bracket keys. Pass a string if you need another format:

```ts
createUrl({ base, pathname: "/users", search: "filter[active]=true" });
```

Leaf values are stringified by `URLSearchParams`, so `null` and `undefined`
become the literal strings `"null"` and `"undefined"` rather than being
dropped. Filter them out before passing:

```ts
const search = Object.fromEntries(
  Object.entries(raw).filter(([, v]) => v != null),
);
```

`ctx.uri(options)` is the same function with `base` set to the current
request's origin.

### `params` only reaches the query string

`params` fills `{name}` placeholders in the finished URL. Braces survive in a
query string but are percent-encoded in a path, so a placeholder there is
never substituted:

```ts
createUrl({ base: "https://example.com", pathname: "/users/{id}", params: { id: 42 } });
// https://example.com/users/%7Bid%7D   ← not replaced

createUrl({ base: "https://example.com", search: "user={id}", params: { id: 42 } });
// https://example.com/?user=42
```

Build path segments by interpolating the string yourself:

```ts
createUrl({ base: ctx.baseUrl, pathname: `/users/${id}` });
```

## Constants

```ts
CONTENT_TYPES   // { json, text, html, css, js, xml, jpg, png, gif, svg, webp, urlencoded, javascript }
HttpStatus      // named status codes
HttpStatusText  // code → reason phrase
IS_PROD         // process.env.NODE_ENV === "production"
```
