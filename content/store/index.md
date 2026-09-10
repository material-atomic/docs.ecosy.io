---
name: "@ecosy/store"
type: module
status: stable
repo: material-atomic/ecosy-store
npm: "@ecosy/store"
summary: Slices, reducers and typed actions over a pub/sub store — framework-agnostic, no provider required.
---

# @ecosy/store

```bash
yarn add @ecosy/store
```

```ts
import { createSlice, combineSlices, configureStore } from "@ecosy/store";

const counter = createSlice({
  name: "counter",
  initialState: { count: 0 },
  reducers: {
    increment: (state) => ({ ...state, count: state.count + 1 }),
    add: (state, action: PayloadAction<number>) => ({ ...state, count: state.count + action.payload }),
  },
});

const { store, getState, actions } = configureStore({
  slices: combineSlices({ counter }),
});

actions.counter.add(5);
getState().counter.count;   // 5
```

Built on [`Subscriber`](/core/subscriber) from `@ecosy/core`, which is its only
dependency. No provider, no context — the store is an object you import.

For React bindings see [`@ecosy/store/react`](/store/react).

## `createSlice`

```ts
function createSlice<State, R extends Reducers<State, AnyAction>, N extends string>(
  options: CreateSliceOptions<State, R, N>,
): Slice<State, R, N>
```

```ts
interface CreateSliceOptions<State, R, N> {
  name: N;
  initialState: State | (() => State);
  reducers: R;
}
```

`initialState` may be a function, evaluated once at creation — use it when the
initial value must not be shared between slices.

Returns:

```ts
interface Slice<State, R, N> {
  name: N;
  initialState: State;
  actions: SliceActions<R, N>;         // one creator per reducer key
  reducer: (state: State, action: AnyAction) => State;
  events: SliceEvents<R, N>;           // { [name]: { [key]: "$name:key" } }
}
```

Each reducer key produces an action creator **and** an event channel named
`$<slice>:<key>`.

### Reducers

```ts
type ReducerHandler<State, Action> = (state: State, action: Action) => State | void;
```

Return the next state, or nothing to leave it unchanged. Reducers must be pure
— the same state and action always give the same result, with no requests, no
timers, no mutation of the argument.

The action's payload type comes from the reducer's signature:

```ts
reducers: {
  reset:  (state) => ({ ...state, count: 0 }),                 // reset()
  add:    (state, a: PayloadAction<number>) => …,              // add(5)
  tag:    (state, a: PayloadAction<string, string, Meta>) => …,// tag("x", meta)
}
```

```ts
type PayloadAction<Payload = never, T = string, Meta = never, Delta = never> = {
  type: T;
  payload: Payload;
  meta?: Meta;
  delta?: Delta;
};
```

A reducer taking no action argument gives a creator taking no arguments.

## `combineSlices`

```ts
function combineSlices<Slices extends SliceMap>(slices: Slices): CombineSlicesResult<Slices>
```

Merges slices into one initial state, one root reducer and one event map. The
key you give each slice becomes its branch of the state tree.

```ts
const combined = combineSlices({ counter, user, settings });
// state: { counter: …, user: …, settings: … }
```

The root reducer delegates each action to the owning slice and returns the
**same object** when nothing changed, so an unrelated dispatch does not
invalidate every subscriber.

The result also carries `slices`, the map as given, which is what
`configureStore` binds its `actions` from. Added in **0.2.2** — a
`CombineSlicesResult` built by hand needs it.

## `configureStore`

```ts
function configureStore<Slices extends SliceMap, Signals extends string[]>(
  options: ConfigureStoreOptions<Slices, Signals>,
): ConfigureStoreResult<Slices>
```

```ts
interface ConfigureStoreOptions<Slices, Signals> {
  slices: CombineSlicesResult<Slices>;
  signals?: Signals;
}

interface ConfigureStoreResult<Slices> {
  store: WiredStore<Slices>;
  dispatch: (action: CombinedActions<Slices>) => void;
  getState: () => CombinedState<Slices>;
  hydrate: (state: PartialLiteral<CombinedState<Slices>>) => void;
  actions: StoreActions<Slices>;
}
```

Framework-agnostic — safe on a server, in a Worker, in any runtime.

### `actions`

Each slice's action creators, bound to this store's dispatch and keyed by the
name given to `combineSlices`:

```ts
actions.counter.add(5);
// same as dispatch(counter.actions.add(5))
```

Arguments are the creator's; the return is `void`. The key is the one from
`combineSlices`, which is often not the slice's own `name`.

Since **0.2.2**.

### `dispatch`

Runs the root reducer, writes the state, and fires the action's channel. Still
there for an action assembled elsewhere, or one dispatched conditionally.

### `getState`

The current combined state.

### `hydrate`

```ts
hydrate(state: PartialLiteral<CombinedState<Slices>>): void
```

Merges state in **without** running a reducer or firing an action channel — for
server-rendered state on the client, or restoring a persisted snapshot.

## `store`

The wired store: the full [`Subscriber`](/core/subscriber) API —
`getState`, `setState`, `subscribe`, `onStateChange`, `subscribeAsyncOnce` —
plus a handle per slice.

For a slice named `error` with reducers `add` and `pop`:

```ts
store.error.add(payload);           // dispatch
const off = store.error.onAdd(fn);  // subscribe → unsubscribe
```

Both are generated by [`Subscriber.wire`](/core/subscriber#subscriberwire), so
a slice name may not collide with an existing store member (`dispatch`,
`getState`, `subscribe`, …) — doing so throws at startup.

```ts
store.onStateChange((state) => render(state));
```

## Signals

```ts
configureStore({ slices: combined, signals: ["refresh", "focus"] })
```

Channels with no state behind them, for telling parts of the app something
happened without recording that it did.

```ts
store.signals.refresh();
store.signals.onRefresh(() => refetch());
```

## `createStore`

```ts
function createStore<State, R, E, N, Signals>(options: CreateStoreOptions): { store; actions }
```

The layer under `configureStore`: one set of reducers with no slices. Reach for
it when a single store of one shape is all you need.

```ts
const { store, actions } = createStore({
  name: "counter",
  initialState: { count: 0 },
  reducers: {
    increment: (state) => ({ ...state, count: state.count + 1 }),
  },
});

actions.increment();
```

`actions` here dispatch directly — they are not creators to pass to `dispatch`,
which is what separates this from the slice API.

```ts
interface CreateStoreOptions<State, R, N, E, Signals> {
  name?: N;
  initialState?: State | PartialLiteral<State>;
  reducers?: R;
  extraEvents?: E;
  signals?: Signals;
}
```

With no `name`, channels land under the `signals` domain.

## `getType`

```ts
function getType(prefix: string, key: string): string
```

Builds a channel name: `getType("counter", "add")` → `"$counter:add"`. Use it
when subscribing by string rather than through a slice's `events`.

## Types

```ts
type AnyAction = PayloadAction<any, any, any, any>;
type StateResult<State> = State | void;
type Reducers<State, Action> = Record<string, ReducerHandler<State, Action>>;
type CombinedState<Slices>;
type CombinedActions<Slices>;
type CombinedEvents<Slices>;
type WiredStore<Slices>;
type BoundActions<Actions>;
type StoreActions<Slices>;
```
