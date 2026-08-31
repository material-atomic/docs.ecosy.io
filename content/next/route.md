---
title: Route
import: "@ecosy/next"
order: 1
---

# Route

```ts
import { Route } from "@ecosy/next";

export const GET = Route(async (ctx) => {
  return { hello: "world" };
});
```

`Route` builds Next.js App Router route handlers. Unlike everything else in the
ecosystem it does not return a class — a Next route file must export named
functions (`GET`, `POST`, …), so the builder produces those.

## Calling forms

```ts
Route(handler)                    // → RouteNextHandler, export it directly
Route(injects?)                   // → builder
Route.use(...middlewares)         // → builder
Route.filter(fn)                  // → builder
Route.get(fn) / .post(fn) / …     // → builder carrying that method
```

### One handler, any method

```ts
export const GET = Route(async (ctx) => ({ ok: true }));
```

### Several methods in one file

```ts
export const { GET, POST } = Route()
  .get(async (ctx) => listUsers())
  .post(async (ctx) => createUser(await ctx.json()));
```

Each method call returns a builder that also carries the handlers defined so
far, so destructuring the final value gives you all of them.

`.route()` and the method builders are exclusive — calling `.route()` after
`.get()` throws:

```
Cannot call .route() after HTTP methods like .get() or .post() have been used.
```

## Dependencies

```ts
Route<Injects extends InjectMap>(injects?: Injects): IRouteBuilder<Injects>
```

Tokens passed here are constructed per request and appear on the context,
typed:

```ts
export const { GET } = Route({ vendor: Vendor, db: Database })
  .get(async (ctx) => {
    const rows = await ctx.db.query("select 1");
    return ctx.vendor.load(rows);
  });
```

Tokens follow the [`Inject`](/next/inject) contract — a class taking no
constructor arguments.

## Middleware

```ts
use(...middlewares: RouteHandler<Context, Injects>[]): IRouteBuilder
```

Middlewares are handlers that run before the main one, in order, with the same
context. They stop the request by throwing.

```ts
const authed = Route({ db: Database }).use(async (ctx) => {
  const user = await verify(ctx.req.headers.get("authorization"));
  if (!user) throw new Unauthorized("Sign in required");
  ctx.set("user", user);
});

export const { GET } = authed.get(async (ctx) => {
  const user = ctx.get<User>("user");
  return user;
});
```

`use` returns a **new** builder rather than mutating — a base builder can be
shared and extended without the branches affecting each other.

## Return values

| handler returns | response |
|---|---|
| a `Response` | used as-is |
| anything else | JSON `{ success: true, data: <value>, status: 200, … }` |

```ts
export const GET = Route(async (ctx) => {
  return { id: 1 };
});
// { "success": true, "data": { "id": 1 }, "status": 200, "statusText": "OK", "error": null }
```

Return a `Response` when you need control over the status, headers or body
format:

```ts
export const GET = Route(async (ctx) => {
  return ctx.res.javascript(source, 200, { "Cache-Control": "public, max-age=31536000" });
});
```

## Errors

Throwing an [`Exception`](#exceptions) produces the matching JSON error
response. Anything else becomes a 500 with the detail logged, never returned.

```ts
export const GET = Route(async (ctx) => {
  const user = await find(id);
  if (!user) throw new NotFound("No such user");
  return user;
});
// 404 { "success": false, "data": null, "error": { "message": "No such user" }, … }
```

Four shapes are recognised when thrown:

| thrown | result |
|---|---|
| `Exception` | its status, statusText, headers and error |
| `Response` | used as-is |
| object with `success`, `data`, `status`, `error` | serialised as JSON |
| anything else | 500 Internal Server Error, cause logged |

### `filter` and `Route.error`

```ts
type RouteFilter = (e: unknown, context: Context) => unknown;
```

```ts
const builder = Route().filter((e, ctx) => {
  if (e instanceof ZodError) return new BadRequest("Invalid", { issues: e.issues });
  return undefined;   // leave unchanged
});

Route.error = (e, ctx) => {
  report(e, ctx.req.url);
  return undefined;
};
```

Both run on a thrown value; returning a value replaces it, returning
`undefined` leaves it alone. The local `filter` runs first, then the global
`Route.error`. A hook that throws is caught and logged — it cannot break the
response.

`Route.error` is a single assignable property, process-wide, not a list.

## Context

The one argument every handler and middleware receives.

### Request

```ts
readonly req: NextRequest;
readonly url: URL;
readonly params: Record<string, string | string[]>;   // awaited route params
get env: Env;             // process.env
get baseUrl: string;      // url.origin
```

Body readers, each delegating to `req`:

```ts
ctx.json<T>()        // Promise<T>
ctx.text()           // Promise<string>
ctx.formData()       // Promise<FormData>
ctx.formEncoded()    // Promise<URLSearchParams>
ctx.arrayBuffer()    // Promise<ArrayBuffer>
ctx.blob()           // Promise<Blob>
```

`params` is already awaited — Next 15+ passes them as a promise, and the
context resolves it before your handler runs.

### Per-request store

```ts
set(key: string, value: unknown): void
get<DataType>(key: string): DataType | undefined
```

Scoped to the request, for passing values from a middleware to a handler.

```ts
ctx.set("user", user);
const user = ctx.get<User>("user");
```

This is backed by the request-id memory that [`Proxy`](/next#proxy) maintains.
Without a proxied request id, `set` is a no-op and `get` returns `undefined` —
so in a plain (non-proxied) app, pass values by closure instead.

### Responses

```ts
ctx.res.json(payload, status?, extraHeaders?)
ctx.res.text(body, status?, extraHeaders?)
ctx.res.javascript(body, status?, extraHeaders?)
ctx.res.next(init?)
ctx.res.redirect(url, init?)
```

`ctx.next(init?)` and `ctx.redirect(url, init?)` are shortcuts;
`ctx.next` also merges the incoming request headers for you, which is what a
middleware wants.

```ts
setHeader(name: string, value: string): void
uri(options?: BaseUrlOptions): string     // absolute URL against baseUrl
```

## Exceptions

```ts
import { NotFound, BadRequest, Unauthorized } from "@ecosy/next";
```

```ts
class Exception<E = ErrorShape> {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly error: E,
    readonly headers: Record<string, string> = {},
  )
}
```

Every subclass takes either a message or a full shape:

```ts
new BadRequest("Invalid payload");
new BadRequest("Invalid payload", { errorCode: "E_VALIDATION" });
new BadRequest({ message: "Invalid payload", issues: [{ path: ["email"], message: "required" }] });
new TooManyRequests("Slow down", {}, { "Retry-After": "60" });
```

```ts
interface ErrorShape {
  message?: string;
  issues?: ErrorIssue[];        // { code?, path, message }
  errorCode?: string;
}
```

| 4xx | 5xx |
|---|---|
| `BadRequest` 400 | `InternalServer` 500 |
| `Unauthorized` 401 | `NotImplemented` 501 |
| `Forbidden` 403 | `BadGateway` 502 |
| `NotFound` 404 | `ServiceUnavailable` 503 |
| `MethodNotAllowed` 405 | `GatewayTimeout` 504 |
| `RequestTimeout` 408 | `InsufficientStorage` 507 |
| `Conflict` 409 | `LoopDetected` 508 |
| `Gone` 410 | `NotExtended` 510 |
| `PayloadTooLarge` 413 | `NetworkAuthenticationRequired` 511 |
| `UnsupportedMediaType` 415 | |
| `UnprocessableEntity` 422 | |
| `TooManyRequests` 429 | |

## Types

```ts
type RouteHandler<Context, Injects extends InjectMap> =
  (context: Injected<Context, Injects>) => Promisable<unknown>;

type RouteNextHandler = (req: NextRequest, payload: RoutePayload) => Promise<Response>;

type RouteFilter = (e: unknown, context: Context) => unknown;
```
