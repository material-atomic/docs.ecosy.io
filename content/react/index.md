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
{ ...rest, key: index, item, index, previous, next, carry }
```

So `UserRow` above is called with `{ dense: true, item, index }`. Declare both:

```tsx
function UserRow({ item, index, dense }: { item: User; index: number; dense?: boolean }) {
  return <tr className={dense ? "tight" : ""}>{index + 1}. {item.name}</tr>;
}
```

`index` is passed but is **not** in the `ItemProps` constraint — the props are
cast on the way in, so a component that forgets to declare `index` still
compiles and still receives it. The same goes for `previous`, `next` and
`carry`: declare the ones you use and ignore the rest.

### `previous` and `next`

The neighbouring entries, or `undefined` at the ends. A date separator or a run
of messages from one author needs the row before it, and this is how the row
gets it:

```tsx
function Message({ item, previous }: { item: Msg; previous?: Msg }) {
  return (
    <>
      {previous?.day !== item.day && <DayDivider day={item.day} />}
      <Bubble author={previous?.author === item.author ? null : item.author} text={item.text} />
    </>
  );
}
```

They cost nothing: both are references to entries already in the array, not
copies. Computing the same thing outside and passing it in means a fresh object
per row, which is what stops `memo(Item)` bailing out.

Since **0.6.0**.

### `range` — a window over the whole list

What a virtualizer hands over. `start` inclusive, `end` exclusive:

```tsx
const rows = virtualizer.getVirtualItems();

<Listing
  items={messages}                                   // the whole list
  range={{ start: rows[0].index, end: rows.at(-1).index + 1 }}
  Item={Message}
  itemKey="id"
/>
```

`items` stays the **full** list. Only the rows in range are built, so the cost
is the window — holding a reference to an array is not walking it, and
`items[i - 1]` costs the same whether the array holds twenty entries or fifty
thousand.

A range rather than a pre-cut slice, and the difference is the whole point.
Hand `Listing` a slice and `index` counts from the window instead of the list,
and `previous` is `undefined` at the top of every scroll position — so a date
separator redraws at the head of each window and a run of messages from one
author breaks every time the user scrolls. Neither reports an error. Both are
right on a short list and wrong once it is long enough to virtualise, which is
exactly when nobody is scrolling by hand to notice.

An `end` past the array is clamped, not refused: a virtualizer overshoots at
the edges by design.

**`range` and `accumulate` together throw.** A fold restarted at the window's
first row gives every row a total that ignores the rows above it — correct at
the top of the list and drifting the further anyone scrolls. A virtualised list
wants its running values computed once, incrementally, outside, and passed in
as one stable `Map`; that is what the virtualizer already does for heights.

Measuring needs nothing from `Listing`: it touches no DOM and `Item` is yours,
so `ref={virtualizer.measureElement}` goes where you decide.

Since **0.7.0**.

### `accumulate` — a running value

For what `previous` cannot answer: a number that runs within a group, a balance
after each entry, an offset.

It is a **scan, not a reduce**. The fold runs as each row is reached, so a row
receives the total **including itself** and never one that counts rows below it:

```tsx
<Listing
  items={[1, 2, 3]}
  Item={Row}
  seed={0}
  accumulate={(carry, n) => carry + n}
/>
// Row 1 gets carry 1, row 2 gets 3, row 3 gets 6.
```

A running number that restarts per group is the same shape:

```tsx
<Listing
  items={messages}
  Item={Message}
  itemKey="id"
  seed={{ day: "", n: 0 }}
  accumulate={(c, m) => (c.day === m.day ? { day: c.day, n: c.n + 1 } : { day: m.day, n: 1 })}
/>
```

Optional in the sense that matters: without it, `carry` is `undefined`, `seed`
never reaches `Item`, and the cost is one destructure and one `if` per row.

**When the carry is an object, return the one you were given if nothing in it
changed.** A fold that rebuilds it every row hands every row a new prop and
`memo(Item)` stops bailing out. A carry that is a number is a new value each
row by definition — that is the point of it — and nothing applies.

The fold runs during render, into a local variable. Not a `useRef`: a ref
survives renders React discards — a StrictMode double render, a concurrent
attempt thrown away — so an accumulation into one counts twice, and only in
development or only under load. A ref would also have to be cleared at row 0 of
every render, which is the tell: something reset every render is not carrying
anything across renders. `Listing` uses no hooks at all, and can still be
called as a plain function.

Since **0.6.0**.

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
