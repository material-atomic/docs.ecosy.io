---
name: "@ecosy/orm"
type: module
status: stable
repo: material-atomic/ecosy-orm
npm: "@ecosy/orm"
summary: A small SQL ORM — schema-inferred entities, repositories, transactions, and a driver you inject.
---

# @ecosy/orm

```bash
yarn add @ecosy/orm pg
```

`pg` is an **optional** peer dependency: it is needed by the Postgres driver
and by nothing else, so an app on another engine never installs it.

There are no other dependencies. Since **1.1.2** there is no `server-only`
either, so the package runs wherever Node does — a script, a worker, a test
runner — and not only inside Next.

```ts
import { DataSource, Entity, createRepository } from "@ecosy/orm";
import { PgDriver } from "@ecosy/orm/drivers/pg";

const User = Entity.create("users", {
  columns: {
    id: { type: "SERIAL", primaryKey: true },
    email: { type: "TEXT", notNull: true, unique: true },
    password: { type: "TEXT", notNull: true, private: true },
    createdAt: { type: "TIMESTAMPTZ", default: "now()" },
  },
  indexes: [{ name: "users_email_idx", columns: ["email"], unique: true }],
});

await DataSource
  .driver(PgDriver({ connectionString: process.env.DATABASE_URL }))
  .entities([User])
  .initialize();

const users = createRepository(User);
const user = await users.findOne({ where: { email: "a@b.com" } });
```

The driver carries the connection settings, so `DataSource` itself knows
nothing about hosts or passwords — changing engine is changing that one
argument.

It no longer imports `server-only`. That marker made importing the ORM into a
client component a build error, and it also made the package unusable outside
Next: a script or a worker got `MODULE_NOT_FOUND` on a convention that means
nothing there. Keeping a database client out of the browser is the app's own
`import "server-only"` to write, in the module that opens the connection.

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

### `driver`

```ts
static driver(driver: Driver): typeof DataSource
static get current(): Driver
static get dialect(): Dialect
```

Installs the engine. Everything else reads it from here.

```ts
import { PgDriver } from "@ecosy/orm/drivers/pg";

DataSource.driver(PgDriver({ host, user, password, database }));
```

The driver is held on `globalThis` under a `Symbol.for` key rather than in a
module variable. A bundler gives different layers of an application their own
copy of a module — in Next, instrumentation and a route handler are separate
graphs — so a driver registered at startup would otherwise be invisible to the
code that serves requests, and every query would report that none was
installed. The same key survives a hot reload.

### `initialize`

```ts
static entities(entities: EntityConstructor[]): typeof DataSource
static initialize(driver?: Driver): Promise<DataSource>
static end(): Promise<void>
```

```ts
await DataSource
  .driver(PgDriver(config))
  .entities([User, Post, Session])
  .initialize();
```

`initialize` opens the connection and **synchronises every registered entity's
schema** — creating tables and indexes that do not exist, adding columns that
were added, and adjusting nullability. A sync that fails rejects, so startup
stops rather than continuing against a wrong schema.

Passing the driver to `initialize` is shorthand for calling `driver()` first.
`end()` closes the pool.

### Using it

```ts
const db = new DataSource();

await db.query("select 1", []);
```

```ts
query<Row>(sql: string, params?: unknown[]): Promise<QueryResultLike<Row>>
transaction(fn?): Promise<Transaction | T>
```

### `createRepository`

```ts
import { createRepository } from "@ecosy/orm";

const users = createRepository(User);
```

A repository for an entity with no class of its own — the same thing
`class UserRepository extends Repository<User>` gives you, without the class.

It was `DataSource#createRepository` until **1.1.1**. It was the only reason
`DataSource` needed `Repository` as a value, while `Repository` needs
`DataSource` for every query it runs, so the pair imported each other — and a
cycle in a package whose entry re-exports both is a class that is `undefined`
at the moment the other is evaluated. Moving one function out was the whole
fix.

`new DataSource()` does **not** connect — it runs on whatever driver is
installed. Calling `query` before one is throws:

```
No driver installed. Call DataSource.driver(PgDriver({ … })) before initialize().
```

## Transactions

```ts
static transaction(): Promise<Transaction>
static transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>
```

Given a function, the transaction commits when it returns and rolls back if it
throws. This is the form to reach for: it cannot leak a connection.

```ts
await DataSource.transaction(async (tx) => {
  await files.using(tx).delete({ projectId });
  await projects.using(tx).delete({ id: projectId });
});
```

Given nothing, the caller owns the lifecycle:

```ts
const tx = await DataSource.transaction();

try {
  await users.using(tx).insert({ email });
  await tx.commit();
} catch (error) {
  await tx.rollback();
  throw error;
}
```

### `Transaction`

```ts
class Transaction {
  get isOpen(): boolean;
  query<Row>(sql: string, params?: unknown[]): Promise<QueryResultLike<Row>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): Promise<void>;
}
```

| | |
|---|---|
| `commit` | Commits, then returns the connection to the pool. Throws if the transaction is already finished. |
| `rollback` | Rolls back and releases. A **no-op** on a finished transaction, so it is safe in a `catch` that may follow a commit. |
| `release` | Returns the connection. **Rolls back first if the transaction is still open.** |
| `query` | Throws once the transaction is finished, rather than silently running outside it. |

`release` rolling back is not a convenience. node-postgres does not undo a
transaction on release, so a forgotten commit would hand the next borrower a
connection with a transaction open on it — and their first statement would
join it. A failed `COMMIT` rolls back for the same reason.

### `Repository.using`

```ts
using(tx: Queryable): this
```

The same repository, bound to a transaction.

It returns a **view**, not a mutation: the original keeps running on the pool,
so a repository shared across requests cannot be dragged into one request's
transaction.

```ts
await DataSource.transaction(async (tx) => {
  await files.using(tx).moveFolder(projectId, "js", "scripts");
  await projects.using(tx).updateSizeDelta(projectId, -bytes);
});
```

## Drivers

```ts
interface Driver {
  readonly name: string;
  readonly dialect: Dialect;
  connect(): Promise<void>;
  end(): Promise<void>;
  query<Row>(sql: string, params?: unknown[]): Promise<QueryResultLike<Row>>;
  acquire(): Promise<DriverConnection>;
}
```

A driver owns the connection. A `Dialect` owns everything that is not plain
SQL:

```ts
interface Dialect {
  placeholder(index: number): string;
  quote(identifier: string): string;
  readonly supportsReturning: boolean;
  upsertClause(conflictColumns: string[], updateColumns: string[]): string;
  alterNullable(table: string, column: string, type: string, notNull: boolean): string;
  tableExists(db: Queryable, table: string): Promise<boolean>;
  listColumns(db: Queryable, table: string): Promise<ColumnInfo[]>;
  listIndexes(db: Queryable, table: string): Promise<Record<string, string>>;
  listChecks(db: Queryable, table: string): Promise<Record<string, string>>;
}
```

The split matters: no engine-specific statement lives in the query builders any
more, which is what makes a second engine a new file rather than a rewrite.
`$1` versus `?`, `"name"` versus `` `name` ``, `ON CONFLICT` versus `ON
DUPLICATE KEY UPDATE`, `information_schema` versus `pg_indexes` — all of it is
the dialect's.

### Built-in drivers

```ts
import { PgDriver } from "@ecosy/orm/drivers/pg";

PgDriver(config: PoolConfig): Driver
```

Each one lives on its own subpath and loads its client package through a
**dynamic import**, so it is deliberately **not exported from the package
root** — installing `@ecosy/orm` pulls in no database client at all. The pool
is held on `globalThis`, so a hot reload reuses it instead of opening a second.

`config` is `pg`'s own `PoolConfig`.

Only `Driver`, `Dialect` and the surrounding types are exported from the root;
they are the contract, and a driver of your own only has to satisfy it.

## Repository

```ts
find(options: FindOptions<Entity>): Promise<Entity[]>
findOne(options: FindOptions<Entity>): Promise<Entity | null>
insert(data: PartialInput<Entity>): Promise<Entity>
insert(data: PartialInput<Entity>[]): Promise<Entity[]>
update(where: FindWhereOptions<Entity>, data: PartialInput<Entity>): Promise<…>
delete(where: FindWhereOptions<Entity>): Promise<…>
upsert(data: PartialInput<Entity>, conflictColumns: string[]): Promise<Entity>
upsert(data: PartialInput<Entity>[], conflictColumns: string[]): Promise<Entity[]>
syncSchema(): Promise<void>
getPrimaryKeyField(): string
```

```ts
interface FindOptions<Entity> {
  where?: FindWhereOptions<Entity> | undefined;
  order?: PartialInput<Record<Extract<keyof Entity, string>, OrderDirection>> | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}
```

```ts
const recent = await users.find({
  where: { active: true },
  order: { createdAt: "DESC" },
  limit: 20,
  offset: 0,
});

const [a, b] = await users.insert([{ email: "a@x.com" }, { email: "b@x.com" }]);

await users.upsert({ email: "a@x.com", name: "A" }, ["email"]);
```

Rows come back as **hydrated entity instances**, not plain objects, so
`save()` and `delete()` work on them.

### Reach for `order` whenever `limit` is set

SQL does not promise which rows a `LIMIT` returns without an `ORDER BY`.
Postgres is free to answer with any twenty matching rows, and free to answer
with different ones next time — so a paged list without an order silently
repeats and skips rows as the table changes underneath it.

Keys are checked against the schema, so nothing can be injected through one; a
name that is not a column is dropped rather than written into the SQL.

Since **1.1.2**.

### JSON and JSONB columns are serialised for you

```ts
await settings.insert({ userId, value: { theme: "dark", tags: ["a", "b"] } });
```

`pg` turns a plain object into JSON but turns a JS array into a Postgres array
literal `{a,b}`, which `jsonb` rejects with *invalid input syntax for type
json*. The column type is declared, so the builder handles both shapes. Reading
is unchanged — the driver already parses `jsonb` back into real objects and
arrays.

Since **1.1.2**.

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

### `null` is `IS NULL`, `undefined` is no condition at all

```ts
await users.find({ where: { deletedAt: null } });
// … WHERE "users"."deleted_at" IS NULL

await users.find({ where: { deletedAt: Not(null) } });
// … WHERE "users"."deleted_at" IS NOT NULL

await users.find({ where: { name: undefined } });
// … no WHERE clause, no parameters
```

The two used to mean the same thing and both were wrong. A `null` became
`= $1` with a null parameter, and `x = NULL` is UNKNOWN in SQL rather than
false — so the query returned nothing, `update` and `delete` sharing the same
builder did nothing, and no error was raised anywhere. The type system invited
it: `{ deletedAt: null }` type-checks on any nullable column.

`undefined` fell into the same hole, which mattered because it is what a filter
built from optional input looks like:

```ts
await users.find({ where: { role, team } });   // team may be undefined
```

That now means "no condition on `team`", the way every other ORM reads it,
rather than a filter the caller never asked for and cannot see.

Fixed in **1.1.2**.

### `And` and `Or` read the entity from where they are used

Neither takes a type argument above, and neither infers one from its
conditions — `{ role: "editor" }` is not an entity, so there is nothing there
to infer from. The entity comes from the position the result lands in, which
inside `find({ where: … })` is the repository's own.

That is enough almost always. It runs out when the call has no such position:

```ts
const rule = And({ role: "editor" });      // no context — falls back
await users.find({ where: rule });         // ✗ not assignable

const rule: FindWhereOptions<User> = And({ role: "editor" });
await users.find({ where: rule });         // ✓
```

Annotate the variable, or write the call where it is used.

Fixed in **1.1.1**. Before it, the nested example above did not compile at all.

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
static hydrate<T extends Entity>(data: PartialInput<T>, repo: Repository<any>): T
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
  constructor(entityName: string, schema: SchemaOptions, dialect?: Dialect)

  buildSelect(options: FindOptions<Entity>): { sql: string; params: any[] }
  buildInsert(rows: PartialInput<Entity>[]): { sql: string; params: any[] }
  buildUpdate(where: FindWhereOptions<Entity>, data: PartialInput<Entity>): { sql: string; params: any[] }
  buildDelete(where: FindWhereOptions<Entity>): { sql: string; params: any[] }
  buildUpsert(rows: PartialInput<Entity>[], conflictColumns: string[]): { sql: string; params: any[] }
}
```

The SQL generator under `Repository`. Use it to inspect what a condition
compiles to, or to build a statement you then run yourself.

```ts
const qb = new QueryBuilder("users", User.schema);
qb.buildSelect({ where: { active: true }, limit: 10 });
// { sql: 'SELECT * FROM "users" WHERE "active" = $1 LIMIT 10', params: [true] }
```

`dialect` defaults to the installed driver's, so it is only worth passing to
compile a statement for an engine other than the one in use. The SQL above is
Postgres because `PgDriver` is what produced it — on another dialect the same
call yields `?` placeholders and backtick-quoted identifiers.

`SchemaBuilder(connection, dialect?)` is the counterpart that emits DDL and
runs `syncSchema`.

## Migration helpers

```ts
import { syncEntities, initDatabase } from "@ecosy/orm/migration";

function syncEntities(entityClasses: EntityConstructor[]): Promise<void>
function initDatabase(): Promise<void>
```

Its own subpath since **1.1.2**, the same arrangement as the drivers. These
read the filesystem, so exporting them from the root put `node:fs/promises`
and `node:path` in the import graph of everyone who imported the package —
including someone who only wanted a type.

`syncEntities` runs the same schema sync `initialize` does, for a migration
script that is not the application's own startup path.

Schema sync creates what is missing. It does not drop or alter existing
columns — a renamed or retyped column needs a migration you write.

## `exactOptionalPropertyTypes`

Every input type says `| undefined` where a value may be absent, so a project
with the flag on can pass one:

```ts
const wrapId = isEmbed ? payload.wrapId : undefined;

await projects.insert({ name, wrapId });            // ✓
await projects.find({ where: { userId }, limit });   // ✓ limit?: number | undefined
```

`Partial<T>` is what this replaces, and not as a matter of style — under the
flag it cannot express what these functions accept:

```ts
Partial<{ nickname: string | null }>   // { nickname?: string | null }
```

That set holds no `undefined`, so `{ nickname: undefined }` is rejected — even
though the ORM treats a missing key and an undefined one identically, since a
column set to `undefined` is simply not written.

```ts
type PartialInput<T> = { [K in keyof T]?: T[K] | undefined };
```

Nothing is widened beyond that, and return types are untouched: a row that came
back is not optional in the caller's sense, and relaxing it would only move the
same problem one step along.

Since **1.1.1**.

## Types

```ts
type InferColumnType<T extends string>
type InferSchema<TCols extends Record<string, ColumnOptions>>
type EntityConstructor<T extends Entity = Entity>
type PartialInput<T>
type OrderDirection            // "ASC" | "DESC"
type FindCondition<T>
type ObjectWhere<Entity>
type FindWhereOptions<Entity>
interface AndCondition<Entity>
interface OrCondition<Entity>
interface SchemaOptions
interface CheckOptions
```
