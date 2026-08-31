---
name: "@ecosy/react"
type: module
status: stable
repo: material-atomic/ecosy-react
npm: "@ecosy/react"
summary: React bindings for @ecosy/store — hooks with no provider.
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
  <Ordered>(selector: (state: State) => Ordered) => Ordered
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
