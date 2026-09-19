# docs.ecosy.io

Documentation site for the ecosy packages. Content lives in `content/**/*.md`;
`app/` is a vinext (Next.js App Router-compatible) project that renders it.

## Build

    npm run build

Runs, in order:

1. `vinext build` — with `next.config.ts`'s `output: "export"` and
   `export const dynamic = "force-static"` on the six page files, this
   writes static HTML into `dist/client/` instead of a Cloudflare Worker
   bundle. 40 files today: one per `content/` page, the four hand-written
   catalog pages (`/`, `/packages`, `/frameworks`, `/forks`), and `404.html`.
2. `scripts/emit-offpage.mjs` — `llms.txt`, `llms-full.txt` and
   `search.json` are `app/**/route.ts` handlers. vinext's export build does
   **not** emit them: `getAppRouteRenderEntryPath()` returns `null` for any
   route with a `routePath`, so the prerender step marks all three
   `skipped: "api"` before ever looking at their `dynamic` export — and the
   build still exits 0, with no warning. This script runs the built
   `dist/server/index.js` (a plain Cloudflare Workers module,
   `{ fetch(request, env, ctx) }`) in-process and writes its three responses
   to `dist/client/` as files — confirmed byte-identical to what
   `vinext start` serves for the same paths.
3. `scripts/emit-markdown.mjs` — writes every page's raw Markdown next to
   the rendered HTML (`/next/route` → `dist/client/next/route.md`), and
   appends a `_headers` rule so Cloudflare Pages serves `*.md` as
   `text/plain` instead of `octet-stream`.

`npm run start` serves `dist/client` locally through
`scripts/serve-static.mjs`, which applies the ONE rewrite rule below — use
it to look at a build before deciding where it ships.

## Hosting requirement — the one thing a host MUST do

`dist/client` is a normal static directory: every file sits at a real path
(`anchor.html`, `core/cache.html`, `llms.txt`, `search.json`, …). But every
link vinext writes into the HTML points at the URL WITHOUT the `.html`
suffix (`href="/anchor"`), because that's the route, not the file. Serving
the directory as-is 404s on every internal link:

    python3 -m http.server → /anchor.html  200
                              /anchor       404   <- every link on every page

The host must rewrite:

    GET /<path>   ->  <path>.html   (when that file exists)
    GET /         ->  index.html

Everything else (`/_next/static/**`, `*.md`, `*.rsc`, `public/` assets) is a
real file at its real path and needs nothing special.

`next.config.ts`'s `trailingSlash: true` would remove this requirement
entirely (`anchor/index.html`, which every static host serves without
configuration) — it was tried and it breaks the build: vinext 1.0.0-beta.8
returns HTTP 308 instead of rendering for every route when it's on
(`Static export failed: 36 routes cannot be statically exported`). Do not
turn it on without re-testing against whatever vinext version is in use at
the time.

`_headers` (written by `scripts/emit-markdown.mjs`) is Cloudflare Pages'
own syntax for the `*.md` → `text/plain` rule above. On any other host it is
an inert text file; that host needs its own equivalent configuration, or
`*.md` files will be served as `application/octet-stream` (which makes a
browser download them instead of showing them) or 404 with no
`Content-Type` interpretation at all, depending on the server.

## Client-side navigation under a static host — NOT YET CONFIRMED in a browser

vinext's client router does not fetch a separate `.rsc` file when
navigating between pages. It re-requests the SAME pathname the link points
at (e.g. `GET /anchor`), adding an `RSC: 1` header, a
`Next-Router-State-Tree` header, and a `_rsc=<hash>` cache-busting query
parameter, and expects the SERVER to notice those and return the page's RSC
payload (`content-type: text/x-component`, a serialized React tree) instead
of the full HTML document it would return for a plain browser request to
the same URL.

Measured on this build's `dist/server/index.js` (the exact server `vinext
start` runs): a request shaped like the router's own produces `HTTP 200
text/x-component`, ~24KB of RSC data, for `GET /anchor?_rsc=<hash>` with
those headers. The SAME request against `dist/client` served by
`scripts/serve-static.mjs` (or any other static file server — this is not a
bug in that script, it is a structural property of "static") returns `HTTP
200 text/html`, the full page, because a static server cannot look at
request headers and choose a different file for the same path.

What is **not yet measured**: what the browser actually does when a
client-side navigation's fetch gets an HTML document instead of an RSC
stream. Reading vinext's source: there is a hard-navigation fallback
(`client/app-nav-failure-handler.js`, wired through the App Router's error
boundary) that would send the browser to a plain full-page reload on a
caught navigation error — but the string that fallback logs
(`"Error occurred during navigation, falling back to hard navigation"`) is
absent from this build's compiled `dist/client/_next/static/` output, which
suggests the safety net is compiled out under this build's configuration,
not that it will necessarily fail loudly. Neither half of that is confirmed
by an actual click in an actual browser — the environment this build was
produced in could not complete that check (no interactive browser access).

**Before shipping this to a static host, click through the site there and
watch the Network tab and the console for exactly this: does an in-app
link navigation (not a full page load) still show the destination page's
own content, or does it break/blank/error?** If it breaks, the two known
ways to route around it — disabling the client router's RSC-fetch
optimisation, or accepting a full page reload on every internal link — both
change what today's users experience, so that decision should be made by
whoever owns the product, not silently inside a build script.
