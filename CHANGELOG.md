# Changelog

Notable changes, newest first. Versions follow [semantic versioning](https://semver.org/); while
the packages are below 1.0 a **minor** bump is where a breaking change lands.

The three packages are versioned together.

## [Unreleased]

### Added

- **The repository skeleton.** A pnpm workspace holding `@nouxwell/tabula-core`,
  `@nouxwell/tabula-vue` and `@nouxwell/tabula-nuxt`, a playground that runs them from source, and
  the build, type-check, test and lint set-up.
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
- **`TabulaGrid`** in `@nouxwell/tabula-vue`, replacing the empty `TabulaWorkspace`: draws only what
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
- **`TabulaGrid` and `TabulaIssues`** take `issues` instead of `validator`. The grid takes
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
- **A lookup holding text is now an error**, `not_matched`: only a record has an id to send.
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
- **`DraftSaver`** saves a sheet a moment after the user stops changing it, and when asked, one
  save at a time, under an id made in the browser so a save repeated is the same draft. A failed
  save leaves the sheet as it is and says so. New error code `invalid_draft`.
