---
title: Syhemo
import: "@ecosy/core/syhemo"
order: 5
---

# Syhemo

```ts
import { Syhemo, CONTENT_TYPE } from "@ecosy/core/syhemo";

const monitor = new Syhemo();
monitor.start({ interval: 5000 });
```

In-process runtime monitoring. Node-only, and not re-exported from the package
index — reach it by subpath.

Metrics come out in the Prometheus data model, so exposing them takes no client
library, registry or push gateway:

```ts
// app/metrics/route.ts
export function GET() {
  return new Response(monitor.metrics(), {
    headers: { "Content-Type": CONTENT_TYPE },
  });
}
```

Collection runs on Syhemo's own timer, never on a scrape. Reading `/metrics`
mutates nothing, so any number of scrapers can call it.

## `new Syhemo(deps?)`

```ts
class Syhemo extends Subscriber<SyhemoState, SyhemoEvents> {
  constructor(deps?: SyhemoDeps)
}
```

```ts
interface SyhemoDeps {
  logger?: SyhemoLogger;     // defaults to BufferedLogger
  source?: SyhemoLogSource;  // defaults to BufferedLogger (the class itself)
}
```

Extends [`Subscriber`](/core/subscriber), so `getState`, `subscribe` and the
rest are available.

## `start`

```ts
start(options?: SyhemoOptions): void
```

```ts
interface SyhemoOptions {
  interval?: number;      // ms between collections, default 5000
  db?: () => boolean;     // pool-connected check, feeds db_pool_connected
}
```

Collects once immediately, then on the interval. Calling `start` twice is a
no-op — the second call returns without starting a second timer.

```ts
monitor.start({
  interval: 10_000,
  db: () => dataSource.isInitialized,
});
```

## `stop`

```ts
stop(): void
```

Clears the timer and sets `started` to `false`.

**Call this.** An interval timer keeps a Node process alive — a script or test
that starts a monitor and does not stop it will not exit.

## `metrics`

```ts
metrics(): string
```

The most recent collection in Prometheus text exposition format. Serve it with
`CONTENT_TYPE`.

Before the first collection this is `""`, which a scraper reads as "no
metrics" rather than as an error.

## `getMetrics`

```ts
getMetrics(): Metric[]
```

The same data as structured objects, for a dashboard that renders it itself.
Empty array before the first collection.

## `CONTENT_TYPE`

```ts
const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
```

## `render`

```ts
function render(metrics: Metric[]): string
```

Metrics → exposition text. `metrics()` is `render(getMetrics())`; call it
directly if you assemble your own metric list.

## `recordHttpRequest`

```ts
function recordHttpRequest(latencyMs: number): void
```

Records one finished request. Takes **milliseconds** — callers time requests in
ms — and converts to seconds internally, because Prometheus wants base units.

```ts
const started = Date.now();
const response = await handler(request);
recordHttpRequest(Date.now() - started);
```

Feeds `http_requests_total` and the `http_request_duration_seconds` histogram.
Module-level state, so it needs no monitor instance.

Bucket bounds, in seconds:
`0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, +Inf`

## Snapshots

```ts
monitor.subscribe("syhemo:metrics:snapshot", (snapshot: MetricsSnapshot) => {
  // every collection
});
```

State holds the last **60** snapshots, oldest dropped:

```ts
interface SyhemoState {
  current: MetricsSnapshot | null;
  snapshots: MetricsSnapshot[];
  logs: LogEntry[];
  started: boolean;
}
```

A collection that throws is caught and logged — the timer keeps running.

## What is collected

| metric | type | |
|---|---|---|
| `process_resident_memory_bytes` | gauge | RSS |
| `process_cpu_usage_ratio` | gauge | non-idle share since last collection, 0–1 |
| `process_uptime_seconds` | gauge | |
| `nodejs_heap_size_total_bytes` | gauge | |
| `nodejs_heap_size_used_bytes` | gauge | |
| `nodejs_heap_size_limit_bytes` | gauge | ceiling V8 will grow to |
| `nodejs_malloced_memory_bytes` | gauge | |
| `nodejs_external_memory_bytes` | gauge | C++ objects bound to JS |
| `nodejs_array_buffers_bytes` | gauge | |
| `nodejs_native_contexts` | gauge | only ever growing indicates a leak |
| `nodejs_detached_contexts` | gauge | detached, not yet collected |
| `nodejs_active_handles` | gauge | labelled `kind="timer"\|"socket"\|"other"` |
| `nodejs_active_requests_total` | gauge | active libuv requests |
| `nodejs_eventloop_lag_mean_seconds` | gauge | |
| `nodejs_eventloop_lag_min_seconds` | gauge | |
| `nodejs_eventloop_lag_max_seconds` | gauge | |
| `nodejs_module_cache_entries` | gauge | CommonJS module cache |
| `nodejs_module_cache_entries_by_group` | gauge | top groups |
| `nodejs_cpu_count` | gauge | logical CPUs |
| `nodejs_cpu_info` | gauge | model in a label, value always 1 |
| `nodejs_version_info` | gauge | version in a label, value always 1 |
| `nodejs_log_entries_total` | counter | labelled `level="error"\|"warn"\|"other"` |
| `system_memory_total_bytes` | gauge | |
| `system_memory_free_bytes` | gauge | |
| `system_load_average` | gauge | labelled `period="1m"\|"5m"\|"15m"` |
| `db_pool_connected` | gauge | 1/0, only when `db` was passed to `start` |
| `http_requests_total` | counter | from `recordHttpRequest` |
| `http_request_duration_seconds` | histogram | from `recordHttpRequest` |

Three conventions hold throughout, and a replacement collector should keep
them:

- **Base units only** — bytes, seconds, ratios 0–1. Never MB, ms or percent. A
  query that has to know which unit a metric used is one that will eventually
  be wrong.
- **Counters are monotonic.** A value that resets itself is a gauge wearing a
  counter's name, and the dashboards it produces look plausible while being
  wrong.
- **No rounding.** Rounding is a display decision and cannot be undone at the
  source.

There is no `summary` type: its quantiles cannot be aggregated across
instances, which is why histograms exist.

## Metric types

```ts
type MetricType = "counter" | "gauge" | "histogram";
type MetricLabels = Record<string, string>;

interface ScalarMetric {
  name: string;      // <namespace>_<subsystem>_<name>_<unit>
  help: string;
  labels?: MetricLabels;
  type: "counter" | "gauge";
  value: number;
}

interface HistogramMetric {
  name: string;
  help: string;
  labels?: MetricLabels;
  type: "histogram";
  buckets: HistogramBucket[];  // cumulative; { le, count }, Infinity renders +Inf
  sum: number;
  count: number;
}

type Metric = ScalarMetric | HistogramMetric;

interface MetricsSnapshot {
  timestamp: number;  // unix ms
  metrics: Metric[];
}
```

## Log ports

Two interfaces, because writing logs and being able to count them are
different jobs and a logging library normally does only the first.

```ts
interface SyhemoLogger {
  log(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
```

Where Syhemo writes its own diagnostics. A bare `console` already satisfies it,
as does a [`@ecosy/logger`](/logger) instance.

```ts
interface SyhemoLogSource {
  getLogs(): LogEntry[];
  counts(): LogCounts;   // { errors, warns, total }
}
```

Where Syhemo reads log activity from. `counts()` must be **monotonic and
non-destructive** — these become counters, and one that resets when read
cannot be shared by two consumers or produce a correct rate.

```ts
monitor = new Syhemo({
  logger: appLogger,
  source: myLogSource,
});
```

## `BufferedLogger`

```ts
import { BufferedLogger } from "@ecosy/core/syhemo/logger";

const logger = new BufferedLogger("MyModule");
logger.log("Ready");
logger.warn("Deprecated API used");
logger.error("Connection failed", error);
```

```ts
class BufferedLogger {
  constructor(context?: string)  // default "@ecosy"

  log(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  verbose(message: string, ...args: unknown[]): void;

  static getLogs(): LogEntry[];
  static counts(): LogCounts;
}
```

Writes to `console` — ANSI colours on a server, CSS in a browser — and appends
to a shared ring buffer. The buffer and counters live on `globalThis`, so the
**class object itself** is the `SyhemoLogSource`, which is why the default is
`BufferedLogger` and not an instance of it.

Satisfies both ports at once, which is what makes `new Syhemo()` work with no
arguments.

```ts
type LogLevel = "LOG" | "WARN" | "ERROR" | "DEBUG" | "VERBOSE";

interface LogCounts {
  errors: number;
  warns: number;
  total: number;
}
```
