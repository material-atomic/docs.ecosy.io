---
title: Source
import: "@ecosy/schedule/source"
order: 1
---

# Source

```ts
import { Source, FileSource, HttpSource, LineParser } from "@ecosy/schedule/source";
```

A source says **where task definitions come from**. It is the one required
dependency — nothing can guess where your schedule lives.

```ts
Schedule({ db: DataSource })
  .source(CronTableSource)
  .task(RowParser)
```

The package ships readers for local files and HTTP only. Sharing a file between
instances behind a load balancer is a mount, not a library concern; a database
source is a few lines with `Source(...)`.

## `SourceAdapter`

```ts
interface SourceAdapter<Entry = string, Context = unknown> {
  read(context: Context): Promisable<Entry[]>;
}

type Source<Entry = string, Context = unknown> = ClassType<SourceAdapter<Entry, Context>>;
```

`.source()` takes a **class**, not a callback, so nothing in the scheduler has
to work out at runtime what it was handed. `context` is the injected context
from `Schedule({ ... })`.

A `read` that throws is a signal, not a failure to hide — the scheduler
responds by keeping the tasks it already has. Do not catch and return `[]`; an
empty array means "no tasks", and returning it on an error would look like a
deliberate deletion of every job.

## `Source(read)`

```ts
function Source<Entry, Context>(read: (context: Context) => Promisable<Entry[]>): ClassType<SourceAdapter<Entry, Context>>
```

Wraps a reader function into a source class, so the one-line case stays one
line.

```ts
Schedule({ db: DataSource })
  .source(Source((ctx) => ctx.db.query("select * from crons where active = true")))
  .task(RowParser)
```

`Entry` is whatever your reader returns — rows, objects, strings — and the
parser you pair it with must accept that type.

## `FileSource(path)`

```ts
function FileSource(path: string): ClassType<SourceAdapter<string>>
```

Reads a local file and returns its lines. Blank lines and lines starting with
`#` are dropped.

```ts
Schedule().source(FileSource("./crontab")).task(LineParser)
```

Re-read on every sync, so editing the file changes the schedule without a
restart. Node-only — `node:fs/promises` is imported dynamically, so the module
still loads elsewhere as long as you do not call it.

## `HttpSource(url, init?)`

```ts
function HttpSource(url: string, init?: RequestInit): ClassType<SourceAdapter<string>>
```

Fetches a text document and returns its lines, same filtering as `FileSource`.

```ts
Schedule()
  .source(HttpSource("https://config.internal/crontab", {
    headers: { Authorization: `Bearer ${token}` },
  }))
  .task(LineParser)
```

A non-2xx response **throws**, so the scheduler keeps the tasks it already has
rather than treating an outage as an empty schedule.

## `TaskParser`

```ts
interface TaskParser<Entry = string> {
  parse(entry: Entry): TaskDefinition;
}
```

One entry in, one task out. Throw on a malformed entry — the scheduler skips
that entry, reports it, and carries on with the rest.

```ts
class RowParser implements TaskParser<CronRow> {
  parse(row: CronRow): TaskDefinition {
    return {
      key: row.key,
      expression: row.expression,
      target: { type: "handler", key: row.handler },
      timezone: row.timezone ?? "UTC",
      enabled: row.active,
      retry: row.retry ?? undefined,
    };
  }
}
```

## `LineParser`

```ts
class LineParser implements TaskParser<string>
```

Parses the crontab-shaped line format that `FileSource` and `HttpSource`
produce.

```
# every five minutes
0 */5 * * * *  handler:session.cleanup
0 0 3 * * *    api:https://app/internal/report  tz=Asia/Ho_Chi_Minh retry=2
0 0 4 * * *    file:./scripts/rollup.js         name=nightly-rollup
```

Five or six cron fields, then a target, then optional `key=value` options.

### Targets

| token | becomes |
|---|---|
| `handler:session.cleanup` | `{ type: "handler", key: "session.cleanup" }` |
| `api:https://…` | `{ type: "api", url: "https://…" }` |
| `file:./script.js` | `{ type: "file", path: "./script.js" }` |

The target is located by its `kind:` prefix rather than by counting fields,
since five- and six-field expressions would otherwise be ambiguous.

### Options

| | |
|---|---|
| `name=` | Task key. Defaults to the whole target token. |
| `tz=` | IANA timezone. |
| `retry=` | Attempts after the first. |
| `timeout=` | Milliseconds. |
| `enabled=false` | Keeps the task known but unscheduled. |

The target doubles as the key, since one target on one schedule is the usual
case. Use `name=` to run the same handler on two expressions:

```
0 0 3 * * *   handler:report  name=report-daily
0 0 3 * * 1   handler:report  name=report-weekly
```

Without distinct names the second line would replace the first — same key, last
one wins.

### Errors

```
LineParser: expected a handler:/api:/file: target after 5 or 6 cron fields — "…"
LineParser: "handler:" has no value — "…"
LineParser: unknown target "cmd" — "…"
```

Each names the offending line, and only that line is skipped.

## Writing your own

Anything with a `read` method works. A source that needs configuration follows
the factory shape used across the ecosystem:

```ts
export function S3Source(bucket: string, key: string): ClassType<SourceAdapter<string>> {
  return class implements SourceAdapter<string> {
    async read(): Promise<string[]> {
      const object = await s3.getObject({ Bucket: bucket, Key: key });
      return (await object.Body.transformToString()).split("\n").filter(Boolean);
    }
  };
}
```
