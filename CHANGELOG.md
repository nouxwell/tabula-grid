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
