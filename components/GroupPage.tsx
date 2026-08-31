import { getPackages } from "@/lib/content.mjs";

/* The three catalogue pages the header links to. Static segments, so they win
   over app/[slug] and a package can never be shadowed by one of them. */
export function GroupPage({
  type,
  title,
  lead,
}: {
  type: "module" | "framework" | "fork";
  title: string;
  lead: string;
}) {
  const items = getPackages().filter((p: any) => p.meta.type === type);

  return (
    <div className="docs-scope">
      <header className="docs-page-header docs-group-header" data-slot="docs-page-header">
        <span className="docs-eyebrow">Catalogue</span>
        <h1>{title}</h1>
        <p className="docs-lead">{lead}</p>
        <div className="docs-meta">
          <span className="docs-group-count">{items.length}</span>
        </div>
      </header>

      <div className="docs-catalogue">
        <div className="docs-cards">
          {items.map((pkg: any) => (
            <a className="docs-card" href={`/${pkg.slug}`} key={pkg.slug}>
              <span className="docs-card-head">
                <span className="docs-card-name">{pkg.meta.name ?? pkg.slug}</span>
                {pkg.meta.status === "beta" && (
                  <span className="docs-badge" data-kind="beta">Beta</span>
                )}
              </span>
              <p className="docs-card-summary">{pkg.meta.summary ?? ""}</p>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
