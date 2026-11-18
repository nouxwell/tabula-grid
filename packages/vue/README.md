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
  issues, undoes with Ctrl+Z, pins and hides columns, and picks lookups from a searched list.
- **`TabulaIssues`** lists the sheet's issues with counts, Previous and Next, and filters the sheet
  to the rows that have them.

Light, dark and system themes; every colour is a `--tabula-*` CSS variable. Turkish and English
text. Vue 3.5 or later.

Everything is explained in the [repository's README](https://github.com/nouxwell/tabula-grid#readme);
what each version changed is in its [changelog](https://github.com/nouxwell/tabula-grid/blob/main/CHANGELOG.md).
For Nuxt, see [@nouxwell/tabula-nuxt](https://www.npmjs.com/package/@nouxwell/tabula-nuxt).

## License

MIT
