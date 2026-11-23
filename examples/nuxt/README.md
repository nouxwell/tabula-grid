# Tabula Grid in Nuxt

A bulk price update in a Nuxt 4 application set up as the IONSIS CRM is: Naive UI, Tailwind 4 and
TypeScript, drawn on the server. The grid comes in through `@nouxwell/tabula-nuxt`, from the
packages' builds, as it would from npm.

```bash
corepack pnpm -r build                          # the packages, then this example
corepack pnpm --filter example-nuxt dev         # http://localhost:3000
corepack pnpm --filter example-nuxt test        # the built server, as a browser first meets it
```

## What it shows

- **One palette.** [app/theme/palette.ts](app/theme/palette.ts) holds the CRM's colours, light and
  dark, once. Naive UI's theme, the CSS variables behind Tailwind's colours (`bg-surface`,
  `text-muted`…) and the grid's `--tabula-*` colours are all made from it.
- **Atoms.** Naive UI is used only through `App*` atoms ([app/components/atoms](app/components/atoms)),
  never directly: what every button shares is decided in one place. Naive UI's props and slots
  pass through. They follow the CRM's: `AppTooltip` keeps itself on a phone's screen,
  `AppModal` + `AppModalScrollWrapper` never run off it, `AppDrawer` + `AppDrawerContent`,
  `AppNumberAnimation`, `AppButton` with a turning icon, and the language select with flags.
  `AppButton` spins while the promise its click returns runs, and `AppSpin` shows a part that
  waits for its data; the page around it is never covered. `AppScrollbar` scrolls an area of the
  page's own under a thin bar the pointer turns into a hand over.
- **Templates.** The module schema is `controlled`, and the server sends one template,
  "Aralık zam listesi" ([server/utils/priceUpdate.ts](server/utils/priceUpdate.ts)). The toolbar's
  template menu puts it in the address; the sheet is made again with the same rows, under the
  schema as the template narrows it. Its row checks warn about a price cut and require an internal
  note for a price that starts before 1 December. The toolbar's **Kurallar** opens the rules
  drawer ([app/components/RulesDrawer.vue](app/components/RulesDrawer.vue)): the rules with the
  rows each catches now, a form to write one, and "Şablonu kaydet", which the server checks
  against the module schema before it keeps the template, on disk in `.data/templates` (the
  `templates` storage in nuxt.config.ts), so a restart loses none. With no
  template chosen, the drawer writes a new one: "Şablon olarak kaydet…" asks its name, and the
  server makes it from what was written. Its second
  tab, Hesaplanan sütunlar, writes the template's own columns: a formula field that completes
  fields and functions ([app/components/FormulaInput.vue](app/components/FormulaInput.vue)) and
  the values it gives on the first rows as it is typed.
- **Saved views.** The toolbar's view menu keeps the sheet as the user arranged it under a name,
  in the browser's storage ([app/utils/views.ts](app/utils/views.ts)); the page opens in the view
  chosen for it. An application keeps the same JSON on its server for each user.
  The rules are in the repository's [DESIGN.md](../../DESIGN.md).
- **Server rendering.** The page, its Naive UI styles and the palette arrive drawn; the grid is
  drawn in the browser, where the sheet's parts are made ([app/utils/sheet.ts](app/utils/sheet.ts)).
  Light or dark comes from a cookie, so the server draws the mode the user chose.
- **A preview before a run.** "Değişiklikleri uygula" checks the sheet when the last check no
  longer holds, is held back while errors stand, and otherwise opens "Uygulanacak değişiklikler"
  (`TabulaPreview` in an `AppModal`): how many rows make a new price line, change one or leave
  one as it is, and each row's fields from the old value to the new. Choosing a row goes to it;
  "N satırı uygula" sends the rows.
- **Sheets as tabs.** Under the sheet, "Fiyat listesi" and any other sheet: + adds one from the
  server's rows, a double click renames, a right click duplicates or deletes, a drag reorders,
  each with its errors counted. Each tab keeps its own rows and template; Kontrol et and Değişiklikleri uygula are about
  the open one. The whole workbook is kept in the browser's storage
  ([app/utils/workbook.ts](app/utils/workbook.ts)); a draft from before tabs opens as the first.
- **An older draft.** A draft saved under another schema opens "Taslak eski bir şemayla
  kaydedilmiş" (`TabulaDraftMapping` in an `AppModal` that only its buttons close): each field
  the schema lost, mapped to a new one (the likely one suggested) or dropped, with its first
  values and what would be lost. "Taslağı aç" opens the draft so mapped and saves it under the new
  schema; "Taslağı sil, sunucudan aç" lets it go. Nothing is saved while the window is open.
- **How cells look.** The toolbar's format group puts bold, italic, a text colour or a fill on the
  cells selected (Ctrl+B, Ctrl+I), aligns their columns and shows more or fewer decimals; the
  colours are kept with the draft and "Renkli" shows their rows. The rules drawer's Renkler tab
  writes colour rules into the template, and its Biçim tab takes the columns' alignment and
  decimals the user gave into it, for everyone who opens it ("Tablodaki biçimi al"); once saved,
  they are the template's, not the user's. Toplu düzenle or Ctrl+H opens find and replace; under the
  rows are their totals, and by the status the row density and the zoom. F1 lists the shortcuts.
- **One edge, two cards.** The toolbar is a card of two rows: what changes the data on top
  (Dosya, Toplu düzenle, the template with Kurallar, the issues switch), what is seen under it. The
  sheet is a card with the formula bar on top and the tabs under it, the whole width until an
  issue comes; then the issues panel comes in beside it, and goes with the last issue. On a narrower
  screen what does not fit goes under ⋯; a phone has Araçlar, a sheet of the tools.
- **Working on many rows.** "Yüzde uygula", "Tutar ekle" and "Yuvarla" change the numbers
  selected in one step, from Toplu düzenle or the grid's right-click menu; "Satırları sil" and Ctrl+− take rows out. Cells changed since the rows
  were loaded are marked, "Değişenler" shows only their rows, and the search finds a product, a
  code or a note as the cells show them.
- **A backend.** [server/api](server/api) answers in the grid's contract: the module schema, the
  rows, the pre-flight check, the run and the product lookups. A PHP backend writes the schema with
  nouxwell/tabula's `Tabula::gridSchema()` and checks rows with `Tabula::checkRows()`.
  Its price list lives in memory: the check says from it what each row would do, and a run writes
  to it. The sheet opens with three discontinued products, which the check refuses: pick another
  product for them and "Değişiklikleri uygula" opens the preview.

## Naive UI on the server

Naive UI's styles are gathered on the server by `@css-render/vue3-ssr` and written into the head by
[app/plugins/naive-ui.server.ts](app/plugins/naive-ui.server.ts). The `nuxtjs-naive-ui` module
(1.0.2) hands them to Nuxt as `ssrContext.styles`, which Nuxt 4 no longer writes into the page, so
with it a server-rendered page arrives without Naive UI's styles. An application that renders only
in the browser (`ssr: false`) never meets this.
