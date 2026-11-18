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
  waits for its data; the page around it is never covered.
  The rules are in the repository's [DESIGN.md](../../DESIGN.md).
- **Server rendering.** The page, its Naive UI styles and the palette arrive drawn; the grid is
  drawn in the browser, where the sheet's parts are made ([app/utils/sheet.ts](app/utils/sheet.ts)).
  Light or dark comes from a cookie, so the server draws the mode the user chose.
- **A backend.** [server/api](server/api) answers in the grid's contract: the module schema, the
  rows, the pre-flight check, the run and the product lookups. A PHP backend writes the schema with
  nouxwell/tabula's `Tabula::gridSchema()` and checks rows with `Tabula::checkRows()`.

## Naive UI on the server

Naive UI's styles are gathered on the server by `@css-render/vue3-ssr` and written into the head by
[app/plugins/naive-ui.server.ts](app/plugins/naive-ui.server.ts). The `nuxtjs-naive-ui` module
(1.0.2) hands them to Nuxt as `ssrContext.styles`, which Nuxt 4 no longer writes into the page, so
with it a server-rendered page arrives without Naive UI's styles. An application that renders only
in the browser (`ssr: false`) never meets this.
