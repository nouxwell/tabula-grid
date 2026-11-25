# Tabula Grid

An Excel-like workspace for preparing, validating and processing bulk data in ERP and CRM screens,
for Vue and Nuxt. It is the browser side of [nouxwell/tabula](https://github.com/nouxwell/tabula),
the PHP library that defines a column once and uses that one definition to export, to build
templates and to import.

> **Status: 0.7.1.** A sheet can be drawn, navigated, typed into, copied from and pasted into;
> what is typed is read the way nouxwell/tabula reads it, checked against the schema's rules as the
> user types, taken back with undo, checked by a backend, sent to it to be processed, and kept as a
> draft to go on with later; a lookup is picked from a searched list. Since 0.1.0 it filters,
> sorts, searches and fills as a spreadsheet does, keeps personal views, works under templates
> with row checks and worked-out columns written with help, edits several options in a cell,
> changes numbers in bulk, marks what the user changed, previews a run before it is sent, maps an
> older draft's fields, and has a right-click menu. Since 0.3.0 several sheets of one module are
> kept together as tabs under the sheet, in a workbook. Since 0.4.0 cells are formatted and
> coloured, by hand and by rule, the columns fill the sheet with their totals under them, the sheet
> zooms, and text is found and replaced. Since 0.5.0 a file is imported through a window that
> shows where its columns go and writes into the rows it finds, a sheet can start empty, and the
> rows with issues are written out to fix and import again. Since 0.6.0 colour is kept for what it
> says, the header carries the column's letter, and the issues are a plain list with filters.
> Since 0.7.0 every sheet of a workbook can be checked and sent at once, a product two sheets
> differ on asked about first. Below 1.0 a minor version may change what came before;
> [CHANGELOG.md](CHANGELOG.md) says when.

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
- **Taking rows out.** Ctrl+− takes out the rows selected whole, as Excel's does; with cells
  selected, the first press selects their rows, so a slip of the keys takes nothing out.
  `removeRows()` takes out the rows the selection spans, for a toolbar's button. Either is one
  step to undo, and a row on its way to the backend stays.
- **Changing numbers in bulk.** `adjustSelection(adjustment)` raises the numbers selected by a
  percentage (`{ kind: "percent", by: "5" }`), adds an amount (`{ kind: "add", by: "-2.5" }`), or
  rounds them to a step (`{ kind: "round", step: "0.05", mode: "half" }`), exactly, to the
  column's digits, as one step to undo. Columns that cannot be edited, locked rows and cells with
  no number are passed over; it returns how many cells changed. The core's
  `adjustValue(field, value, adjustment)` works out one value.
- **What the user changed.** Give the grid a `SheetChanges` as `changes`, and every cell the user
  changed since the sheet was loaded has a mark in its top left corner (see below).
- **Column letters.** `column-letters` puts A, B, C before each header's label, in the same row,
  as the columns stand on screen: the addresses the formula bar shows.
- **A right-click menu.** On a cell, what is done most at once: Kes, Kopyala, Yapıştır, İçeriği
  temizle; then the groups, each opening its items beside it: Doldur (down, right), Satırlar
  (added above or below the selection, as many as it spans, and taken out, the count in their
  words: "3 satırı sil"), the host's items, and Süz ve sırala ("“TRY” olanları göster", the
  column's filter cleared, the sorts). On a row's number the row items stand in the open, without
  the cell's own; on a header, the header's menu. A click outside the selection selects the cell or row first, as in
  Excel; any issue the cell has heads the menu. Shift+F10 and the menu key open it at the active
  cell; arrows move in it, Escape closes it. While a cell is being edited the browser's own menu
  stays, for the text. `menu-items` adds the host's own items among the grid's groups, one
  with `children` opening them beside it (a child of `kind: "heading"` titles the ones after it,
  `kind: "line"` parts them, `danger` draws one in red), and `@menu` gives the key of the one
  chosen. A group opens under the pointer, with Right or Enter, and closes with Left or Escape; on
  the left when the window has no room on the right. Ctrl++ adds rows
  as Ctrl+− takes them out, and `insertRows("above" | "below")` does it for a button. Menu
  pasting reads the clipboard, which a browser may ask the user to allow; refused, the menu stays
  open and says to paste with Ctrl+V, which needs nothing.
- **Themes.** `light`, `dark` or `auto`, in colours an application changes (see below).

With Nuxt, add `@nouxwell/tabula-nuxt` to `modules` and `<TabulaGrid>`, `<TabulaIssues>`,
`<TabulaFormulaBar>`, `<TabulaStatusBar>`, `<TabulaPreview>`, `<TabulaDraftMapping>`,
`<TabulaSheetTabs>` and `<TabulaFind>` are available everywhere, drawn in the browser only.

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
`addressOf(rowId, field)`, `writeCell(rowId, field, text)` and `formatValue(field, value)`. `position()`
gives the active cell and the scroll, and `restorePosition(position)` puts the user back there, as a
host does when it makes the grid again over the same rows. Addresses follow the columns as
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
- **Searching.** `rowsContaining(store, schema, text, { settings })` keeps the rows where a cell
  holds the text as the cell shows it ("1.533,80", "Mağaza, Web", a record's name), case aside the
  language's way; a number is found as it is typed too. Give it to the view under a name of its
  own, `view.filter(rowsContaining(…), "search")`, so it stands with the column filters.

### What the user changed

`SheetChanges` follows what the user changed since the sheet was loaded: each cell that holds
other than it did, and each row added since. Only the fields that are sent count. Values are
compared as the backend reads them (12.5 is "12.50", a record is its id, a multi-select's options
count in any order), and a value put back takes its mark away.

```ts
const changes = new SheetChanges({
  schema,
  store,
  baseline: rowsFromTheServer, // left out, the store as it is now
  key: "productId" // matched by product, so a draft opened another day shows its changes
})

changes.isChanged(rowId, "newPrice")
changes.summary() // { rows: 128, cells: 140, added: 2, missing: 1 }
view.filter(rowsChanged(changes), "changed") // only the rows changed or added
```

A row whose key changes is another row: an added one, while the one it was goes missing.
`reset()` takes the sheet as it is now as what it is compared with.

### Colours

The grid and the issue panel keep colour for what it says: neutral greys for the sheet, one green
for the selection and the main action, one red for errors, a dark orange for warnings, and a dark
theme in layered greys.
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
colour, `--tabula-accent-text`: a green that fills well reads under the 4.5:1 text needs on
white. A cell no one types into, and one its row's record filled, is a neutral grey
(`--tabula-readonly-bg`, `--tabula-readonly-fg`); the link in a filled column's header and its
tooltip say where it came from. A rise and a fall in a column coloured by sign are `--tabula-positive` and
`--tabula-negative`.

Every other `--tabula-*` variable, such as `--tabula-range-bg` or `--tabula-error-bg`, can still be
set on its own. [examples/nuxt](examples/nuxt/README.md) writes an application's palette into
these from the one file its Naive UI theme and Tailwind colours are made from.

## How cells look

What a cell looks like is never what it holds: nothing here changes a value, and nothing of it is
sent to the backend. Where each look is kept is what tells them apart.

- **A column's format**, its alignment and the decimals it shows, is part of the columns' layout,
  `columns.formats`: kept with the draft and in a saved view, and in a template's view. A number
  shown with fewer digits keeps every digit it has.

  ```ts
  columns.value = withColumnFormat(columns.value, "newPrice", { align: "center", decimals: 0 })
  ```

  A template's formats, in its view's `columns.formats`, are for everyone who opens it: give them
  to the grid's `defaultFormats`, and each user's own are drawn over them, property by property
  (`mergeColumnFormats`). Taking one's own off brings the template's back. Once a template is saved
  with the formats a user gave, `withoutColumnFormats` takes off what it now says from theirs, so a
  later change to the template reaches them too.

  ```vue
  <TabulaGrid v-model:columns="columns" :default-formats="template.view?.columns.formats" … />
  ```

- **What the user colours by hand**, a fill, a text colour, bold, italic, is a `CellMarks`: kept
  with the draft, taken back with Ctrl+Z in its turn with the rows' changes, and `rowsMarked`
  filters a `RowView` to its rows. Give it to the grid's `marks`; Ctrl+B and Ctrl+I put bold and
  italic on what is selected, and the grid's `markSelection`, `toggleSelection` and
  `clearSelectionMarks` are a toolbar's.

  ```ts
  const marks = new CellMarks({ marks: opening.marks, history })
  const saver = new DraftSaver({ schema, store, session, marks, save })
  grid.value.markSelection({ fill: "yellow" })
  ```

- **Colour rules** colour cells by what the row holds, for everyone who opens the schema or the
  template, and follow the values as they change. A rule's conditions are a check's; it colours its
  field's cell, or the whole row without one. A later rule is drawn over an earlier one, and what
  the user put on by hand over both.

  ```json
  {
    "id": "low-price",
    "when": [{ "field": "newPrice", "op": "<", "value": 100 }],
    "field": "newPrice",
    "fill": "orange"
  }
  ```

The colours are names, `yellow`, `green`, `blue`, `purple`, `pink`, `orange`, `grey`, `red`: the
theme draws each as a light tint for a fill and towards the text colour for text, in light and in
dark alike (`--tabula-mark-yellow` and the rest). An issue's tint stays over a fill.

The grid also takes `fit`, which shares the room left on its right among the columns the user has
not sized by hand; `totals`, a row under the rows with each number column's sum, average, smallest
or largest over the rows shown; and `zoom`, which draws the text, the rows and the widths larger
or smaller together. A double click on a column's edge fits it to its contents.

**Find and replace** is `findCells` and `replaceCells` in the core, and `TabulaFind` in the Vue
package: a strip that looks among the cells selected, in a column or in the sheet, as the cells show
their values, tints what it finds in the grid (bind its `found` to the grid's), and replaces as
typing would, every cell in one step. The grid says when Ctrl+H is pressed with `@find`.

```vue
<TabulaFind v-model:open="finding" v-model:found="found" :grid="grid" :store="store" :schema="schema" :view="view" />
<TabulaGrid ref="grid" :found="found ?? undefined" @find="finding = true" … />
```

## Rules and issues

`SheetValidator` checks a sheet against its schema and keeps the result current: required fields,
`min` and `max` compared as decimals, `minLength` and `maxLength` counted in characters a reader
sees, `unique` across the column, and values that are not of their type. After each change it
checks only the cells the change touched.

Each issue is bound to a row by its id and to a field by its key, never to a row number or a
header, and carries a code and params rather than only a sentence. `TabulaIssues` lists them as
rows of a plain list, with arrows to the previous and the next, and filters for all of them, the
errors or the warnings with their counts: where each is, what it says, and whether the browser or
the server found it, so the user knows which they can fix themselves. A row is pressed as a whole
to go to its cell. Give it and the grid the same
issues, and send its `select` to the grid's `goTo`. On a phone, `variant="sheet"` makes it a bar
with the counts that opens the list from the bottom of the screen; choosing an issue closes it,
`v-model:open` opens it from elsewhere, `:bar="false"` leaves the bar out for a host that shows
the state by its own buttons, `:modal="false"` takes the lower part of the screen only
(`--tabula-issues-sheet-height`) and stays open while the chosen cell shows above it, and its `actions` slot takes a button such as "Check
again". `closable` gives the panel a close button too, which emits `close`, for a host that
shows it only while there are issues:

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
await session.process({ leaveOut: [rowId] }) // the rest now; those rows stay for a later run
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
issues. Given the grid's `addressOf` as `address-of`, and a field naming the rows as
`name-field`, the panel shows each issue's cell address, "D8", and its row's product. Each row's number then shows its result, and a processed row can no longer be changed.

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
emits `select` with its id. The example's "Değişiklikleri uygula" checks the sheet when the last
check no longer holds, is held back with its reason while errors stand, and otherwise opens the
preview before anything is sent.

## Importing and exporting

CSV is read and written in the browser; an xlsx file goes to the application's backend, which
reads it with nouxwell/tabula and answers with rows in the module's own values, ready for the store.

```ts
const table = parseCsv(decodeText(new Uint8Array(await file.arrayBuffer())))

// Where each column would go, and the column that finds the sheet's rows: for the user to look over.
const suggested = suggestColumns(table, { schema, settings, remembered })
const found = suggestMatch(table, store, { schema, settings }) // { column: 0, field: "sku" } or null

const columns = Object.fromEntries(suggested.map((item, index) => [index, item.field]))
const imported = importTable(table, { schema, settings, columns, key: found?.column ?? null })
const matches = found ? matchRows(store, schema.field(found.field), imported.keys, settings) : undefined

applyImport(store, schema, imported, { matches, unmatched: "add" }) // one Ctrl+Z takes it back
// imported.columns: each column's fate, its first values, how many of them could not be read

const csv = toCsv(exportTable({ store, fields, rowIds, settings }), { delimiter: csvDelimiterFor(settings) })
```

- **As Excel writes it.** Quoted cells, doubled quotes and line breaks inside a cell. The
  delimiter is told from the first line: a Turkish Excel writes `;`, since its decimal mark is the
  comma. A file that is not UTF-8 is read as Windows-1254, which is what Excel saves a Turkish
  "CSV" in.
- **Columns by name, or as suggested.** A header names its field by label or by key, in any case;
  `columns` maps them by position instead. A column of a read-only or computed field is passed
  over, and the result says which columns matched, which did not, which required fields are
  missing, each column's first values and how many of them could not be read. `suggestColumns`
  says where a file's columns would go and why: where the host remembers the header went
  (`headerKey`), the header as a field's name, a word the two share ("Fiyat" and "Yeni fiyat"), or
  values only one field reads ("TRY" and "USD" as a currency's options). Only fields typed into
  are suggested, each once.
- **Into the rows they find.** `suggestMatch` finds the column whose values name the sheet's rows,
  such as a product code, and `matchRows` the rows each value names, without regard to case and
  "1.001" the same number as 1001. `applyImport` writes a row of the file into the rows it found,
  an empty cell emptying its cell, and adds the others with the schema's defaults or leaves them
  out; rows the host locks, such as those processed, are not written into.
- **Cells as typed.** Each cell is read as a paste reads it: text that is no value of its field
  stays as written, marked; product names are matched to products by the lookup, in one request.
  Appended in one change, an import goes back with one Ctrl+Z.
- **Out as the sheet writes it.** Every digit with the sheet's decimal mark, dates in its pattern,
  a BOM so Excel reads UTF-8. Text that Excel would run as a formula when the file is opened,
  starting with `=`, `+`, `-` or `@`, is written with a `'` before it; a number is never touched.
  `extra` adds the host's own columns before or after the fields', such as each row's number and
  its issues: the example writes the rows with issues so, to fix in Excel and import again.

A row holding nothing anyone gave it, every field empty or at its default (`isBlankRow`), is
neither checked nor sent: a new row nobody typed into, or a pasted block's empty line, says nothing
until something is in it, and then it is checked whole. The grid's `new-row` draws a row after the
last that adds one when pressed, and a sheet with no rows takes a paste from its first cell.

## Formulas

A field in the module schema can be worked out from the other fields of its row instead of typed:

```json
{ "key": "difference", "type": "money", "decimals": 2, "formula": "[newPrice] - [currentPrice]" }
```

The language is a spreadsheet's, fields by key in brackets rather than cell addresses (addresses
are read while a formula is written; see below), numbers with a point, English function names,
arguments separated by commas or semicolons. `SUM`, `AVERAGE`,
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
- **`formulaFromAddresses(text, columns)`** reads a cell address as the field of its column, in
  the same row: "D * 1.2" and "D2 * 1.2" alike are "[Yeni fiyat] * 1.2", `columns` being the
  fields as the columns stand on screen. A column formula only reads its own row, so a row number
  says nothing; a name followed by "(" stays a function. Written with the label, the formula keeps
  its meaning however the columns move later.

The formula bar shows a worked-out column's formula by the fields' labels, each field it reads in
its own colour, and the grid colours those columns the same while the cell is active, its own
row's cells stronger, as Excel colours references. The grid's `cell` carries the formula in pieces
(`formulaParts` from the core) and `references`, the fields it reads in order.

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
- **What a record fills.** A lookup's `fills` names the fields its record fills, such as a
  product's code and current price; a record answers with `values` for them, by field key. They
  are written with the record, whether picked from the list or matched to a name or a code, as part
  of the same step, and emptied when the cell is left with no record. The grid tints a filled cell
  and names its record in the cell's tooltip and the formula bar's. `match()` says what names
  would be matched to without writing anything, such as for a file's column before an import.

  ```json
  { "key": "productId", "type": "lookup", "lookup": "product", "fills": ["sku", "currentPrice"] }
  ```

  ```json
  {
    "id": 1004,
    "label": "Ürün 000005",
    "description": "SKU-000005",
    "values": { "sku": "SKU-000005", "currentPrice": "104.00" }
  }
  ```

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

// What waits is saved before the page goes, so a reload right after a change keeps it.
window.addEventListener("pagehide", () => void saver.flush())
```

The draft's id is made in the browser, so saving the same draft again replaces it; a save whose
answer was lost makes no second draft. A save that fails leaves the sheet as it is and says so.
A save that writes at once, such as to the browser's storage, is done before the page goes; one
sent to a backend may not be, so a hidden page (`visibilitychange`) is a good moment to flush too.
A saver disposed of saves no more: a sheet made again over the same rows saves them with its own.

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

### Mapping the fields of an older draft

A draft keeps each field's label with its key, so a field the schema has dropped since is still
known by name. `mapDraft(draft, schema, { rename })` says what opening it would do to each field:
where its values go (its own field, the one it is renamed to, or nowhere), how many rows hold a
value, its first values, and how many of them a field of another type cannot read; with the new
fields that open empty and the rows that lose a value. `suggestRenames(draft, schema)` pairs each
field the schema lost with a new field of the same type whose name shares a word with its own
("Fiyat" and "Yeni fiyat", `price` and `newPrice`): a suggestion to show, never applied alone.

```vue
<TabulaDraftMapping v-model:rename="rename" :draft="draft" :schema="schema" />
<!-- rename starts as suggestRenames(draft, schema); then openDraft(draft, schema, { accept: true, rename }) -->
```

`TabulaDraftMapping` draws it: each field the schema lost, with its type, key and first values,
and a list to map it to a new field or drop it, saying how many values move or how many rows lose
one; the fields whose type changed, with how many values the new type cannot read; the new
fields; and the ones unchanged in a line. The host puts it in a window with the buttons to open
the draft or let it go, and keeps the draft untouched until then: the example saves nothing while
the window is open, and saves the draft under the new schema once it opens.

## Workbooks and sheet tabs

Several sheets of one module can be kept together, as a spreadsheet keeps its tabs: each with its
own rows, template, issues and results. A `Workbook` holds them in the order their tabs stand,
each with its name, its template's id, its draft, and what the application keeps with it, such as
the counts its tab shows while it is closed; and which one is open. It is plain JSON, kept where
drafts are.

```ts
let workbook = createWorkbook({ id, module: "product.price_update", sheet: { name: "Fiyat listesi" } })

workbook = addSheet(workbook, { name: "Mart kampanyası", template: "march" }).workbook // opened
workbook = withSheet(workbook, "sheet-1", { draft: createDraft({ … }), meta: { errors: 3 } })
workbook = moveSheet(workbook, "sheet-2", 0) // first; the open one stays open
workbook = removeSheet(workbook, "sheet-2") // never the last one
workbook = readWorkbook(JSON.parse(stored)) // a draft of one sheet reads as a workbook of it
```

Each sheet's session takes the sheet's id as its `sheetId`, so its requests say which sheet they
are about and an issue for another sheet is passed over. A check and a run are about one sheet.

Several sheets sent one after another can disagree: two price lists both changing a product, the
one sent last winning unseen. `sharedRecords` finds the records more than one sheet holds a row
of, by the field that names them, and the fields their rows differ in; a run leaves a row out with
`process({ leaveOut })` until the user says which sheet's goes.

```ts
sharedRecords(
  [
    { sheetId: "sheet-1", schema, store: march, rows: planned },
    { sheetId: "sheet-2", schema, store: april }
  ],
  { key: "productId", settings: VALUE_SETTINGS.tr }
)
// [{ key: "id:9", label: "Ürün 000009", rows: [{ sheetId, rowId, values }, …], differs: ["newPrice"] }]
```

```vue
<TabulaSheetTabs
  v-model:active="open"
  :tabs="tabs"
  @add="add"
  @rename="rename"
  @duplicate="copy"
  @remove="remove"
  @move="move"
/>
<!-- tabs: [{ id: "sheet-1", name: "Fiyat listesi", errors: 3, changed: true }, { id: "sheet-2", name: "Mart", done: true }] -->
```

`TabulaSheetTabs` draws them under the sheet, as a spreadsheet does: the open one marked, each with
its errors counted or a tick once processed, a small dot before the name of one with changes not
yet applied (`changed`), and + to add one. A double click or F2 renames a tab
in place, Escape leaving it as it was; a right click, or the menu key, opens its menu: rename,
duplicate, move left or right, delete, the last one never deleted. A tab is dragged to another
place, a line showing where it lands and Escape putting it back, or moved with Ctrl+Shift and an
arrow; `move(id, to)` says where, counted among the others. Arrows move between the tabs and Enter
opens one. It only says what the user asked for; the host keeps the workbook and does it. The example keeps
the open sheet live and the others as drafts in the workbook: opening a tab saves the one left,
with the counts its tab shows, and opens the other from its draft, with its template. Its
"Tüm sayfaları uygula" checks every sheet, the closed ones made from their drafts in the
background, shows what each would send and asks about a product two of them differ on, then sends
them in tab order, a sheet with an error held back.

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
| draw columns its way: alignment, decimals, for everyone | change a value, or what is sent                |

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
  "view": {
    "columns": { "hidden": ["sku"], "pinned": ["productId"], "formats": { "currency": { "align": "center" } } },
    "columnWidths": {},
    "filters": {},
    "sort": null
  }
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
- **The view is where the sheet starts; its formats are always there.** The columns, widths,
  filters and sort of `view` are where a user starts who has no view of their own, and theirs
  replace them. Its `columns.formats` lie under every user's own formats whatever view is open (see
  [How cells look](#how-cells-look)).
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
3. The tag publishes. The Publish workflow (`.github/workflows/publish.yml`) builds and tests the
   packages, checks them as published, and publishes them, core first: each packed by pnpm, which
   alone turns `workspace:^` into the version, and sent by npm through
   [trusted publishing](https://docs.npmjs.com/trusted-publishers). GitHub gives the job a
   short-lived identity in place of a token, and npm adds provenance. A version already on npm is
   passed over; for a tag pushed before the workflow was there, run it by hand ("Run workflow")
   with the tag. `corepack pnpm publish-packages --tag vX.Y.Z --dry-run` shows what would go out
   and sends nothing.

Once, on npmjs.com, each of the three packages names its trusted publisher under Settings: GitHub
Actions, the repository `nouxwell/tabula-grid`, the workflow `publish.yml` and the environment
`npm`. A required reviewer on the repository's `npm` environment makes every publish wait for an
approval.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 [IONSIS](https://ionsis.com).
