---
name: "@ecosy/styled"
type: module
status: stable
repo: material-atomic/ecosy-styled
npm: "@ecosy/styled"
summary: One styling API for React and React Native — shorthand props, sx, variants, responsive values and theming.
---

# @ecosy/styled

```bash
yarn add @ecosy/styled
```

```tsx
import { styled, useTheme } from "@ecosy/styled/react";

const Card = styled("div", { borderWidth: 1 }, {
  variants: {
    intent: { primary: { bg: "primary" }, ghost: { bg: "transparent" } },
  },
  defaultVariants: { intent: "primary" },
});

<Card intent="ghost" p={16} r={8} sx={{ padding: { base: 8, md: 16 } }} />
```

Peer dependencies: `react`, plus `react-native` on mobile, and
[`@ecosy/store`](/store) with [`@ecosy/react`](/react) for theming.

## Two entry points, one API

```ts
import { styled, useTheme } from "@ecosy/styled/react";           // web
import { styled, useTheme } from "@ecosy/styled/react-native";    // mobile
```

The same component definition compiles to inline styles on the web and a
`StyleSheet` on native. The split is at the **import**, not in your code, so a
shared component file does not branch on platform.

Styles resolve to inline objects or `StyleSheet` entries — there is no CSS
loader, no `.css` file, no class names. The trade is real: **no cascade, no
`:hover` from a stylesheet, and no browser caching of a CSS file.** State-driven
styling goes through variants and props instead.

## `styled`

```ts
function styled<C extends ElementType, V extends VariantConfig>(
  Component: C,
  creator?: Styled<CSSProperties> | ((theme: ThemeConfigs) => CSSProperties),
  configs?: StyledConfigs<V>,
): ComponentType<StyledComponentProps<C, V>>
```

| | |
|---|---|
| `Component` | A tag name (`"div"`) or any React component. |
| `creator` | Base styles, or a function of the theme. |
| `configs.variants` | Variant map. |
| `configs.defaultVariants` | Which variant applies with no prop. |
| `configs.displayName` | Defaults to `Styled(div)` or the component's name. |

Forwards refs. Variant keys are consumed as props and never reach the DOM;
everything else passes through.

Styles merge in this order, later winning:

```
creator → variants → sx → shorthand props → style
```

## Shorthand props

Any of these on a styled component becomes a style property:

| | | | |
|---|---|---|---|
| `p` `pt` `pb` `pl` `pr` `ps` `pe` `px` `py` | padding | `m` `mt` `mb` `ml` `mr` `ms` `me` `mx` `my` | margin |
| `bg` | backgroundColor | `c` | color |
| `bc` | borderColor | `bw` | borderWidth |
| `fs` `fw` `ff` | font size/weight/family | `lh` `ls` `ta` | lineHeight, letterSpacing, textAlign |
| `w` `minW` `maxW` | width | `h` `minH` `maxH` | height |
| `r` | borderRadius | `rt` `rb` `rl` `rr` | radius per side |
| `rtl` `rtr` `rbl` `rbr` | radius per corner | `aspect` | aspectRatio |
| `justify` `align` | justifyContent, alignItems | `direction` `wrap` | flexDirection, flexWrap |
| `z` | zIndex | `pos` | position |

```tsx
<Box px={16} py={8} bg="surface" c="onSurface" r={8} />
```

Each may take a function of the theme:

```tsx
<Box bg={(theme) => theme.palette.primary} />
```

`c` defaults to `"text"` when not given, so text picks up the theme colour
without being told.

## `sx`

```ts
type SxValue =
  | string | number | boolean
  | PlatformSelect<string | number | boolean>
  | ResponsiveSelect<string | number | boolean>;
```

Full property names, with two extra value shapes.

### Responsive

```tsx
<Box sx={{ padding: { base: 8, md: 16, lg: 24 } }} />
```

| key | from |
|---|---|
| `base` | 0 |
| `sm` | 576 |
| `md` | 768 |
| `lg` | 992 |
| `xl` | 1200 |
| `2xl` | 1400 |

Resolved in JavaScript against the current window width, not by a media query —
so it re-renders on resize and works identically on native. On a server render
`base` is used, since there is no width yet.

### Platform

```tsx
<Box sx={{ shadow: { web: "0 1px 2px #0002", default: "none" } }} />
```

The web build reads `web`, falling back to `default`; the native build reads its
own key.

### Colours

A colour property given a palette key resolves through the theme:

```tsx
<Box sx={{ backgroundColor: "primary" }} />
<Box sx={{ backgroundColor: "primary.20" }} />   // 20% opacity
```

`name.NN` converts the palette hex to `rgba` at that opacity — which is how you
get a translucent brand colour without hard-coding one.

## Hooks

```ts
useTheme(): ThemeConfigs
useThemeMode(): "light" | "dark"
useSelector<T>(selector: (state: ThemeState) => T): T
useWindowWidth(): number
useSx(sx?: SxProp): CSSProperties
useStyled<Props>(props: Props): { styled; other; theme }
useThemeFactory<R>(creator: (theme: ThemeConfigs) => R): R
```

`useStyled` splits props into style and non-style — what `styled` uses
internally, and what you need to build your own wrapper:

```tsx
function Custom(props: MyProps & StyledProps) {
  const { styled, other } = useStyled(props);
  return <div style={styled} {...other} />;
}
```

`useThemeFactory` memoises a theme-derived value that is not a style:

```ts
const chartColors = useThemeFactory((t) => [t.palette.primary, t.palette.secondary]);
```

## `makeStyles`

```ts
function makeStyles<T>(creator: (theme: ThemeConfigs) => T): () => { styles: InferStyle<T>; theme: ThemeConfigs }
```

A named stylesheet, rebuilt when the theme changes.

```tsx
const useStyles = makeStyles((theme) => ({
  container: { padding: 16, backgroundColor: theme.palette.surface },
  title: { fontSize: 20, color: (t) => t.palette.primary },
}));

function Panel() {
  const { styles, theme } = useStyles();
  return <div style={styles.container}><h2 style={styles.title}>…</h2></div>;
}
```

Individual values may also be functions of the theme, resolved at the same time.

## `variants`

```ts
function variants<V extends VariantConfig>(
  base?: Styled<CSSProperties>,
  configs?: { variants?: V; defaultVariants?: { [K in keyof V]?: keyof V[K] } },
): (theme: ThemeConfigs, props?: { [K in keyof V]?: keyof V[K] }) => CSSProperties
```

The CVA pattern without the `styled` wrapper — for computing a style object
directly.

```ts
const button = variants(
  { paddingLeft: 16, paddingRight: 16, borderRadius: 8 },
  {
    variants: {
      intent: { primary: { backgroundColor: "brand" }, ghost: { backgroundColor: "transparent" } },
      size: { sm: { paddingTop: 6 }, lg: { paddingTop: 12 } },
    },
    defaultVariants: { intent: "primary", size: "sm" },
  },
);

const style = button(theme, { intent: "ghost" });
```

Combinations are resolved at call time rather than enumerated up front.

## Theming

State lives in an [`@ecosy/store`](/store) slice, so switching theme is a
dispatch and every subscribed component re-renders — no provider threaded
through the tree.

```ts
import { store, actions } from "@ecosy/styled/react";

store.dispatch(actions.toggleTheme());
store.dispatch(actions.setTheme("dark"));
store.dispatch(actions.setThemes(myThemes));
```

```ts
interface ThemeState {
  mode: "light" | "dark";
  themes: { light: ThemeConfigs; dark: ThemeConfigs };
}

interface ThemeConfigs {
  palette: ThemePalette;
  sizes: Record<string, Record<string, ThemeSizeConfig>>;
}
```

`ThemePalette` is a Material-shaped set of tokens — `primary`/`onPrimary`,
`secondary`/`onSecondary`, `background`/`onBackground`, `surface`/`onSurface`,
`surfaceVariant`/`onSurfaceVariant`, `outline`, `inverseSurface`/
`inverseOnSurface`, `text`, `textSecondary`, `border`, `error`/`onError`,
`success`/`onSuccess`. The `on*` pairing is what lets a component pick a
readable foreground without being told.

The default theme is `slate`, in both modes.

### `withThemeSlice`

```ts
function withThemeSlice(options?: WithThemeSliceOptions): { slices; signals }
```

Combines the theme slice with your own, for one store rather than two:

```ts
import { withThemeSlice } from "@ecosy/styled/slice";
import { connectStore } from "@ecosy/react";

export const { useSelector, dispatch } = connectStore(
  withThemeSlice({
    slices: { user: userSlice, cart: cartSlice },
    initialState: { mode: "dark", themes: myThemes },
  }),
);
```

The theme lands under `state.theme`, and `toggleTheme` / `setTheme` join your
own actions. Pass `reducers` to add more to the theme slice itself.

## Utilities

```ts
function hexToRgba(hex: string, opacity: number): string
function resolveSxValue(key: string, value: SxValue, theme: ThemeConfigs, windowWidth?: number): unknown
```

`hexToRgba` accepts `#abc`, `#aabbcc` and `#aabbccdd`, and returns the input
unchanged when it is not a hex colour. `resolveSxValue` is the single-value
resolver behind `sx`.

## Subpath imports

```ts
import { styled } from "@ecosy/styled/react/styled";
import { styled } from "@ecosy/styled/react-native/styled";
import { withThemeSlice } from "@ecosy/styled/slice";
import slate from "@ecosy/styled/theme/slate";
import type { ThemeConfigs } from "@ecosy/styled/types/theme";
```
