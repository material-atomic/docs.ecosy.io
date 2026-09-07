---
name: "@ecosy/react"
type: module
status: stable
repo: material-atomic/ecosy-react
npm: "@ecosy/react"
summary: React bindings for @ecosy/store — hooks with no provider, plus list and icon helpers.
---

# @ecosy/react

```bash
yarn add @ecosy/react
```

```tsx
import { connectStore } from "@ecosy/react";
import { combineSlices } from "@ecosy/store";

export const { useSelector, useDispatch, createSelector, store } = connectStore({
  slices: combineSlices({ counter, user }),
});

function Counter() {
  const count = useSelector((s) => s.counter.count);
  const dispatch = useDispatch();

  return <button onClick={() => dispatch(counter.actions.increment())}>{count}</button>;
}
```

Peer dependencies: `react`, [`@ecosy/store`](/store).

**No provider.** The store is created at module scope and the hooks close over
it, so there is nothing to wrap the tree in and no context to thread through.
That also means one store per module — for two independent stores, call
`connectStore` twice and export each set of hooks separately.

## `connectStore`

```ts
function connectStore<Slices extends SliceMap, Signals extends string[]>(
  options: ConnectStoreOptions<Slices, Signals>,
): ConnectStoreResult<Slices>
```

Takes the same options as
[`configureStore`](/store#configurestore) and returns everything it does, plus
the hooks:

```ts
interface ConnectStoreResult<Slices> {
  store: WiredStore<Slices>;
  dispatch: (action: CombinedActions<Slices>) => void;
  getState: () => CombinedState<Slices>;
  hydrate: (state: Partial<CombinedState<Slices>>) => void;

  useSelector: <Selected>(selector: (state: CombinedState<Slices>) => Selected) => Selected;
  useDispatch: () => (action: CombinedActions<Slices>) => void;
  createSelector: /* 1–3 selectors plus a combiner, or variadic */;
}
```

`dispatch`, `getState` and `hydrate` work outside React too — in an event
handler, a loader, a test.

## `useSelector`

```ts
useSelector<Selected>(selector: (state: State) => Selected): Selected
```

Re-renders only when the **selected** value changes, compared with
`isEqual` — deep, not reference. So a selector returning a fresh object each
call does not cause a render when its contents are unchanged:

```ts
const { name, email } = useSelector((s) => ({ name: s.user.name, email: s.user.email }));
```

That is the opposite of the usual React-Redux caveat: with reference equality
this would re-render on every dispatch. Here it does not, at the cost of a deep
comparison — so keep selected values small, and select the branch rather than
the whole state.

The selector is re-read on every render, so it may close over props:

```ts
const item = useSelector((s) => s.items.byId[props.id]);
```

## `useDispatch`

```ts
useDispatch(): (action: CombinedActions<Slices>) => void
```

Returns the store's `dispatch`. Stable across renders — the same function every
time — so it is safe in a `useCallback` or `useEffect` dependency list, and
leaving it out changes nothing.

## `createSelector`

```ts
createSelector(...selectors, combiner): (state: State) => Result
```

Memoises a derived value. The combiner re-runs only when one of the inputs
changes, compared with `isEqual`.

```ts
const selectVisibleTodos = createSelector(
  (s) => s.todos.items,
  (s) => s.todos.filter,
  (items, filter) => items.filter((t) => filter === "all" || t.status === filter),
);

const todos = useSelector(selectVisibleTodos);
```

Typed overloads cover one, two and three selectors; more are accepted through
the variadic signature, with looser inference.

The cache holds **one** entry — the last inputs and result. A selector called
alternately with two different states recomputes every time, so define it once
at module scope rather than inside a component.

## `createStoreOrder`

```ts
function createStoreOrder<State, Store extends Subscriber<State>>(store: Store):
  StoreSelector<State>

type StoreSelector<State> = <Ordered>(selector: (state: State) => Ordered) => Ordered
```

Builds a `useSelector`-style hook for any
[`Subscriber`](/core/subscriber) instance, not just a store built by
`connectStore`. This is what `useSelector` is made with.

```ts
import { createStoreOrder } from "@ecosy/react";

const useMonitor = createStoreOrder(syhemoInstance);

function Metrics() {
  const snapshot = useMonitor((s) => s.current);
  return <pre>{JSON.stringify(snapshot, null, 2)}</pre>;
}
```

Comparison uses the subscriber's own `shallow.isEqual`, so a store configured
with a different equality function is honoured here too.

`StoreSelector<State>` is the hook's own type, for annotating the export:

```ts
import { createStoreOrder, type StoreSelector } from "@ecosy/react";
import { combineSlices, configureStore } from "@ecosy/store";

const configured = configureStore({ slices: combineSlices({ auth, project }) });

export type RootState = ReturnType<typeof configured.getState>;
export const useSelector: StoreSelector<RootState> = createStoreOrder(configured.store);
```

`Ordered` is whatever the selector picks out — the type on the left of the
assignment at the call site.

Since **0.5.0**.

## Server rendering

```tsx
// server
const html = renderToString(<App />);
const state = getState();

// client
hydrate(preloadedState);
```

`hydrate` writes state without running a reducer or firing an action channel,
so subscribers see the new state without treating it as a user action.

Because the store lives at module scope, it is **shared across requests** in a
long-running server process. Create it per request, or keep server rendering to
state passed in as props.

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
| *anything else* | Forwarded to every `Item`. |

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

If both are given, `keyExtractor` is used and a warning says so in development.

Position stays the default. A property that resolves to something other than a
string or a number — missing on one row, an object, a `Date` — falls back to
position for that row and warns.

Since **0.5.0**.

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
