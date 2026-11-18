# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org/); while
the packages are below 1.0 a **minor** bump is where a breaking change lands.

The three packages are versioned together.

## [Unreleased]

### Added

- **`TabulaFormulaBar`**: the active cell's address and value above the sheet. An address typed and
  Entered goes there; a value typed is written as typing it into the cell writes it, into the cell
  it was typed for even when a click has moved the selection on. A formula column shows its formula,
  read only.
- **`TabulaStatusBar`**: the rows and issues counted, the cells selected, and the sum and average of
  their numbers, worked out exactly by the core's new **`summarizeCells`**. `start` and `end` slots
  take what the application adds.
- **`TabulaGrid` exposes** what the bars read: `cell`, `selected`, `rows`, `issueSummary`,
  `goToAddress`, `writeCell` and `formatValue`. **`columnName`** and **`parseAddress`** turn a
  column's place into its letters and back, as the columns stand on screen.
- **Colours by sign.** A numeric field takes `"tone": "sign"` in the schema: a rise is shown in
  green with its plus, a fall in red. `FieldTone` is its type.
- **A row's number carries a mark** for the worst issue on any of its cells, hidden columns too.
- **`TabulaIssues` says who found each issue**, the browser or the server, and has a `sheet`
  variant for phones: a bar with the counts that opens the list from the bottom of the screen,
  closes on choosing an issue, opens with `v-model:open`, and takes buttons in an `actions` slot.
- **`examples/nuxt`**, the grid in a Nuxt 4 application set up as the IONSIS CRM is: Naive UI used
  only through `App*` atoms, Tailwind 4 and TypeScript, one palette for Naive UI, Tailwind and the
  grid, and server routes that answer in the grid's contract. It follows the chosen designs: a
  side panel, the formula bar and the status bar on a desktop; icon buttons a finger wide, the
  issues as a sheet and the actions at the bottom on a phone. Drafts are kept in the browser, CSV
  goes in and out, and the rows are fetched by the browser rather than sent in the page. It is drawn
  on the server; its test starts the built server and checks the page it sends, on CI with the rest.
  Its atoms follow the CRM's: a tooltip that stays on a phone's screen, one modal shape with a
  scrolling body, a drawer and its content, numbers that count, a button whose icon turns, and the
  language select with flags; what changes state fades, and reduced motion turns it off.
- **Sorting and filtering in the header.** A column's menu sorts it either way and opens its
  filter: the values it holds with their counts, a search, and a range for numbers and dates.
  `v-model:filters` and `v-model:sort` keep them; a sorted header shows its arrow, a filtered one a
  funnel, and `aria-sort` says the same to a screen reader. The values listed are those the other
  columns' filters keep.
- **The core's filters**: `rowsMatching`, `rowOrder`, `compareValues`, `distinctValues`,
  `filterKey` and `hasRange`, with the types `ColumnCondition`, `ColumnFilters`, `ColumnSort` and
  `DistinctValue`. Values are told apart by what they are (12.5 and "12.50" are one), text sorts in
  the language's order with numbers read as numbers, and cells not of the column's type and empty
  ones stay last whichever way a column sorts.
- **`RowView` takes named filters and a sort**: `filter(fn, name)` and `clear(name)`, so the
  grid's column filters (`"columns"`) and a page's own, such as the issue panel's `"issues"`, stand
  side by side; `sort(order)` with a `RowOrder`, and `sorted` and `arranged` beside `filtered`.
  While sorted, a row shown again goes to its place in the order and rows added go at the end.
- **The example shows that it waits**, as the CRM does: the grid's place spins with "Tablo
  hazırlanıyor…" until the rows are in, and says "Satırlar yüklenemedi." with a "Yeniden dene"
  button if they could not be fetched. `AppButton` spins by itself while the promise its click
  returns runs, and a second click meanwhile does nothing; `AppSpin` is the spinner atom.
- **`DESIGN.md`, `CLAUDE.md` and `AGENTS.md`**: the palette, the layouts chosen for desktop and
  phone, the parts decided for and against, the component and motion rules, and how work is done
  here, written down once.

### Changed

- **`RowView.clear()` without a name takes every filter and the sort away**; `clear(name)` takes
  one filter. `filtered` now means a filter stands; `arranged` is true for a filter or a sort.
- **`TabulaIssues` draws issues as cards**: where, what, who found it and "go to cell", tinted by
  severity, with the counts as chips. The class names a page or a test reads stay as they were.
- **`@nouxwell/tabula-nuxt` registers the bars** too: `TabulaFormulaBar` and `TabulaStatusBar`.
- **Text in the accent colour is a step darker** on light and lighter on dark
  (`--tabula-accent-text`), so links and buttons pass 4.5:1; `--tabula-positive` and
  `--tabula-negative` colour a column by sign.

- **IONSIS's palette is the default**, light and dark. The colours an application changes are a
  few, on the class `tabula-theme` that the grid and the issue panel both carry: `--tabula-accent`,
  `--tabula-bg`, `--tabula-bg-alt`, `--tabula-fg`, `--tabula-muted`, `--tabula-error`,
  `--tabula-warning`, `--tabula-success`, `--tabula-radius`, `--tabula-radius-small`,
  `--tabula-font-family` and `--tabula-font-size`. Lines, the selection and the tints of a cell with
  an issue are worked out from them, and each can still be set on its own; the panel's
  `--tabula-issues-*` colours follow the grid's. The grid takes the page's font unless told
  otherwise.

### Fixed

- **No BigInt literals in the core.** A build that aims at an older JavaScript, as Nuxt's server
  build does, warned that `10n` and the like may not run. The formulas' decimals now make their
  constants with `BigInt()`; nothing else changed.

## [0.1.0] — 2026-11-18

The first release: a sheet that is drawn, typed into, pasted into and checked as the user works,
taken to a backend through the application's own adapters, and kept as a draft.

### Added

- **Three packages on npm**: `@nouxwell/tabula-core`, `@nouxwell/tabula-vue` and
  `@nouxwell/tabula-nuxt`, versioned together, each with its readme and licence. Their types work
  under the module resolution Vite and Nuxt use and under Node's (`NodeNext`). The script
  `check:packages` packs them, installs the tarballs into an empty project and uses them from
  there, on CI as well.
- **The repository skeleton.** A pnpm workspace holding the three packages, a playground that runs
  them from source, and the build, type-check, test and lint set-up.
- **`ModuleSchema`** reads and checks the module schema a backend sends. The field types are
  nouxwell/tabula's (`enum` arrives as `options`) plus `percent` and `lookup`. The rules are `min`
  and `max` as decimal text, `minLength`, `maxLength` and `unique`. Every problem is reported at
  once with its place, and an unknown property or rule is refused rather than skipped.
- **`RowStore`** holds a sheet's rows under ids that never change, with transactions that count a
  revision, record what they changed in a form that can be undone, and take everything back when
  they throw.
- **`Selection`** keeps the active cell, the selected range and the corner Shift moves, the way
  Excel does, including Ctrl and an arrow.
- **`parseTsv` and `toTsv`** read and write clipboard text as spreadsheets do, quoted cells with
  line breaks included. A line break inside a cell is always `\n`, though the Windows clipboard
  turns it into `\r\n` on the way through.
- **Column sizing**: `resolveColumnSizing`, `autoColumnWidth`, `clampColumnWidth` and
  `headerDisplayText`, with a 100 to 320 pixel automatic width, a separate 1,000 pixel limit for
  dragging, and headers cut at 100 characters.
- **`TabulaGrid`** in `@nouxwell/tabula-vue` draws only what
  is on screen, moves and edits as Excel does, copies and pastes blocks, sizes columns from their
  headers and lets the user drag or fit them, and comes in light, dark and system themes. Text that
  arrives without a key press, from an input method or dictation, starts an edit like typing does.
- **`@nouxwell/tabula-nuxt`** registers `TabulaGrid`, drawn in the browser only.
- **Browser tests** that build the playground and drive the grid with a real keyboard, mouse and
  clipboard, on CI as well.
- **Reading and writing values**: `readInput`, `formatCell`, `editText` and `valueProblem`, with
  `VALUE_SETTINGS.tr`, `VALUE_SETTINGS.en` and `defineValueSettings`. Numbers are held as decimal
  text and dates as ISO text. Text is read as nouxwell/tabula reads an imported file, rule for
  rule; text that cannot be read stays in the cell with a problem coded as `RowErrorCode` codes it.
- **A date field's own `pattern`** in the module schema, as `Field::pattern()` has on the PHP side.
- **`conformance/values.json`**, run by both this package and nouxwell/tabula
  (`conformance/php/check.php`), so the two sides read and write every value alike. From
  nouxwell/tabula 0.9.0 that includes dates: neither side rolls 31.02.2026 into March or reads
  05/03/2026 as 3 May.
- **`TabulaGrid`** shows values the sheet's way, reads what is typed and pasted, and marks a cell
  holding text it could not read. Its `value-settings` prop takes any `ValueSettings`.
- **`SheetValidator`** checks a sheet against the schema's rules (`required`, `min`, `max`,
  `minLength`, `maxLength`, `unique`, and each value's type) and keeps the result current, checking
  only what a change touched. Issues are bound to row ids and field keys and carry a code and
  params. A repeated value points at the first ten other rows holding it and counts the rest, so
  one paste over 50,000 rows stays cheap.
- **`TabulaIssues`** lists a sheet's issues with counts, Previous and Next, and emits the one
  chosen. `TabulaGrid` marks errors and warnings on their cells with Turkish or English tooltips
  (`locale`), takes a shared `validator`, and goes to a cell with `goTo(rowId, field)`.
- **`UndoHistory`** makes each transaction on a store one step to take back and make again, 100
  by default. A step taken back is a change of its own with the origin `"undo"` (`"redo"` the
  other way), and rows come back under the ids they had. A listener writing in answer to an undo
  ends the way forward rather than tangling the order.
- **`RowStore.revert` and `replay`** take a change back and make it again as one new change.
  Removed rows go back to their places in one pass, however scattered. A sheet that has moved on
  is refused with the new error code `conflict`, and nothing is written.
- **`TabulaGrid`** undoes with Ctrl+Z and redoes with Ctrl+Y or Ctrl+Shift+Z, selecting and
  scrolling to what changed, whoever asked for the step. It keeps a history of its own or takes
  one as `history`, and exposes `undo()` and `redo()`.
- **`SheetSession`** checks a sheet with the backend and sends it to be processed, through the
  adapters an application gives it (`SheetAdapters`: `preflight`, `process`, `processStatus`,
  `cancelProcess`). The backend's issues are merged with the local ones; an issue on a cell changed
  since its answer was asked for is marked stale, not fixed. Rows that went through are locked and
  not sent again, `removeSucceeded()` leaves the rest. A run with no answer goes `unknown` and is
  sent again under the same idempotency key, or asked about, never run twice. A `pending` run is
  followed to its end, and a failed request is kept apart from the issues of the data.
- **The contract**: `SheetRequest`, `ProcessRequest`, `CheckResponse`, `ProcessResponse` and
  `IssueInput`, with `readCheckResponse` and `readProcessResponse` to check an answer against it.
  Only fields with `submit` are sent, a lookup as its id.
- **Issues** carry `blocking` and `stale`, and the summary counts stale ones apart. `IssueSet` is
  what the grid and the panel read: a `SheetValidator`, or a session's `issues`.
- **`TabulaGrid` and `TabulaIssues`** take `issues`, a validator's or a session's. The grid takes
  `results`: each row's number shows its result, an issue about a whole row is shown there, and a
  processed row cannot be changed. A stale issue has a grey corner, and the panel lists it apart.
- New error code `invalid_response`, for an answer that is not in the contract's shape.
- **Drafts**: `createDraft`, `readDraft` and `openDraft`. A draft holds the rows under their ids,
  each row's result, a run with no answer, the column widths and the schema version. `openDraft`
  sends a draft of another schema version back for review, with the fields added, removed,
  retyped and renamed, and opens it only with `accept`. `SheetSession` takes what a draft kept as
  `restore` and gives it with `persisted()`: a processed row opens locked, a run with no answer
  opens `unknown`.
- **`LookupResolver`** matches the names typed or pasted into lookup cells to records, through the
  application's `resolve` adapter: all the names of a paste in one request per lookup, in batches
  of 200, with answers kept for a minute. A name that means exactly one record becomes it; others
  stay as typed. It also serves the editor's `search`.
- **A lookup holding text is an error**, `not_matched`: only a record has an id to send.
- **`TabulaGrid` lists a lookup's records under the editor** as the user types (`lookups`), and
  an options field's choices, Alt+Down for all of them. Arrows, Enter, Tab, Escape and the mouse
  work the list; Enter picks on its own only the one record that fits, and a disabled record is
  never picked.
- **`UndoHistory`** keeps a lookup's matches in the step of the edit they came from (`joins`), and
  `RowStore.revert` and `replay` take several changes as one.
- **`RowView`**, the rows on screen: all of them, or those a filter keeps (`rowsWithIssues`,
  `rowsWithResult`, or any predicate), applied at a moment and again on `refresh()`. Rows added
  while it filters are shown, and `show(rowId)` brings back one it left out. `IssueSet` gains
  `hasIssues(rowId)`.
- **`TabulaGrid`** takes a `view`: row numbers stay the sheet's, a paste writes only into the rows
  shown, and `goTo` shows a row the filter left out. **`TabulaIssues`** has a switch for only the
  rows with issues, bound with `v-model:only-issue-rows`, and a Refresh button (`refresh-rows`).
- **CSV.** `parseCsv` and `toCsv` read and write CSV as spreadsheets do, the delimiter told from
  the first line (`detectDelimiter`), and `decodeText` reads a file as UTF-8 or else as
  Windows-1254. `importTable` turns a table into rows, matching headers to fields by label or key
  and reading each cell as a paste does, and says which columns matched, which were passed over and
  which required fields are missing. `exportTable` writes rows the sheet's way, guarding text that
  a spreadsheet would run as a formula; `csvDelimiterFor` picks `;` where the comma is the decimal
  mark.
- **Formulas.** A schema field can have a `formula` over the other fields of its row, by key in
  brackets, in a spreadsheet's language with English function names. `parseFormula` turns it into
  a tree that is worked out, never run as code, in decimals rather than floats. Sixteen functions
  are built in, an application can add its own, and what cannot be worked out is an error value
  (`#DIV/0!`, `#VALUE!`, `#NAME?`, `#NUM!`) shown in the cell and reported as `formula_error`. A
  formula that does not parse, reads an unknown field or goes round in a circle refuses the schema;
  a formula field is never editable. New error code `invalid_formula`.
- **`FormulaEngine`** keeps formula fields worked out inside the change that called for them, and
  `applyFormulas` fills rows before a store exists. **`RowStore.derive`** is how: work that belongs
  to every change, written into it, so an edit and what follows from it are one revision, one
  notice and one undo step. `TabulaGrid` marks a formula column with ƒx and shows its formula in
  the header's tooltip; an undo selects what the user changed, not what was worked out from it.
- **Hiding and pinning columns.** `ColumnLayout` (`order`, `hidden`, `pinned`, by field key) with
  `arrangeColumns` and `withColumn`; keys the schema no longer has are passed over. `TabulaGrid`
  takes it as `v-model:columns`, and a header's menu pins, hides and shows hidden columns again.
  Pinned columns come first and are held in place with CSS `sticky`, so they do not lag behind a
  sideways scroll; the selection and the active cell are drawn with them. A paste passes over a
  hidden column, and going to an issue in one shows it. A draft keeps the layout, following
  renamed fields.
- **`DraftSaver`** saves a sheet a moment after the user stops changing it, and when asked, one
  save at a time, under an id made in the browser so a save repeated is the same draft. A failed
  save leaves the sheet as it is and says so. New error code `invalid_draft`.
- **Rows a server checks the same way.** A pre-flight check or a run sends each value in the form
  the grid writes it. Text a host loaded, such as "1.234,56" in a money column, goes as
  "1234.56", and the grid holds it to its rules and to uniqueness as that value; "12,5" in an
  integer column goes as 12.5, for the server to refuse for the same reason. `SheetValidator`
  gains a `settings` getter. The `checks` cases in `conformance/values.json` are whole rows in
  which `SheetValidator` and nouxwell/tabula's `Tabula::checkRows()` must find the same issues.

[Unreleased]: https://github.com/nouxwell/tabula-grid/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nouxwell/tabula-grid/releases/tag/v0.1.0
