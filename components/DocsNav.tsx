import { GROUPS } from "@/lib/content.mjs";

type Pkg = {
  slug: string;
  meta: Record<string, any>;
  pages: { slug: string; title: string }[];
};

export function DocsNav({
  packages,
  current,
}: {
  packages: Pkg[];
  current: { slug?: string; page?: string };
}) {
  return (
    <nav className="docs-nav" data-slot="docs-nav" aria-label="Documentation">
      <div className="docs-nav-title">Documentation</div>

      {GROUPS.map((group) => {
        const items = packages.filter((p) => p.meta.type === group.type);
        if (!items.length) return null;

        return (
          <div className="docs-nav-group" key={group.type}>
            <div className="docs-nav-group-label">{group.label}</div>
            <ul className="docs-nav-list">
              {items.map((pkg) => (
                <li key={pkg.slug}>
                  <a
                    className="docs-nav-link"
                    href={`/${pkg.slug}`}
                    aria-current={current.slug === pkg.slug && !current.page ? "page" : undefined}
                  >
                    <span>{pkg.meta.name ?? pkg.slug}</span>
                    {pkg.meta.status === "beta" && (
                      <span className="docs-badge" data-kind="beta">Beta</span>
                    )}
                  </a>

                  {pkg.pages.length > 0 && (
                    <ul className="docs-nav-children">
                      {pkg.pages.map((page) => (
                        <li key={page.slug}>
                          <a
                            className="docs-nav-link"
                            href={`/${pkg.slug}/${page.slug}`}
                            aria-current={
                              current.slug === pkg.slug && current.page === page.slug ? "page" : undefined
                            }
                          >
                            <span>{page.title}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
