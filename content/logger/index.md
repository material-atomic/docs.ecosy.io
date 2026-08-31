---
name: "@ecosy/logger"
type: module
status: stable
repo: material-atomic/ecosy-logger
npm: "@ecosy/logger"
summary: A logger built from a format and a set of deliveries — ten wire standards, any destination.
---

# @ecosy/logger

```bash
yarn add @ecosy/logger
```

```ts
import { Logger } from "@ecosy/logger";

const AppLogger = Logger("JSON");
const logger = new AppLogger();

logger.info("Server started", { port: 3000 });
logger.error("Upload failed", error);
```

Zero dependencies. A logger is a **format** plus a list of **deliveries**;
everything else is those two interfaces.

## `Logger`

```ts
function Logger(standard?: LoggerStandard, deliveries?: ILogDelivery[]): ILoggerConstructor
```

| | |
|---|---|
| `standard` | Wire format. Defaults to `"TEXT"`. |
| `deliveries` | Where formatted output goes. Defaults to `[new ConsoleDelivery()]`. |
| **returns** | A class constructible with no arguments. |

Returns a **class**, not an instance, so it drops straight into an injector:

```ts
Route({ logger: Logger("JSON") })
Inject({ logger: Logger("OTLP", [new HttpDelivery(endpoint)]) })
```

An unknown `standard` silently falls back to `"TEXT"` rather than throwing.

## `ILogger`

```ts
interface ILogger {
  info(...args: any[]): void;
  log(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  debug(...args: any[]): void;
}
```

Five levels, all variadic, all returning `void` — a log call never blocks and
never rejects, even when a delivery is asynchronous.

The shape is `console`-compatible, so a logger can be passed anywhere a console
is expected, including
[`loggerPlugin`](/http#loggerplugin-options) and
[`LoggerHook`](/schedule/hook#loggerhookloggger).

## Formats

```ts
type LoggerStandard =
  | "TEXT" | "JSON" | "GELF" | "Syslog" | "CEF" | "LEEF"
  | "W3C" | "OTLP" | "Fluentd" | "Loki" | (string & {});
```

| standard | output | for |
|---|---|---|
| `TEXT` | the raw arguments, unchanged | terminal via `ConsoleDelivery` |
| `JSON` | `{ level, timestamp, host, data }` | anything ingesting JSON lines |
| `GELF` | GELF 1.1 JSON | Graylog |
| `Syslog` | RFC 5424 line | syslog, rsyslog, journald |
| `CEF` | `CEF:0\|…` | ArcSight and other SIEMs |
| `LEEF` | `LEEF:2.0\|…` | QRadar |
| `W3C` | space-separated fields | W3C extended log format |
| `OTLP` | OpenTelemetry log record JSON | OTel collectors |
| `Fluentd` | `[tag, unixTime, record]` | Fluentd / Fluent Bit |
| `Loki` | `{ streams: [{ stream, values }] }` | Grafana Loki |

`TEXT` is a pass-through — arguments reach `console.log` as given, so objects
stay inspectable in a terminal and errors keep their stack. Every other
standard produces a **string**.

### One argument or many

The structured standards summarise: the first argument becomes the message —
stringified if it is not already a string — and when there is more than one,
the full argument list is JSON-serialised alongside it. `JSON` is the exception
and keeps every argument in `data`.

So this reaches a SIEM as a single message plus context, not as five fields:

```ts
logger.error("Upload failed", { userId: 42 }, error);
```

Formatter instances are shared — one per standard, created once.

## Deliveries

```ts
interface ILogDelivery {
  send(level: LogLevel, formattedData: any): void | Promise<void>;
}
```

`ConsoleDelivery` is the only one that ships. It calls the `console` method
matching the level, and spreads an array payload — which is what makes `TEXT`
render as if you had called `console.log` directly.

```ts
import { ConsoleDelivery } from "@ecosy/logger";

Logger("JSON", [new ConsoleDelivery(), new HttpDelivery(url)]);
```

Deliveries run in order, and each is isolated: one that **throws**, or whose
promise **rejects**, is caught and reported to `console.error` — the others
still receive the entry.

```ts
class HttpDelivery implements ILogDelivery {
  constructor(private readonly url: string) {}

  async send(level: LogLevel, data: any) {
    await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof data === "string" ? data : JSON.stringify(data),
    });
  }
}
```

Nothing awaits an async delivery, so a log call returns immediately and a slow
destination never holds up the request that produced the entry. The trade is
that a batch of entries can be lost on process exit — flush before shutdown if
that matters.

## Formatters

```ts
interface ILogFormatter {
  format(level: LogLevel, args: any[]): any;
}
```

Every built-in formatter class is exported (`JsonFormatter`, `TextFormatter`,
`GelfFormatter`, `SyslogFormatter`, `CefFormatter`, `LeefFormatter`,
`W3cFormatter`, `OtlpFormatter`, `FluentdFormatter`, `LokiFormatter`), along
with `FormatterFactory`:

```ts
FormatterFactory.get(standard?: LoggerStandard): ILogFormatter
```

A custom format goes through the delivery rather than through `Logger`, since
`Logger` selects by name from the built-in table:

```ts
class MyDelivery implements ILogDelivery {
  private readonly formatter = new MyFormatter();
  send(level: LogLevel, _ignored: any) { /* … */ }
}
```

## Helpers

```ts
function getHostname(): string
function parseArgs(args: any[]): { summary: string; full: string }
```

`getHostname` returns `window.location.hostname` in a browser and the OS
hostname on a server. `parseArgs` is the summarising rule the structured
formatters share.

## Subpath imports

```ts
import { Logger } from "@ecosy/logger/logger";
import { ConsoleDelivery } from "@ecosy/logger/deliveries/console";
import { JsonFormatter } from "@ecosy/logger/formatters/json";
```

Every module is reachable on its own path, so a build that needs one formatter
does not carry the other nine.
