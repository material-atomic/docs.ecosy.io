"use client";

import { useEffect, useState } from "react";
import { SearchIcon, SunIcon, MoonIcon, MenuIcon, GithubIcon } from "./icons";
import { Search } from "./Search";

export function Topbar() {
  const [dark, setDark] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggleTheme = () => {
    const next = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("docs-theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  };

  /* The nav panel is server-rendered inside the shell, so the toggle reaches it
     through the DOM rather than through shared React state. */
  const toggleNav = () => {
    const panel = document.querySelector<HTMLElement>("[data-nav-panel]");
    if (!panel) return;

    const open = panel.dataset.open === "true";
    panel.dataset.open = open ? "false" : "true";
    document.querySelector(".docs-scrim")?.remove();

    if (open) return;

    const scrim = document.createElement("div");
    scrim.className = "docs-scrim";
    scrim.addEventListener("click", () => {
      panel.dataset.open = "false";
      scrim.remove();
    });
    document.body.append(scrim);
  };

  return (
    <>
      <header className="docs-topbar">
        <button
          className="docs-icon-button docs-nav-toggle"
          type="button"
          aria-label="Open navigation"
          onClick={toggleNav}
        >
          <MenuIcon />
        </button>

        <a className="docs-brand" href="/">
          <img src="/logo-mark.svg" width={26} height={26} alt="" /> ecosy
        </a>

        <nav className="docs-topnav" aria-label="Catalogue">
          <a href="/packages">Packages</a>
          <a href="/frameworks">Frameworks</a>
          <a href="/forks">Forks</a>
        </nav>

        <div className="docs-topbar-spacer" />

        <button className="docs-search-trigger" type="button" onClick={() => setSearchOpen(true)}>
          <SearchIcon />
          <span>Search the docs…</span>
          <kbd className="docs-kbd">⌘K</kbd>
        </button>

        <a className="docs-icon-button" href="https://github.com/material-atomic" aria-label="GitHub">
          <GithubIcon />
        </a>

        <button className="docs-icon-button" type="button" aria-label="Toggle theme" onClick={toggleTheme}>
          {dark ? <MoonIcon /> : <SunIcon />}
        </button>
      </header>

      <Search open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
