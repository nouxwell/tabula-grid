# Tabula Grid — Design & Styling Guide (READ THIS FIRST)

> **Before any design, UI or styling work in this repository, read this file.** Its rules hold for
> the packages, the playground and the examples, and for anyone building a screen with the grid.
>
> Tasarım işlerinin ana kaynağı bu dosyadır. Her arayüz isteğinde önce buraya bakılır; burada
> yazanı tekrar sormaya gerek yoktur.

The look was chosen on 2026-11-18 on the design canvas
[Tabula Grid tasarım önerileri](https://claude.ai/artifact/HiDLYFc6Q3kVq5QmzYT4Dp): layout A on a
desktop, C and D on a phone, the parts sheet for every state. Colours, type and the component
rules follow the IONSIS CRM (`crm-frontend/DESIGN.md`), so a screen made with the grid looks like
the rest of the CRM.

---

## Two kinds of code, two sets of rules

### 1. The packages (`packages/vue`, `packages/core`)

They are installed into any application, so they bring nothing of their own taste with them.

- **No UI kit, no CSS framework, no icon library.** No Naive UI, no Tailwind, no Iconify in a
  package. Plain elements, styled in the component's own `<style>` block.
- **Colours only from `packages/vue/src/theme.css`.** A component uses `--tabula-*` variables and
  nothing else; a new colour is a new variable there, worked out from the root ones with
  `color-mix()` so it follows when an application changes the accent. A hex in a component's CSS
  is a bug (shadows are the one exception).
- **Class names start with `tabula-`** and stay stable: hosts style them and the browser tests
  read them. Change one only with the tests and the changelog.
- **Accessible as drawn.** Real `<button>`s and `<input>`s with labels; text at 4.5:1 (the accent
  carries words only as `--tabula-accent-text`); 44px touch targets wherever a phone is meant.
- **Words in both languages**, in `messages.ts` (`tr` and `en`, the same keys).

### 2. Applications and examples (`examples/nuxt`, the CRM)

- **Naive UI only through `App*` atoms** in `app/components/atoms/`: `AppButton`, never
  `<n-button>`, on any screen. A component the set lacks is wrapped as a new `App*` atom first
  (Naive UI's props and slots pass through), then used. One change to an atom changes every screen.
- **Tailwind utilities for layout and text**, colours from the palette's tokens (`bg-surface`,
  `text-muted`, `border-divider`, `text-primary-text`…). No hex in a component, no bespoke class
  names; a `<style>` block only where a utility cannot say it (an atom's transition).
- **One palette file** (`app/theme/palette.ts`) makes Naive UI's theme, the CSS variables behind
  Tailwind's colours and the grid's `--tabula-*` colours. Change a colour there, nowhere else.
- **Mobile first**, checked at 375px and 1440px. No sideways page scroll; wide content scrolls
  inside its own box.

---

## Colours

The CRM's design tokens (`figma-tokens.json`). The grid's defaults are the same values.

| Token            | Light                | Dark                       | Grid variable                |
| ---------------- | -------------------- | -------------------------- | ---------------------------- |
| Page             | `#f5f7f9`            | `#14161a`                  | —                            |
| Surface          | `#ffffff`            | `#26282d`                  | `--tabula-bg`                |
| Second surface   | `#fafbfc`            | `#1d1f25`                  | `--tabula-bg-alt`            |
| Text             | `#000000`            | `#ffffff`                  | `--tabula-fg`                |
| Second text      | `#495465`            | `#acb5be`                  | `--tabula-muted`             |
| Primary (accent) | `#00b27b`            | `#00e19b`                  | `--tabula-accent`            |
| Primary as text  | `#00835a`            | `#00e19b`                  | `--tabula-accent-text`       |
| Error            | `#ff0156`            | `#ff0156`                  | `--tabula-error`             |
| Warning          | `#ffb600`            | `#ffb600`                  | `--tabula-warning`           |
| Success          | `#00b27b`            | `#00e19b`                  | `--tabula-success`           |
| Info             | `#6267ff`            | `#6267ff`                  | `--tabula-info`              |
| Divider          | `rgba(0, 0, 0, 0.1)` | `rgba(255, 255, 255, 0.1)` | `--tabula-line` (worked out) |

- **The green that carries words is a step darker on light.** `#00b27b` on white reads at 2.9:1,
  under the 4.5:1 text needs, so buttons' and links' words use `#00835a` (4.8:1). Borders, the
  selection, fills and the logo keep `#00b27b`. On dark, a green button's words are dark
  (`#04140e`): white on that green does not read.
- **Signal colours as text** are mixed towards the text colour (`--tabula-issues-error`,
  `--tabula-issues-warning`): amber and red stay readable on either background.
- **A number coloured by its sign** (`"tone": "sign"` in the schema): a rise in
  `--tabula-positive` with its plus, a fall in `--tabula-negative`.
- **Radius** 6px (`--tabula-radius`), 3px for small parts (`--tabula-radius-small`).
- **Type**: the page's font (`"Helvetica Neue", "Segoe UI", system-ui, sans-serif`); Lexend for
  page titles; a monospace for cell addresses. 15px body, 13px in the grid. The CRM's token says
  `'Helvatica Neue'`, a typo that matches no font; use `Helvetica Neue`.

---

## The layout chosen

### Desktop (768px and wider) — design A

1. **Top bar**: logo, where the page is (Ürünler / Toplu işlemler), theme switch, language select
   with flags.
2. **Page header**: title, "Taslak" tag (its tooltip says nothing is written before the changes
   are applied), the row count (counting up), the save status, then Taslağı kaydet · Kontrol et ·
   **Değişiklikleri uygula** (primary). While an error stands it is held back, its tooltip and the
   foot of the issues saying "Uygulamadan önce N hatayı düzeltin."
3. **Toolbar**: undo and redo (icon buttons with tooltips), İçe aktar ▾, Dışa aktar ▾, Sütunlar,
   the template ▾, **Kurallar** (with no template chosen, what is written there is saved as a new template, named
   in a small window), the view ▾,
   then the bulk edits on what is selected: Yüzde uygula and Tutar ekle (each a small window with
   the amount), Yuvarla ▾ (to 0,05, whole, whole up or down, or tens), and Satırları sil (Ctrl+−).
   Under the toolbar, "Tüm satırlar" and "Değişenler" with their counts, and the search on the
   right.
   - **The rules drawer** (design E, 560px, on the right) has no mask: the sheet stays in view and in
     reach while a rule is written. Each rule is a card with its sentence and how many rows it
     catches now; one at a time opens as a form (field, what it must be, against what, Ne zaman,
     Hata or Uyarı, its own words). The count follows every pick and keystroke, and "Satırları
     göster" narrows the sheet to those rows until the form closes. Nothing is kept before
     "Şablonu kaydet", which spins until the server answers.
   - **Its second tab, Hesaplanan sütunlar** (design G): the template's own columns, a formula or a
     helper each. The formula is written with the fields' labels; "[" lists the fields, a letter
     the functions, Enter or Tab puts one in, and above the field the call's arguments show with
     the one being written in bold and what the function does. Under it, the values on the first
     rows and how many rows fail, as it is typed. A column kept shows in the sheet at once, marked
     as not saved in the footer; Vazgeç and closing the drawer put the sheet back as saved.
4. **Formula bar** (`TabulaFormulaBar`): address and value of the active cell; a formula by the
   fields' names, each in the colour its column takes in the sheet while the cell is active.
5. **The sheet** (`TabulaGrid`, with column letters, and the user's changed cells marked in the top
   left corner in the info colour) and, on its right, **the issues** (`TabulaIssues`, 340px, each
   with the cell's address, "D8", and the product). A right click opens the grid's menu: cut,
   copy, paste, clear, fill, add and take out rows, the page's Yüzde uygula, Tutar ekle and
   Yuvarla ▸, filter by the value and sort, each with its keys on the right.
6. **Sheet tabs** (`TabulaSheetTabs`, design R) on the left of the bottom bar: the open one white
   with the accent under it, each with its errors in red or a tick, + to add one; a double click
   renames, a right click opens rename, duplicate and delete. Then the **status bar**
   (`TabulaStatusBar`): rows and issues, the selection, its sum and average.

### Phone (under 768px) — designs C and D

1. **App bar**: logo, theme switch, ⋯ (language, with flags).
2. Title, "Taslak", save status.
3. **Icon toolbar**, every button 44px, scrolling sideways when it must.
4. Formula bar.
5. The sheet, rows 40px high.
6. **Issues bar** (`TabulaIssues variant="sheet"`): the counts; it opens the issues as a sheet
   from the bottom, with "Yeniden kontrol et"; choosing an issue closes it and goes to the cell.
7. **Action bar** at the bottom: Taslağı kaydet · Kontrol et · Uygula, Uygula disabled while an
   error stands. The search takes the whole width under the row filter.

### The parts, as decided

| #   | Part                                                | Where       | State              |
| --- | --------------------------------------------------- | ----------- | ------------------ |
| 1   | Issues in a side panel                              | package     | done               |
| 2   | Issues in a bottom panel with tabs, and run history | package     | not chosen         |
| 3   | Issues as a sheet on a phone                        | package     | done               |
| 4   | Formula bar                                         | package     | done               |
| 5   | Column letters over the headers                     | package     | not chosen         |
| 6   | Colour by sign                                      | package     | done               |
| 7   | A mark by a row's number                            | package     | done               |
| 8   | Who found an issue (browser or server)              | package     | done               |
| 9   | Search in the sheet                                 | package     | not chosen         |
| 10  | Filter and sort in the header                       | package     | done (phase two)   |
| 11  | Fill handle                                         | package     | done (phase two)   |
| 12  | Status bar with sum and average                     | package     | done               |
| 13  | Sheet tabs                                          | package     | not chosen (large) |
| 14  | Zoom                                                | package     | not chosen         |
| 15  | Save status                                         | application | done               |
| 16  | Top bar                                             | application | done               |
| 17  | Toolbar with import and export menus                | application | done               |
| 18  | Phone layout                                        | application | done               |
| 19  | Darker green for words                              | both        | done               |
| 20  | Rules in a drawer beside the sheet (E)              | application | done (phase two)   |
| 21  | Rules in a centred modal (F)                        | application | not chosen         |
| 22  | Live count of the rows a rule catches               | application | done (phase two)   |
| 23  | A rule's own words, Turkish and English             | both        | done (phase two)   |
| 24  | Field limits tab in the rules drawer                | application | not chosen (later) |
| 25  | Comparison with a worked-out value                  | package     | not chosen         |
| 26  | Computed columns tab in the rules drawer (G)        | application | done (phase two)   |
| 27  | Formula completion: fields and functions            | both        | done (phase two)   |
| 28  | A function's help and its arguments, as written     | both        | done (phase two)   |
| 29  | Live preview of a formula                           | application | done (phase two)   |
| 30  | A formula typed into one cell with "="              | package     | not chosen         |
| 31  | A preview before a run, in a window (H)             | both        | done (phase two)   |
| 32  | The old values in the sheet's own cells (I)         | package     | not chosen         |
| 33  | The check says what each row would do (`plan`)      | package     | done (phase two)   |
| 34  | Choosing a row in the preview goes to it            | both        | done (phase two)   |
| 35  | Rows that would not change are not sent             | package     | not chosen         |
| 36  | Changed cells marked, and a "Değişenler" filter     | both        | done (phase two)   |
| 37  | Bulk percentage, amount and rounding                | both        | done (phase two)   |
| 38  | Searching the sheet                                 | both        | done (phase two)   |
| 39  | Column letters over the headers                     | package     | done (phase two)   |
| 40  | Selecting and taking rows out                       | both        | done (phase two)   |
| 41  | The cell's address and the row's name in issues     | package     | done (phase two)   |
| 42  | The run held back while errors stand, with why      | application | done (phase two)   |
| 43  | "Değişiklikleri uygula" in place of "İşle"          | application | done (phase two)   |
| 44  | The issue panel opened and closed from the bar      | application | not chosen         |
| 45  | Fixing a cell in the issue panel                    | package     | not chosen         |
| 46  | The issues as a table in a bottom panel, with tabs  | package     | not chosen         |
| 47  | Workflow steps over the sheet                       | application | not chosen         |
| 48  | Type marks in cells (⌄, calendar, switch)           | package     | not chosen         |
| 49  | A window mapping an older draft's fields (J)        | both        | done (phase two)   |
| 50  | A warning strip, the mapping in a drawer (K)        | application | not chosen         |
| 51  | Renames suggested by type and name                  | package     | done (phase two)   |
| 52  | Each field's first values                           | package     | done (phase two)   |
| 53  | Values lost, and values the new type cannot read    | package     | done (phase two)   |
| 54  | Field labels kept in drafts                         | package     | done (phase two)   |
| 55  | The draft kept untouched until the user decides     | application | done (phase two)   |
| 56  | Renames declared by the schema (`renamedFrom`)      | package     | not chosen         |
| 57  | Addresses typed in a formula read as fields (L)     | both        | done (phase two)   |
| 58  | Column letters in the formula completion            | application | done (phase two)   |
| 59  | The formula bar shows formulas by the fields' names | package     | done (phase two)   |
| 60  | The columns a formula reads, coloured (Q)           | package     | done (phase two)   |
| 61  | References to one cell (`$D$8`)                     | package     | not chosen         |
| 62  | References to a column's total                      | package     | not chosen         |
| —   | A right-click menu, with the host's own items       | both        | done (phase two)   |
| 63  | Sheet tabs under the sheet, as in Excel (R)         | both        | done               |
| 64  | Sheet tabs at the top, as a browser's (S)           | application | not chosen         |
| 65  | Each tab a sheet of the same module                 | both        | done               |
| 66  | A tab of another module                             | both        | asked about        |
| 67  | Every tab in one draft (a workbook)                 | package     | done               |
| 68  | Checks and runs about the open sheet                | application | done               |
| 69  | "Apply all"                                         | application | asked about        |
| 70  | A tab's errors or tick on it                        | package     | done               |
| 71  | A tab's menu: rename, duplicate, delete             | package     | done               |
| 72  | Tabs reordered by dragging                          | package     | asked about        |
| 73  | Formulas reading another sheet                      | package     | asked about        |
| —   | Multi-select cells, ticked in a list                | package     | done (phase two)   |
| —   | Saved views (personal views)                        | both        | done (phase two)   |
| —   | Templates (the layer between schema and views)      | both        | done (phase two)   |

A part marked "not chosen" is not built without asking first.

---

## Components (`App*` atoms)

Every screen takes these; none uses the Naive UI component underneath directly.

- **`AppButton`**: `size="small"` by default, `size="large"` on a phone. A click whose handler
  returns a promise spins the button until it settles, and a second click meanwhile does nothing:
  give it the action's promise (an `async` function) and write no `loading` of your own. `icon`
  names an `AppIcon`; when it changes (sun ↔ moon) the new one turns in. An icon-only button has
  an `aria-label` and an `AppTooltip`, and is at least 44px on a phone (`min-h-11 min-w-11`).
- **`AppInput`**: every text field. Naive UI's props pass through; a refused value sets
  `status="error"` and says why under the field, in a `role="alert"` line.
- **`AppScrollbar`**: every scroll area of the application's own; Naive UI's thin bar, which
  turns the pointer into a hand. `x-scrollable` for one that scrolls sideways.
- **`AppSpin`**: the spinner of a part that waits for its data. It passes on only the slots it is
  given: Naive UI hides its own spinner behind an empty one.
- **`AppIcon`**: the one icon set, by name; a name it lacks is a type error. Stroke icons,
  1.8 wide.
- **`AppTooltip`**: every hint. It keeps itself on a phone's screen (capped to the screen less
  32px, slid sideways to 16px from each edge, arrow still on the trigger), so a call never carries
  a phone width or a phone placement. Long text goes in `AppFitText` with
  `:content-style="FIT_TOOLTIP_STYLE"`; short labels need neither. Never a raw `n-tooltip`.
- **`AppModal`**: one shape. A card at most `width` wide (680px by default) and never wider than
  the screen less 32px, never taller than the screen less 48px, centred; header and footer fixed.
  Its body goes in **`AppModalScrollWrapper`**, which scrolls inside the card with its bar in the
  card's padding, clear of the fields.
- **`AppDrawer`** + **`AppDrawerContent`**: the drawer is as wide as it asks (420px) and never
  wider than the screen; the content brings the header with its close button, a body that scrolls
  and a footer that stays.
- **`AppDropdown`**: a menu that drops from a button, opened by a click (a finger, a mouse and the
  keyboard alike). Options may carry an `icon`.
- **`AppSelect`**; **`LocaleSelect`** for the language: Türkçe and English, each with its flag
  (`AppFlag`, drawn inline, so it is there with the page).
- **`AppNumberAnimation`**: a number that counts to its new value, 300ms, thousands separated in
  the locale given.
- **`AppTag`**, **`AppSwitch`**, **`AppCard`**, **`AppCollapse`** + **`AppCollapseItem`**.

---

## Loading

As the CRM's loading standard has it:

1. **A part that waits shows that it waits, alone.** The grid's place shows `AppSpin` and what it
   waits for ("Tablo hazırlanıyor…") until its rows are in; the page around it is already there
   and works. Nothing covers the whole page for one part.
2. **An action spins its own button only.** Saving, checking, sending, reading a file: the button
   pressed spins (`AppButton` does it by itself for a promise; `:loading` for work started
   elsewhere, such as `phase === "checking"`). The page is not covered and its fields are not
   wrapped in a spinner; what must not be touched meanwhile is `:disabled`.
3. **A failure says so where it happened, with a way on.** Rows that could not be fetched leave
   "Satırlar yüklenemedi." and a "Yeniden dene" button in the grid's place, never a spinner that
   turns forever. A flag that opens a waiting state is closed in `finally`.

---

## Scroll bars

As the CRM draws them: **a thin rounded thumb on a clear track**, 5px, in the text colour at 20%
(30% under the pointer), **that turns the pointer into a hand** and can be dragged; never the
browser's own bar with its arrows. A browser draws its own bar with the arrow whatever the page
asks, so ours hide it and draw the thumb themselves, as Naive UI's `n-scrollbar` does. Wheel, keys
and touch scroll the area as the browser scrolls it.

- **In the packages**, every scroll area carries `tabula-scroll` from `theme.css`, which hides the
  browser's bar, and has a `ScrollThumbs` beside it in the same positioned parent, which draws
  ours over its edges: the sheet, the filter's list of values, the editor's suggestions, the issue
  list. A new one does both; `tabula-scroll` alone leaves an area with no bar at all.
  `--tabula-scrollbar`, `--tabula-scrollbar-hover` and `--tabula-scrollbar-size` change them.
- **In an application**, a scroll area of its own is an `AppScrollbar` (`x-scrollable` for one that
  scrolls sideways), as the CRM's. Areas Naive UI scrolls (`AppDrawer`, `AppModal`) draw their own
  already. `scrollbar-thin` in `main.css` is only for a scroll area that cannot be wrapped: it is
  thin, but under it the pointer stays an arrow.
- **No `scrollbar-width` or `scrollbar-color` utilities, and no `::-webkit-scrollbar` rules in a
  component.** In Chromium the standard pair turns the thin bar off and brings the thick one back.
- **A bar never runs against content.** It is drawn over the area's edge, so the area keeps room
  there: the sheet scrolls 10px past its last row and column, and a list inside a padded panel
  reaches into the padding with a negative margin and gives the same room back as padding, so the
  bar runs in the panel's padding and the content ends where the rest of the panel does.

---

## Motion

- **Everything that changes state moves softly**, 150–300ms, `ease-out` or `ease-in-out`; nothing
  snaps. Named transitions: `fade` (200ms), `fade-up` (250ms, 8px), `icon-swap` (inside
  `AppButton`).
- **Everything that opens and closes animates**: drawers, modals, dropdowns and collapses do so
  through Naive UI; a `v-if` that swaps one thing for another sits in a `<Transition>` (the grid
  fading in for "Tablo hazırlanıyor…", the save status changing).
- **Numbers count** with `AppNumberAnimation` rather than jump.
- **`prefers-reduced-motion: reduce`** turns every transition off. A new transition does the
  same.
- No keyframe animations of our own.

---

## Things that bite

- **Naive UI's styles are not in a CSS layer; Tailwind's utilities are.** A display utility on a
  Naive UI component (`class="hidden md:block"` on an `AppSelect`, `md:hidden` on an `AppButton`)
  loses to Naive UI's own `display`. Put such utilities on a plain wrapper element.
- **Naive UI's config provider renders an element**: give it `h-full`, or a page cannot fill the
  window.
- **Server rendering**: Naive UI's styles are gathered by `@css-render/vue3-ssr` and written into
  the head by `app/plugins/naive-ui.server.ts`. The `nuxtjs-naive-ui` module (1.0.2) hands them to
  `ssrContext.styles`, which Nuxt 4 no longer writes.
- **Ids in components** come from `useId()`, never a counter: a counter differs between the server
  and the browser.
- **Tailwind 4 has a `scrollbar-thin` utility of its own** (`scrollbar-width: thin`), which in
  Chromium would bring the thick bar back. The application's `scrollbar-thin` in `main.css` sits
  outside Tailwind's layers so it wins, and resets it.
- **A browser's own scroll bar ignores `cursor`.** Neither `::-webkit-scrollbar-thumb` nor the
  area itself can turn the pointer into a hand over it; only a thumb drawn as an element can, which
  is why the packages have `ScrollThumbs` and the application `AppScrollbar`.
- **The grid is drawn in the browser only.** Its rows are fetched by the browser
  (`useFetch(…, { server: false })`); in the page's payload they would be sent twice.

---

## Pre-flight checklist

- [ ] Packages: no UI kit, no Tailwind, colours only from `theme.css`, classes `tabula-*`.
- [ ] Applications: every Naive UI component through an `App*` atom; a missing one wrapped first.
- [ ] No hex in a component; colours from the palette or `--tabula-*`.
- [ ] Words in the accent colour use the darker step; text at 4.5:1 in light and dark.
- [ ] Checked at 375px and 1440px, light and dark; 44px targets on a phone; no sideways page scroll.
- [ ] Every hint is an `AppTooltip`; every modal the `AppModal` shape; every drawer
      `AppDrawer` + `AppDrawerContent`.
- [ ] What opens, closes or swaps animates; reduced motion turns it off.
- [ ] No browser scroll bar: `tabula-scroll` + `ScrollThumbs` in a package, `AppScrollbar` in an
      application; the pointer turns into a hand over every thumb.
- [ ] Every action's button spins while it runs (its click returns the promise); a waiting part
      spins alone; a failure says so with a way to try again.
- [ ] A part marked "not chosen" above was asked about before it was built.
