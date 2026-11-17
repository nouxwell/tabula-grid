# Tabula Grid

An Excel-like workspace for preparing, validating and processing bulk data in ERP and CRM screens,
for Vue and Nuxt. It is the browser side of [nouxwell/tabula](https://github.com/nouxwell/tabula),
the PHP library that defines a column once and uses that one definition to export, to build
templates and to import.

> **Status: early.** A sheet can be drawn, navigated, typed into, copied from and pasted into;
> what is typed is read the way nouxwell/tabula reads it, checked against the schema's rules as
> the user types, and taken back with undo. The backend adapters come next. No release has been
> made and none of the three packages is on npm; each is marked `private` until its first release.

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
counts, Previous and Next; give it and the grid the same validator, and send its `select` to the
grid's `goTo`:

```vue
<script setup lang="ts">
const validator = new SheetValidator(schema, store, VALUE_SETTINGS.tr)
const grid = ref<InstanceType<typeof TabulaGrid>>()
</script>

<template>
  <TabulaGrid ref="grid" :schema="schema" :store="store" :validator="validator" />
  <TabulaIssues
    :validator="validator"
    :schema="schema"
    :store="store"
    @select="issue => grid?.goTo(issue.rowId!, issue.field)"
  />
</template>
```

These are the browser's checks, for the user's sake. Passing them promises nothing: the backend
checks everything again before it writes.

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
