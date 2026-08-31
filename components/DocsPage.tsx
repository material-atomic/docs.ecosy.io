import { DocsNav } from "./DocsNav";
import { Enhance } from "./Enhance";

type Entry = { href: string; label: string };

export function DocsPage({
  packages,
  current,
  header,
  html,
  prev,
  next,
}: {
  packages: any[];
  current: { slug?: string; page?: string };
  header: React.ReactNode;
  html: string;
  prev?: Entry;
  next?: Entry;
}) {
  return (
    <div className="docs-scope">
      <div className="docs-shell" data-slot="docs-shell">
        <div className="docs-nav-col" data-nav-panel>
          <DocsNav packages={packages} current={current} />
        </div>

        <main className="docs-main">
          {header}
          <div className="g-prose" dangerouslySetInnerHTML={{ __html: html }} />

          {(prev || next) && (
            <nav className="docs-pager" data-slot="docs-pager">
              {prev && (
                <a className="docs-pager-card" data-dir="prev" href={prev.href}>
                  <span className="docs-pager-dir">Previous</span>
                  <span className="docs-pager-title">{prev.label}</span>
                </a>
              )}
              {next && (
                <a className="docs-pager-card" data-dir="next" href={next.href}>
                  <span className="docs-pager-dir">Next</span>
                  <span className="docs-pager-title">{next.label}</span>
                </a>
              )}
            </nav>
          )}
        </main>

      </div>

      <Enhance />
    </div>
  );
}
