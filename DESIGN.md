# Tabula Grid — Design & Styling Guide (READ THIS FIRST)

> **Before any design, UI or styling work in this repository, read this file.** Its rules hold for
> the packages, the playground and the examples, and for anyone building a screen with the grid.
>
> Tasarım işlerinin ana kaynağı bu dosyadır. Her arayüz isteğinde önce buraya bakılır; burada
> yazanı tekrar sormaya gerek yoktur.

The look is drawn on the design canvas
[Tabula Grid tasarım önerileri](https://claude.ai/artifact/HiDLYFc6Q3kVq5QmzYT4Dp). It was chosen on
2026-11-18 (layout A on a desktop, C and D on a phone) and redrawn on 2026-11-24 (items 138–160,
boards AK–AP): one bar, one workspace, colour only where it says something. The component rules
follow the IONSIS CRM (`crm-frontend/DESIGN.md`); a host such as the CRM sets its own colours
through the `--tabula-*` variables.

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

Chosen on 2026-11-24 (canvas items 152 and 153, board AP): colour is kept for what it says. Neutral
greys for the page and the sheet; one green for the main action, the selection and the open tab;
one red for errors; a dark orange for warnings. No lavender, no pink. The dark theme is layered
greys (page, surface, raised surface), not one near-black. The grid's defaults and the example's
palette (`examples/nuxt/app/theme/palette.ts`) are the same values.

| Token            | Light     | Dark      | Grid variable                          |
| ---------------- | --------- | --------- | -------------------------------------- |
| Page             | `#f4f5f7` | `#0e1013` | —                                      |
| Surface          | `#ffffff` | `#16191e` | `--tabula-bg`                          |
| Second surface   | `#f9fafb` | `#1a1e24` | `--tabula-bg-alt`                      |
| Text             | `#101318` | `#e7e9ec` | `--tabula-fg`                          |
| Second text      | `#5b6573` | `#9aa3af` | `--tabula-muted`                       |
| Primary (accent) | `#00a06c` | `#22b57f` | `--tabula-accent`                      |
| Primary as text  | `#007a54` | `#3fcf95` | `--tabula-accent-text`                 |
| Error            | `#c4183c` | `#ff6b81` | `--tabula-error`                       |
| Warning          | `#d98a00` | `#f0b44c` | `--tabula-warning`                     |
| Info (changed)   | `#3b6fd8` | `#6ea0ff` | `--tabula-info`                        |
| Divider          | `#dde1e6` | `#2e333b` | `--tabula-head-line` (worked out)      |
| Read-only cell   | text 4%   | text 4%   | `--tabula-readonly-bg`, `-readonly-fg` |

- **The green that carries words is a step darker on light, lighter on dark.** Borders, the
  selection, fills and the logo keep the accent; buttons' and links' words take
  `--tabula-accent-text`. A primary button on dark has dark words (`#04140d`).
- **A cell no one types into is a neutral grey**, a record's filled cell too; a link in its
  column's header says a record fills it. **An error is one red**: a light tint, a corner and the
  row's number in red.
- **Signal colours as text** are mixed towards the text colour (`--tabula-issues-error`,
  `--tabula-issues-warning`): amber and red stay readable on either background.
- **A number coloured by its sign** (`"tone": "sign"` in the schema): a rise in
  `--tabula-positive` with its plus, a fall in `--tabula-negative`.
- **Radius** 6px (`--tabula-radius`), 3px for small parts (`--tabula-radius-small`); cards 8–10px.
- **Type**: the page's font (`"Helvetica Neue", "Segoe UI", system-ui, sans-serif`); Lexend for
  page titles. **No monospace anywhere**: cell addresses, column letters, keys and formulas take
  the page's font, with `tabular-nums` where digits line up. 15px body, 13px in the grid.

---

## The layout chosen

Redrawn on 2026-11-24 (canvas items 138–160, boards AK–AO): one bar, one workspace, more rows.

### Desktop (768px and wider) — designs AK and AL

1. **App bar** (56px), one row: logo, "Ürünler ›", the page's title, "Taslak" (its tooltip says
   nothing is written before the changes are applied, and that Ctrl+S saves the draft now), the save
   status; on the right the check's state as a chip (green "Sorun yok" or red "3 sorun", which opens
   and closes the issues), Kontrol et, **Değişiklikleri uygula** (primary; "Uygula" under 1280px),
   then the shortcuts, the theme and the language (a globe with "TR"). While an error stands Uygula
   is held back, its tooltip and the foot of the issues saying "Uygulamadan önce N hatayı
   düzeltin." Kaydet is in Dosya and on Ctrl+S: the draft saves itself.
2. **One card** under it, 16px from the page's edges, holding everything about the sheet:
   - **The tools in one row (46px), without edges**: undo, redo | Dosya ▾, Toplu düzenle ▾ |
     the format (bold, italic, text and fill colour, alignment, decimals, clear; under one Biçim ▾
     below 1400px) | the template ▾ and Kurallar; on the right the rows shown (Tümü, Değişenler,
     Renkli, with their counts), the search, Sütunlar and the views ▾. Groups are parted by a thin
     line. Below 1280px Dosya, Toplu düzenle and Kurallar go under ⋯; nothing scrolls sideways.
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
   - **The formula bar** (`TabulaFormulaBar`, 36px), a strip: the active cell's address and value;
     a formula by the fields' names, each in the colour its column takes in the sheet.
   - **The sheet** (`TabulaGrid`): each column's letter before its label in the header's one row,
     green in a selected column; a link after the label of a column a record fills; changed cells
     marked in the top left corner in the info colour; the totals row's choice as its own words
     ("Toplam ▾"). The sheet shows 21 rows at 1440×900. A right click opens the grid's menu: cut,
     copy, paste, clear, fill, add and take out rows, the page's Yüzde uygula, Tutar ekle and
     Yuvarla ▸, filter by the value and sort, each with its keys on the right.
   - **The issues** (`TabulaIssues`, 320px, 360px from 1280px) inside the card, beside the sheet,
     with the first issue and gone with the last; the chip or their × closes them until the next
     check. A plain list: a dot, "Satır 9 · Ürün", the cell's address, who found it, the product
     and the message, the whole row pressed to go to the cell; ↑ ↓ (F8, Shift+F8), filters for all,
     the errors and the warnings, and the switch "Yalnız sorunlu satırları göster". Under the list
     the reason Uygula waits, and "Hatalı satırları indir".
   - **The foot** (40px): the sheet tabs (`TabulaSheetTabs`, design R) on the left, the open one
     with the accent along its top; on the right rows and issues, the selection, its sum and average
     (`TabulaStatusBar`), and one menu for the row density and the zoom: "Normal · %100 ▾".

### Phone (under 768px) — designs AM, AN and AO

1. **App bar**: logo, the page's title with "Taslak · Kaydedildi 19:40" under it, and ⋯ (the
   theme, the language, Kaydet).
2. **One row of tools** (52px): undo, redo, Tümü / Değişenler, the search (opened under the row by
   the magnifier) and **Araçlar**.
3. **The sheet edge to edge**, no card: the formula bar as a strip, the sheet with 40px rows (12
   on the first screen; a column cut at the right says it scrolls), the totals, then the tabs with
   the row count just above the bottom bar.
4. **The bottom bar**: the check's state as a 48px button (a green tick, or the issues' count in
   red, which opens them), Kontrol et · Uygula; Uygula held back while an error stands.
5. **Araçlar** opens a short sheet from the bottom (AN): the selection ("D3:D9 · 7 hücre"), the
   format as eight tiles, the selected cells' work and the file's as large buttons two by two, and
   the sheet's settings as a list with their values (Sütunlar 9 / 10, Görünüm, Şablon, Kurallar,
   Bul ve değiştir).
6. **The issues** take the lower half of the screen (AO, `TabulaIssues variant="sheet"` with
   `:bar="false"` and `:modal="false"`): the page makes room above them, so a chosen issue's cell
   shows there while the list stays open; at their foot "Hatalıları indir" and "Yeniden kontrol".
7. No "Sorun yok" bar: the state is the bottom bar's button.

### The parts, as decided

| #   | Part                                                 | Where       | State              |
| --- | ---------------------------------------------------- | ----------- | ------------------ |
| 1   | Issues in a side panel                               | package     | done               |
| 2   | Issues in a bottom panel with tabs, and run history  | package     | not chosen         |
| 3   | Issues as a sheet on a phone                         | package     | done               |
| 4   | Formula bar                                          | package     | done               |
| 5   | Column letters over the headers                      | package     | not chosen         |
| 6   | Colour by sign                                       | package     | done               |
| 7   | A mark by a row's number                             | package     | done               |
| 8   | Who found an issue (browser or server)               | package     | done               |
| 9   | Search in the sheet                                  | package     | not chosen         |
| 10  | Filter and sort in the header                        | package     | done (phase two)   |
| 11  | Fill handle                                          | package     | done (phase two)   |
| 12  | Status bar with sum and average                      | package     | done               |
| 13  | Sheet tabs                                           | package     | not chosen (large) |
| 14  | Zoom                                                 | package     | not chosen         |
| 15  | Save status                                          | application | done               |
| 16  | Top bar                                              | application | done               |
| 17  | Toolbar with import and export menus                 | application | done               |
| 18  | Phone layout                                         | application | done               |
| 19  | Darker green for words                               | both        | done               |
| 20  | Rules in a drawer beside the sheet (E)               | application | done (phase two)   |
| 21  | Rules in a centred modal (F)                         | application | not chosen         |
| 22  | Live count of the rows a rule catches                | application | done (phase two)   |
| 23  | A rule's own words, Turkish and English              | both        | done (phase two)   |
| 24  | Field limits tab in the rules drawer                 | application | not chosen (later) |
| 25  | Comparison with a worked-out value                   | package     | not chosen         |
| 26  | Computed columns tab in the rules drawer (G)         | application | done (phase two)   |
| 27  | Formula completion: fields and functions             | both        | done (phase two)   |
| 28  | A function's help and its arguments, as written      | both        | done (phase two)   |
| 29  | Live preview of a formula                            | application | done (phase two)   |
| 30  | A formula typed into one cell with "="               | package     | not chosen         |
| 31  | A preview before a run, in a window (H)              | both        | done (phase two)   |
| 32  | The old values in the sheet's own cells (I)          | package     | not chosen         |
| 33  | The check says what each row would do (`plan`)       | package     | done (phase two)   |
| 34  | Choosing a row in the preview goes to it             | both        | done (phase two)   |
| 35  | Rows that would not change are not sent              | package     | not chosen         |
| 36  | Changed cells marked, and a "Değişenler" filter      | both        | done (phase two)   |
| 37  | Bulk percentage, amount and rounding                 | both        | done (phase two)   |
| 38  | Searching the sheet                                  | both        | done (phase two)   |
| 39  | Column letters over the headers                      | package     | done (phase two)   |
| 40  | Selecting and taking rows out                        | both        | done (phase two)   |
| 41  | The cell's address and the row's name in issues      | package     | done (phase two)   |
| 42  | The run held back while errors stand, with why       | application | done (phase two)   |
| 43  | "Değişiklikleri uygula" in place of "İşle"           | application | done (phase two)   |
| 44  | The issue panel opened and closed from the bar       | application | not chosen         |
| 45  | Fixing a cell in the issue panel                     | package     | not chosen         |
| 46  | The issues as a table in a bottom panel, with tabs   | package     | not chosen         |
| 47  | Workflow steps over the sheet                        | application | not chosen         |
| 48  | Type marks in cells (⌄, calendar, switch)            | package     | not chosen         |
| 49  | A window mapping an older draft's fields (J)         | both        | done (phase two)   |
| 50  | A warning strip, the mapping in a drawer (K)         | application | not chosen         |
| 51  | Renames suggested by type and name                   | package     | done (phase two)   |
| 52  | Each field's first values                            | package     | done (phase two)   |
| 53  | Values lost, and values the new type cannot read     | package     | done (phase two)   |
| 54  | Field labels kept in drafts                          | package     | done (phase two)   |
| 55  | The draft kept untouched until the user decides      | application | done (phase two)   |
| 56  | Renames declared by the schema (`renamedFrom`)       | package     | not chosen         |
| 57  | Addresses typed in a formula read as fields (L)      | both        | done (phase two)   |
| 58  | Column letters in the formula completion             | application | done (phase two)   |
| 59  | The formula bar shows formulas by the fields' names  | package     | done (phase two)   |
| 60  | The columns a formula reads, coloured (Q)            | package     | done (phase two)   |
| 61  | References to one cell (`$D$8`)                      | package     | not chosen         |
| 62  | References to a column's total                       | package     | not chosen         |
| —   | A right-click menu, with the host's own items        | both        | done (phase two)   |
| 63  | Sheet tabs under the sheet, as in Excel (R)          | both        | done               |
| 64  | Sheet tabs at the top, as a browser's (S)            | application | not chosen         |
| 65  | Each tab a sheet of the same module                  | both        | done               |
| 66  | A tab of another module                              | both        | asked about        |
| 67  | Every tab in one draft (a workbook)                  | package     | done               |
| 68  | Checks and runs about the open sheet                 | application | done               |
| 69  | "Apply all"                                          | application | asked about        |
| 70  | A tab's errors or tick on it                         | package     | done               |
| 71  | A tab's menu: rename, duplicate, delete              | package     | done               |
| 72  | Tabs reordered by dragging                           | package     | done               |
| 73  | Formulas reading another sheet                       | package     | asked about        |
| 74  | The toolbar in two rows by purpose (T)               | application | done               |
| 75  | Toplu düzenle: the bulk edits in one menu            | application | done               |
| 76  | A bar over the selection with the bulk edits (U)     | package     | not chosen         |
| 77  | Dosya: import and export in one menu                 | application | done               |
| 78  | The template joined with Kurallar                    | application | done               |
| 79  | Kaydet beside the save status                        | application | done               |
| 80  | The formula bar on top of the sheet's card           | application | done               |
| 81  | What does not fit goes under ⋯                       | application | done               |
| 82  | An icon-only toolbar in one row (V)                  | application | not chosen         |
| 83  | A phone's tools in a sheet from the bottom (W)       | application | done               |
| 84  | Toolbar and sheet in cards, on one edge (X)          | application | done               |
| 85  | The sheet the whole width without issues             | application | done               |
| 86  | The issues panel comes and goes with the issues (Y)  | application | done               |
| 87  | The issues switch with their count                   | both        | done               |
| 88  | The panel opening only after a check                 | application | not chosen         |
| 89  | Alignment: left, centre, right                       | package     | done               |
| 90  | Fill and text colour on cells (Z)                    | package     | done               |
| 91  | Bold and italic                                      | package     | done               |
| 92  | Clear the format                                     | package     | done               |
| 93  | Colour rules (AA)                                    | package     | done               |
| 94  | Decimals shown                                       | package     | done               |
| 95  | Zoom and row density (AB)                            | package     | done               |
| 96  | Font size and family per cell                        | package     | not chosen         |
| 97  | Wrapped text                                         | package     | not chosen         |
| 98  | Format painter                                       | package     | not chosen         |
| 99  | Borders and merged cells                             | package     | not chosen         |
| 100 | Columns stretched to the sheet (AB)                  | package     | done               |
| 101 | Grey K, L, M… columns                                | package     | not chosen         |
| 102 | A row for a new product at the bottom (AB)           | package     | done as 124        |
| 103 | A totals row (AB)                                    | package     | done               |
| 104 | Find and replace, Ctrl+H (AC)                        | package     | done               |
| 105 | A column fitted to its contents                      | package     | done (before)      |
| 106 | A shortcuts window                                   | application | done               |
| 107 | Notes on cells                                       | package     | not chosen         |
| 108 | Grouping and subtotals                               | package     | not chosen         |
| 109 | Excel (.xlsx) import and export                      | CRM         | with the CRM       |
| 110 | A template's formats under each user's own           | package     | done               |
| 111 | A Biçim tab in the rules drawer (AD)                 | application | done               |
| 112 | "Şablona kaydet" in the format group (AE)            | application | not chosen         |
| 113 | A user's formats move into the template saved        | application | done               |
| 114 | Formats saved as a new template                      | application | done               |
| 115 | The whole layout saved into the template             | application | not chosen         |
| 116 | The import window before anything goes in (AF)       | both        | done               |
| 117 | Columns suggested by name, word and values           | package     | done               |
| 118 | Where a header went, remembered                      | application | done               |
| 119 | Each column's first values and unreadable cells      | package     | done               |
| 120 | Rows of a file written into the rows they find       | package     | done               |
| 121 | A fixed value for a field the file lacks             | application | not chosen         |
| 122 | "Boş sayfa" from + (AG)                              | both        | done               |
| 123 | An empty sheet says how to fill it                   | application | done               |
| 124 | A row after the last that adds one (102)             | package     | done               |
| 125 | A row nobody filled is not checked or sent           | package     | done               |
| 126 | The rows with issues as a file (AH)                  | both        | done               |
| 127 | Warnings too, with who found each                    | application | done               |
| 128 | The issues file imported again, by SKU               | both        | done               |
| 129 | The rows with issues moved to a sheet of their own   | application | not chosen         |
| 130 | A record fills its row's fields (AI)                 | package     | done               |
| 131 | A product's code typed or pasted into Ürün           | application | done               |
| 132 | The list shows code and price, the typed part marked | both        | done               |
| 133 | Filled cells tinted, with a tooltip                  | package     | done               |
| 134 | A code matching nothing said plainly                 | package     | done               |
| 135 | A column of codes sent to the lookup in an import    | both        | done               |
| 136 | The SKU column typed into on new rows (AJ)           | package     | not chosen         |
| 137 | A server row's product kept as it is                 | package     | not chosen         |
| 138 | Title, draft and the run in one app bar (AK)         | application | done               |
| 139 | Tools, formula bar, sheet and tabs in one card       | application | done               |
| 140 | One toolbar row without edges                        | application | done               |
| 141 | The check's state as a chip by Uygula                | application | done               |
| 142 | A plainer foot: tabs, status, one size menu          | both        | done               |
| 143 | The language as a globe with "TR"                    | application | done               |
| 144 | Column letters in the header's row                   | package     | done               |
| 145 | Read-only and filled cells a neutral grey            | package     | done               |
| 146 | One red for an error; the row's number in red        | package     | done               |
| 147 | The totals row's choice as its own words             | package     | done               |
| 148 | The issues as a plain list (AL)                      | package     | done               |
| 149 | Arrows and Tümü / Hata / Uyarı filters               | package     | done               |
| 150 | No pink strip; the reason under the list             | application | done               |
| 151 | The issues inside the card, by the sheet             | application | done               |
| 152 | One palette (AP)                                     | both        | done               |
| 153 | A dark theme in layered greys                        | both        | done               |
| 154 | A phone's title bar with ⋯ (AM)                      | application | done               |
| 155 | A phone's one row of tools                           | application | done               |
| 156 | A phone's sheet edge to edge, 12 rows                | both        | done               |
| 157 | No "Sorun yok" bar on a phone                        | application | done               |
| 158 | A phone's tabs above the bottom bar                  | application | done               |
| 159 | A phone's short tools sheet (AN)                     | application | done               |
| 160 | A phone's issues over the lower half (AO)            | application | done               |
| 161 | The formula bar only while editing                   | both        | not chosen         |
| 162 | Column letters hidden                                | package     | not chosen         |
| —   | Multi-select cells, ticked in a list                 | package     | done (phase two)   |
| —   | Saved views (personal views)                         | both        | done (phase two)   |
| —   | Templates (the layer between schema and views)       | both        | done (phase two)   |

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
- [ ] No monospace font, in a package or an application.
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
