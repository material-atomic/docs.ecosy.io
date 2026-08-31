---
name: "@ecosy/next-themes"
type: fork
status: stable
repo: material-atomic/next-themes
npm: "@ecosy/next-themes"
summary: next-themes with React 19 support and three fixes not yet in an upstream release.
upstream:
  repo: pacocoursey/next-themes
  package: next-themes
  version: 0.4.6
---

# @ecosy/next-themes

A fork of [next-themes](https://github.com/pacocoursey/next-themes). The API is
unchanged — **use the upstream documentation**:

> **[next-themes README →](https://github.com/pacocoursey/next-themes#readme)**

Nothing on this page repeats it. What follows is only what differs, because a
fork that documents itself twice is a fork whose two copies drift apart.

## Why it exists

`next-themes@0.4.6` renders its inline script as a `<script>` tag from a React
component. On the server that works: the script arrives in the initial HTML,
the browser's parser runs it, and the theme is applied before first paint.

On the client it does not. React inserts that tag through the DOM rather than
the HTML parser, and a script inserted that way never executes — so on a
client-side render the theme was never applied and the page flashed.

## What changed

**1. The client applies the theme through `useInsertionEffect`, not a script tag.**

`ThemeScript` now calls the theme function directly in a `useInsertionEffect`.
That hook fires synchronously before the browser paints the mutation, which is
what keeps the flash away — a `useEffect` would run a frame too late.

**2. The server still emits the script tag.**

Unchanged on that side, deliberately. The tag in the initial HTML is what
prevents a flash before hydration, and no effect can run early enough to
replace it. `ThemeScript` renders the tag on the server and `null` on the
client.

**3. A theme missing from `value` no longer leaks its internal name.**

Pre-existing upstream bug. Given `value={{ dark: 'dark-mode' }}` and a theme
with no entry, `updateDOM` fell back to the raw theme name — writing an
internal identifier into the DOM as if it were a class or attribute value.

It now skips instead: the class is not added, and the attribute is *removed*
rather than set to something meaningless.

## Also carried

The fork branches after upstream's `v0.4.6` tag, so it also carries three
commits that upstream has merged but not yet published — `next-themes` on npm
is still 0.4.6 as well:

- `setTheme` receives the latest state ([#347](https://github.com/pacocoursey/next-themes/pull/347))
- `<ThemeScript>` is exported ([#355](https://github.com/pacocoursey/next-themes/pull/355))
- `PropsWithChildren` typing under `@types/react` 17 ([#356](https://github.com/pacocoursey/next-themes/pull/356))

## Installing

```bash
yarn add @ecosy/next-themes
```

Same API, different package name — so the import specifier changes:

```diff
- import { ThemeProvider } from "next-themes";
+ import { ThemeProvider } from "@ecosy/next-themes";
```

Or alias `next-themes` to it in your bundler and leave every import alone.

### Both are 0.4.6, and they are not the same code

The fork keeps upstream's version number so the lineage stays readable, which
means `next-themes@0.4.6` and `@ecosy/next-themes@0.4.6` are different builds
under the same number. If a lockfile or a colleague reports "0.4.6", the
version alone does not tell you which one is installed — check the package
name.

## When to go back

When upstream ships React 19 support. This fork exists for one reason, and it
should stop existing when that reason does.
