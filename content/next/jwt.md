---
title: Jwt
import: "@ecosy/next/jwt"
order: 4
---

# Jwt

```ts
import { Jwt } from "@ecosy/next/jwt";
```

Reads a bearer token off a request, verifies it, signs a new one. A thin,
configured wrapper over [`jsonwebtoken`](https://github.com/auth0/node-jsonwebtoken).

## Installing

`jsonwebtoken` is an **optional peer dependency** — the package does not bundle
it, and importing `@ecosy/next` never loads it. It is needed only by this
subpath:

```bash
yarn add jsonwebtoken
yarn add -D @types/jsonwebtoken
```

The emitted `jwt.d.ts` references `jsonwebtoken`'s own types, so
`@types/jsonwebtoken` is required to typecheck against this subpath, not just
to author it.

`Jwt` is deliberately absent from the root entry point. Import it from
`@ecosy/next/jwt` — `import { Jwt } from "@ecosy/next"` does not resolve.

## `Jwt(config)`

```ts
function Jwt(configs: JwtConfig): ClassType<JwtHelper>

interface JwtConfig {
  secret: string;
  issuer?: string;
  accessKey?: string;
}
```

| | |
|---|---|
| `secret` | Signing and verification secret. |
| `issuer` | Expected `iss`. Omit it and `iss` is not checked at all. |
| `accessKey` | Default cookie name for `extractFromCookie`. Defaults to `"access_token"`. |
| **returns** | A class constructible with no arguments. |

It returns a class rather than an instance, so it drops straight into an
[`InjectMap`](/next/inject):

```ts
export const AppJwt = Jwt({ secret: process.env.JWT_SECRET!, issuer: "MyApp" });

export const GET = Route({ jwt: AppJwt }).get(async (ctx) => {
  const token = ctx.jwt.extractFromHeader(ctx.req.headers);
  const payload = token ? ctx.jwt.verify(token) : null;
  if (!payload) throw new Unauthorized("Bad token");
  return { userId: payload.sub };
});
```

### `issuer`

Configured, it is enforced: a token whose `iss` differs — or that carries no
`iss` — fails `verify`.

```ts
const App = Jwt({ secret, issuer: "MyApp" });
new App().verify(signedByAnotherService);   // → null
```

Omitted, the claim is not examined, and any correctly signed token with a `sub`
passes. That is the right setting only when one secret serves one issuer;
anywhere a secret is shared, `issuer` is what keeps another service's tokens
out.

## Methods

### `extractFromHeader(headers)`

```ts
extractFromHeader(headers: Headers): string | null
```

Returns the token from `Authorization: Bearer <token>`, or `null` when the
header is missing, uses another scheme, or is not exactly two space-separated
parts. It does **not** verify — pass the result to `verify`.

```ts
const token = helper.extractFromHeader(request.headers);
```

### `extractFromCookie(cookies, key?)`

```ts
extractFromCookie(cookies: RequestCookies, key?: string): string | null
```

Returns the named cookie's value, or `null`. `key` defaults to the
`accessKey` given to `Jwt(...)`, so a refresh cookie is read by naming it:

```ts
helper.extractFromCookie(request.cookies);                  // access_token
helper.extractFromCookie(request.cookies, "refresh_token");
```

`RequestCookies` is Next's request-side cookie object — `request.cookies` in a
route or middleware, not the `cookies()` helper.

### `verify(token)`

```ts
verify(token: string): jwt.JwtPayload | null
```

Returns the payload when the signature holds, `sub` is a non-empty string,
and — if an `issuer` was configured — `iss` matches it. Returns `null` in
every other case — a bad
signature, an expired token, a payload that is not an object, or a failed
claim. **It never throws**, so there is no error to distinguish *expired* from
*forged*; both are `null`.

```ts
const payload = helper.verify(token);
if (!payload) throw new Unauthorized("Bad token");
payload.sub;   // string, guaranteed non-empty
```

Nothing else is checked. `aud`, `nbf` beyond `jsonwebtoken`'s own handling, and
any custom claim of your own — a token type, a scope — are yours to check on
the returned payload.

### `decode(token)`

```ts
decode<Payload>(token: string): Payload
```

Parses the payload **without verifying the signature** and casts it to
`Payload`. The cast is unchecked and the token is untrusted, so this is for
reading a claim off a token you are not authorising with — the `sub` on an
already-expired token, say. Never branch on it for access.

```ts
const { sub } = helper.decode<{ sub: string }>(token);
```

### `sign(payload, options?)`

```ts
sign(payload: string | object | Buffer, options?: jwt.SignOptions): string
```

Signs with the configured `secret`. Everything else comes from `options`,
passed through to `jsonwebtoken` untouched.

`issuer` is **not** applied for you. With one configured, a token you sign
without it is rejected by this same helper's `verify`, so set it either way:

```ts
helper.sign({ sub: userId }, { issuer: "MyApp", expiresIn: "15m" });
helper.sign({ iss: "MyApp", sub: userId, exp: now + 900 });
```

The two are equivalent; use `options` unless you are computing `iat`/`exp`
yourself.
