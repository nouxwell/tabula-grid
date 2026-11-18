# @nouxwell/tabula-nuxt

The Nuxt module of [Tabula Grid](https://github.com/nouxwell/tabula-grid), an Excel-like workspace
for preparing, validating and processing bulk data in ERP and CRM screens.

```bash
npm install @nouxwell/tabula-core @nouxwell/tabula-nuxt
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@nouxwell/tabula-nuxt"],
  tabula: { prefix: "" } // "App" registers AppTabulaGrid, AppTabulaIssues and the rest
})
```

`<TabulaGrid>`, `<TabulaIssues>`, `<TabulaFormulaBar>` and `<TabulaStatusBar>` from
[@nouxwell/tabula-vue](https://www.npmjs.com/package/@nouxwell/tabula-vue) are then available in
every page, with their stylesheet. They are drawn in the browser only: the grid measures text and
reads the clipboard, and a server has neither. The schema, the rows and the checks come from
[@nouxwell/tabula-core](https://www.npmjs.com/package/@nouxwell/tabula-core). Nuxt 4 or later.

Everything is explained in the [repository's README](https://github.com/nouxwell/tabula-grid#readme);
what each version changed is in its [changelog](https://github.com/nouxwell/tabula-grid/blob/main/CHANGELOG.md).

## License

MIT
