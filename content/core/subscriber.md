---
title: Subscriber
import: "@ecosy/core/subscriber"
order: 3
---

# Subscriber

```ts
import { Subscriber } from "@ecosy/core/subscriber";

const sub = new Subscriber({ count: 0 });

const off = sub.subscribe("tick", (n: number) => console.log(n));
sub.dispatch("tick", 1);
off();
```

A pub/sub emitter with a state container attached. It is the base
[`@ecosy/store`](/store) is built on, and can be used directly.

## `new Subscriber(initialState?, events?)`

```ts
class Subscriber<State extends LiteralObject, Events = {}> {
  constructor(initialState?: State | PartialLiteral<State>, events?: Events)
}
```

| | |
|---|---|
| `initialState` | Starting state. Defaults to `{}`. |
| `events` | Event domains to merge into `_events`, for [`wire`](#subscriberwire). |

## Channels

### `subscribe`

```ts
subscribe<Payload = never>(channel: string, handler: SubcribeHandler<Payload>): () => void
```

Returns the unsubscribe function. Handlers are held in a `Set`, so subscribing
the same function reference twice registers it once.

```ts
const off = sub.subscribe<User>("user:login", (user) => console.log(user.name));
off();
```

### `dispatch`

```ts
dispatch<Payload = unknown>(channel: string, payload?: Payload): void
```

Calls every handler on `channel`, synchronously, in subscription order. A
channel with no subscribers is a no-op. Omitting `payload` calls handlers with
no arguments rather than with `undefined`.

Handlers are called directly — a handler that throws propagates out of
`dispatch` and the remaining handlers do not run.

### `subscribeAsyncOnce`

```ts
subscribeAsyncOnce<Payload = never>(
  channel: string,
  handler?: SubcribeHandler<Payload>,
  signal?: AbortSignal,
): Promise<Payload>
```

Resolves with the first payload dispatched to `channel`, then unsubscribes.
Rejects with `Error("Operation cancelled")` if `signal` aborts, including when
it is already aborted on entry.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

const user = await sub.subscribeAsyncOnce<User>("user:login", undefined, controller.signal);
```

**Pass a signal unless the channel is certain to fire.** Without one, a channel
that never dispatches leaves the promise pending and the handler subscribed —
that is a leak, and nothing here will collect it.

## State

### `getState`

```ts
getState(): State
```

Returns the live state object, not a copy. Do not mutate it — go through
`setState`, or the change event will not fire.

### `setState`

```ts
setState(state: State | PartialLiteral<State>): void
```

Deep-merges into current state. If the result is `isEqual` to what was there,
**nothing is dispatched** — so setting a value to what it already is does not
wake subscribers.

Handlers receive a clone, so a subscriber cannot mutate the store's copy.

```ts
sub.setState({ count: 1 });        // dispatches
sub.setState({ count: 1 });        // no dispatch, unchanged
sub.setState({ nested: { a: 1 } }); // merged, not replaced
```

### `onStateChange`

```ts
onStateChange(handler: SubcribeHandler<State>): () => void
```

Shorthand for subscribing to the built-in `$state:change` channel. Returns the
unsubscribe function.

## `shallow`

```ts
get shallow(): Freezable<Shallow>
set shallow(shallow: Shallow | Partial<Shallow>)
```

```ts
interface Shallow {
  merge<AsType>(source: unknown, target: unknown, cloneDeep?: (data: unknown) => unknown): AsType;
  clone<DataType>(data: DataType): DataType;
  isEqual(value1: unknown, value2: unknown): boolean;
}
```

The three functions `setState` uses, swappable. Assigning merges over the
current set, so you can replace one and keep the rest:

```ts
sub.shallow = { isEqual: Object.is };  // reference equality instead of deep
```

The getter returns a frozen copy, so reading `shallow` and mutating it changes
nothing.

## `Subscriber.wire`

```ts
static wire<ExtendedEvents extends ExtendedEventExpect, State, Instance>(
  $instance: Instance,
  events: ExtendedEvents,
): Instance & Freezable<WiredEvents<ExtendedEvents>>
```

Turns a `{ domain: { event: channel } }` map into typed methods on the
instance. Each event gets two:

| generated | does |
|---|---|
| `instance.domain.event(payload?)` | `dispatch(channel, payload)` |
| `instance.domain.onEvent(handler)` | `subscribe(channel, handler)` → unsubscribe |

```ts
const events = {
  user: { login: "$user:login", logout: "$user:logout" },
} as const;

const sub = Subscriber.wire(new Subscriber({}, events), events);

sub.user.onLogin((user) => console.log(user));
sub.user.login({ id: 1 });
```

Each domain is installed as a non-writable, non-configurable frozen property.
A domain name colliding with an existing member **throws**:

```ts
Subscriber.wire(sub, { dispatch: { ... } });
// Error: [Subscriber.wire] "dispatch" is invalid.
```

So avoid `subscribe`, `dispatch`, `getState`, `setState`, `shallow`,
`onStateChange`, `subscribeAsyncOnce` and `_events` as domain names. Values in
`events` that are not plain objects are skipped rather than wired.

## Types

```ts
type SubscribeChannel = string;

type SubcribeHandler<Payload = never> =
  [Payload] extends [never] ? () => void : (payload: Payload) => void;

type ExtendedEventExpect = {
  readonly [domain: string]: { readonly [event: string]: SubscribeChannel };
};

type SubscriberInstance<State extends LiteralObject = LiteralObject, Events = {}>;
```

`_events` always contains the built-in `state.change` domain
(`"$state:change"`) merged with whatever you passed to the constructor.
