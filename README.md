# Tabula Grid

An Excel-like workspace for preparing, validating and processing bulk data in ERP and CRM screens,
for Vue and Nuxt. It is the browser side of [nouxwell/tabula](https://github.com/nouxwell/tabula),
the PHP library that defines a column once and uses that one definition to export, to build
templates and to import.

> **Status: early.** The core holds a sheet's schema, rows and selection; nothing draws them yet. No
> release has been made and none of the three packages is on npm; each is marked `private` until
> its first release.

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
```

With pnpm installed globally, drop the `corepack` in front. The recursive commands are spelled out
rather than wrapped in root scripts on purpose: a script that calls `pnpm` again only works where
`pnpm` is on the `PATH`, which under Corepack it is not.

## Versioning

The same rule as `nouxwell/tabula`: below 1.0, a **minor** bump is where a breaking change lands.
The three packages are versioned together, one `vX.Y.Z` tag per release.
[CHANGELOG.md](CHANGELOG.md) says what each release changed.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 [IONSIS](https://ionsis.com).
