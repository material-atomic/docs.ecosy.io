"use client";

import { useEffect } from "react";

const COPY =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const CHECK =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg>';

/* The prose is server-rendered HTML, so the copy buttons and the scrollspy are
   wired to it after mount rather than being React nodes of their own. */
export function Enhance() {
  useEffect(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".docs-copy")];

    const onCopy = async (event: Event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const code = button.parentElement?.querySelector("code");
      if (!code) return;

      try {
        await navigator.clipboard.writeText(code.textContent ?? "");
      } catch {
        return;
      }

      button.dataset.copied = "true";
      button.innerHTML = CHECK;
      button.setAttribute("aria-label", "Copied");

      setTimeout(() => {
        delete button.dataset.copied;
        button.innerHTML = COPY;
        button.setAttribute("aria-label", "Copy code");
      }, 1600);
    };

    buttons.forEach((b) => b.addEventListener("click", onCopy));
    return () => buttons.forEach((b) => b.removeEventListener("click", onCopy));
  }, []);

  useEffect(() => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".docs-toc-link")];
    if (!links.length) return;

    const byId = new Map(links.map((a) => [a.getAttribute("href")!.slice(1), a]));
    const headings = [...byId.keys()]
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!headings.length) return;

    let active: string | null = null;

    const mark = (id: string | null) => {
      if (id === active) return;
      if (active) byId.get(active)?.removeAttribute("data-active");
      active = id;
      if (active) byId.get(active)?.setAttribute("data-active", "true");
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length) return mark(visible[0].target.id);

        /* Nothing in the band: fall back to the last heading scrolled past, so
           the marker never blanks out between two long sections. */
        const passed = headings.filter((h) => h.getBoundingClientRect().top < 100);
        if (passed.length) mark(passed[passed.length - 1].id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );

    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, []);

  return null;
}
