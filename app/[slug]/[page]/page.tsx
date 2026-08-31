import { getPackages, reading, render } from "@/lib/content.mjs";
import { notFound } from "next/navigation";
import { DocsPage } from "@/components/DocsPage";

export async function generateStaticParams() {
  const packages = getPackages();
  return packages.flatMap((pkg: any) =>
    pkg.pages.map((page: any) => ({ slug: pkg.slug, page: page.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; page: string }>;
}) {
  const { slug, page: pageSlug } = await params;
  const packages = getPackages();
  const pkg = packages.find((p: any) => p.slug === slug);
  const page = pkg?.pages.find((p: any) => p.slug === pageSlug);

  return {
    title: `${page?.title ?? pageSlug} — ${pkg?.meta.name ?? slug}`,
    description: pkg?.meta.summary ?? "",
  };
}

export default async function SubPage({
  params,
}: {
  params: Promise<{ slug: string; page: string }>;
}) {
  const { slug, page: pageSlug } = await params;
  const packages = getPackages();
  const pkg = packages.find((p: any) => p.slug === slug);
  const page = pkg?.pages.find((p: any) => p.slug === pageSlug);
  if (!pkg || !page) notFound();

  const { html } = render(page.body);
  const flat = reading(packages);
  const at = flat.findIndex((e: any) => e.href === `/${slug}/${pageSlug}`);

  const header = (
    <header className="docs-page-header" data-slot="docs-page-header">
      <span className="docs-eyebrow">{pkg.meta.name ?? slug}</span>
      <h1>{page.title}</h1>
      {page.importPath && (
        <div className="docs-meta">
          <code>import … from &quot;{page.importPath}&quot;</code>
        </div>
      )}
    </header>
  );

  return (
    <DocsPage
      packages={packages}
      current={{ slug, page: pageSlug }}
      header={header}
      html={html}
      prev={flat[at - 1]}
      next={flat[at + 1]}
    />
  );
}
