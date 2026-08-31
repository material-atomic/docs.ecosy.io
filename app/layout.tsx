import type { Metadata } from "next";
import "./globals.css";
import { Topbar } from "@/components/Topbar";

export const metadata: Metadata = {
  title: "ecosy — documentation",
  description: "Documentation for the ecosy ecosystem.",
};

/* Runs before first paint so the page never flashes the wrong ground. */
const THEME = `try{var m=localStorage.getItem("docs-theme");
if(m==="dark"||(!m&&matchMedia("(prefers-color-scheme: dark)").matches))
document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* The script below adds .dark before React hydrates, so the client has a
       class the server could not know about — the server has no way to read a
       preference that lives in the visitor's browser. suppressHydrationWarning
       is the documented escape for exactly this, and it covers this element's
       own attributes only, not its subtree. */
    <html lang="en" data-theme="blue" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo-mark.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>
        <Topbar />
        {children}
        <footer className="docs-footer">
          <div className="docs-footer-inner">
            <span>The ecosy ecosystem.</span>
            <a href="https://github.com/material-atomic">Source on GitHub</a>
            <span className="docs-footer-credit">Theme Goes design by S3Tech</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
