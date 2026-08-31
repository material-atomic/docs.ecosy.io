---
name: "@ecosy/orm"
type: module
status: stable
repo: material-atomic/ecosy-orm
npm: "@ecosy/orm"
summary: A small PostgreSQL ORM — schema-inferred entities, repositories, and active-record instances.
---

# @ecosy/orm

```bash
yarn add @ecosy/orm pg
```

```ts
import { DataSource, Entity } from "@ecosy/orm";

const User = Entity.create("users", {
  columns: {
    id: { type: "SERIAL", primaryKey: true },
    email: { type: "TEXT", notNull: true, unique: true },
    password: { type: "TEXT", notNull: true, private: true },
    createdAt: { type: "TIMESTAMPTZ", default: "now()" },
  },
  indexes: [{ name: "users_email_idx", columns: ["email"], unique: true }],
});

await DataSource.entities([User]).initialize({ connectionString: process.env.DATABASE_URL });

const users = new DataSource().createRepository(User);
const user = await users.findOne({ where: { email: "a@b.com" } });
```

`pg` is a peer dependency — the driver belongs to the application, which
already decides pool size, TLS and connection lifetime.

Server-only: the module imports `server-only`, so importing it from a client
component is a build error.

## `Entity.create`

```ts
static create<TName extends string, TCols extends Record<string, ColumnOptions>>(
  entityName: TName,
  schema: { columns: TCols; indexes?: readonly IndexOptions[] },
): EntityConstructor
```

Returns a class whose instance type is **inferred from the schema** — no
decorators, no separate interface to keep in step.

```ts
interface ColumnOptions {
  type: string;
  name?: string;         // column name, defaults to the key
  primaryKey?: boolean;
  notNull?: boolean;
  unique?: boolean;
  default?: string;      // raw SQL, e.g. "now()"
  references?: string;   // e.g. "users(id)"
  private?: boolean;     // omitted from toJSON()
}

interface IndexOptions {
  name: string;
  columns: readonly string[];
  unique?: boolean;
}
```

Type inference:

| `type` | TypeScript |
|---|---|
| `TEXT`, `UUID` | `string` |
| `INTEGER`, `BIGINT`, `FLOAT`, `SERIAL` | `number` |
| `BOOLEAN` | `boolean` |
| `TIMESTAMP`, `TIMESTAMPTZ`, `DATE` | `string` |
| anything else | `unknown` |

A column without `notNull: true` is typed as `T | null`, so nullability comes
from the schema rather than being asserted separately.

Timestamps are `string`, not `Date` — `pg` returns them as given, and this
package does not convert.

## `DataSource`

### `initialize`

```ts
static entities(entities: EntityConstructor[]): typeof DataSource
static initialize(configs: PoolConfig): Promise<DataSource>
```

```ts
await DataSource
  .entities([User, Post, Session])
  .initialize({ connectionString: process.env.DATABASE_URL });
```

`initialize` creates the pool and **synchronises every registered entity's
schema** — creating tables and indexes that do not exist. A sync that fails
rejects, so startup stops rather than continuing against a wrong schema.

The pool is stored on `globalThis` under `__ECOSY_ORM_POOL`, so a second
`initialize` reuses the existing one rather than opening another. That is what
keeps a Next.js hot reload from leaking pools.

`configs` is `pg`'s own `PoolConfig`.

### Using it

```ts
const db = new DataSource();

await db.query("select 1", []);
const users = db.createRepository(User);
const client = await db.client;      // a pooled client — release it yourself
```

```ts
static get pool(): Pool
query(sql: string, params?: unknown[]): Promise<QueryResult>
createRepository<T>(EntityClass: EntityConstructor<T>): Repository<T>
get client(): Promise<PoolClient>
```

`new DataSource()` with no arguments does **not** connect — it attaches to the
pool `initialize` created. Calling `query` before that throws:

```
DataSource has not been initialized. Please call DataSource.initialize() first.
```

Use `client` for a transaction, and release it when done:

```ts
const client = await db.client;
try {
  await client.query("BEGIN");
  // …
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
}
```

## Repository

```ts
find(options: FindOptions<Entity>): Promise<Entity[]>
findOne(options: FindOptions<Entity>): Promise<Entity | null>
insert(data: Partial<Entity>): Promise<Entity>
insert(data: Partial<Entity>[]): Promise<Entity[]>
update(where: FindWhereOptions<Entity>, data: Partial<Entity>): Promise<…>
delete(where: FindWhereOptions<Entity>): Promise<…>
upsert(data: Partial<Entity>, conflictColumns: string[]): Promise<Entity>
upsert(data: Partial<Entity>[], conflictColumns: string[]): Promise<Entity[]>
syncSchema(): Promise<void>
getPrimaryKeyField(): string
```

```ts
interface FindOptions<Entity> {
  where?: FindWhereOptions<Entity>;
  limit?: number;
  offset?: number;
}
```

```ts
const recent = await users.find({
  where: { active: true },
  limit: 20,
  offset: 0,
});

const [a, b] = await users.insert([{ email: "a@x.com" }, { email: "b@x.com" }]);

await users.upsert({ email: "a@x.com", name: "A" }, ["email"]);
```

Rows come back as **hydrated entity instances**, not plain objects, so
`save()` and `delete()` work on them.

## Conditions

```ts
import { And, Or, Not, Like, Between } from "@ecosy/orm";
```

An object is an implicit `AND` over its keys:

```ts
await users.find({ where: { active: true, role: "admin" } });
// active = $1 AND role = $2
```

Operators wrap a value:

```ts
await users.find({
  where: {
    email: Like("%@example.com"),
    age: Between([18, 65]),
    status: Not("banned"),
  },
});
```

`And` and `Or` nest:

```ts
await users.find({
  where: Or(
    { role: "admin" },
    And({ role: "editor" }, { verified: true }),
  ),
});
// role = $1 OR (role = $2 AND verified = $3)
```

An array is also an `AND` of its members. Every value goes through a
parameter placeholder — nothing is interpolated into SQL.

## Active record

An entity that came from a repository carries a hidden reference to it:

```ts
save(): Promise<this>
delete(): Promise<void>
toJSON(): Record<string, unknown>
```

```ts
const user = await users.findOne({ where: { id: 1 } });

user.name = "New name";
await user.save();       // UPDATE, primary key is set

await user.delete();
```

`save()` chooses **UPDATE when the primary key has a value** and INSERT
otherwise, assigning the inserted row back onto the instance.

An entity built with `new User()` rather than through a repository has no
reference and throws:

```
Cannot save() a disconnected Entity. It must be created via Repository or injected manually.
```

Use `repository.insert(data)` for new rows.

### `toJSON`

Columns marked `private: true` are **stripped**, and so is the internal
repository reference. So returning an entity straight from a route does not
leak a password hash:

```ts
const User = Entity.create("users", {
  columns: {
    id: { type: "SERIAL", primaryKey: true },
    email: { type: "TEXT" },
    password: { type: "TEXT", private: true },
  },
});

return user;   // { id, email } — no password
```

It runs on `JSON.stringify`, so it protects a response body, not a
`console.log` or a value spread into another object.

## `Entity.hydrate`

```ts
static hydrate<T extends Entity>(data: Partial<T>, repo: Repository<any>): T
```

Builds an instance from raw data and attaches a repository — what `find` uses.
Reach for it when rows come from a query you wrote yourself and you want
active-record behaviour on them:

```ts
const { rows } = await db.query("select * from users where …");
const entities = rows.map((row) => User.hydrate(row, users));
```

## `QueryBuilder`

```ts
class QueryBuilder<Entity> {
  constructor(entityName: string, schema: SchemaOptions)

  buildSelect(options: FindOptions<Entity>): { sql: string; params: any[] }
  buildInsert(rows: Partial<Entity>[]): { sql: string; params: any[] }
  buildUpdate(where: FindWhereOptions<Entity>, data: Partial<Entity>): { sql: string; params: any[] }
  buildDelete(where: FindWhereOptions<Entity>): { sql: string; params: any[] }
  buildUpsert(rows: Partial<Entity>[], conflictColumns: string[]): { sql: string; params: any[] }
}
```

The SQL generator under `Repository`. Use it to inspect what a condition
compiles to, or to build a statement you then run yourself.

```ts
const qb = new QueryBuilder("users", User.schema);
qb.buildSelect({ where: { active: true }, limit: 10 });
// { sql: 'SELECT * FROM "users" WHERE "active" = $1 LIMIT 10', params: [true] }
```

`SchemaBuilder` is the counterpart that emits DDL and runs `syncSchema`.

## Migration helpers

```ts
function syncEntities(entityClasses: EntityConstructor[]): Promise<void>
function initDatabase(): Promise<void>
```

`syncEntities` runs the same schema sync `initialize` does, for a migration
script that is not the application's own startup path.

Schema sync creates what is missing. It does not drop or alter existing
columns — a renamed or retyped column needs a migration you write.

## Types

```ts
type InferColumnType<T extends string>
type InferSchema<TCols extends Record<string, ColumnOptions>>
type EntityConstructor<T extends Entity = Entity>
type FindCondition<T>
type ObjectWhere<Entity>
type FindWhereOptions<Entity>
interface AndCondition<Entity>
interface OrCondition<Entity>
interface SchemaOptions
interface CheckOptions
```
