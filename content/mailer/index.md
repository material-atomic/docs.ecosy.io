---
name: "@ecosy/mailer"
type: module
status: stable
repo: material-atomic/ecosy-mailer
npm: "@ecosy/mailer"
summary: An email builder with its own template directives, retry and rate limiting — over any transport.
---

# @ecosy/mailer

```bash
yarn add @ecosy/mailer
```

```ts
import nodemailer from "nodemailer";
import { Mailer } from "@ecosy/mailer";

export const AppMailer = Mailer({
  driver: nodemailer,
  transport: { host: "smtp.example.com", port: 587, auth: { user, pass } },
  defaults: { from: "Shop <noreply@example.com>" },
  retry: { retries: 2, delay: 1000 },
  rateLimit: { maxRequests: 5, interval: 1000, mode: "serial" },
});

await new AppMailer().send({
  to: "user@example.com",
  subject: "Welcome, {user.name}",
  content: "<p>Hello {user.name}!</p>",
  text: "Hello {user.name}!",
  data: { user: { name: "Alice" } },
});
```

Zero dependencies. It brings no transport of its own — anything with
`createTransport` works, Nodemailer included.

## `Mailer`

```ts
function Mailer<Data = unknown, Injects extends InjectMap = InjectMap>(
  config: MailerConfig<Data, Injects>,
): ClassType<MailerLike<Data>>
```

Returns a class taking no constructor arguments, so it is an injection token
like any other. One instance holds the transport, the retry and the rate
limiter, so a limit of five a second is five a second — configuring a mailer
per message gives each message its own budget and limits nothing. The
constructor builds `inject`, `Retry` and `RateLimiter` right away, with the
instance. Only the transport waits: constructing the token opens no socket,
and the transport itself is not built until the first send.

```ts
interface MailerConfig<Data = unknown, Injects extends InjectMap = InjectMap> {
  driver: DriverLike;
  transport?: TransportOptions;
  defaults?: MessageEnvelope & { subject?: string; content?: string; text?: string };
  components?: Components;
  data?: Record<string, Data>;
  retry?: RetryOptions;
  rateLimit?: RateLimitOptions;
  escape?: boolean;                 // HTML-escape template values, default true — see Templates
  logger?: LoggerLike | ClassType<LoggerLike>;
  inject?: Injects;                 // tokens built once with the mailer, handed to onError
  onError?: (error: unknown, message: Message<Data>, context: Injected<Injects>) => void;
}
```

### `MailerLike`

```ts
interface MailerLike<Data = unknown> {
  send(message?: Message<Data>): Promise<unknown>;
  render(message?: Message<Data>): RenderedMessage;
  renderComponent(name: string, data?: Record<string, Data>): string;
  verify(): Promise<boolean>;
  transporter(): TransporterLike;
}
```

`send` needs a recipient somewhere — the message's `to`, or the mailer's
`defaults.to` — and throws `TypeError` otherwise. It resolves with whatever the
transport returns and rejects when every retry attempt has failed; it does not
swallow, so wrap it or let it propagate.

```ts
interface MessageEnvelope {
  to?: MailerAddress;
  from?: MailerFrom;
  cc?: MailerAddress;
  bcc?: MailerAddress;
  replyTo?: MailerAddress;          // defaults to from when neither the message nor the mailer sets it
  headers?: Record<string, string>;
  attachments?: Array<string | Attachment>;
}

interface Message<Data = unknown> extends MessageEnvelope {
  subject?: string;
  content?: string;                 // HTML body template
  text?: string;                    // plain-text alternative, templated but never escaped
  data?: Record<string, Data>;
  components?: Components;
  raw?: boolean;                    // send the templates as written, with no directives resolved
}
```

## Templates

The body, subject and text all go through `Formatter`. Values are
**HTML-escaped**; `{@raw:path}` is how a value that is already markup gets in.

| Directive | Syntax | |
|---|---|---|
| Variable | `{user.name}`, `{order.items.0.price}` | escaped; an unresolved path renders empty |
| Raw value | `{@raw:post.body}` | inserted as written |
| Component | `{@component:header}` | carries its own data |
| Condition | `{@if:user.isAdmin}…{@endif:user.isAdmin}` | the closing tag repeats the **path** |
| Comparison | `{@if:user.age >= 18}…{@endif:user.age}` | `===` `!==` `==` `!=` `>=` `<=` `>` `<` |
| Else | `{@else:user.isAdmin}` | |
| Loop | `{@loop:items}…{items.name}…{@endloop:items}` | the collection's name is the current element |
| Loop index | `{items:[x]}` | 0-based |

Inside a loop the body is an ordinary template — variables, conditions and
further loops all read from the element:

```ts
import { Formatter } from "@ecosy/mailer";

const fmt = new Formatter(
  "{@loop:order.lines}<li>{order.lines:[x]}. {order.lines.sku}" +
    "{@if:order.lines.price >= 500}<b>deal</b>{@endif:order.lines.price}</li>{@endloop:order.lines}",
  { order: { lines: [{ sku: "A1", price: 300 }, { sku: "B2", price: 600 }] } },
);

fmt.format();
// <li>0. A1</li><li>1. B2<b>deal</b></li>
```

A component's data serves that component only:

```ts
Mailer({
  driver: nodemailer,
  components: {
    header: { content: "<h1>{site.title}</h1>", data: { site: { title: "Shop" } } },
  },
});
```

## Rendering without sending

```ts
render(message?: Message<Data>): RenderedMessage        // { subject, html, text? }
renderComponent(name: string, data?: Record<string, Data>): string
```

For a preview route, or a snapshot test:

```ts
const mailer = new AppMailer();

mailer.render({ subject: "Hi {user.name}", content: "<p>Hi {user.name}</p>", data: { user: { name: "Bob" } } });
mailer.renderComponent("header", { site: { title: "Staging" } });
```

## Attachments

```ts
interface Attachment {
  filename?: string | false;
  cid?: string;                    // for inline images
  content?: string | Buffer | Readable;
  path?: string;
  contentType?: string;
  encoding?: string;
  contentDisposition?: "attachment" | "inline";
  contentTransferEncoding?: "7bit" | "base64" | "quoted-printable" | false;
  headers?: Record<string, string | string[] | { prepared: boolean; value: string }> | Array<{ key: string; value: string }>;
  raw?: string | Buffer | Readable | { content?: string | Buffer | Readable; path?: string };
}
```

(`@ecosy/mailer` keeps this header shape as an internal alias, not a named
export — write it inline as above, there is nothing to import.)

A bare string in the `attachments` array is a file path, converted to
`{ path, headers }` — `attachments()` merges the mailer's `defaults.headers`
with the message's own `headers` into every attachment, including the ones
that started as a plain string; everything else is Nodemailer's attachment
shape, `cid` included:

```ts
await new AppMailer().send({
  to: "user@example.com",
  content: "<p>Your invoice</p>",
  attachments: [
    "/var/app/invoices/2026-09.pdf",
    { filename: "logo.png", path: "/assets/logo.png", cid: "logo" },
  ],
});
```

Use `cid` with `contentDisposition: "inline"` to embed an image the template
references as `<img src="cid:logo">`.

## Retry and rate limiting

```ts
interface RetryOptions {
  retries?: number;          // default 1, not counting the first attempt
  delay?: number;            // default 3000 ms
  backoffFactor?: number;    // default 1 (fixed delay)
}

interface RateLimitOptions {
  maxRequests?: number;
  interval?: number;                     // ms
  mode?: "serial" | "concurrent";        // default "concurrent"
}
```

`retries: 2` means up to three attempts. The rate limiter is a sliding window,
held in memory **per mailer instance** — two processes each get their own
budget. Both work on their own, too:

```ts
import { RateLimiter, Retry } from "@ecosy/mailer";

await new Retry({ retries: 3 }).retry(() => doSomething());
await new RateLimiter({ maxRequests: 5, interval: 1000 }).handle(() => send(payload));
```

## Logging and failures

```ts
Mailer({
  driver: nodemailer,
  logger: AppLogger,            // a LoggerLike, or a class that builds one
  inject: { alerts: Alerts },   // constructed once with the mailer
  onError: (error, message, context) => context.alerts.raise(message.subject, error),
});
```

`send` logs at `log` on success, `error` on failure, and `debug` while building
the payload — `console` and [the ecosy logger](/logger) both satisfy
`LoggerLike`. `MAILER_LOGGING=false` silences it without a code change.
`onError` runs after the last retry attempt has failed; the error is rethrown
either way.

## Ports

```ts
interface DriverLike {
  createTransport(options: any): TransporterLike;
}

interface TransporterLike {
  sendMail(mail: SendOptions): Promise<unknown>;
  verify?(): Promise<boolean | any>;
}

interface LoggerLike {
  log(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
  verbose?(message: string, ...args: unknown[]): void;
}
```

`transporter()` returns the underlying transport if you need something this
API does not cover.

## Upgrading from 0.1.x

`Mailer.from({ driver, options, data, retry, rateLimit })` is gone. Configure a
mailer once, and pass each message to `send`:

```diff
-const mailer = Mailer.from({
-  driver: nodemailer,
-  options: { host, port, auth, from, to, subject, content },
-  data,
-  retry: { retries: 2, delay: 1000 },
-});
-await mailer.send();
+const AppMailer = Mailer({
+  driver: nodemailer,
+  transport: { host, port, auth },
+  defaults: { from },
+  retry: { retries: 2, delay: 1000 },
+});
+await new AppMailer().send({ to, subject, content, data });
```

Also new in 0.2.0: template values are escaped by default (`{@raw:path}` opts
out), loops and the `>=`, `<=`, `===`, `!==` comparisons render at all, a string
attachment is attached rather than dropped, and the package loads under
`require` again.
