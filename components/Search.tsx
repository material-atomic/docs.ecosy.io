"use client";

import { useEffect, useRef, useState } from "react";

type Entry = { title: string; path: string; section?: string };

/* Subsequence match, so "corutil" finds "core utilities". Ranked by how early
   and how tightly the query lands. */
function score(haystack: string, needle: string): number {
  const text = haystack.toLowerCase();
  let at = -1;
  let first = -1;
  let gaps = 0;

  for (const char of needle) {
    const next = text.indexOf(char, at + 1);
    if (next === -1) return -1;
    if (first === -1) first = next;
    if (at !== -1) gaps += next - at - 1;
    at = next;
  }

  return 1000 - first * 4 - gaps;
}

export function Search({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || entries) return;
    fetch("/search.json")
      .then((r) => r.json())
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [open, entries]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      input.current?.focus();
    }
  }, [open]);

  const needle = query.trim().toLowerCase();
  const results = !entries
    ? []
    : !needle
      ? entries.slice(0, 12)
      : entries
          .map((entry) => ({ entry, rank: score(`${entry.title} ${entry.section ?? ""}`, needle) }))
          .filter((r) => r.rank > 0)
          .sort((a, b) => b.rank - a.rank)
          .slice(0, 12)
          .map((r) => r.entry);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose();

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!results.length) return;
        setCursor((c) => (c + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
        return;
      }

      if (event.key === "Enter" && results[cursor]) {
        event.preventDefault();
        window.location.href = results[cursor].path;
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, results, cursor, onClose]);

  if (!open) return null;

  return (
    <div className="docs-cmd" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="docs-cmd-panel" role="dialog" aria-modal="true" aria-label="Search">
        <input
          ref={input}
          className="docs-cmd-input"
          type="search"
          placeholder="Search or jump to…"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
        />
        <ul className="docs-cmd-list">
          {results.length === 0 && <li className="docs-cmd-empty">No matches.</li>}
          {results.map((entry, i) => (
            <li key={entry.path + i}>
              <a className="docs-cmd-item" data-active={i === cursor} href={entry.path}>
                <span>{entry.title}</span>
                <span className="docs-cmd-path">{entry.section ?? ""}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
