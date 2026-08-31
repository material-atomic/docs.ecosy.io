import { getPackages, reading, render } from "@/lib/content.mjs";
import { notFound } from "next/navigation";
import { DocsPage } from "@/components/DocsPage";
import { PackageHeader } from "@/components/PackageHeader";

export async function generateStaticParams() {
  const packages = getPackages();
  return packages.map((pkg: any) => ({ slug: pkg.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const packages = getPackages();
  const pkg = packages.find((p: any) => p.slug === slug);

  return {
    title: `${pkg?.meta.name ?? slug} — ecosy`,
    description: pkg?.meta.summary ?? "",
  };
}

export default async function PackagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const packages = getPackages();
  const pkg = packages.find((p: any) => p.slug === slug);
  if (!pkg) notFound();

  const { html } = render(pkg.body);
  const flat = reading(packages);
  const at = flat.findIndex((e: any) => e.href === `/${slug}`);

  return (
    <DocsPage
      packages={packages}
      current={{ slug }}
      header={<PackageHeader meta={pkg.meta} slug={slug} />}
      html={html}
      prev={flat[at - 1]}
      next={flat[at + 1]}
    />
  );
}
