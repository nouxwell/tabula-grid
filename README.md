# Tabula Grid

An Excel-like workspace for preparing, validating and processing bulk data in ERP and CRM screens,
for Vue and Nuxt. It is the browser side of [nouxwell/tabula](https://github.com/nouxwell/tabula),
the PHP library that defines a column once and uses that one definition to export, to build
templates and to import.

> **Status: 0.1.0, the first release.** A sheet can be drawn, navigated, typed into, copied from
> and pasted into; what is typed is read the way nouxwell/tabula reads it, checked against the
> schema's rules as the user types, taken back with undo, checked by a backend, sent to it to be
> processed, and kept as a draft to go on with later; a lookup is picked from a searched list.
> Below 1.0 a minor version may change what came before; [CHANGELOG.md](CHANGELOG.md) says when.

## Packages

| Package                 | What it is                                                          |
| ----------------------- | ------------------------------------------------------------------- |
| `@nouxwell/tabula-core` | The framework-free core. No Vue, no DOM.                            |
| `@nouxwell/tabula-vue`  | Vue 3 components built on the core.                                 |
| `@nouxwell/tabula-nuxt` | A thin Nuxt module that registers the components, client-side only. |

```bash
npm install @nouxwell/tabula-core @nouxwell/tabula-vue   # Vue 3.5 or later
npm install @nouxwell/tabula-core @nouxwell/tabula-nuxt  # Nuxt 4 or later
```

They are ES modules with their types. TypeScript reads the types under the module resolution Vite
and Nuxt set (`Bundler`) and under Node's (`NodeNext`), so the core can check rows on a Node
server as well.

`playground/` is a small Vite app that runs the packages from source. It is not published.

[`examples/nuxt/`](examples/nuxt/README.md) is the grid in a Nuxt application set up as the IONSIS
CRM is, with Naive UI, Tailwind and TypeScript, drawn on the server. It uses the packages as they
are published.

`spikes/` holds throwaway experiments that settled a design question, kept for their numbers.
[spikes/render](spikes/render/README.md) is why the grid is drawn by a renderer of our own rather
than by an existing engine.

## The core

`@nouxwell/tabula-core` has no Vue and no DOM in it. Three pieces carry the rest:

- **`ModuleSchema`** reads the schema a backend sends: one field per column with a key that never
  changes, a type, and the rules nobody further down may loosen. It checks all of it and reports
  every problem at once, each with where it is. A property or rule it does not know is refused
  rather than skipped, because a skipped rule is a rule that quietly stops being checked.
- **`RowStore`** holds the rows under ids that stay the same through sorting, inserting, deleting
  and pasting, so an issue or a result always lands on the row it was about. Every change is a
  transaction with a revision number; a transaction that throws is taken back whole. Values are
  what JSON carries, so a draft is the store written out.
- **`Selection`** follows Excel: the active cell stays while Shift extends the selection, Ctrl and
  an arrow jump to the end of a run of filled cells.

```ts
import { ModuleSchema, RowStore, Selection } from "@nouxwell/tabula-core"

const schema = ModuleSchema.from(await fetchSchema("product.price_update"))
const rows = new RowStore({ rows: [{ values: { productId: { id: 1842, label: "Çelik Termos" } } }] })

rows.subscribe(change => console.log(change.revision, change.operations))
rows.transact(
  () => {
    const [id] = rows.appendRows(1)
    rows.setCell(id!, "newPrice", "389.90")
  },
  { origin: "paste" }
)

const selection = new Selection(rows.size, schema.fields.length)
selection.move(1, 0, { extend: true })
```

The core also holds the two rules the grid needs from a spreadsheet: `parseTsv` and `toTsv` read
and write clipboard text the way Excel and Google Sheets do, and `resolveColumnSizing` with its
helpers decides how wide a column may be.

### Values

A cell holds what a backend can take as it is: numbers as decimal text (`"1234.56"`, never a
float, so a price is exactly what was typed), dates as ISO text (`"2026-12-31"`), yes and no as
booleans, an option as its value, a lookup as `{ id, label }`.

`readInput(field, text, settings)` turns what a person typed into that, the way nouxwell/tabula
reads an imported file: "1.234,56", "1.234,56 ₺", "(1.234,56)", "31.12.2026", "Evet" and an option's
label all work with Turkish settings. `formatCell` writes a value back the sheet's way, and
`editText` gives the text an editor opens with, every digit kept. Text that cannot be read is
never thrown away: the cell keeps it as typed, and `valueProblem` says what was expected, with the
same codes and params as nouxwell/tabula's `RowErrorCode`.

```ts
import { readInput, VALUE_SETTINGS } from "@nouxwell/tabula-core"

readInput(schema.field("newPrice"), "1.234,5 ₺", VALUE_SETTINGS.tr) // { value: "1234.5", problem: null }
readInput(schema.field("validFrom"), "31.02.2026", VALUE_SETTINGS.tr).problem?.code // "not_a_date"
```

`VALUE_SETTINGS.tr` is nouxwell/tabula's own defaults with Turkish words for yes and no;
`VALUE_SETTINGS.en` has English separators and ISO dates. `defineValueSettings` changes any part
and checks the result. [conformance/](conformance/README.md) is the file of cases both sides are
run against, and lists where they differ on purpose.

## The grid

`TabulaGrid` in `@nouxwell/tabula-vue` draws a schema and a row store:

```vue
<script setup lang="ts">
import { ModuleSchema, RowStore } from "@nouxwell/tabula-core"
import { TabulaGrid } from "@nouxwell/tabula-vue"
import "@nouxwell/tabula-vue/style.css"
import { ref } from "vue"

const schema = ModuleSchema.from(json)
const store = new RowStore({ rows })
const widths = ref({}) // keep it, and the user's column widths come back next time
</script>

<template>
  <TabulaGrid v-model:column-widths="widths" :schema="schema" :store="store" theme="auto" />
</template>
```

Give it a height through its parent; it fills it. Pass the store and schema as they are, not
wrapped in `ref()`: the grid subscribes to the store rather than watching it.

- **Drawing.** Only the rows and columns on screen exist in the page, so 50,000 rows draw like 50.
  The header and the row numbers stay in place while the sheet scrolls under them.
- **Keyboard, as in Excel.** Arrows, Shift to extend, Ctrl and an arrow to jump, Home, End,
  Ctrl+Home, Page Up and Down, Ctrl+A, Shift+Space and Ctrl+Space. Typing replaces a cell, F2 edits
  it, Enter and Tab commit and move, Escape cancels. Text from an input method or dictation works
  like typed text. At the last column Tab leaves the grid.
- **Clipboard.** Copy gives text a spreadsheet reads. A pasted block lands at the top left of the
  selection, one pasted value fills the whole selection, and a paste that runs past the last row
  adds the rows it needs. A read-only column is passed over and keeps its values.
- **Filling, as in Excel.** Drag the square on the selection's corner down, up, across, or across
  the corner to fill a block (down first, then across from every row reached): numbers
  with one step between them go on by it (10, 20 gives 30, 40), a date goes on a day at a time,
  dates on one day of the month by months, and a name ending in a number counts on ("Ürün 9",
  "Ürün 10", "A009", "A010"); anything else, and one number alone, repeats. Ctrl (Option on a Mac)
  held when letting go turns a series into copies, or one number into a count. Double-clicking
  the square fills down as far as the column beside goes, so a price typed at the top of a list
  goes down all of it. Ctrl+D copies the selection's first row down it, Ctrl+R its first column
  across. A fill is one step to undo, writes only into the rows shown, and passes over columns
  that cannot be edited; across columns of different kinds a value is carried through its text,
  as a paste would. The core's `fillValues(field, values, count, options)` works the values out.
  On a touch screen the square is not drawn: a finger cannot hold it.
- **Columns.** Each column starts as wide as its header, from 100 to 320 pixels. A header past 100
  characters is cut with "…", and every header is whole in its tooltip. Dragging a column's edge
  goes up to 1,000 pixels and is never undone by measuring; double-clicking it fits the column to
  its contents within the automatic limits. All five numbers can be set for the module and for
  each column.
- **Values.** Cells show their values the sheet's way, and what is typed or pasted is read into
  the field's type. Copied text pastes back as the same values. Pass `value-settings` for anything
  other than Turkish.
- **Issues.** A cell breaking a rule, or holding text it could not read, gets a red corner and
  says why in its tooltip, in Turkish or English (`locale`), and its row's number carries a mark,
  so a row with something to fix is found as the sheet scrolls past. `goTo(rowId, field)` selects
  a cell and scrolls it into view, which is what an issue's ids are for.
- **Colours by sign.** A numeric field with `"tone": "sign"` in its schema shows a rise in green
  with its plus and a fall in red, as a change column wants.
- **Undo.** Ctrl+Z takes a step back, Ctrl+Y or Ctrl+Shift+Z makes it again, and either selects
  what it changed. While a cell is being edited, Ctrl+Z belongs to the editor.
- **Hiding and pinning.** A header's menu (⋯) pins a column, hides it, or shows the hidden ones
  again. Pinned columns come first and stay in place while the rest scroll sideways under them.
  The user's arrangement is a `ColumnLayout`, `{ order, hidden, pinned }` by field key; bind it
  with `v-model:columns` to keep it, as a draft does. Hiding a column relaxes nothing: its issues
  are still listed, going to one shows the column again, and a paste passes over it.
- **Several options in a cell.** A field with `"multiple": true` is edited in a list of its
  options to tick, under the cell: typing finds them, Space or a click ticks the one highlighted,
  Enter ticks what a search found, and Enter with nothing typed writes what is ticked, in the
  options' own order. F2, a double click and Alt+Down start with the cell's options ticked; typing
  replaces them, as anywhere; Escape leaves the cell as it was. The cell reads "Mağaza, Web", and
  that text pastes back as the same options. Its filter lists each option once, and keeps a row
  holding any option ticked, whatever else it holds.
- **Sorting and filtering.** The same menu sorts the rows by the column and filters it: tick the
  values to keep, or give a range of numbers or dates. A sorted header shows its arrow, a filtered
  one a funnel (see below).
- **Themes.** `light`, `dark` or `auto`, in colours an application changes (see below).

With Nuxt, add `@nouxwell/tabula-nuxt` to `modules` and `<TabulaGrid>`, `<TabulaIssues>`,
`<TabulaFormulaBar>`, `<TabulaStatusBar>` and `<TabulaPreview>` are available everywhere, drawn in
the browser only.

### The formula bar and the status bar

Two components that go with a grid, placed wherever the page wants them, given the grid's ref:

```vue
<template>
  <TabulaFormulaBar :grid="grid" />
  <TabulaGrid ref="grid" :schema="schema" :store="store" />
  <TabulaStatusBar :grid="grid">
    <template #end>Taslak kaydedildi · 09:38</template>
  </TabulaStatusBar>
</template>
```

- **`TabulaFormulaBar`** shows the active cell's address, "D9", and its value as an editor opens
  it. An address typed and Entered goes there; the value is edited as in the cell, Enter writes it
  and Escape leaves it. What was typed goes into the cell it was typed for, even when a click has
  already moved the selection on. A worked-out column shows its formula, read only.
- **`TabulaStatusBar`** counts the rows and the issues, names the cells selected, and sums and
  averages their numbers exactly, written as their column writes a number. `start` and `end` slots
  take what the application adds.

Both read what the grid exposes, which any other part of a page can read too: `cell` (the active
cell, its address, field and text), `selected` (the range, with `summarizeCells` from the core
behind its sum and average), `rows`, `issueSummary`, `goToAddress(address)`,
`writeCell(rowId, field, text)` and `formatValue(field, value)`. Addresses follow the columns as
they stand on screen; `columnName` and `parseAddress` turn one into the other.

### Sorting and filtering

A header's menu sorts its column either way and opens its filter: the values the column holds,
each once with how many rows hold it, to tick, with a search above them; a number or date column
also takes a range, from and to, written as the column writes it. The values listed are those of
the rows the other columns' filters keep, as in a spreadsheet. Bind both to keep them:

```vue
<script setup lang="ts">
import type { ColumnFilters, ColumnSort } from "@nouxwell/tabula-core"

const filters = ref<ColumnFilters>({}) // { price: { kind: "range", from: "10", to: null } }
const sort = ref<ColumnSort | null>(null) // { key: "price", direction: "desc" }
</script>

<template>
  <TabulaGrid v-model:filters="filters" v-model:sort="sort" :schema="schema" :store="store" />
</template>
```

- **Values, not text.** 12.5 and "12.50" are one value, a record is its id and an option its
  value, so a filter does not change with the language or with how a number is written.
  `filterKey(field, value)` gives the key a `values` condition lists; "" is an empty cell.
- **What needs fixing stays together.** Numbers sort by value, dates in time, text in the
  language's order with the numbers in it read as numbers ("Ürün 9" before "Ürün 10"). Whichever
  way a column sorts, cells holding something not of its type and then the empty ones stay last.
- **Applied at a moment.** A filter or sort holds the rows as they were when it was applied: a row
  edited so it no longer matches stays where it is, and rows a paste adds come at the end. Applying
  the filter again, or the issue panel's Refresh, puts them in their place.
- **The same in code.** `rowsMatching(store, schema, filters)` is the filter and
  `rowOrder(store, schema, sort, locale)` the order the grid gives its `RowView`;
  `compareValues`, `distinctValues` and `hasRange` are what the menu is built from.

### Colours

The grid and the issue panel are drawn in IONSIS's palette, the one its CRM uses, light and dark.
An application changes a few colours and the rest follow: lines, the selection, the tints of a cell
with an issue are worked out from them. Both components carry the class `tabula-theme`:

```css
.tabula-theme {
  --tabula-accent: #2563eb; /* the selection, the active cell, a selected header */
  --tabula-bg: #ffffff; /* cells and the panel */
  --tabula-bg-alt: #f8fafc; /* headers and read-only cells */
  --tabula-fg: #0f172a; /* text; lines are this over the background */
  --tabula-muted: #475569; /* the second kind of text */
  --tabula-error: #dc2626;
  --tabula-warning: #d97706;
  --tabula-success: #16a34a;
  --tabula-radius: 6px; /* menus and lists; --tabula-radius-small for smaller parts */
  --tabula-font-family: inherit; /* the page's font unless set */
  --tabula-font-size: 13px;
}

.tabula-theme[data-tabula-theme="dark"] {
  --tabula-bg: #0f172a;
  /* … */
}
```

Scroll bars are thin, as the CRM's, and the pointer turns into a hand over them: the grid and the
panel hide the browser's own and draw their thumbs, which can be dragged, while wheel, keys and touch
scroll as before. `--tabula-scrollbar`, `--tabula-scrollbar-hover` and `--tabula-scrollbar-size`
(5px) change them.

Where the accent carries words, on a link or a button, the grid takes it a step towards the text
colour, `--tabula-accent-text`: IONSIS's green reads at 2.9:1 on white, under the 4.5:1 text
needs. A rise and a fall in a column coloured by sign are `--tabula-positive` and
`--tabula-negative`.

Every other `--tabula-*` variable, such as `--tabula-range-bg` or `--tabula-error-bg`, can still be
set on its own. [examples/nuxt](examples/nuxt/README.md) writes an application's palette into
these from the one file its Naive UI theme and Tailwind colours are made from.

## Rules and issues

`SheetValidator` checks a sheet against its schema and keeps the result current: required fields,
`min` and `max` compared as decimals, `minLength` and `maxLength` counted in characters a reader
sees, `unique` across the column, and values that are not of their type. After each change it
checks only the cells the change touched.

Each issue is bound to a row by its id and to a field by its key, never to a row number or a
header, and carries a code and params rather than only a sentence. `TabulaIssues` lists them as
cards, with counts, Previous and Next: where each is, what it says, and whether the browser or the
server found it, so the user knows which they can fix themselves. Give it and the grid the same
issues, and send its `select` to the grid's `goTo`. On a phone, `variant="sheet"` makes it a bar
with the counts that opens the list from the bottom of the screen; choosing an issue closes it,
`v-model:open` opens it from elsewhere, and its `actions` slot takes a button such as "Check
again":

```vue
<script setup lang="ts">
const validator = new SheetValidator(schema, store, VALUE_SETTINGS.tr)
const grid = ref<InstanceType<typeof TabulaGrid>>()
</script>

<template>
  <TabulaGrid ref="grid" :schema="schema" :store="store" :issues="validator" />
  <TabulaIssues
    :issues="validator"
    :schema="schema"
    :store="store"
    @select="issue => grid?.goTo(issue.rowId!, issue.field)"
  />
</template>
```

These are the browser's checks, for the user's sake. Passing them promises nothing: the backend
checks everything again before it writes.

### Row checks

Some rules are about a row rather than one cell: "Not is required when Aktif is no", "Yeni fiyat
cannot be below Mevcut fiyat". A schema, or a template, writes them as `checks`:

```json
"checks": [
  {
    "id": "note-when-inactive",
    "assert": { "field": "note", "op": "filled" },
    "when": [{ "field": "active", "op": "=", "value": false }]
  },
  {
    "id": "not-below-current",
    "assert": { "field": "newPrice", "op": ">=", "other": "currentPrice" },
    "severity": "warning",
    "message": { "tr": "Yeni fiyat mevcut fiyatın altında.", "en": "The new price is below the current one." }
  }
]
```

- **What a check says** is a condition on one field (`assert`): `filled`, `empty`, or compared
  with `=`, `!=`, `<`, `<=`, `>` or `>=` to a `value` or to an `other` field of the row. **When
  it applies** is a list of conditions (`when`), every one holding; none, and it always applies.
  Order (`<` and the rest) is for numbers and dates; numbers compare as decimals, a lookup by its id.
- **Its issue lands on the asserted field's cell**, an `error` (the default) that keeps the row
  from being processed, or a `warning` that only points it out. A comparison with nothing on one
  side says nothing: whether a field is filled is a check of its own.
- **Its words.** The grid words it from the check, in the sheet's language and writing: "Mevcut
  fiyat değerinden küçük olamaz (Para birimi = TRY olduğunda)." A check's own `message`, by
  language, is said instead.
- **Checked as the user types.** A change checks again only the checks that read the field it
  changed, on that row. The schema refuses a check it cannot apply, each problem where it is: an
  unknown field, an order on text, a value that is not the field's, two checks with one id.
- **For an editor.** `rowsBreaking(schema, store, check, settings)` lists the rows a check catches
  now, before it is saved anywhere, and `describeCheck(check, schema, locale, settings)` from
  `@nouxwell/tabula-vue` says it as a sentence. [examples/nuxt](examples/nuxt/README.md) builds its
  rules drawer from them: a template's rules as cards with their counts, a form for one, the sheet
  narrowed to the rows it catches, and the template saved to the server, which checks it again.

### Only the rows with issues

A `RowView` decides which rows are on screen. Give it to the grid, and bind the panel's switch:
its filter is named, so it stands beside the column filters (the grid's own, named `"columns"`)
and goes without them.

```vue
<script setup lang="ts">
const view = new RowView(store)
const onlyIssueRows = ref(false)

watch(onlyIssueRows, only => (only ? view.filter(rowsWithIssues(issues), "issues") : view.clear("issues")))
</script>

<template>
  <TabulaGrid :schema="schema" :store="store" :issues="issues" :view="view" />
  <TabulaIssues :issues="issues" v-model:only-issue-rows="onlyIssueRows" @refresh-rows="view.refresh()" />
</template>
```

A filter applies at a moment, as a spreadsheet's does: a row the user fixes stays on screen until
the filter is applied again (the panel's Refresh). Row numbers stay the rows' numbers in the
sheet. A paste writes only into the rows shown, never into one the filter hides, and rows it adds
past the last are shown. Going to an issue on a row the filter left out shows that row in its
place. `rowsWithResult(session.results, ["failed"])` filters by the backend's results instead, and
any `(rowId) => boolean` will do. `clear()` with no name takes every filter and the sort away.

## Undo

`UndoHistory` makes every change to a store a step, whoever made it: one transaction is one step,
so a paste of 500 rows goes back in one go, with the rows it added. Rows that come back keep the
ids they had, and their issues come back with them. Taking a step back is a change of its own,
with a new revision and `"undo"` as its origin, so a backend answer about the sheet before it is
out of date after it.

The grid keeps a history of its own. Pass one in to drive buttons from it:

```vue
<script setup lang="ts">
const history = new UndoHistory(store) // 100 steps; { limit } for another number
const version = shallowRef(0)
history.subscribe(() => version.value++)
const canUndo = computed(() => version.value >= 0 && history.canUndo)
</script>

<template>
  <button :disabled="!canUndo" @click="grid?.undo()">Geri al</button>
  <TabulaGrid ref="grid" :schema="schema" :store="store" :history="history" />
</template>
```

Under it, `RowStore.revert(change)` and `replay(change)` take any change back and make it again.
Both refuse, with a `conflict` and without writing anything, a sheet that is no longer as the
change left it or found it.

## The backend

`SheetSession` takes a sheet to the application's backend: a pre-flight check, and the run that
processes it. It never makes a request itself. The application gives it adapters, which call the
backend however the application does and answer in the package's shapes; a backend with answers of
its own shape is adapted there.

```ts
const session = new SheetSession({
  schema,
  store,
  history, // cleared when rows are sent: what the backend has cannot be undone in the sheet alone
  adapters: {
    preflight: (request, { signal }) => api.post("/price-updates/check", request, { signal }),
    process: (request, { signal }) => api.post("/price-updates", request, { signal }),
    processStatus: (query, { signal }) => api.get(`/price-updates/runs/${query.idempotencyKey}`, { signal })
  }
})

await session.check() // { status: "valid" | "invalid" | "failed" | …, issues }
await session.process() // { status: "succeeded" | "partial" | "blocked" | "unknown" | …, succeeded, failed, … }
```

A request carries the module, the schema version, the sheet's revision and its rows, each under
its row id. Only fields with `submit` are sent, a lookup as its id. A pre-flight answer is a list
of issues, each with a `code`, a fallback `message`, `params`, and the row and field it is about;
an issue for a deleted row is dropped, one for an unknown field is kept as the row's. A run answers
`succeeded`, `partial`, `failed` or `cancelled`, with each row's result and issues. When it answers
`pending`, the session asks `processStatus` until it is done, showing how far it has got.

- **Stale answers.** An answer is about the revision it was asked at. An issue on a cell changed
  since, while the backend was checking or afterwards, is marked stale: not fixed, not blocking,
  waiting to be checked again. The grid shows it with a grey corner, the panel apart.
- **Failures apart from issues.** An adapter that throws, or answers in the wrong shape, is a
  failure of the request, in `session.state.failure`. The issues of the data stay as they were.
- **Processing.** Any error standing, the local checks' or the backend's, holds the run back.
  Rows that went through are locked and are not sent again; the next run sends only the rest.
  `removeSucceeded()` takes them out of the sheet in one change, so work goes on with the rest.
- **No double runs.** Every run has an idempotency key. When no answer comes, the session goes
  `unknown`, keeps the rows locked, and sends the same request again under the same key, or asks
  `processStatus` how it went. It never sends those rows as a new run. A cancel asks the backend to
  stop and takes nothing back: rows done before the stop stay done.

Give the grid `:issues="session.issues"` and `:results="session.results"`, and the panel the same
issues. Each row's number then shows its result, and a processed row can no longer be changed.

### Before a run: what it would do

Only the backend knows whether a row makes a new record or changes one, and what that record holds
now. A pre-flight answer may say so, in `plan`, one entry for each row it can tell about:

```ts
{
  issues: [],
  plan: [
    { rowId: "r1", action: "update", previous: { newPrice: "1496.66", validFrom: "2026-11-01" } },
    { rowId: "r2", action: "create" },
    { rowId: "r3", action: "unchanged" }
  ]
}
```

`previous` holds, for an update, each field that would change, with the value the backend has now
in the form rows are sent in (a lookup may come as `{ id, label }`). A field left out is not
changing. `plan` is optional: without it a preview has only the number of rows to show.

`session.plan()` reads it against the sheet as it stands: each row a run would send, in sheet order,
with its `action` and its `changes` (the backend's value and the sheet's), and the counts. A row
changed or added after the check is `unknown`, and `current` is false until the sheet is checked
again; a finished run leaves nothing to go by, since it changed what the backend holds.
`session.blocked()` says how many rows an error holds back.

```vue
<TabulaPreview :session="session" :plan="plan" name-field="productId" @select="goTo" />
```

`TabulaPreview` draws a plan: the counts, a filter by kind, and each row with its fields from the
old value to the new (`1.496,66 → 1.533,80`), a new record with the fields it gets, and the warnings
standing on it. The host puts it in a window of its own with the buttons to go on; choosing a row
emits `select` with its id. The example's İşle checks the sheet when the last check no longer
holds, stops on rows with an error, and otherwise opens the preview before anything is sent.

## Importing and exporting

CSV is read and written in the browser; an xlsx file goes to the application's backend, which
reads it with nouxwell/tabula and answers with rows in the module's own values, ready for the store.

```ts
const text = decodeText(new Uint8Array(await file.arrayBuffer()))
const result = importTable(parseCsv(text), { schema, settings })

store.transact(() => store.appendRows(result.rows), { origin: "import" })
// result.columns: what each column became; result.missing: required fields no column brought

const csv = toCsv(exportTable({ store, fields, rowIds, settings }), { delimiter: csvDelimiterFor(settings) })
```

- **As Excel writes it.** Quoted cells, doubled quotes and line breaks inside a cell. The
  delimiter is told from the first line: a Turkish Excel writes `;`, since its decimal mark is the
  comma. A file that is not UTF-8 is read as Windows-1254, which is what Excel saves a Turkish
  "CSV" in.
- **Columns by name.** A header names its field by label or by key, in any case; `columns` maps
  them by position instead. A column of a read-only or computed field is passed over, and the
  result says which columns matched, which did not, and which required fields are missing.
- **Cells as typed.** Each cell is read as a paste reads it: text that is no value of its field
  stays as written, marked; product names are matched to products by the lookup, in one request.
  Appended in one change, an import goes back with one Ctrl+Z.
- **Out as the sheet writes it.** Every digit with the sheet's decimal mark, dates in its pattern,
  a BOM so Excel reads UTF-8. Text that Excel would run as a formula when the file is opened,
  starting with `=`, `+`, `-` or `@`, is written with a `'` before it; a number is never touched.

## Formulas

A field in the module schema can be worked out from the other fields of its row instead of typed:

```json
{ "key": "difference", "type": "money", "decimals": 2, "formula": "[newPrice] - [currentPrice]" }
```

The language is a spreadsheet's, without cell addresses: fields by key in brackets, numbers with a
point, English function names, arguments separated by commas or semicolons. `SUM`, `AVERAGE`,
`MIN`, `MAX`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `ABS`, `IF`, `IFERROR`, `AND`, `OR`, `NOT`, `ISBLANK`,
`LEN` and `CONCAT` are built in, with `+ - * / ^ %`, `&` for text and the comparisons. Nothing a user
writes is ever run as code: a formula is parsed, and the tree is worked out.

- **Exact.** Numbers are decimals, not floats: 0.1 + 0.2 is 0.3, a division goes to 20 places, and
  the result is rounded to the field's places, half away from zero.
- **As Excel works.** An empty field is 0 in a sum and nothing in an average, `IF` works out only
  the branch it takes, text compares regardless of case, and what cannot be worked out is an error
  value: `#DIV/0!`, `#VALUE!`, `#NAME?`, `#NUM!`. The cell shows it, and it is an issue that holds
  back processing.
- **Checked as the schema is read.** A formula that does not parse, reads a field the schema does
  not have, or goes round in a circle refuses the schema. A formula field is never editable.
- **One change.** `FormulaEngine` works the formulas out inside the change that called for them:
  an edit and its consequences are one revision, one notice to listeners, one Ctrl+Z.
  `applyFormulas` fills rows before the store is made, so opening a sheet is no change at all.

```ts
const store = new RowStore({ rows: applyFormulas(schema, rows) })
const formulas = new FormulaEngine({
  schema,
  store,
  // An application's own function: it works a value out of its arguments and does nothing else.
  functions: { MARGIN: ([price, cost]) => formulaNumber(margin(numberArgument(price), numberArgument(cost))) }
})
```

What the browser works out is shown to the user and sent like any value, never trusted: the
backend works it out again. A field with `submit: false` is not sent at all.

### Writing a formula

A formula editor helps as it is written, from three pieces:

- **`formulaCaret(text, caret)`** in the core reads the formula up to the caret as the parser
  does, quotes and brackets passed over: what is being typed there (a field after "[", or a
  function's name, with the stretch a completion replaces) and the call the caret is inside, at
  which argument.
- **`formulaWithLabels` and `formulaWithKeys`** write a formula with the fields' labels, as a
  person reads it ("ROUND([Aralık fiyatı] * 1.2, 2)"), and back with their keys, as it is saved. A
  label two fields share is left as written, for the parser to refuse.
- **`functionHelp(name, locale)`** in `@nouxwell/tabula-vue` says what each of the 16 functions
  takes and does, in Turkish and English: `ROUND(sayı, basamak)`, "Sayıyı verilen ondalık
  basamağa yuvarlar". An application's own function has none, and is listed by its name.

[examples/nuxt](examples/nuxt/README.md) puts them together in the rules drawer's "Hesaplanan
sütunlar" tab: the template's own columns, and a formula field that lists the fields after "[" and
the functions on a letter, shows the call's arguments with the one being written in bold, and the
values the formula gives on the first rows as it is typed. A column kept shows in the sheet at once,
not saved until the template is.

## Lookups

A lookup holds a record as `{ id, label }`: the user sees the label, the backend receives the id.
A name typed or pasted into one is text until a record is matched to it, and text in a lookup is
an error (`not_matched`), since there is no id to send.

`LookupResolver` does the matching, through two adapters of the application's:

```ts
const lookups = new LookupResolver({
  schema,
  store,
  adapters: {
    search: ({ lookup, query, limit }, { signal }) => api.get(`/lookups/${lookup}`, { query, limit }, { signal }),
    resolve: ({ lookup, labels }) => api.post(`/lookups/${lookup}/resolve`, { labels })
  }
})
```

- **Typing.** Give the grid `:lookups="lookups"` and typing in a lookup cell lists the matching
  records under the editor, with a line such as a product code, as typing pauses. The arrows move
  through the list, Enter or a click picks, Escape closes it. Enter picks on its own only when one
  record alone fits what is typed; two records named alike are for the user to tell apart. A record
  marked `disabled`, such as an inactive product, is listed but cannot be picked.
- **Pasting.** Every name that lands in a lookup cell is gathered, and all of them go to `resolve`
  as one request per lookup (or a few, for thousands), never one per cell. A name the backend
  answers with exactly one record becomes that record; none or several, and it stays as typed,
  marked. Matching is the backend's, in the user's language: the browser sends the names as they
  were written. An answer is used again for a minute.
- **Undo.** The change that puts matched records in place joins the paste it came from: one
  Ctrl+Z takes back both, and nothing is asked again on the way back or forward.

An options field lists its choices the same way, filtered as the user types; Alt+Down opens the
whole list.

## Drafts

A draft is the sheet saved to go on with later. It creates no business record: it holds the rows
under their ids, each row's result from the backend, a run that never answered, the column widths,
and the schema version the rows were written against. It is plain JSON, kept wherever the
application keeps it.

```ts
const saver = new DraftSaver({
  schema,
  store,
  session,
  save: (draft, { signal }) => api.put(`/drafts/${draft.id}`, draft, { signal }),
  view: () => ({ columnWidths: widths.value })
})
// Saves a moment after the user stops changing the sheet (2 s by default), and on saver.save().
```

The draft's id is made in the browser, so saving the same draft again replaces it; a save whose
answer was lost makes no second draft. A save that fails leaves the sheet as it is and says so.

Opening one checks it against the schema as it is now:

```ts
const opening = openDraft(readDraft(await api.get(`/drafts/${id}`)), schema)

if (opening.status === "opened") {
  const store = new RowStore({ rows: opening.rows })
  const session = new SheetSession({ schema, store, adapters, restore: opening.session })
} else if (opening.status === "review") {
  // opening.changes: fields added, removed (and how many rows lose a value), retyped, renamed
}
```

A draft saved under another schema version is never opened silently: it comes back for review,
and opens with `{ accept: true }` once the user agrees, `rename` carrying a renamed field's
values to its new key. Every value is then checked again. A processed row opens locked, and a run
that never answered opens `unknown`, to be sent again under its key: closing the page mid-run
cannot lead to the rows being processed twice.

## Saved views

A user arranges the sheet for the work in hand (columns moved, hidden or pinned, widths, filters,
a sort) and keeps it under a name, to come back to: "Haftalık fiyatlar", "Yalnız TRY". A view is
how to look, never what is there: it holds what the grid's `columns`, `column-widths`, `filters`
and `sort` models hold, and no rows.

The views of one module are one JSON document, kept wherever the application keeps it: in the
browser, or on its server for each user. The core changes it by returning a new one, so it can sit
in a ref as it is:

```ts
import { addView, emptyViews, readViews, sameView, setDefaultView, viewFor } from "@nouxwell/tabula-core"

let views = emptyViews(schema.module) // or readViews(JSON.parse(stored), schema.module)
const state = { columns: columns.value, columnWidths: widths.value, filters: filters.value, sort: sort.value }

views = addView(views, { id: crypto.randomUUID(), name: "Haftalık fiyatlar", ...state })
views = setDefaultView(views, views.views[0].id) // the sheet opens in it

const shown = viewFor(views.views[0], schema) // as it applies to the schema now
const changed = !sameView(schema, state, views.views[0]) // "· değişti" beside its name
```

- **Opening under a newer schema.** `viewFor` passes over a column the schema no longer has, and a
  filter or sort on one, so a view saved before a column was removed still opens.
- **Telling a view changed.** `sameView` compares what the views show, not how they are written:
  the schema's own order written out is no order, and ticked values match in any order.
- **Names.** `viewNameProblem` says `empty`, `too_long` (past 60) or `taken` (another view's,
  in any case); `addView` and `renameView` refuse the same. Give them the page's `locale`: in
  Turkish "HAFTALIK" is "Haftalık" in capitals, in English it is not, and left out the machine's
  own language decides. `updateView`, `removeView` and
  `setDefaultView` complete it, and `readViews` checks what comes back from storage, every
  problem at once (`invalid_views`).

[examples/nuxt](examples/nuxt/README.md) has the menu: the views to choose from, with a tick by the
one shown and "· değişti" once the sheet no longer matches it, and save, save as, rename, delete
and "open in this view".

## Templates

A template is the sheet as an authorized user prepares it for a task, layered on the developer's
module schema and under each user's own views: "Aralık zam listesi" on the price update. It only
narrows what the schema allows, never loosens it:

| A template may                                          | It may not                                     |
| ------------------------------------------------------- | ---------------------------------------------- |
| change a column's header (the key stays)                | change a key, a type or what is sent           |
| require a field the schema leaves optional              | make a required field optional                 |
| keep a column from being typed into                     | open a column the schema keeps read-only       |
| narrow a limit: a `min` above the schema's, `unique`    | let through what the schema's limits refuse    |
| give new rows a value (`default`)                       | give a lookup, a formula or a unique field one |
| add columns of its own, a helper or a formula           | have them sent for processing                  |
| add row checks (`checks`), each only refusing more      | take one of the schema's checks away           |
| say how the sheet opens: columns, widths, filters, sort | override a user's own default view             |

Only a module whose schema says `"customization": "controlled"` takes one; a `fixed` module
refuses every template. A template is one JSON document the backend keeps and sends:

```json
{
  "format": "tabula-grid.template",
  "version": 1,
  "module": "product.price_update",
  "id": "december-rise",
  "name": "Aralık zam listesi",
  "fields": {
    "newPrice": { "label": "Aralık fiyatı", "rules": [{ "rule": "min", "value": "1" }] },
    "validFrom": { "required": true, "default": "2026-12-01" },
    "active": { "editable": false }
  },
  "columns": [
    { "key": "withTax", "type": "money", "label": "KDV dahil", "decimals": 2, "formula": "ROUND([newPrice] * 1.2, 2)" },
    { "key": "internalNote", "type": "string", "label": "İç not" }
  ],
  "view": { "columns": { "hidden": ["sku"], "pinned": ["productId"] }, "columnWidths": {}, "filters": {}, "sort": null }
}
```

```ts
import { applyTemplate, readTemplate, templateProblems, withDefaults } from "@nouxwell/tabula-core"

const template = readTemplate(json, moduleSchema.module) // its shape, every problem at once
const schema = applyTemplate(moduleSchema, template) // the schema the sheet works with
```

- **Refused whole, never half applied.** `templateProblems` lists everything that keeps a template
  from applying, each where the template wrote it: `fields.newPrice.rules[0]: min -5 would let
through what the schema's min 0 refuses`, `columns[0].key: "note" is a field of the module`,
  `fields.newPrice.rules: min 200000 is above max 100000; no value can satisfy both`.
  `applyTemplate` throws them (`invalid_template`); an editor shows them.
- **The sheet works with the result.** Its checks, its formulas and its columns are the schema's as
  the template left it; the template's columns come last and are never sent, so the backend sees
  the module's fields only.
- **Defaults.** A field's `default` (the schema's own, or one a template gives) fills new rows:
  the rows a paste adds past the last, and the rows an import brings (`withDefaults(schema, rows)`),
  where they give no value. A row already there is never changed by it.
- **The backend checks again.** A template's narrower limits are checked in the browser here. A
  backend that takes templates checks them too before it writes; nouxwell/tabula does not read
  templates yet.

[examples/nuxt](examples/nuxt/README.md) has a template menu: the template goes in the address
(`?template=december-rise`), and choosing another makes the sheet again with the same rows.

## Where the line is drawn

The packages never talk to a database and never choose an HTTP client. The application that embeds
them supplies the adapters for lookups, pre-flight checks, processing and drafts, and stays in
charge of authorisation, transactions and the final business rules. What the browser calculates is
never to be trusted by the backend.

## Development

Needs Node 22.13 or later (22, 24 or 26+) and pnpm, run through Corepack, which ships with Node 22
and 24 (on later versions, `npm install --global corepack`):

```bash
corepack pnpm install
corepack pnpm -r build                 # the three packages, in dependency order
corepack pnpm -r typecheck
corepack pnpm -r test
corepack pnpm lint
corepack pnpm format:check
corepack pnpm check:packages           # the packages as published: packed, installed, used
corepack pnpm --filter playground dev  # the playground
corepack pnpm --filter example-nuxt dev  # the Nuxt example, on the built packages
corepack pnpm --filter playground test:browser
```

`check:packages` needs the packages built. It packs them as `pnpm publish` would, installs the
tarballs into an empty project with npm, imports them in Node, and type-checks against them as
Vite and as Node resolve modules; `--keep` leaves the project behind to look at.

The browser tests build the playground and drive it with the keyboard, the mouse and the
clipboard. They use the installed Microsoft Edge; set `TABULA_BROWSER` to `chrome` for Chrome, or
to `chromium` after `corepack pnpm --filter playground exec playwright-core install chromium`.

With pnpm installed globally, drop the `corepack` in front. The recursive commands are spelled out
rather than wrapped in root scripts on purpose: a script that calls `pnpm` again only works where
`pnpm` is on the `PATH`, which under Corepack it is not.

## Versioning

The same rule as `nouxwell/tabula`: below 1.0, a **minor** bump is where a breaking change lands.
The three packages are versioned together, one `vX.Y.Z` tag per release.
[CHANGELOG.md](CHANGELOG.md) says what each release changed.

A release, on `main`:

1. One commit sets the version in the three `package.json` files and in `version` in
   `packages/core/src/index.ts` (a test holds the two together), and turns the changelog's
   Unreleased into the version's heading, with its link at the bottom.
2. An annotated tag `vX.Y.Z` on that commit, pushed with it. CI runs on the tag.
3. With `main` at the tag: `corepack pnpm install --frozen-lockfile`, `corepack pnpm -r build`,
   `corepack pnpm check:packages`, then `corepack pnpm -r publish`, signed in to npm as an owner of
   the `@nouxwell` scope. pnpm, not npm: only pnpm turns `workspace:^` into the version. Add
   `--dry-run` first to see what would go out.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 [IONSIS](https://ionsis.com).
