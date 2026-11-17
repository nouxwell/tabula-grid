# Tabula Grid

An Excel-like workspace for preparing, validating and processing bulk data in ERP and CRM screens,
for Vue and Nuxt. It is the browser side of [nouxwell/tabula](https://github.com/nouxwell/tabula),
the PHP library that defines a column once and uses that one definition to export, to build
templates and to import.

> **Status: early.** A sheet can be drawn, navigated, typed into, copied from and pasted into;
> what is typed is read the way nouxwell/tabula reads it, checked against the schema's rules as
> the user types, taken back with undo, checked by a backend, sent to it to be processed, and kept
> as a draft to go on with later; a lookup is picked from a searched list. No release has been made
> and none of the three packages is on npm; each is marked `private` until its first release.

## Packages

| Package                 | What it is                                                          |
| ----------------------- | ------------------------------------------------------------------- |
| `@nouxwell/tabula-core` | The framework-free core. No Vue, no DOM.                            |
| `@nouxwell/tabula-vue`  | Vue 3 components built on the core.                                 |
| `@nouxwell/tabula-nuxt` | A thin Nuxt module that registers the components, client-side only. |

`playground/` is a small Vite app that runs the packages from source. It is not published.

`spikes/` holds throwaway experiments that settled a design question, kept for their numbers.
[spikes/render](spikes/render/README.md) is why the grid is drawn by a renderer of our own rather
than by an existing engine.

## What the core holds so far

`@nouxwell/tabula-core` has no Vue and no DOM in it. Three pieces are in place:

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
- **Columns.** Each column starts as wide as its header, from 100 to 320 pixels. A header past 100
  characters is cut with "…", and every header is whole in its tooltip. Dragging a column's edge
  goes up to 1,000 pixels and is never undone by measuring; double-clicking it fits the column to
  its contents within the automatic limits. All five numbers can be set for the module and for
  each column.
- **Values.** Cells show their values the sheet's way, and what is typed or pasted is read into
  the field's type. Copied text pastes back as the same values. Pass `value-settings` for anything
  other than Turkish.
- **Issues.** A cell breaking a rule, or holding text it could not read, gets a red corner and
  says why in its tooltip, in Turkish or English (`locale`). `goTo(rowId, field)` selects a cell
  and scrolls it into view, which is what an issue's ids are for.
- **Undo.** Ctrl+Z takes a step back, Ctrl+Y or Ctrl+Shift+Z makes it again, and either selects
  what it changed. While a cell is being edited, Ctrl+Z belongs to the editor.
- **Themes.** `light`, `dark` or `auto`, and every colour is a `--tabula-*` CSS variable.

With Nuxt, add `@nouxwell/tabula-nuxt` to `modules` and `<TabulaGrid>` is available everywhere,
drawn in the browser only.

## Rules and issues

`SheetValidator` checks a sheet against its schema and keeps the result current: required fields,
`min` and `max` compared as decimals, `minLength` and `maxLength` counted in characters a reader
sees, `unique` across the column, and values that are not of their type. After each change it
checks only the cells the change touched.

Each issue is bound to a row by its id and to a field by its key, never to a row number or a
header, and carries a code and params rather than only a sentence. `TabulaIssues` lists them, with
counts, Previous and Next; give it and the grid the same issues, and send its `select` to the
grid's `goTo`:

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

### Only the rows with issues

A `RowView` decides which rows are on screen. Give it to the grid, and bind the panel's switch:

```vue
<script setup lang="ts">
const view = new RowView(store)
const onlyIssueRows = ref(false)

watch(onlyIssueRows, only => (only ? view.filter(rowsWithIssues(issues)) : view.clear()))
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
any `(rowId) => boolean` will do.

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

## Where the line is drawn

The packages never talk to a database and never choose an HTTP client. The application that embeds
them supplies the adapters for lookups, pre-flight checks, processing and drafts, and stays in
charge of authorisation, transactions and the final business rules. What the browser calculates is
never to be trusted by the backend.

## Development

Needs Node 22.13 or later (22, 24 or 26+) and pnpm, run through Corepack, which ships with Node:

```bash
corepack pnpm install
corepack pnpm -r build                 # the three packages, in dependency order
corepack pnpm -r typecheck
corepack pnpm -r test
corepack pnpm lint
corepack pnpm format:check
corepack pnpm --filter playground dev  # the playground
corepack pnpm --filter playground test:browser
```

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

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 [IONSIS](https://ionsis.com).
