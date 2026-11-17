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
