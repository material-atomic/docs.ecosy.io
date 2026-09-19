---
title: Session
import: "@ecosy/core/session"
order: 8
---

# Session

```ts
import { Session, MemoryStore } from "@ecosy/core/session";
```

Cookie sessions: an id in a signed cookie, the session's data encrypted in a
store. Framework-free — a session reads and writes its cookie through a
`CookieJar`, which an adapter builds from whatever the framework has (a Next
route, a Hono context, an Express `req`/`res` pair each fit in a few lines).
Not re-exported from the package index — reach it by subpath.

## Quick start

```ts
import { Session } from "@ecosy/core/session";
import type { CookieJar, CookieOptions } from "@ecosy/core/session";

// A CookieJar backed by a plain Map — enough to run a session end to end
// without a framework. A real adapter reads/writes the framework's own
// request/response cookies instead.
function mapCookieJar(cookies: Map<string, string>): CookieJar {
  return {
    get: (name) => cookies.get(name) ?? null,
    set: (name, value, _options: CookieOptions) => {
      cookies.set(name, value);
    },
    delete: (name) => {
      cookies.delete(name);
    },
  };
}

const AppSession = Session();

async function handleRequest(cookies: Map<string, string>): Promise<void> {
  const jar = mapCookieJar(cookies);
  const session = await new AppSession().load(jar);

  await session.set({ theme: "dark" });
  const theme = session.get<string>(["theme"], "light");
  console.log(theme);
}
```

`Session()` with no options runs end to end on an in-process `MemoryStore`
and a per-process generated encryption key — good for trying the API, not for
running it: that key does not survive a restart and is not shared between
instances. Pass `store` and `encrypt` for a deployment that needs either to
hold.

## `CookieJar`

```ts
import type { Promisable } from "@ecosy/core/types";
import type { CookieOptions } from "@ecosy/core/session";

interface CookieJar {
  get(name: string): string | null | undefined;
  set(name: string, value: string, options: CookieOptions): Promisable<void>;
  delete(name: string, options: CookieOptions): Promisable<void>;
}
```

The one thing a session needs from the framework, and what keeps the session
itself framework-free.

## `CookieOptions`

```ts
interface CookieOptions {
  maxAge?: number;
  path?: string;
  domain?: string;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  httpOnly?: boolean;
}
```

Attributes for the session cookie. `maxAge` is in seconds, the way
`Set-Cookie` has it — not milliseconds, unlike `SessionOptions.maxAge` below.

## `Session`

```ts
import type { SessionClass, SessionOptions } from "@ecosy/core/session";

declare function Session(options?: SessionOptions): SessionClass;
```

Builds a session token class. Every request loading the same id in this
process shares one live state: a write from one is seen by the others at
once, and the later write wins (see Behavior, below). Where a module is
evaluated more than once, anchor the class with `@ecosy/anchor` to share it
across them, the same as `storageKey` does.

`SessionOptions`:

| | |
|---|---|
| `encrypt` | A crypt token class. Defaults to a key generated for the process: everything the session encrypts becomes unreadable after a restart, and is not shared between instances — pass your own to keep sessions past that. |
| `store` | A session store class. Defaults to `MemoryStore()`. |
| `queue` | Orders `set` and `setQueue` calls per session id. Without one, a write applies as soon as it is reached. |
| `batch` | Gathers `set` calls per session id into one write — see [`Batch`](/core/batch). Without one, each `set` runs alone. |
| `cookie` | `CookieOptions` plus an optional `name`, defaulting to `"sid"`. Defaults otherwise to `httpOnly: true`, `sameSite: "lax"`, `path: "/"`. |
| `maxAge` | Milliseconds a session lives after its last save. Default 7 days. Must be positive. |
| `storageKey` | Keeps the live session states — and, with no `store` given, the default `MemoryStore`'s records too — on `globalThis` under this name, so every copy of the module (Next's proxy and route handlers, say) shares one session state. |
| `regenerate.grace` | Milliseconds the old id from `regenerate()` still works. Default 30 000. Must be `0` or more. |
| `logger` | Console-shaped; only `warn` is used. Defaults to `console`. |

## `SessionHandle`

```ts
import type { SessionData } from "@ecosy/core/session";

interface SessionHandle {
  readonly id: string;
  readonly isNew: boolean;

  get<Value = SessionData>(): Value;
  get<Value = unknown>(path: string | readonly string[], defaultValue?: Value): Value;

  getAsync<Value = SessionData>(): Promise<Value>;
  getAsync<Value = unknown>(path: string | readonly string[], defaultValue?: Value): Promise<Value>;

  set(partial: SessionData): Promise<void>;
  setQueue(partial: SessionData): Promise<void>;
  setIn(path: string | readonly string[], value: unknown): Promise<void>;
  unset(path: string | readonly string[]): Promise<void>;
  persist(): Promise<void>;
  start(): Promise<void>;

  setUser(userId: string | null): Promise<void>;
  regenerate(): Promise<void>;
  destroy(): Promise<void>;
}
```

One request's view of a session — what `SessionToken.load()` returns.

- **`id`, `isNew`.** A new session already has an id before it is ever saved;
  `isNew` stays `true` until the first save.
- **`get`.** A copy of the current in-memory state, or of the value at
  `path`, right now — it does not wait for a `set`/`setQueue` still working
  its way through a `batch` or `queue`. Use `getAsync` for that.
- **`getAsync`.** Like `get`, after the `set`/`setQueue` work pending at the
  time of the call — and the save it ends in — has finished.
- **`set`.** Merges `partial` into the state through the `batch` (if any),
  then the `queue` (if any), then saves.
- **`setQueue`.** The same merge, through the `queue` only — skips the
  `batch` even when one is configured.
- **`setIn`, `unset`.** Write or remove one path in the state right away —
  no `batch`, no `queue` — then save. `setIn(path, undefined)` removes the
  path rather than storing `undefined`, since `undefined` does not survive
  the store.
- **`persist`.** Saves the state as it is now, without changing it.
- **`start`.** Saves the session even while empty, so it — and its cookie —
  exist from now on. For an anonymous session, something else may need to be
  bound to it before sign-in (a CSRF cookie, say); an untouched session is
  otherwise never given a cookie or written to the store at all.
- **`setUser`.** Ties the session to a user id (signed, not stored in the
  clear) so `revokeUser` can end every session tied to it. `null` unties it.
- **`regenerate`.** Moves the state to a new id and cookie. The old id keeps
  working for `regenerate.grace` milliseconds, for requests already on their
  way with it. Call this on sign-in, before `setUser`, so a session started
  before authentication cannot be reused by whoever had the pre-sign-in
  cookie.
- **`destroy`.** Deletes the session and its cookie; the handle continues
  with a new, empty session.

## `SessionToken`

```ts
import type { CookieJar, SessionHandle } from "@ecosy/core/session";

interface SessionToken {
  load(jar: CookieJar): Promise<SessionHandle>;
  revokeUser(userId: string): Promise<void>;
}
```

What `new AppSession()` gives you. `load` returns the session the cookie in
`jar` names, or a new one when there is none, the cookie fails verification,
or the session it names is gone. `revokeUser` ends every session tied to
`userId` via `setUser` — it needs a store with `deleteByUser` (`MemoryStore`
has one) and throws `TypeError` otherwise.

## `SessionData`, `SessionRecord`, `SessionMeta`

```ts
type SessionData = Record<string, unknown>;

interface SessionRecord {
  data: string;
  createdAt: number;
  expiresAt: number;
  user?: string;
}

type SessionMeta = Omit<SessionRecord, "data"> & { key: string };
```

`SessionRecord` is what a store holds: `data` already encrypted, `user`
already a signature, both epoch-millisecond timestamps. `SessionMeta` is the
same without `data`, plus the store key — what `listByUser` hands out for
listing a user's sessions without decrypting each one.

## `SessionStore`

```ts
import type { SessionMeta, SessionRecord } from "@ecosy/core/session";

interface SessionStore {
  get(key: string): Promise<SessionRecord | null>;
  set(key: string, record: SessionRecord): Promise<void>;
  delete(key: string): Promise<void>;
  listByUser?(user: string): Promise<SessionMeta[]>;
  deleteByUser?(user: string): Promise<void>;
  prune?(): Promise<void>;
}
```

Three methods are required; the rest unlock features (`listByUser` and
`deleteByUser` for `revokeUser`, `prune` for periodic cleanup) and are used
only when present. A miss is `null`, never a throw. A write that fails should
throw — a session that silently did not save logs people out without saying
so.

## `SessionLogger`

```ts
interface SessionLogger {
  warn(...args: unknown[]): void;
}
```

Console-shaped; only `warn` is called, for things like a store rejecting an
`onMax` decision (see `MemoryStore`, below).

## Behavior

**Write ordering.** Writes are applied in the order they were *called*, not
the order the work behind them happens to finish. `set` and `setQueue` can be
delayed — by a `batch`'s window, by a `queue` waiting its turn — so a delayed
write can finish applying after a `setIn`, `unset`, or another `set` that was
called later. When that happens, the delayed write does not clobber the path
the later call already changed; only its own, still-current changes land.
Two writes to different paths merge into the state independently either way —
neither touches a key the other's partial does not mention.

**Untouched sessions cost nothing.** `load()` alone never writes a cookie or
a store record. A session becomes real — gets a cookie, gets stored — on its
first `set`, `setIn`, `unset`, `setUser`, or `start`.

**The cookie only moves for the live id.** While an id is in `regenerate`'s
grace period, its record is still updated in the store (so requests already
holding it keep working), but its cookie is not reissued — the browser has
already moved on to the new id's cookie.

## `MemoryStore`

```ts
import type { MemoryStoreOptions, SessionStoreClass } from "@ecosy/core/session";

declare function MemoryStore(options?: MemoryStoreOptions): SessionStoreClass;
```

Builds an in-process session store. Records live with the class: every
`new Store()` from one `MemoryStore(...)` call sees the same records, and two
calls to `MemoryStore()` are two independent stores (unless they share a
`storageKey`). Dies with the process unless `persist` is given, and is never
shared with `Session`'s own default unless you pass the same `MemoryStore(...)`
class to `Session`'s `store` option, or the same `storageKey` to both.

```ts
import type { SessionMeta } from "@ecosy/core/session";

interface MemoryStoreMaxInfo {
  entries: readonly SessionMeta[];
  incoming: SessionMeta;
  max: number;
}
```

```ts
import type { SessionRecord } from "@ecosy/core/session";
import type { Promisable } from "@ecosy/core/types";

interface MemoryStorePersist {
  load(): Promisable<Iterable<readonly [string, SessionRecord]> | null | undefined>;
  save(entries: Array<[string, SessionRecord]>): Promisable<void>;
  delay?: number;
}
```

```ts
import type { MemoryStoreMaxInfo, MemoryStorePersist, SessionLogger } from "@ecosy/core/session";
import type { Promisable } from "@ecosy/core/types";

interface MemoryStoreOptions {
  max?: number;
  distance?: number;
  onMax?: (info: MemoryStoreMaxInfo) => Promisable<false | readonly string[]>;
  persist?: MemoryStorePersist;
  sweepInterval?: number;
  storageKey?: string;
  logger?: SessionLogger;
}
```

| | |
|---|---|
| `max` | Records held at most. `0` (default): no limit. |
| `distance` | With the store full, records expiring within this many milliseconds are dropped to make room. `0` (default): off. |
| `onMax` | With the store still full after `distance`, decides what goes: return the keys to remove, or `false` to drop the incoming record instead. An invalid return is a `TypeError` in development and a warning (then treated as `false`) in production. Without `onMax`, a full store warns and drops the incoming record. |
| `persist` | Keeps records across restarts — `load` seeds the store once, `save` gets the full snapshot (never a delta) after changes settle for `delay` milliseconds (default 1000). Records are already encrypted and keyed by signature, so a persistence layer never sees plaintext. |
| `sweepInterval` | Milliseconds between sweeps of expired records. `0` (default): swept only as records are read and written, a few at a time. |
| `storageKey` | Keeps the records on `globalThis` under this name, so every copy of the module reads and writes the same ones. |
| `logger` | Console-shaped; only `warn` is used. |

## Usage

Regenerating the session id on sign-in, then signing everywhere out:

```ts
import { Session } from "@ecosy/core/session";
import type { CookieJar, CookieOptions } from "@ecosy/core/session";

function mapCookieJar(cookies: Map<string, string>): CookieJar {
  return {
    get: (name) => cookies.get(name) ?? null,
    set: (name, value, _options: CookieOptions) => {
      cookies.set(name, value);
    },
    delete: (name) => {
      cookies.delete(name);
    },
  };
}

const AppSession = Session();

async function login(jar: CookieJar, userId: string): Promise<void> {
  const session = await new AppSession().load(jar);
  await session.regenerate();
  await session.setUser(userId);
}

async function logoutEverywhere(userId: string): Promise<void> {
  await new AppSession().revokeUser(userId);
}

async function logout(jar: CookieJar): Promise<void> {
  const session = await new AppSession().load(jar);
  await session.destroy();
}
```

Gathering `set()` calls per session with `@ecosy/core/batch`, so several
writes that land close together become one save:

```ts
import { Batch } from "@ecosy/core/batch";
import { Session } from "@ecosy/core/session";

const AppBatch = Batch({ window: 10 });
const AppSession = Session({ batch: AppBatch });
```

A `MemoryStore` with a cap and a hand-rolled eviction policy:

```ts
import { MemoryStore, Session } from "@ecosy/core/session";
import type { MemoryStoreMaxInfo } from "@ecosy/core/session";

const AppStore = MemoryStore({
  max: 10_000,
  distance: 60_000, // prefer evicting records expiring within the next minute
  onMax(info: MemoryStoreMaxInfo): string[] {
    const oldest = [...info.entries].sort((a, b) => a.createdAt - b.createdAt)[0];
    return oldest ? [oldest.key] : [];
  },
});

const AppSession = Session({ store: AppStore });
```
