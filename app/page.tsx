
import { Enhance } from "@/components/Enhance";
import { ArrowRightIcon } from "@/components/icons";
import { CodeTabs } from "@/components/CodeTabs";
import { highlight } from "@/lib/highlight.mjs";

const COPY = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

/* Real code from the @ecosy/next reference, not a mock-up. */
const SAMPLE = `import { Route, NotFound } from "@ecosy/next";

export const GET = Route({ users: Users })
  .get(async (ctx) => {
    const user = await ctx.users.byId(ctx.params.id);
    if (!user) throw new NotFound("No such user");
    return user;
  });`;

const AXIOM = `export const Vendor = Pack(EsmAdapter)
  .mount("/services/vendor")
  .fetch(HttpFetcher)
  .cache(DiskCache(".cache"));

// Vendor is a class. Nothing to call, nothing to await.
export const { GET } = Route({ vendor: Vendor }).get(async (ctx) => {
  return ctx.vendor.resolve(ctx.params.path);
});`;

export default function Home() {

  return (
    <div className="docs-scope">
      <header className="docs-hero" data-slot="docs-hero">
        <div className="docs-hero-grid">
          <div>
            <span className="docs-hero-eyebrow">Documentation</span>
            <h1 className="docs-hero-title">ecosy</h1>

            <p className="docs-hero-lead">
              Packages for building an application, two frameworks built on them, and forks
              carrying fixes upstream has not released. Each one stands alone.
            </p>

            <div className="docs-hero-actions">
              <a className="docs-button" data-variant="brand" href="/core">
                Start with @ecosy/core
                <ArrowRightIcon />
              </a>
              <a
                className="docs-button"
                data-variant="outline"
                href="https://github.com/material-atomic"
              >
                Source on GitHub
              </a>
            </div>

            <CodeTabs
              group="package-manager"
              tabs={[
                { value: "yarn", code: "yarn add @ecosy/core", language: "bash" },
                { value: "npm", code: "npm install @ecosy/core", language: "bash" },
                { value: "pnpm", code: "pnpm add @ecosy/core", language: "bash" },
              ]}
            />
          </div>

          <figure className="docs-hero-figure">
            <figcaption className="docs-hero-figure-bar">
              <span className="docs-hero-figure-dots" aria-hidden><i /><i /><i /></span>
              <span className="docs-hero-figure-title">app/api/users/[id]/route.ts</span>
            </figcaption>
            <pre>
              <code dangerouslySetInnerHTML={{ __html: highlight(SAMPLE) }} />
            </pre>
          </figure>
        </div>
      </header>

      <section className="docs-intro">
        <div className="g-prose">
          <h2>What it is</h2>
          <p>
            Seventeen packages, each solving one problem and installable on its own. Most carry{" "}
            <strong>no dependencies at all</strong>; the ones that do depend on another package
            here, and say so on their own page. Nothing pulls in a framework you did not ask for.
          </p>

          <h2>One idea runs through all of it</h2>
          <p>
            A function returns a <em>class</em>, not an instance. Configuration is a chain, and the
            chain has no terminal — a half-configured chain and a finished token are the same
            thing, so it drops straight into an injector.
          </p>
        </div>

        <div className="docs-intro-code">
          <div className="docs-code" data-slot="docs-code-block">
            <pre>
              <code dangerouslySetInnerHTML={{ __html: highlight(AXIOM) }} />
            </pre>
          </div>
        </div>

        <div className="g-prose">
          <h2>Ports, not imports</h2>
          <p>
            <code>Cacher</code>, <code>Fetcher</code>, <code>Searcher</code>, <code>Hook</code> and{" "}
            <code>Coordinator</code> are structural interfaces with two or three methods. An
            application that already owns a cache or an HTTP client satisfies them without
            importing anything from here — which is what keeps the packages free of each other.
          </p>
        </div>
      </section>

      <nav className="docs-intro-links" aria-label="Catalogue">
        <a className="docs-card" href="/packages">
          <span className="docs-card-head"><span className="docs-card-name">Packages</span></span>
          <p className="docs-card-summary">Things you install into an application, one job each.</p>
        </a>
        <a className="docs-card" href="/frameworks">
          <span className="docs-card-head"><span className="docs-card-name">Frameworks</span></span>
          <p className="docs-card-summary">Built on the packages; you adopt one for a whole application.</p>
        </a>
        <a className="docs-card" href="/forks">
          <span className="docs-card-head"><span className="docs-card-name">Forks</span></span>
          <p className="docs-card-summary">Someone else's package, carrying a fix upstream has not released.</p>
        </a>
      </nav>

      <Enhance />
    </div>
  );
}
