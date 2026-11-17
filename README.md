# Tabula Grid

An Excel-like workspace for preparing, validating and processing bulk data in ERP and CRM screens,
for Vue and Nuxt. It is the browser side of [nouxwell/tabula](https://github.com/nouxwell/tabula),
the PHP library that defines a column once and uses that one definition to export, to build
templates and to import.

> **Status: early.** A sheet can be drawn, navigated, typed into, copied from and pasted into.
> Values are kept as typed: reading them as numbers and dates, validation, undo and the adapters
> come next. No release has been made and none of the three packages is on npm; each is marked
> `private` until its first release.

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
- **Themes.** `light`, `dark` or `auto`, and every colour is a `--tabula-*` CSS variable.

With Nuxt, add `@nouxwell/tabula-nuxt` to `modules` and `<TabulaGrid>` is available everywhere,
drawn in the browser only.

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
