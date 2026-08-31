---
name: "@ecosy/datekit"
type: module
status: stable
repo: material-atomic/ecosy-datekit
npm: "@ecosy/datekit"
summary: A headless calendar engine — Date with 1-based months, plus day, month and year objects that generate grids.
---

# @ecosy/datekit

```bash
yarn add @ecosy/datekit
```

```ts
import { Monthify } from "@ecosy/datekit";

const march = new Monthify(2026, 3);
const { weeks, flatten, numberOfWeeks } = march.getCalendar();

weeks.forEach((week) => week.forEach((day) => render(day)));
```

Zero dependencies. Four classes, each immutable: every operation returns a new
instance.

Headless — it produces the data a calendar needs and renders nothing.

## Months are 1-based

Every class here numbers January as **1**, unlike native `Date`. That applies to
constructors, properties and `Dateify.from`:

```ts
Dateify.from(2026, 3, 24);   // 24 March 2026
new Date(2026, 3, 24);       // 24 April 2026 — native, 0-based
```

Native `Date` methods inherited by `Dateify` — `getMonth()`, `setMonth()` —
stay 0-based. The 1-based convention applies to this package's own API.

## `Dateify`

```ts
class Dateify extends Date
```

A `Date` subclass, so every native method still works.

### `Dateify.from`

```ts
static from(...params: DateifyParams): Dateify
```

```ts
type DateifyParams =
  | []
  | [value: string | number | Date]
  | [year: number, month: number, date?: number, hours?: number,
     minutes?: number, seconds?: number, ms?: number];
```

```ts
Dateify.from();                        // now
Dateify.from("2026-03-24");
Dateify.from(2026, 3, 24, 17, 10);     // month is 1-based
```

### Instance methods

```ts
format(): string
clone(): Dateify
addDays(days: number): Dateify
startOfDay(): Dateify
endOfDay(): Dateify
toISODate(): string
isToday(): boolean
isLeapYear(): boolean
toTimezone(offsetHours: number): Dateify
getDayName(chars?: 0 | 1 | 2 | 3): string
```

```ts
const d = Dateify.from(2026, 3, 24);

d.format();            // "03/24/2026, 12:00:00 AM"
`Time: ${d}`;          // same — toString is overridden
d.toISODate();         // "2026-03-24"
d.addDays(7);          // new Dateify, original unchanged
d.getDayName(3);       // "Tue"
```

`format` uses one shared `Intl.DateTimeFormat` (`en-US`, `MM/DD/YYYY, hh:mm:ss
A`), created once — building an `Intl` formatter per call is the usual cost in
a date-heavy render.

`toTimezone(offsetHours)` shifts by a **fixed offset**, not by an IANA zone, so
it does not follow daylight saving. For zone-aware formatting use `Intl`
directly.

`getDayName(chars)` gives the full name at `0`, or that many leading characters
at `1`–`3` (`"T"`, `"Tu"`, `"Tue"`).

### Statics

```ts
static pad(value: string | number): string
static isValid(date: unknown): date is Date
static daysInMonth(year: number, month: number): number
static isLeapYear(year: number): boolean
static getDayLabel(value: number, chars?: 0 | 1 | 2 | 3): string
static readonly formatter: Intl.DateTimeFormat
```

`isValid` rejects an `Invalid Date`, which `instanceof Date` does not.

## `Dayify`

```ts
class Dayify {
  constructor(date?: Dateify)   // defaults to today
}
```

One day, with everything a calendar cell needs read once at construction:

```ts
readonly date: Dateify;
readonly day: number;         // 1–31
readonly month: number;       // 1-based
readonly year: number;
readonly dayOfWeek: number;   // 0 = Sunday
readonly isToday: boolean;
readonly isWeekend: boolean;  // Saturday or Sunday
```

```ts
next(): Dayify
prev(): Dayify
add(days: number): Dayify
compareTo(other: Dayify): 1 | 0 | -1
lt(other: Dayify): boolean
gt(other: Dayify): boolean
eq(other: Dayify): boolean
```

Comparisons are by **calendar day**, ignoring time — two `Dayify` for the same
date are `eq` regardless of hour.

`isToday` is fixed at construction. A grid built before midnight still says so
after it; rebuild if the page can stay open across a day boundary.

## `Monthify`

```ts
class Monthify {
  constructor(year?: number, month?: number, options?: MonthifyOptions)

  readonly year: number;
  readonly month: number;      // 1-based
  get daysInMonth(): number;
}

interface MonthifyOptions {
  includeAdjacentMonths?: boolean;  // default true
  startOfWeek?: 0 | 1;              // 0 = Sunday (default), 1 = Monday
}
```

Construction is O(1) — the day array is built only when `getCalendar()` is
called, so a year of twelve months costs nothing until rendered.

```ts
next(): Monthify
prev(): Monthify
add(months: number): Monthify
clone(options?: Partial<MonthifyOptions>): Monthify
eq(other: Monthify): boolean
```

### `getCalendar`

```ts
getCalendar(addAdjacent?: boolean): {
  weeks: (Dayify | null)[][];
  flatten: (Dayify | null)[];
  numberOfWeeks: number;
  numberOfDays: number;
}
```

The month grid, padded to whole weeks at both ends.

| `includeAdjacentMonths` | padding cells |
|---|---|
| `true` (default) | `Dayify` for the neighbouring month's days |
| `false` | `null` |

```ts
const cal = new Monthify(2026, 3, { startOfWeek: 1 });
const { weeks } = cal.getCalendar();

weeks.map((week) =>
  week.map((day) => (day ? `${day.day}${day.isToday ? "*" : ""}` : "")),
);
```

`weeks` is rows of exactly 7. Pass `addAdjacent` to override the option for one
call — useful for rendering the same month twice with and without leading
greys.

## `Yearify`

```ts
class Yearify {
  constructor(year?: number, monthOptions?: MonthifyOptions)

  get months(): Monthify[];      // twelve, in order
  get isLeapYear(): boolean;
}
```

```ts
getQuarter(quarter: 1 | 2 | 3 | 4): Monthify[]
next(): Yearify
prev(): Yearify
add(years: number): Yearify
eq(other: Yearify): boolean
```

```ts
const year = new Yearify(2026, { startOfWeek: 1 });

year.months.map((m) => m.getCalendar());
year.getQuarter(1);              // Jan, Feb, Mar
```

`monthOptions` is passed to every month it creates, so week alignment is set
once.

## Subpath imports

```ts
import { Dateify } from "@ecosy/datekit/dateify";
import { Dayify } from "@ecosy/datekit/dayify";
import { Monthify } from "@ecosy/datekit/monthify";
import { Yearify } from "@ecosy/datekit/yearify";
```

Each imports the ones below it — `Monthify` pulls in `Dayify` and `Dateify` —
so the saving is real only when reaching for `Dateify` alone.
