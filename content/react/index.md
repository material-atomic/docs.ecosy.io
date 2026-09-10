---
name: "@ecosy/react"
type: module
status: stable
repo: material-atomic/ecosy-react
npm: "@ecosy/react"
summary: React components — a list renderer with checked item props, and an SVG icon factory.
---

# @ecosy/react

```bash
yarn add @ecosy/react
```

```tsx
import { Listing, createSvgIcon } from "@ecosy/react";
```

Peer dependency: `react`. Nothing else — since **0.5.0** this package has no
`@ecosy/*` dependency at all, at runtime or as a peer.

The store bindings that used to live here — `connectStore`, `useSelector`,
`useDispatch`, `createSelector`, `createStoreOrder` — moved to
[`@ecosy/store/react`](/store/react) in that release. They call
`configureStore`, so keeping them in a separate package meant a version range
between them and the store, and a range on a `0.x` version is how a project
ends up with two copies of the store and two incompatible `Subscriber` types.

## `Listing`

```tsx
import { Listing } from "@ecosy/react";
// or: import { Listing } from "@ecosy/react/listing";

function Listing<Data, ItemProps extends { item: Data }>(
  props: ListingProps<Data, ItemProps>,
): ReactNode
```

Renders a list without the `items.map(...)` boilerplate, and without a
component having to decide what "no results" looks like every time.

| | |
|---|---|
| `items` | The data. Empty, `null` or `undefined` all render `empty`. |
| `Item` | Component rendered once per entry. |
| `Container` | Wraps the items. Defaults to `Fragment`. |
| `empty` | Rendered *instead of* the container when there is nothing. Defaults to `null`. |
| `itemKey` | The property that identifies a row. |
| `keyExtractor` | Derives a row's key. Wins over `itemKey`. |
| *anything else* | Any prop `Item` takes, forwarded to every one. |

```tsx
<Listing
  items={users}
  Item={UserRow}
  Container={Table}
  empty={<EmptyState label="No users" />}
  dense
/>
```

Nothing to do with the store — it needs only React.

### What `Item` receives

```tsx
{ ...rest, key: index, item, index }
```

So `UserRow` above is called with `{ dense: true, item, index }`. Declare both:

```tsx
function UserRow({ item, index, dense }: { item: User; index: number; dense?: boolean }) {
  return <tr className={dense ? "tight" : ""}>{index + 1}. {item.name}</tr>;
}
```

`index` is passed but is **not** in the `ItemProps` constraint — the props are
cast on the way in, so a component that forgets to declare `index` still
compiles and still receives it.

### Forwarded props are checked

```ts
type ListingProps<Data, ItemProps> =
  ListingOwnProps<Data, ItemProps> & Partial<Omit<ItemProps, "item" | "index">>;
```

Anything beyond `Listing`'s own props has to be a prop `Item` takes, with the
type it declares.

Passing them is optional — `Listing` forwards what it is given and does not
undertake to satisfy `Item`'s contract — but the *types* are not optional:
`dense="yes"` where a boolean is wanted is an error either way.

`item` and `index` are excluded. They come from the data, one value per row, so
a caller cannot meaningfully pass them; leaving them in would have an editor
offer `item` as a prop of `<Listing>`.

Until **0.4.2** this was an index signature, and a misspelled `Itme={Row}`, a
`dense="yes"` where a boolean was wanted, and a prop the item does not take all
type-checked.

### `Container` receives only `children`

Extra props go to the items, never to the container. A container that needs its
own props has to close over them:

```tsx
<Listing items={rows} Item={Row} Container={({ children }) => <Table striped>{children}</Table>} />
```

### `itemKey` and `keyExtractor`

```tsx
<Listing items={users} Item={UserRow} itemKey="id" />
<Listing items={users} Item={UserRow} keyExtractor={(user, index) => `${user.id}:${index}`} />
```

Give one to any list that can reorder. Without either, rows are keyed by
position, and inserting, removing or sorting then makes React reuse the wrong
element — an open menu, a focused input, a running transition follow the
position rather than the data.

| | |
|---|---|
| `itemKey` | A property name, checked against the item type. |
| `keyExtractor` | `(item, index) => Key`, the same name and signature as React Native's. |

`itemKey` is the shorthand for the common case. `keyExtractor` covers the rest:
a composite key, a derived one, and a list of primitives, which has no property
to name.

If both are given, `keyExtractor` is used and a warning says so.

Position stays the default. A property that resolves to something other than a
string or a number — missing on one row, an object, a `Date` — falls back to
position for that row and warns once per render, however many rows are
affected.

Since **0.4.2**.

## `createSvgIcon`

```ts
import { createSvgIcon } from "@ecosy/react";
// or: import { createSvgIcon } from "@ecosy/react/svg-icon";

function createSvgIcon(
  name: string,
  children: IconChildren[],
  initialProps?: IconProps,
): (props: IconProps) => ReactElement

type IconChildren = [name: string, props: Record<string, unknown>];

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "viewBox" | "children"> {
  size?: number;
  color?: string;
  viewBox?: number;
}
```

Builds an icon component from shape data rather than JSX, so an icon set is a
data file instead of a folder of near-identical components.

```tsx
export const CheckIcon = createSvgIcon("CheckIcon", [
  ["path", { d: "M5 13l4 4L19 7" }],
]);

<CheckIcon />                          // 24px, currentColor
<CheckIcon size={32} className="ml-2" />
```

Each entry in `children` is `[tagName, props]` and becomes one child element;
keys are generated as `` `${tag}-${index}` ``, so the array's order is its
identity.

`name` becomes the component's `displayName` — it is what React DevTools and
component stacks show, and it is not read anywhere else.

### Defaults on the `<svg>`

| | |
|---|---|
| `viewBox` | `0 0 24 24` |
| `width` / `height` | `size`, default `24` |
| `stroke` | `color`, then `stroke`, default `currentColor` |
| `strokeWidth` | `2` |
| `fill` | `none` |
| `strokeLinecap` / `strokeLinejoin` | `round` |
| `xmlns` | the SVG namespace |

The defaults describe a **stroked** icon on a 24-unit square. `width` and
`height` given directly beat `size`. Each of these is a default, not a fixed
value: all of them can be replaced at the call site or in `initialProps`.

### `viewBox` is a number, not a string

It is the length of one side — `viewBox={16}` means `viewBox="0 0 16 16"`. Only
square boxes starting at the origin can be expressed, and the string form is
typed out of `IconProps`, so an icon drawn on a non-square canvas cannot be
built with this.

### `initialProps`

The defaults for one icon, overridden by anything passed at the call site.
Every prop is settable through it, `fill` and the stroke joins included — which
is what makes a filled icon declarable once:

```tsx
export const Dot = createSvgIcon("Dot", [["circle", { cx: 12, cy: 12, r: 10 }]], {
  fill: "currentColor",
  stroke: "none",
});

<Dot />             // filled, 24px
<Dot size={32} />   // filled, 32px
<Dot fill="none" /> // back to an outline
```

### `color` and `stroke`

Both set the stroke. `color` is this helper's own prop and wins when the two
are given together; `stroke` is the raw SVG attribute and is there for the
cases `color` does not cover, such as clearing it on a filled icon.

```tsx
<CheckIcon color="red" />                  // stroke="red"
<CheckIcon stroke="blue" />                // stroke="blue"
<CheckIcon color="red" stroke="blue" />    // stroke="red"
```

`size`, `color` and `viewBox` are the helper's own props, not attributes — they
are consumed here and never reach the element. Everything else in `IconProps`
is a normal SVG prop and passes through untouched.
