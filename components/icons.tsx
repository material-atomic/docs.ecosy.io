/* Stroke icons on a 16/20/24 grid. Inline SVG so they scale and recolour. */
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const SearchIcon = ({ size = 16 }) => (
  <svg width={size} height={size} {...base}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const SunIcon = ({ size = 16 }) => (
  <svg width={size} height={size} {...base}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const MoonIcon = ({ size = 16 }) => (
  <svg width={size} height={size} {...base}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </svg>
);

export const MenuIcon = ({ size = 16 }) => (
  <svg width={size} height={size} {...base}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const GithubIcon = ({ size = 16 }) => (
  <svg width={size} height={size} {...base}>
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.2-1.5 6.2-6.7A5.2 5.2 0 0 0 19.9 5a4.9 4.9 0 0 0-.1-3.6s-1.1-.3-3.6 1.4a12.3 12.3 0 0 0-6.4 0C7.3 1.1 6.2 1.4 6.2 1.4A4.9 4.9 0 0 0 6.1 5a5.2 5.2 0 0 0-1.4 3.7c0 5.2 3.2 6.4 6.2 6.7a3.4 3.4 0 0 0-.9 2.6V22" />
  </svg>
);

export const ArrowRightIcon = ({ size = 16 }) => (
  <svg width={size} height={size} {...base}>
    <path d="M5 12h13M13 6l6 6-6 6" />
  </svg>
);

