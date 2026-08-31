---
title: Hook
import: "@ecosy/schedule/hook"
order: 2
---

# Hook

```ts
import { Hook, LoggerHook } from "@ecosy/schedule/hook";
```

A hook is where run outcomes go. Optional — without one, a finished task
reports nowhere.

```ts
Schedule()
  .hook(Hook.combine(LoggerHook(), TelegramHook, MailHook))
```

## `Hook`

```ts
interface Hook {
  notify(event: TaskEvent): Promisable<void>;
}
```

One hook, not a list — `combine` turns several into one, so nothing downstream
ever branches on how many there are.

`.hook()` takes a **class**; the scheduler constructs it at `start()`.

```ts
class TelegramHook implements Hook {
  async notify(event: TaskEvent) {
    if (event.ok) return;
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: `${event.key} failed (${event.reason}): ${event.detail ?? ""}`,
      }),
    });
  }
}
```

The hook is notified **once per run**, with the final attempt's event — not
once per retry. For per-attempt reporting use
[`.onError()`](/schedule#retries-and-timeouts).

## `LoggerHook(logger?)`

```ts
function LoggerHook(logger?: { info(...a: unknown[]): void; error(...a: unknown[]): void }): ClassType<Hook>
```

Writes each outcome as a log line. Defaults to `console`, so it works before
real logging is wired up.

```ts
Schedule().hook(LoggerHook())
Schedule().hook(LoggerHook(appLogger))
```

```
[schedule] session.cleanup ok in 42ms
[schedule] report failed (timeout) after 30001ms on attempt 3: request exceeded 30000ms
```

Note it is a **factory** — `LoggerHook()` returns the class. Passing
`LoggerHook` itself would hand the scheduler a factory to construct instead of a
hook.

Anything with `info` and `error` works, including a
[`@ecosy/logger`](/logger) instance.

## `Hook.combine`

```ts
Hook.combine(...hooks: ClassType<Hook>[]): ClassType<Hook>
```

Fans one event out to several hooks, as a single hook class.

```ts
Schedule().hook(Hook.combine(LoggerHook(), TelegramHook, MetricsHook))
```

Hooks run **concurrently, each isolated**:

- One that **throws** is caught and warned about; the others still run.
- One that **hangs** is abandoned after **10 seconds**; the others still
  complete.

A Telegram call that fails must not stop the log line from being written, and a
slow one must not hold the scheduler — the task has already finished, and
reporting is separate work.

The 10-second hook deadline is fixed and independent of the task's own
`timeout`.

`combine` flattens, so `combine(a, combine(b, c))` and `combine(a, b, c)`
behave identically. With no arguments it is a valid no-op, which makes it a
usable default rather than something to guard against:

```ts
Schedule().hook(Hook.combine(...(isProd ? [TelegramHook] : [])))
```

## `TaskEvent`

```ts
interface TaskEvent {
  key: string;
  scheduledFor: Date;     // the fire time from the expression, not `now`
  startedAt: Date;
  durationMs: number;
  attempt: number;        // 1 for the first try
  ok: boolean;
  reason?: TaskFailure;
  detail?: string;
  raw?: unknown;
}

type TaskFailure = "throw" | "status" | "timeout" | "exit" | "unknown";
```

| `reason` | |
|---|---|
| `"throw"` | a handler threw |
| `"status"` | an api target answered outside 2xx |
| `"timeout"` | the deadline passed |
| `"exit"` | a file target exited non-zero, or was killed |
| `"unknown"` | anything else, including an unregistered handler key |

Normalised across all three target kinds, so a hook never branches on target
type. `raw` keeps the original — a return value, a response body, or stdout.

`scheduledFor` is the computed fire time, so two instances a few milliseconds
apart report the same value for the same run.

## Schedule-level events

The scheduler reports its own problems through
[`.onError()`](/schedule#sync), not through the hook, using the reserved key
`@schedule`:

```ts
Schedule().onError((event, task) => {
  if (event.key === "@schedule") {
    alert(`scheduler problem: ${event.detail}`);
    return;
  }
  record(event);
});
```

That covers a source read that failed, an unparseable entry, and a source that
returned nothing while tasks are live.
