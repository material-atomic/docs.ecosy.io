---
name: "@ecosy/http"
type: module
status: stable
repo: material-atomic/ecosy-http
npm: "@ecosy/http"
summary: A fetch client with interceptors, a normalised response, XHR uploads with progress, and a chainable action builder.
---

# @ecosy/http

```bash
yarn add @ecosy/http
```

```ts
import { Http } from "@ecosy/http";

const { success, data, error } = await Http.get<User[]>("/api/users");
```

Zero dependencies, built on `fetch`. Works in a browser, in Node 18+, and on
Cloudflare Workers.

## `HttpResponse`

Every method resolves to the same shape. **Nothing rejects** — a network
failure, a timeout and a 500 all arrive here, so a call site branches instead of
catching.

```ts
interface HttpResponse<T = unknown, E = unknown> {
  success: boolean;
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  error: E | null;
}
```

```ts
const res = await Http.get<User>("/api/users/1");

if (!res.success) {
  return handle(res.error, res.status);
}

res.data.name;
```

A transport failure — DNS, refused connection, abort, CORS — comes back as
`status: 0`, `statusText: "Error"`, `data: null`, with the `Error` in `error`.
That is the one status you cannot get from a server, so it is how you tell
"never reached" from "reached and refused":

```ts
if (res.status === 0) {
  // request never completed
}
```

The body is parsed as JSON when the response `Content-Type` contains
`application/json`, and as text otherwise. On a non-2xx JSON body, `error` is
the body's `error` field if it has one, and the whole body if it does not.

## Static methods

Use these when you have a full URL and no shared configuration.

```ts
Http.get<T, E>(url, init?)
Http.post<T, E>(url, body?, init?)
Http.put<T, E>(url, body?, init?)
Http.patch<T, E>(url, body?, init?)
Http.delete<T, E>(url, body?, init?)
Http.head<T, E>(url, init?)
Http.options<T, E>(url, init?)
Http.request<T, E>(init)
Http.upload<T, E>(url, file, options?)
Http.related<T, E>(url, file, options?)
```

`init` is `HttpInit` without `url` and `method` (and without `body` where the
signature already takes one).

## `new Http(init?)`

An instance when you want a base URL, default headers or per-client
interceptors.

```ts
class Http {
  constructor(init?: string | HttpOptions)
}

interface HttpOptions {
  baseURL?: string;                          // default "/"
  allowedOrigins?: ReadonlyArray<string>;
  configs?: Record<string, unknown>;         // merged into every request init
}
```

```ts
const api = new Http("https://api.example.com");

const api = new Http({
  baseURL: "https://api.example.com",
  allowedOrigins: ["https://cdn.example.com"],
  configs: { credentials: "include" },
});
```

Instances carry the same seven verbs plus `request`, `upload` and `related`.

### URL resolution

A URL with a scheme is used as-is; anything else is joined onto `baseURL`.
Protocol-relative URLs **throw**:

```ts
api.get("/users");                      // https://api.example.com/users
api.get("https://other.com/x");         // as given
api.get("//evil.com/x");                // Error: protocol-relative URLs are not allowed
```

### `addHeaders`

```ts
addHeaders(headers: Record<string, string>): void
```

Merges into the instance's default headers, which per-request `headers`
override.

```ts
api.addHeaders({ Authorization: `Bearer ${token}` });
```

### `allowedOrigins`

The origin of `baseURL` is always allowed; `allowedOrigins` adds more. They
bound where a redirect may land, so a 302 to an unlisted origin is not
followed. An invalid entry throws at construction.

Note this registry is **process-global**: origins registered by one instance
apply to redirect checks made by every other. The first client to declare any
origin therefore turns the check on for everyone.

## `HttpInit`

```ts
interface HttpInit {
  url: string;
  method?: HttpMethod;
  query?: Record<string, string | number | boolean | null | undefined>;
  params?: Record<string, unknown>;   // fills :name in the path
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;

  credentials?: "same-origin" | "include" | "omit";
  cache?: "force-cache" | "no-store";
  mode?: "cors" | "no-cors" | "same-origin";
  redirect?: "follow" | "manual" | "error";
  referrer?: string;
  referrerPolicy?: HttpReferrerPolicy;
  integrity?: string;
  keepalive?: boolean;
  priority?: "auto" | "high" | "low";
  duplex?: "half" | "full";

  // per-request interceptors
  request?: MaybeArray<HttpInterceptorRequest>;
  response?: MaybeArray<HttpInterceptorResponse>;
  transform?: MaybeArray<HttpInterceptorTransform>;
  error?: MaybeArray<HttpInterceptorError>;

  // Next.js
  revalidate?: number | false;
  tags?: string[];

  // Cloudflare Workers
  cacheEverything?: boolean;
  cacheTtl?: number;
  cacheKey?: string;
  cacheTtlByStatus?: Record<string, number>;
  cacheTags?: string[];
  resolveOverride?: string;
  image?: ...;
  polish?: "lossless" | "lossy" | "off";
  minify?: ...;
  scrapeShield?: boolean;
  colo?: string;
}
```

Next.js and Cloudflare fields are written flat and split into `next` and `cf`
objects before reaching `fetch`, so the same init works on both runtimes.

```ts
await Http.get("/api/posts", { revalidate: 60, tags: ["posts"] });
await Http.get("https://cdn/x.json", { cacheTtl: 3600, cacheEverything: true });
```

`params` and `query`:

```ts
await api.get("/users/:id/posts", {
  params: { id: 42 },
  query: { page: 2, draft: false },
});
// /users/42/posts?page=2&draft=false
```

## Interceptors

Four kinds, registered per instance (`api.on`) or process-wide (`Http.on`).

| type | signature | runs |
|---|---|---|
| `request` | `(init) => init` | before the request is sent |
| `response` | `(response) => Response` | on the raw `Response` |
| `transform` | `(data) => any` | on parsed body data |
| `error` | `(error) => any` | on a failure |

```ts
api.on("request", (init) => ({
  ...init,
  headers: { ...init.headers, "X-Trace": traceId() },
}));

api.on("error", (err) => {
  report(err);
  return err;
});

api.off("request", handler);
```

Instance `on`/`off` return `this` and chain. Registering the same function
twice registers it once.

Order per request: static interceptors, then instance, then per-request from
`init`.

`Http.on` affects **every** instance in the process. Use it for cross-cutting
concerns (tracing, global error reporting), not for auth headers belonging to
one API.

## Uploads

### `upload`

```ts
upload<T, E>(
  url: string,
  file: File | File[] | FileList,
  options?: HttpUploadOptions & Omit<HttpInit, "url" | "method" | "body">,
): Promise<HttpResponse<T, E>>
```

```ts
interface HttpUploadOptions {
  onProgress?: (progress: HttpProgress) => void;
  name?: string;                        // field name, default "file"
  body?: Record<string, unknown>;       // extra fields alongside the file
  headers?, params?, query?, signal?
}

interface HttpProgress {
  loaded: number;
  total: number;
  percentage: number;
}
```

```ts
await Http.upload("/api/files", file, {
  name: "avatar",
  body: { userId: 42 },
  onProgress: ({ percentage }) => setProgress(percentage),
});
```

Runs on `XMLHttpRequest`, not `fetch` — upload progress is not observable
through `fetch`. The response shape is identical.

### `related`

```ts
related<T, E>(url, file, options: HttpRelatedOptions): Promise<HttpResponse<T, E>>
```

```ts
interface HttpRelatedOptions {
  metadata: Record<string, unknown>;
  metadataMimeType?: string;   // default "application/json"
  contentType: string;         // the file's type
  headers?, params?, query?, signal?
}
```

`multipart/related` — a JSON metadata part followed by the binary part, which
is what the Google Drive and YouTube upload APIs expect.

## `Fetcher`

A builder over `Http` that turns endpoint keys into reusable actions and runs
them through a middleware pipeline.

```ts
import { Fetcher, dedupePlugin, cachePlugin } from "@ecosy/http";

const api = Fetcher({ baseURL: "https://api.example.com" })
  .register("users", { me: "/users/me", list: "/users" })
  .use(dedupePlugin(), cachePlugin({ ttl: 30_000 }))
  .retry(async (res) => res.status === 401 && (await refreshToken()));

const me = api<User>("users.me");
const { data, key, args } = await api.fetcher(me);
```

### `Fetcher(options?)`

```ts
function Fetcher(options?: FetcherOptions | string): IFetcherBuilder
```

A string is shorthand for `{ baseURL }`. Three statics start a chain without
options: `Fetcher.baseURL(url)`, `Fetcher.endpoint(fn)`,
`Fetcher.register(...)`.

```ts
interface FetcherOptions {
  baseURL?: string;
  http?: Http;                    // reuse an existing instance
  endpoint?: Record<string, unknown> | (() => Record<string, unknown>);
  request?, response?, transform?, error?
  middlewares?: FetcherMiddleware[];
  retryLimit?: number;
  shouldRetry?: (res, key) => boolean | Promise<boolean>;
  onRetry?: (res, key) => boolean | Promise<boolean>;
  onResult?: (result, config) => void | Promise<void>;
}
```

### Building

```ts
.baseURL(url)
.endpoint(fn)
.register(service, endpoints)     // or .register({ service: endpoints })
.request(fn) .response(fn) .transform(fn) .error(fn)
.use(...middlewares)
.shouldRetry(fn)
.retry(fn)
.onResult(fn)
.config(options)
```

All return the builder. `.http` exposes the underlying `Http` instance.

**The builder is mutable.** Each call changes the builder in place and returns
the same object, so a shared base cannot be branched:

```ts
const base = Fetcher({ baseURL: "https://api.example.com" });

const authed = base.request(addToken);   // mutates base
const public = base;                     // also has addToken
```

Create a separate `Fetcher(...)` per configuration rather than deriving one
from another.

### Actions

```ts
api<T, Args, E>(key: string, method?: HttpMethod | "upload" | "related"): HttpAction<T, Args, E>
```

```ts
interface HttpAction<T, Args extends any[], E> {
  key: string;
  fn: (...args: Args) => Promise<HttpResponse<T, E>>;
}
```

An action is a descriptor, not a request — nothing is sent until you execute
it. `key` is stable, which is what makes it usable as a React Query or SWR
cache key.

```ts
api.fetcher(action, ...args)                    // rest arguments
api.execute(action, args, overrideConfig?)      // array + per-call config
```

Both resolve to `FetcherResult`, which is `HttpResponse` plus `key` and `args`:

```ts
type FetcherResult<T, Args, E> = HttpResponse<T, E> & { key: string; args: Args };
```

### Middleware

```ts
type FetcherMiddleware = (
  action: HttpAction,
  args: any[],
  next: () => Promise<HttpResponse>,
) => Promise<HttpResponse>;
```

Runs in registration order, each wrapping the next.

```ts
const timing: FetcherMiddleware = async (action, args, next) => {
  const t = performance.now();
  const res = await next();
  console.log(action.key, performance.now() - t);
  return res;
};
```

### Retry

```ts
.shouldRetry((res, key) => boolean | Promise<boolean>)
.retry((res, key) => boolean | Promise<boolean>)
```

`shouldRetry` decides whether a response is a retry candidate; `retry` does the
repair and returns `true` to re-run the request. Bounded by `retryLimit`.

```ts
Fetcher({ baseURL, retryLimit: 1 })
  .shouldRetry((res) => res.status === 401)
  .retry(async () => {
    const ok = await refreshToken();
    return ok;
  });
```

## Plugins

```ts
import { dedupePlugin, cachePlugin, loggerPlugin } from "@ecosy/http/plugins";
```

### `dedupePlugin()`

Collapses identical in-flight requests — same action key and same arguments —
onto one promise. Cleared when it settles.

### `cachePlugin(options?)`

```ts
interface CachePluginOptions {
  ttl?: number;   // ms, default 60000
}
```

In-memory, keyed by action key plus arguments. Process-local and unbounded —
for short TTLs on a bounded set of keys, not a general cache.

### `loggerPlugin(options?)`

```ts
interface LoggerPluginOptions {
  logger?: unknown;          // console, @ecosy/logger, winston…
  successLevel?: string;     // default "info", falling back to "log"
  errorLevel?: string;       // default "error"
  formatStart?: (key: string, args: any[]) => any[];
  formatSuccess?: (key: string, res: any, durationMs: number) => any[];
  formatError?: (key: string, err: any, durationMs: number) => any[];
}
```

Logs start, completion and duration. The logger is called by method name, so
anything with the right methods works — passing a logger instance directly
instead of an options object is also accepted.

```ts
Fetcher(baseURL).use(loggerPlugin({ logger, successLevel: "debug" }));
```

## `Endpoint`

```ts
class Endpoint {
  static register(service: string, endpoints: EndpointConfig): typeof Endpoint;
  static register(configs: Record<string, EndpointConfig>): typeof Endpoint;
  static all(): Record<string, EndpointConfig>;
}
```

The process-wide registry a `Fetcher` falls back to when it has no `endpoint`
of its own. `Http.Endpoint` is the same class.

```ts
Http.Endpoint.register({
  users: { me: "/users/me", list: "/users" },
  posts: { list: "/posts" },
});
```

## `createClient`

```ts
function createClient(options?: HttpClientOptions): <T, Args, E>(key: string, method?) => HttpAction<T, Args, E>
```

The action factory under `Fetcher`, without the pipeline. Use it when you want
keyed actions but no middleware, retry or interceptor chain.

```ts
const api = createClient({
  baseURL: "https://api.example.com",
  endpoint: { users: { list: "/users" } },
});

const getUsers = api<User[]>("users.list");
const { data } = await getUsers.fn();
```

## Constants and types

```ts
Methods          // { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS }
Uploads          // { UPLOAD, RELATED }
HttpStatus       // named status codes
HttpStatusText   // code → standard reason phrase
```

```ts
type HttpMethod = keyof typeof Methods;
type HttpStatusCode = typeof HttpStatus[keyof typeof HttpStatus];
type MaybeArray<T> = T | T[];

function asArray<T>(data: T | T[]): T[]
function getHttpInitSlice(init: Partial<HttpInit>): HttpInitSlice
```

`HttpUtils` holds the URL and origin helpers the client uses internally.
