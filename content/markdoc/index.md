---
name: "@ecosy/markdoc"
type: framework
status: beta
repo: material-atomic/ecosy-markdoc
npm: "@ecosy/markdoc"
summary: A documentation runtime for edge environments, with a GitHub repository as the content store.
---

# @ecosy/markdoc

```bash
yarn add @ecosy/markdoc
```

```ts
import { markdoc } from "@ecosy/markdoc";
import { Layout, Sitemap, RobotsTxt, html } from "@ecosy/markdoc/plugins";

export default markdoc({
  repo: "my-org/my-docs",
  branch: "main",
  dir: "/content",
  revalidate: 300,
  plugins: [
    Layout({
      getTemplate: html`<html><body><nav>${(s) => renderNav(s)}</nav>{{ body }}</body></html>`,
      payload: { siteName: "My Docs" },
    }),
    Sitemap,
    RobotsTxt({ sitemapUrl: "https://docs.example.com/sitemap.xml" }),
  ],
});
```

Markdown lives in a GitHub repository. The runtime fetches it through jsDelivr
on demand and renders it — no build step baking pages into a bundle, and no
database holding a copy of what is already in git. A merged pull request is a
publish.

The core uses Web standards only (`Request`, `Response`, `fetch`), so it runs on
Cloudflare Workers, Deno Deploy, Vercel Edge and Bun with no adapter.

## `markdoc`

```ts
function markdoc(options: MarkdocConfigurations): { fetch(request: Request): Promise<Response> }
```

Returns an edge server — export it as the default from a Worker, or hand it to
[`server`](#nodejs) on Node.

```ts
interface MarkdocConfigurations {
  // repository
  repo: string;                   // "owner/name"
  branch?: string;
  dir?: string;

  // content source
  provider?: string;              // default "https://cdn.jsdelivr.net/gh"
  interpolate?: string;           // default "{provider}/{repo}{branch}{dir}{path}"

  // behaviour
  strict?: boolean;
  revalidate?: number;            // seconds
  parser?: MarkdownParser;
  plugins?: PluginableLike[];
  lifecycle?: RequestLifecycleOptions;
  imports?: MarkdocImports;
}
```

### Pointing at another host

`interpolate` assembles the content URL from `{provider}`, `{repo}`,
`{branch}`, `{dir}` and `{path}`. The default matches jsDelivr; override it for
a host with a different path shape:

```ts
markdoc({
  repo: "my-org/my-docs",
  provider: "https://raw.githubusercontent.com",
  interpolate: "{provider}/{repo}/{branch}{dir}{path}",
});
```

### `parser`

```ts
type MarkdownParser = (markdown: string, frontmatter: Record<string, unknown>) => string
```

Receives the body **after** frontmatter extraction. Defaults to
`builtinParser`, a small one that ships with the package.

```ts
import { marked } from "marked";

markdoc({ repo, parser: (md) => marked.parse(md) as string });
```

`builtinParser` and `sanitizeHtml` are both exported if you want to wrap rather
than replace.

## Plugins

```ts
import { Layout, Sitemap, RobotsTxt, Authen, Cors, RSSFeed, Markdash, AutoInvalidate }
  from "@ecosy/markdoc/plugins";
```

A plugin declares what it registers, and optionally hooks the request
lifecycle.

```ts
abstract class Plugin {
  constructor(ctx: RequestContext, store: StoreLike)
  readonly id: string;
  get runtime(): RuntimeContext;

  abstract getRegistry(): PluginRegistry;

  fetch?(req: MarkdocRequest, res: MarkdocResponse): Promisable<MarkdocResponse>;
  beforeRequest?(...): …;
  afterRequest?(...): …;
}

interface PluginRegistry {
  urls?: Record<string, PluginRouteSchema>;
  template?: Record<string, string>;
  components?: Record<string, string>;
}
```

| hook | |
|---|---|
| `beforeRequest` | guards — auth, redirects, refusals |
| `fetch` | answers a request the plugin registered a URL for |
| `afterRequest` | transforms the response |

`fetch` is **required** when `getRegistry().urls` is non-empty, and a template
resolver is required when `template` is. Plugin components override file-based
ones of the same name.

Most built-ins are **factories** returning a plugin class; `Sitemap` is a class
already, so it is passed directly:

```ts
plugins: [Sitemap, RobotsTxt({ … }), Cors({ … })]
```

### `Layout`

```ts
function Layout(config: LayoutConfig): LayoutPluginConstructor
```

```ts
interface LayoutConfig {
  urls?: LayoutUrls;                        // static assets to serve
  template?: { root?: boolean; … };
  path?: { name: string; parser: string | LayoutPathParser };
  getTemplate?: string | LayoutTemplateFn;
  payload?: Record<string, unknown> | ((store) => Record<string, unknown>);
}
```

Precedence for the template: `getTemplate` → `path` → the default
`_template.md`.

```ts
Layout({
  urls: { "assets/css/style.css": {}, "assets/js/script.js": {} },
  path: { name: "_layout.html", parser: "root" },
  payload: (store) => ({ siteName: "My Docs", nav: store.getState().pages }),
});
```

### `html`

```ts
html`<h1>{{ title }}</h1> ${(store) => store.getState().user.name}`
```

A tagged template with two kinds of hole:

| | resolved | cost |
|---|---|---|
| `{{ key }}` | once, from `payload` | none |
| `${store => …}` | from the store, re-read on change | a re-render |

They look different on purpose — the second one costs a render, and it should
be visible in the source which holes carry that.

### `Sitemap`

```ts
plugins: [Sitemap]
```

Serves `/sitemap.xml` and a JSON sitemap. No options.

### `RobotsTxt`

```ts
function RobotsTxt(options?: RobotsTxtOptions): PluginConstructor

interface RobotsTxtOptions {
  rules?: RobotsRule[];      // { userAgent, allow?, disallow? }
  sitemapUrl?: string;
}
```

Serves `/robots.txt`. Defaults to allow-all.

### `Cors`

```ts
function Cors(options: CorsOptions): PluginConstructor

interface CorsOptions {
  origin: CorsOrigin;               // "*", a string, an array, or a predicate
  methods?: string[];
  headers?: string[];
  exposeHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;                  // default 86400
}
```

`credentials: true` with `origin: "*"` is refused at construction rather than
producing headers a browser will reject.

### `Authen`

```ts
function Authen(options: AuthenOptions): PluginConstructor

interface AuthenOptions {
  verify: AuthenVerify;
  cookieName?: string;         // default "token"
  publicPaths?: string[];
  render?: AuthenRenderConfig;
  handler?: AuthenHandler;
}
```

A `beforeRequest` guard: paths in `publicPaths` pass through, everything else
needs a cookie that `verify` accepts.

### `RSSFeed`

```ts
function RSSFeed(options: RSSFeedOptions): PluginConstructor

interface RSSFeedOptions {
  title: string;
  link: string;
  description?: string;
  path?: string;               // default "/feed.xml"
  format?: "rss" | "atom";     // default "rss"
  language?: string;           // default "en"
  maxItems?: number;           // default 20
  feedLink?: string;           // default link + path
  items?: FeedItemsSource;
  image?: FeedImage;
}
```

### `Markdash`

```ts
function Markdash(options?: MarkdashOptions): PluginConstructor
```

An admin surface for the runtime's caches:

```
GET  /<prefix>
POST /<prefix>/reload/manifest
POST /<prefix>/reload/engine
POST /<prefix>/clear/pages
```

`prefix` is normalised — leading and trailing slashes are stripped. With
`enableSwitchSource` three more routes are registered for changing the content
source at runtime.

**Guard it.** These routes clear caches and can change where content is read
from; put `Authen` in front, or do not mount it in production.

### `AutoInvalidate`

```ts
function AutoInvalidate(options: AutoInvalidateOptions): PluginConstructor

interface AutoInvalidateOptions {
  interval?: number;                        // 0 = off
  targets?: readonly InvalidateTarget[];    // default ["manifest", "engine", "pages"]
}
```

Expires caches on a schedule. Register it in `imports` rather than `plugins` —
it needs to outlive a request:

```ts
markdoc({
  repo,
  imports: { invalidate: AutoInvalidate({ interval: 600 }) },
});
```

On an edge runtime an isolate may be recycled at any point, so anything that
must survive a request has to be **declared** there rather than assumed.

## `imports`

```ts
type MarkdocImports = Record<string, InjectClassable<unknown, InjectedAccessor>>;
```

Services registered into the runtime container, reachable from a plugin with
`Inject<T>("name")`.

```ts
markdoc({
  repo,
  imports: {
    analytics: AnalyticsService,
    search: {
      target: SearchIndex,
      get: (accessor) => [accessor.get("fetchable")],
    },
  },
});
```

The object form declares constructor arguments resolved from the container.

These names are **reserved** and cannot be overridden: `configuration`,
`engine`, `fetchable`, `repo`, `documentation`, `manifest`, `pagable`,
`pluginable`, `server`.

Their interfaces are exported (`ConfigurationLike`, `DocumentationLike`,
`EngineLike`, `FetchableLike`, `ManifestLike`, `PagableLike`) so an external
plugin can type `this.runtime.configuration` without redeclaring a mirror.

## Node.js

```ts
import { server } from "@ecosy/markdoc/nodejs";

const app = markdoc({ repo: "my-org/my-docs" });

server(app, { port: 3000 }).start();
```

```ts
function server(app: EdgeServer, options?: NodeJSOptions): NodeJSServerStatic

interface NodeJSOptions {
  port?: number;         // default 3000
  hostname?: string;     // default "127.0.0.1"
}

interface NodeJSServerStatic {
  readonly port: number;
  readonly hostname: string;
  start(callback?: () => void): void;
  stop(callback?: (err?: Error) => void): void;
}
```

A separate entry point, so the edge build never carries Node code.

`start()` is **hot-reload safe**: the running server is kept on `globalThis`
under a registered symbol, so a re-executed module closes the previous one
before binding. That is what otherwise fails as `EADDRINUSE` on the second
reload.

`hostname` defaults to localhost — set `"0.0.0.0"` to expose on all interfaces
in a container.

## `redirect`

```ts
function redirect(url: string, status?: RedirectStatus): Response
```

For a `beforeRequest` guard that needs to send the visitor elsewhere.

## Where it does not fit

A site aggregating many repositories, with hundreds of pages and one search
index across all of them. Fetch-on-demand is right for one project's
documentation and wrong once the corpus has to be queried as a whole — at that
point the content wants assembling somewhere, not gathering per request.

## Subpath imports

```ts
import { markdoc, Plugin, Inject } from "@ecosy/markdoc";
import { Layout, Cors } from "@ecosy/markdoc/plugins";
import { Layout } from "@ecosy/markdoc/plugins/layout";
import { AutoInvalidate } from "@ecosy/markdoc/imports";
import { server } from "@ecosy/markdoc/nodejs";
```
