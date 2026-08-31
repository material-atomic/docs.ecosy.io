"use client";

import { useEffect, useState } from "react";

/* Same contract as GoesDesignSystem.CodeTabs (components/docs/CodeBlock.d.ts),
   so this is a drop-in swap if the design system ever ships consumable:

     CodeTab  extends CodeBlockProps { value: string; label?: ReactNode }
     CodeTabs { tabs, group, defaultValue, onValueChange, labels }

   The behaviour that matters is `group`: every block sharing one switches
   together and the choice survives a reload. A docs page that asks the reader
   to pick their package manager once, then forgets it two blocks later, is the
   thing this exists to prevent. */

export type CodeTab = {
  value: string;
  label?: React.ReactNode;
  code?: string;
  language?: string;
};

type Labels = { copy?: string; copied?: string };

/* One store per group, shared by every mounted CodeTabs. */
const groups = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function readStored(group: string): string | null {
  try {
    return localStorage.getItem(`docs-codetab:${group}`);
  } catch {
    return null;
  }
}

function setGroup(group: string, value: string) {
  groups.set(group, value);
  try {
    localStorage.setItem(`docs-codetab:${group}`, value);
  } catch {}
  listeners.get(group)?.forEach((fn) => fn());
}

function useGroupValue(group: string | undefined, fallback: string) {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    if (!group) return;

    /* Read after mount, never during render: the server has no localStorage and
       a first paint that disagrees with it is a hydration mismatch. */
    const stored = groups.get(group) ?? readStored(group);
    if (stored) {
      groups.set(group, stored);
      setValue(stored);
    }

    const sync = () => setValue(groups.get(group) ?? fallback);
    const set = listeners.get(group) ?? new Set();
    set.add(sync);
    listeners.set(group, set);

    return () => {
      set.delete(sync);
    };
  }, [group, fallback]);

  return [value, (next: string) => (group ? setGroup(group, next) : setValue(next))] as const;
}

const COPY = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

const CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m4 12 5 5L20 6" />
  </svg>
);

export function CodeTabs({
  tabs = [],
  group,
  defaultValue,
  onValueChange,
  labels,
  className = "",
}: {
  tabs?: CodeTab[];
  group?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  labels?: Labels;
  className?: string;
}) {
  const [value, setValue] = useGroupValue(group, defaultValue ?? tabs[0]?.value ?? "");
  const [copied, setCopied] = useState(false);

  const active = tabs.find((t) => t.value === value) ?? tabs[0];
  if (!active) return null;

  const pick = (next: string) => {
    setValue(next);
    onValueChange?.(next);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active.code ?? "");
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={`docs-tabs ${className}`.trim()} data-slot="docs-code-tabs">
      <div className="docs-tabs-bar" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={tab.value === active.value}
            className="docs-tab"
            onClick={() => pick(tab.value)}
          >
            {tab.label ?? tab.value}
          </button>
        ))}

        <button
          type="button"
          className="docs-copy"
          data-copied={copied || undefined}
          aria-label={copied ? labels?.copied ?? "Copied" : labels?.copy ?? "Copy code"}
          onClick={copy}
        >
          {copied ? CHECK : COPY}
        </button>
      </div>

      <pre>
        <code className={active.language ? `language-${active.language}` : undefined}>
          {active.code}
        </code>
      </pre>
    </div>
  );
}
