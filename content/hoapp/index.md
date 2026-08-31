---
name: "@ecosy/hoapp"
type: framework
status: beta
repo: material-atomic/ecosy-hoapp
npm: "@ecosy/hoapp"
summary: A route framework over Hono — declarative descriptors, nestable routers, a uniform response envelope and generated OpenAPI.
---

# @ecosy/hoapp

```bash
yarn add @ecosy/hoapp hono
```

```ts
import { Router, Descriptor, json, NotFound } from "@ecosy/hoapp";

const users = new Router("/users")
  .get("/", Descriptor({ summary: "List users" }).use(async (c) => listUsers()))
  .get("/:id", Descriptor({ summary: "Get user" }).use(async (c) => {
    const user = await findUser(c.req.param("id"));
    if (!user) throw new NotFound("No such user");
    return user;
  }));

const api = new Router({ base: "/api", cors: { origins: ["https://app.example.com"] } })
  .use(json)
  .add(users);

export default api.getRouter();
```

`hono` is a peer dependency. Runs anywhere Hono does — Cloudflare Workers, Deno,
Bun, Node.

A route here is a **descriptor**: metadata plus handlers. The metadata is what
the router registers, what OpenAPI is generated from, and what decides how a
return value becomes a response — one declaration, not three.

## `Descriptor`

```ts
function Descriptor<Data, Route extends string>(descriptor: DescritorConfigurations<Route>): DescriptorLike
```

```ts
interface DescritorConfigurations<Route extends string> {
  url?: Route;
  title?: string;
  summary?: string;
  status?: ContentfulStatusCode;      // default 200
  tags?: string[];
  type?: "json" | "html" | "text";    // default "json"
  responses?: Record<number | string, unknown>;
  basic?: boolean;
  bearer?: boolean;
  examples?: Record<string, unknown>;
}
```

Returns a **class**, so it composes without instantiation.

```ts
const getUser = Descriptor({ url: "/:id", summary: "Get user", tags: ["users"] })
  .use(authenticate)
  .use(async (c) => findUser(c.req.param("id")));
```

| method | |
|---|---|
| `.use(...handlers)` | Appends middlewares and the final handler. |
| `.url(path)` | Returns a copy bound to `path`. |
| `.refine(config)` | Returns a copy with merged configuration. |
| `.handle()` | One Hono handler running the whole chain. |
| `.forRoute()` | The handler array, for `app.get(path, ...)`. |

`.url()` and `.refine()` return **new** descriptors carrying the same handlers,
so one descriptor can be mounted at several paths.

Register on a raw Hono app if you are not using `Router`:

```ts
app.get("/users/:id", getUser.handle());
```

### Return values

The **last** handler's return value becomes the response, shaped by
`descriptor.type`:

| `type` | result |
|---|---|
| `"json"` (default) | wrapped in the response envelope |
| `"html"` | `c.html(String(result), status)` |
| `"text"` | `c.text(String(result), status)` |

Returning a `Response` passes it through untouched.

A handler declaring a **second parameter** (`next`) is treated as middleware:
its return value is passed on rather than becoming the body. So this is the
line between a handler and a middleware — the arity, not a separate registration
call:

```ts
.use(async (c, next) => { /* middleware */ await next(); })
.use(async (c) => ({ ok: true }))   // handler
```

A descriptor with no handlers throws `InternalServerError` when the router
builds it.

## `Router`

```ts
class Router<Base extends string, B extends Bindings> {
  constructor(options?: Base | RouterOptions<B>)
}
```

```ts
interface RouterOptions<B> {
  base?: string;
  cors?: CorsOptions & { path?: string };
  logger?: boolean | string;                  // true, or a path pattern
  notFound?: NotFoundHandler;
  error?: ErrorHandler;
  useFactory?: { path: string; use: MiddlewareHandler | MiddlewareHandler[] }[];
  middlewares?: DescriptorLike[];
}
```

A string is shorthand for `{ base }`.

```ts
.get(path?, descriptor)
.post(path?, descriptor)
.put(path?, descriptor)
.patch(path?, descriptor)
.delete(path?, descriptor)
.options(path?, descriptor)
.all(path?, descriptor)
.use(path?, descriptor)      // middleware for this router
.add(...routers)             // nest child routers
.getRouter(basePath?)        // build the Hono app
```

The path may be given as the first argument or as `url` on the descriptor —
the argument wins.

### Nesting

```ts
const admin = new Router("/admin").use(requireAdmin).get("/stats", stats);
const api = new Router("/api").add(users, admin);

export default api.getRouter();
```

Each child mounts under its own `base`, and paths compose — `/api/admin/stats`.
A router's `.use()` middlewares apply to that router and everything nested
inside it.

### Mounting onto an existing app

```ts
const app = new Hono();
Router.add(app, api, webhooks);
```

## Responses

Every JSON response has the same envelope:

```ts
interface ResponseStructure<Data> {
  success: boolean;
  data: Data | null;
  status: number;
  message: string;
  error: { message: string; detail: unknown } | null;
}
```

```json
{ "success": true, "data": { "id": 1 }, "status": 200, "message": "Successful", "error": null }
```

### `HttpResult`

```ts
class HttpResult<Data> {
  constructor(
    success: boolean,
    statusText: string,
    statusCode: ContentfulStatusCode,
    message: string,
    data?: Data | null,
    errorDetail?: unknown,
  )

  get(): ResponseStructure<Data>
  json(ctx: RouteContext): Response
}
```

Build the envelope yourself when you need a status the descriptor does not
declare.

### Success classes

`OK` (200), `Created` (201), `Accepted` (202), `ResetContent` (205),
`MovedPermanently` (301), `Found` (302), `TemporaryRedirect` (307).

```ts
.use(async (c) => new Created(user).json(c))
```

### Error classes

Thrown, not returned. Each extends Hono's `HTTPException`, so Hono's own error
handling picks them up.

`BadRequest` (400), `Unauthorized` (401), `Forbidden` (403), `NotFound` (404),
`Conflict` (409), `UnsupportedMediaType` (415), `InternalServerError` (500).

```ts
throw new BadRequest("Invalid payload", { field: "email" });
```

The second argument is `errorDetail`, which lands in `error.detail`.

Anything else that escapes becomes a 500 through the router's default error
handler.

## Built-in middleware

### `json`

```ts
import { json } from "@ecosy/hoapp";

new Router("/api").use(json);
```

Rejects a mutating request (POST, PUT, PATCH, DELETE) whose body is not
`application/json`, with 415 naming what was expected and what arrived. A
request with **no body** — `content-length` absent or zero — passes through, so
a bodyless DELETE is not rejected.

### `cors`

```ts
interface CorsOptions {
  url?: string;
  origins?: string[];            // "*" allows any
  methods?: string[];            // GET POST PUT PATCH DELETE OPTIONS
  headers?: string[];            // Content-Type, Authorization
  credentials?: boolean;         // default true
  maxAge?: number;               // default 86400
}
```

```ts
new Router({ base: "/api", cors: { origins: ["https://app.example.com"] } });

// or as a descriptor
api.use(cors({ origins: ["*"], credentials: false }));
```

Note `credentials` defaults to **`true`**, which browsers refuse to combine
with `origins: ["*"]`. Set it to `false` for a public API.

`DEFAULT_ALLOWED_METHODS` and `DEFAULT_ALLOWED_HEADERS` are exported.

### Auth

```ts
import { basic, bearer, jwt } from "@ecosy/hoapp/auth";

new Router("/admin").use(basic({ username: "u", password: "p" }));
new Router("/api").use(bearer({ token: process.env.API_TOKEN }));
new Router("/api").use(jwt({ secret: process.env.JWT_SECRET }));
```

Each wraps the corresponding Hono middleware as a descriptor, so options are
Hono's own.

## OpenAPI

```ts
import { Swagger, ApiOperation } from "@ecosy/hoapp/swagger";
import { SwaggerUI } from "@ecosy/hoapp/swagger-ui";

const swagger = new Swagger({
  info: { title: "My API", version: "1.0.0" },
  jsonUrl: "/docs/json",
});

swagger.addUI(new SwaggerUI().getRouter({ base: "/docs", jsonUrl: "/docs/json" }));

const app = new Router("/").add(api, swagger.getRouter());
```

Constructing a `Swagger` registers it with `Router` globally, so **every route
declared afterwards** is collected. Declare it before your routers, or routes
registered earlier will be missing from the spec.

### `ApiOperation`

```ts
function ApiOperation<Data, Route extends string>(options: ApiOperationOptions<Route>): DescriptorLike
```

A `Descriptor` with the extra OpenAPI fields:

```ts
interface ApiOperationOptions extends DescritorConfigurations {
  description?: string;
  operationId?: string;
  deprecated?: boolean;
  parameters?: Array<{ name; in: "query" | "header" | "path" | "cookie"; description?; required?; deprecated?; schema? }>;
  requestBody?: { description?; required?; content: Record<string, any> };
  security?: Array<Record<string, string[]>>;
}
```

```ts
const createUser = ApiOperation({
  url: "/",
  summary: "Create a user",
  operationId: "createUser",
  requestBody: {
    required: true,
    content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" } } } } },
  },
  responses: { 201: { description: "Created" } },
}).use(async (c) => createUser(await c.req.json()));
```

Hono-style `:id` path parameters are converted to OpenAPI `{id}`
automatically.

### `SwaggerRegistry`

```ts
class SwaggerRegistry implements RouterRegistryLike {
  constructor(config: SwaggerConfig)
  register(method: string, path: string, desc: DescriptorLike): void
  getOpenApiJson(): object
}
```

The collector. Register any object with a `register` method to build something
else from the same route declarations:

```ts
Router.registry(myOwnRegistry);
```

That is the extension point for generating a client, a Postman collection, or a
route table — the router already knows every route and its metadata.

## Subpath imports

```ts
import { Router } from "@ecosy/hoapp/router";
import { Descriptor } from "@ecosy/hoapp/descriptor";
import { OK, NotFound } from "@ecosy/hoapp/result";
import { json } from "@ecosy/hoapp/json";
import { cors } from "@ecosy/hoapp/cors";
import { basic, bearer, jwt } from "@ecosy/hoapp/auth";
import { Swagger } from "@ecosy/hoapp/swagger";
import { SwaggerUI } from "@ecosy/hoapp/swagger-ui";
```

`swagger` and `swagger-ui` are separate paths so a production build does not
carry the spec generator or the UI's inlined CSS and JavaScript.
