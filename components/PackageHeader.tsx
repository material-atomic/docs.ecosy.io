export function PackageHeader({ meta, slug }: { meta: Record<string, any>; slug: string }) {
  const bits: React.ReactNode[] = [];

  if (meta.status) bits.push(<span className="docs-badge" data-kind={meta.status} key="s">{meta.status}</span>);
  if (meta.npm) bits.push(<code key="n">{meta.npm}</code>);
  if (meta.repo) bits.push(<a href={`https://github.com/${meta.repo}`} key="r">Source</a>);
  if (meta.upstream?.repo)
    bits.push(
      <span key="u">
        fork of <a href={`https://github.com/${meta.upstream.repo}`}>{meta.upstream.repo}</a>
      </span>,
    );

  return (
    <header className="docs-page-header" data-slot="docs-page-header">
      <span className="docs-eyebrow">{meta.type ?? ""}</span>
      <h1>{meta.name ?? slug}</h1>
      {meta.summary && <p className="docs-lead">{meta.summary}</p>}
      <div className="docs-meta">
        {bits.map((bit, i) => (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && <span className="docs-meta-sep">·</span>}
            {bit}
          </span>
        ))}
      </div>
    </header>
  );
}
