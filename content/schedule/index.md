---
name: "@ecosy/schedule"
type: module
status: beta
repo: material-atomic/ecosy-schedule
npm: "@ecosy/schedule"
summary: Cron scheduling driven by a data source — handlers, HTTP calls or scripts, with retries, coordination and hooks.
---

# @ecosy/schedule

```bash
yarn add @ecosy/schedule
```

Runs cron tasks whose definitions come from a **source** — a database table, a
file, an HTTP endpoint — rather than from code. Editing a row changes the
schedule; no deploy.

```ts
import { Schedule, Registry } from "@ecosy/schedule";
import { Hook } from "@ecosy/schedule/hook";

export const AppSchedule = Schedule({ db: DataSource })
  .source(CronTableSource)
  .task(RowParser)
  .registry(Registry.add(SessionCleanup))
  .hook(Hook.combine(LoggerHook, TelegramHook))
  .retry(2)
  .sync(30_000)
  .cascade("drain");

const schedule = new AppSchedule();
await schedule.start();
```

Zero dependencies. Node 18+ (`node:child_process` for file targets).

## `Schedule(injects?)`

```ts
function Schedule<Injects extends InjectMap>(injects?: Injects): IScheduleBuilder
```

Returns a **class**. Every step returns another class, so there is no terminal
call — the chain and the finished token are the same thing.

Tokens in `injects` are constructed **once**, at `start()`, and form the context
passed to the source and to handlers.

| step | default | |
|---|---|---|
| `.source(Source)` | — | Where definitions come from. **Required.** |
| `.task(Parser)` | — | Turns one entry into a `TaskDefinition`. **Required.** |
| `.registry(registry)` | empty | Handlers by name. |
| `.coordinator(Coordinator)` | — | Which instance runs a fire. |
| `.hook(Hook)` | — | Where outcomes go. |
| `.retry(n)` | `0` | Extra attempts after a failure. |
| `.timeout(ms)` | `30000` | Per-run deadline. |
| `.sync(every)` | `60000` | Whether, and how often, the source is re-read and reconciled. `false` reads once at start and never again; `true` uses the default; a number sets the interval. |
| `.tick(ms)` | `1000` | How often due tasks are checked. |
| `.cascade(policy)` | `"drain"` | What happens when a task leaves the source. |
| `.onError(fn)` | — | Called on each failed attempt, before the retry decision. |
| `.notFound(fn)` | — | Called when an entry names an unregistered handler. |

Each step returns a **new** class rather than mutating, so a half-configured
chain can be shared as a base and branched.

`tick` defaults to one second because expressions have a seconds field. Raising
it means sub-minute tasks fire late.

## `ScheduleRunner`

### `start`

```ts
start(): Promise<void>
```

Constructs the injected tokens, the parser, the coordinator and the hook; runs
one `sync()`; then starts both timers.

Throws when `.source(...)` or `.task(...)` is missing.

Idempotent **on one instance** — calling it twice does not create two sets of
timers. It says nothing about two separate instances; see
[Coordinator](#coordinator).

### `stop`

```ts
stop(): Promise<void>
```

Clears both timers and awaits the runs already in flight. Always call it on
shutdown — the interval timers keep a Node process alive.

### `sync`

```ts
sync(): Promise<void>
```

Re-reads the source and reconciles it against the tasks already running: an
entry that is new becomes a task, one that changed is updated, one that has
disappeared is handled by [`cascade`](#cascade).

Runs once inside `start()`, then on the interval `.sync()` set — unless that was
`false`, in which case the one read at start is the only one. Call it directly
to apply a change without waiting.

A failed read is not a reason to stop: `start()` completes either way, so a
source that is not reachable yet — an HTTP endpoint served by the same process,
for instance — simply loads its tasks one sync later.

Three cases are deliberately **not** treated as deletions:

- **The source throws.** The schedule is left exactly as it was. A database
  blip is not an instruction to cancel everything.
- **The source answers with something that is not a list.** A broken source, not
  an empty schedule — reported the same way a failed read is.
- **The source returns nothing while tasks are live.** Far more likely a
  partial read than a deliberate deletion of every job at once — and getting
  that wrong wipes the schedule during an incident.

All three are reported through `onError` under the key `@schedule`. An entry that
fails to parse is skipped and reported; the rest of the sync continues.

### `status`

```ts
status(): ScheduleStatus

interface ScheduleStatus {
  running: boolean;
  lastSyncAt: Date | null;
  lastSyncOk: boolean | null;
  tasks: TaskStatus[];
}
```

`lastSyncOk === false` with a recent `lastSyncAt` means the source is failing
while the schedule keeps running on its last good read — worth surfacing.

## Task definitions

```ts
interface TaskDefinition {
  key: string;
  expression: string;              // 6-field cron, or 5 for standard crontab
  target: TaskTarget;
  timezone?: string;               // IANA zone, defaults to UTC
  enabled?: boolean;
  retry?: number;                  // overrides the schedule default
  timeout?: number;                // ms, overrides the schedule default
}
```

`key` is the identity used for registry lookup, for coordination, and for
matching across syncs — changing it creates a different task.

`enabled: false` keeps a task known but unscheduled, so its history survives a
pause.

Timezone defaults to **UTC**, never the host zone, which differs between
machines.

### Cron expressions

Six fields, seconds first:

```
┌─────────── second       0-59
│ ┌───────── minute       0-59
│ │ ┌─────── hour         0-23
│ │ │ ┌───── day of month 1-31
│ │ │ │ ┌─── month        1-12
│ │ │ │ │ ┌─ day of week  0-6 (Sunday = 0)
* * * * * *
```

A five-field expression is accepted and read as standard crontab — seconds
default to `0`.

```
0 */5 * * * *     every 5 minutes, on the minute
0 0 3 * * *       03:00 daily
*/30 * * * * *    every 30 seconds
0 0 9 * * 1-5     09:00 on weekdays
0 0 0 1 * *       midnight on the 1st
```

Supported: `*`, `,`, `-`, `/`, and names for month and day-of-week (`JAN`,
`MON`).

When **both** day-of-month and day-of-week are restricted, the task fires when
**either** matches — the Vixie cron rule, not an intersection. `0 0 0 13 * 5`
means "the 13th, and every Friday", not "Friday the 13th".

## Targets

```ts
type TaskTarget =
  | { type: "handler"; key: string }
  | { type: "api"; url: string; method?: string; headers?: Record<string, string>; body?: string }
  | { type: "file"; path: string; args?: string[] };
```

| | runs | on timeout |
|---|---|---|
| `handler` | a function from the [registry](#registry) | **keeps running** — a JavaScript function cannot be interrupted |
| `api` | an HTTP request | request aborted; the server may still be working |
| `file` | a child process | killed with `SIGKILL` |

That difference is real and worth choosing on. A `handler` that hangs holds
nothing back — the next fire is blocked by `running`, not by the clock — but it
also cannot be stopped. Put work you may need to kill in a `file` target.

An `api` target is answered outside 2xx → `reason: "status"`.

## Registry

```ts
import { Registry } from "@ecosy/schedule";
```

A source entry is text, so it cannot carry a function — only a key naming one.
The registry is the other half: code declares handlers under names, and the
source names them.

```ts
const SessionCleanup = Registry("session.cleanup", { db: DataSource }, async (ctx) => {
  const { affected } = await ctx.db.query("delete from sessions where expires_at < now()");
  return { deleted: affected };
});

Schedule().registry(Registry.add(SessionCleanup).add(OtherTask))
```

```ts
Registry(key, handler)              // no dependencies
Registry(key, injects, handler)     // context carries the tokens
Registry.empty()                    // empty registry to chain .add() onto
Registry.add(entry)                 // shorthand for Registry.empty().add(entry)
```

`Registry(...)` returns a **class** with a static `key`. `.add()` returns a new
registry rather than mutating.

Registering the same key twice: **last wins**, no throw. A hot reload re-runs
the declaration, and refusing the second would leave the first, stale closure
in place.

A handler's tokens are constructed **per run**, so nothing holds a connection
open between fires.

What a handler returns lands in `event.raw`.

An entry naming a key with no handler fires `notFound` and fails the run —
loud rather than silent, since a row that is enabled but points nowhere
otherwise looks like a task that simply never fires.

## Retries and timeouts

```ts
Schedule().retry(2).timeout(60_000)
```

`retry(2)` means up to three attempts. Between them the delay backs off —
`2^attempt` seconds, capped at 30 — because retrying a failing endpoint three
times in the same millisecond is three failures, not three chances.

`onError` is called on **every** failed attempt, before the retry decision. The
hook is notified **once**, with the final attempt's event.

A task's own `retry` and `timeout` override the schedule defaults.

## Cascade

What happens to a task that disappears from the source:

| policy | |
|---|---|
| `"drain"` (default) | Stop scheduling; let the run in flight finish; then drop it. |
| `"stop"` | Stop scheduling now. A `file` target is killed; the other two are let go. |
| `"keep"` | Leave it running. For when the source is not the only authority. |

## Coordinator

```ts
interface Coordinator {
  claim(key: string, scheduledFor: Date): Promisable<boolean>;
  release(key: string, scheduledFor: Date, event: TaskEvent): Promisable<void>;
}
```

Without one, **every instance runs everything** — correct for a single process
and wrong the moment there are two.

```ts
class PgCoordinator implements Coordinator {
  async claim(key: string, scheduledFor: Date) {
    const res = await pool.query(
      `insert into cron_runs (key, scheduled_for) values ($1, $2)
       on conflict (key, scheduled_for) do nothing returning 1`,
      [key, scheduledFor],
    );
    return res.rowCount === 1;
  }

  async release(key: string, scheduledFor: Date, event: TaskEvent) {
    await pool.query(
      `update cron_runs set ok = $3, duration_ms = $4 where key = $1 and scheduled_for = $2`,
      [key, scheduledFor, event.ok, event.durationMs],
    );
  }
}
```

`claim` must be **atomic across instances**. A unique constraint on
`(key, scheduledFor)` is a stronger guarantee than a distributed lock, and it
leaves a run history behind for free.

It is deliberately separate from the source: a file-backed schedule behind a
load balancer still needs coordination, and a database-backed one on a single
box does not.

`scheduledFor` is the **fire time computed from the expression**, not `now` —
so two instances a few milliseconds apart claim the same value.

## Events

```ts
interface TaskEvent {
  key: string;
  scheduledFor: Date;
  startedAt: Date;
  durationMs: number;
  attempt: number;        // 1 for the first try
  ok: boolean;
  reason?: TaskFailure;
  detail?: string;
  raw?: unknown;          // return value, response body, or stdout
}

type TaskFailure = "throw" | "status" | "timeout" | "exit" | "unknown";
```

`reason` is normalised across all three target kinds, so a hook never has to
branch on target type to find out what went wrong. `raw` keeps the original.

## Overlap

A task's next fire time is advanced **before** the run starts, so a slow task
does not drag its own schedule along behind it. A second fire while the first
is still running is skipped — overlap is held off by the `running` flag, not by
the clock.

## One instance

`ScheduleRunner` is a plain instance with no global state: constructing two
gives two. Whether that should happen is the caller's business — whatever runs
this once (a bootstrap, a framework's init) already owns that question.

With [`@ecosy/next`](/next/bootstrap):

```ts
export const bootstrap = Bootstrap()
  .register("db", () => dataSource.initialize())
  .register("schedule", async () => {
    const schedule = new AppSchedule();
    await schedule.start();
    return schedule;
  })
  .start();
```

Remember that `instrumentation.ts` re-runs on a hot reload — guard it, or the
timers multiply. See [Bootstrap](/next/bootstrap#guard-anything-with-a-lifetime).

## Types

```ts
type ClassType<Instance = unknown> = new () => Instance;
type InjectMap = Record<string, ClassType>;
type Promisable<T> = T | Promise<T>;

type NotFoundHandler = (key: string, task: TaskDefinition) => Promisable<void>;
type ErrorHandler = (event: TaskEvent, task: TaskDefinition) => Promisable<void>;
type CascadePolicy = "drain" | "stop" | "keep";
```

See also [Source](/schedule/source) and [Hook](/schedule/hook).
