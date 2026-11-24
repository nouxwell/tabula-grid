# @nouxwell/tabula-vue

The Vue 3 components of [Tabula Grid](https://github.com/nouxwell/tabula-grid), an Excel-like
workspace for preparing, validating and processing bulk data in ERP and CRM screens.

```bash
npm install @nouxwell/tabula-core @nouxwell/tabula-vue
```

```vue
<script setup lang="ts">
import { ModuleSchema, RowStore, SheetValidator, VALUE_SETTINGS } from "@nouxwell/tabula-core"
import { TabulaGrid, TabulaIssues } from "@nouxwell/tabula-vue"
import "@nouxwell/tabula-vue/style.css"

const schema = ModuleSchema.from(json)
const store = new RowStore({ rows })
const validator = new SheetValidator(schema, store, VALUE_SETTINGS.tr)
</script>

<template>
  <div style="height: 480px">
    <TabulaGrid :schema="schema" :store="store" :issues="validator" theme="auto" />
  </div>
  <TabulaIssues :issues="validator" :schema="schema" :store="store" />
</template>
```

- **`TabulaGrid`** draws only what is on screen, so 50,000 rows draw like 50. It moves, edits,
  copies and pastes as Excel does, reads what is typed the sheet's way, marks the cells with
  issues and the ones the user changed, undoes with Ctrl+Z, pins and hides columns, picks lookups
  from a searched list, raises numbers by a percentage, adds and takes out rows, and opens a
  right-click menu of its own, to which the host adds items.
- **`TabulaIssues`** lists the sheet's issues as cards, with counts, Previous and Next, the cell's
  address and the row's name, says whether the browser or the server found each, and filters the sheet to the rows that have them. On a
  phone it is a bar that opens the list from the bottom of the screen (`variant="sheet"`);
  `closable` gives the panel a close button that emits `close`.
- **`TabulaFormulaBar`** shows the active cell's address and value, goes to an address typed into
  it, and writes a value typed there, as a spreadsheet's formula bar. A formula shows by the fields'
  names, each in the colour its column takes in the sheet.
- **`TabulaStatusBar`** counts the rows and issues and sums and averages the numbers selected.
- **`TabulaFind`** finds and replaces over the sheet, as a strip: in the cells selected, a column
  or the whole sheet; the grid tints what it finds, and "Replace all" is one Ctrl+Z.
- **`TabulaSheetTabs`** draws a workbook's sheets as tabs under the sheet, with their errors
  counted, and renames, duplicates, reorders, deletes and adds them.
- **`TabulaDraftMapping`** maps the fields of a draft saved under an older schema before it opens:
  where each field the schema lost goes, its first values, and what would be lost or unreadable.
- **`TabulaPreview`** shows what a run would do before it is sent: new records, updates from the
  old value to the new, and the rows that would not change, as the backend's check said.

Neutral greys with one green and one red, light, dark (layered greys) and following the system; a
few `--tabula-*` CSS variables change it and the rest follow. Turkish and English text. Vue 3.5 or later.

Everything is explained in the [repository's README](https://github.com/nouxwell/tabula-grid#readme);
what each version changed is in its [changelog](https://github.com/nouxwell/tabula-grid/blob/main/CHANGELOG.md).
For Nuxt, see [@nouxwell/tabula-nuxt](https://www.npmjs.com/package/@nouxwell/tabula-nuxt).

## License

MIT
