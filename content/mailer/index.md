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
import { Mailer } from "@ecosy/mailer";
import nodemailer from "nodemailer";

const mailer = Mailer.from({
  driver: nodemailer,
  options: {
    host: "smtp.example.com",
    port: 587,
    auth: { user, pass },
    from: "noreply@example.com",
    to: "user@example.com",
    subject: "Welcome, {user.name}",
    content: "<p>Hello {user.name}!</p>",
  },
  data: { user: { name: "Alice" } },
  retry: { retries: 2, delay: 1000 },
  rateLimit: { maxRequests: 5, interval: 1000 },
});

await mailer.send();
```

Zero dependencies. It brings no transport of its own — anything with
`createTransport` works, Nodemailer included.

## `Mailer.from`

```ts
static from<T>(config: MailerStatic<T>): Mailer<T>
```

```ts
interface MailerStatic<T> {
  driver: DriverLike;
  options: MailerOptions & Omit<SendOptions, "html">;
  components?: Components;
  data?: Record<string, T>;
  retry?: RetryOptions;
  rateLimit?: RateLimitOptions;
  logger?: LoggerLike;
}
```

```ts
interface MailerOptions {
  host?: string;
  port?: number;
  secure?: boolean;     // default false
  auth?: any;
  url?: string;
  content?: string;     // body template
  subject?: string;     // subject template
  logger?: LoggerLike;
}
```

`new Mailer(driver, options)` is the same thing without components, data,
retry or rate limiting — `from` is the one to use.

## Addresses and content

```ts
interface SendOptions {
  to?: MailerAddress;
  from?: MailerFrom;
  subject?: string;
  cc?: MailerAddress;
  bcc?: MailerAddress;
  replyTo?: MailerAddress;
  attachments?: Array<string | Attachment>;
  headers?: Record<string, string>;
  html?: string;
}

type MailerFrom = string | { name: string; address: string };
type MailerAddress = MailerFrom | MailerFrom[];
```

`replyTo` defaults to `from` when not given.

Setters, all chainable:

```ts
setSender(options: SendOptions)
setFrom(from) · setTo(to) · setCc(cc) · setBcc(bcc) · setReplyTo(replyTo)
setHeaders(headers)
setData(data) · setComponents(components)
setRetry(options) · setRateLimit(options) · setLogger(logger)
```

```ts
mailer.setTo("someone@example.com").setData({ user: { name: "Bob" } });
await mailer.send();
```

The instance is **mutable and reused** — each setter changes it in place.
Sending to many recipients in a loop means re-setting `to` and `data` each time,
and a concurrent send would race. Build one `Mailer` per message, or `await`
each send.

## Templates

The body and subject both go through `Formatter`.

### Variables

```
{user.name}
{order.items.0.price}
```

Dot and index paths. A path that does not resolve renders as empty.

### Conditions

```
{@if:user.isAdmin}
  <p>Admin</p>
{@else:user.isAdmin}
  <p>Member</p>
{@endif:user.isAdmin}
```

With a comparison:

```
{@if:user.age >= 18}<p>Welcome</p>{@endif:user.age}
```

Note the closing tag repeats the **path**, not the whole expression.

### Loops

```
{@loop:items}
  <li>{items.name} — {items.price}</li>
{@endloop:items}
```

Inside the loop, the collection name refers to the current element.

### Components

```
{@component:header}
```

```ts
Mailer.from({
  components: {
    header: { content: "<h1>{site.title}</h1>", data: { site: { title: "Shop" } } },
  },
});
```

Each component carries its own data, merged with the parent's during rendering.

### Previewing

```ts
getContent(): string
getSubject(): string
renderComponent(name: string, mockData?: Record<string, T>): string
```

Render without sending — for a preview route, or a snapshot test:

```ts
mailer.renderComponent("header", { site: { title: "Staging" } });
```

## `send`

```ts
send(): Promise<unknown>
```

Assembles the payload and hands it to the transport, wrapped as
**retry → rate limiter → send**. Resolves with whatever the transport returns.

Rejects when every attempt fails — `send` does not swallow, so wrap it or let
it propagate.

## `verify`

```ts
verify(): Promise<boolean>
```

`true` when the transport verifies, `false` on any failure. A transport with no
`verify` (SendGrid, for one) also returns `true`, so a `true` means "did not
fail", not "confirmed reachable".

## `Retry`

```ts
interface RetryOptions {
  retries?: number;          // default 1, not counting the first attempt
  delay?: number;            // default 3000 ms
  backoffFactor?: number;    // default 1 (fixed delay)
}
```

```ts
new Retry({ retries: 2, delay: 1000, backoffFactor: 2 });
// attempt 1 → fail → 1s → attempt 2 → fail → 2s → attempt 3
```

`retries: 2` means up to three attempts. Usable on its own:

```ts
import { Retry } from "@ecosy/mailer";

await new Retry({ retries: 3 }).retry(() => doSomething());
```

## `RateLimiter`

```ts
interface RateLimitOptions {
  maxRequests?: number;
  interval?: number;                     // ms
  mode?: "serial" | "concurrent";        // default "concurrent"
}
```

Sliding window.

| mode | |
|---|---|
| `"concurrent"` | tasks within the window run in parallel |
| `"serial"` | each task completes before the next starts |

```ts
import { RateLimiter } from "@ecosy/mailer";

const limiter = new RateLimiter({ maxRequests: 5, interval: 1000 });
await limiter.handle(() => send(payload));
```

The limiter is **per instance**, held in memory. Two processes each get their
own budget — for a provider quota shared across instances you need coordination
outside this package.

## Ports

```ts
interface DriverLike {
  createTransport(options: TransportOptions): TransporterLike;
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

`console` and [`@ecosy/logger`](/logger) both satisfy `LoggerLike`. The mailer
logs at `log` on send and success, `error` on failure, and `debug` while
building the payload.

`getTransporter()` returns the underlying transport if you need something this
API does not cover.

## Attachments

```ts
interface Attachment {
  filename?: string | false;
  cid?: string;                    // for inline images
  content?: string | Buffer | Readable;
  path?: string | Url;
  contentType?: string;
  encoding?: string;
  contentDisposition?: "attachment" | "inline";
  contentTransferEncoding?: "7bit" | "base64" | "quoted-printable" | false;
  headers?: Headers;
  raw?: string | Buffer | Readable | { content?: …; path?: … };
}
```

Nodemailer's attachment shape, so anything valid there is valid here. Use `cid`
with `contentDisposition: "inline"` to embed an image the template references as
`<img src="cid:logo">`.
