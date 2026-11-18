# @nouxwell/tabula-core

The framework-free core of [Tabula Grid](https://github.com/nouxwell/tabula-grid), an Excel-like
workspace for preparing, validating and processing bulk data in ERP and CRM screens. No Vue and no
DOM: it runs in a browser, in a worker and in Node alike.

```bash
npm install @nouxwell/tabula-core
```

- **`ModuleSchema`** reads the schema a backend sends and refuses what it does not know.
- **`RowStore`** holds the rows under ids that never change, every change a transaction with a
  revision; **`UndoHistory`** takes changes back.
- **`readInput`** and **`formatCell`** read and write values the way
  [nouxwell/tabula](https://github.com/nouxwell/tabula) reads an imported file: "1.234,56",
  "31.12.2026" and "Evet" with Turkish settings. A cell holds decimal text, ISO dates and booleans.
- **`SheetValidator`** checks the schema's rules as the user types; **`SheetSession`** takes the
  sheet to the backend's pre-flight check and run, through adapters the application gives it.
- **`LookupResolver`**, **`FormulaEngine`**, **`DraftSaver`**, CSV import and export, and the
  clipboard's TSV.

```ts
import { ModuleSchema, RowStore, SheetValidator, VALUE_SETTINGS } from "@nouxwell/tabula-core"

const schema = ModuleSchema.from(await (await fetch("/api/modules/product.price_update")).json())
const store = new RowStore({ rows: [{ values: { newPrice: "389.90" } }] })
const validator = new SheetValidator(schema, store, VALUE_SETTINGS.tr)

validator.summary() // { errors, warnings, stale, rows }
```

The grid that draws it is [@nouxwell/tabula-vue](https://www.npmjs.com/package/@nouxwell/tabula-vue).
Everything is explained in the [repository's README](https://github.com/nouxwell/tabula-grid#readme);
what each version changed is in its [changelog](https://github.com/nouxwell/tabula-grid/blob/main/CHANGELOG.md).

## License

MIT
