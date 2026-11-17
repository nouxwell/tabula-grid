# Render spike

One question, answered before any real code was written: **should the grid be drawn by our own
renderer, or should it sit on an existing open-source engine?**

The same sheet was built twice — once with a small renderer of our own, once with
[RevoGrid](https://github.com/revolist/revogrid) 4.31.5 (MIT) through its Vue 3 wrapper — and both
were measured in a real browser. Nothing in this folder is imported by the packages. It is a
throwaway, kept for the numbers and for the method.

**Verdict: our own renderer.** The engine showed no decisive advantage, which was the bar it had to
clear. The reasoning is at the end; the numbers come first.

## Running it

```bash
corepack pnpm --filter spike-render measure   # the timings below; writes results.json
corepack pnpm --filter spike-render check     # the user actions below
corepack pnpm --filter spike-render dev       # then open /own.html?demo or /engine.html?demo
```

Both scripts drive the Microsoft Edge that is already installed, headless. Nothing is downloaded.

## What was built

|                  | Own renderer                                                | Engine                            |
| ---------------- | ----------------------------------------------------------- | --------------------------------- |
| Code             | [`src/own/OwnGrid.vue`](src/own/OwnGrid.vue), one component | RevoGrid, configured in ~40 lines |
| Drawing          | Vue template over a window of rows and columns              | Its own virtual DOM (Stencil)     |
| Scrolling        | The browser's own scroll container                          | Its own scrollbars and viewport   |
| Data             | Plain arrays, kept out of Vue's reactivity                  | One object per row                |
| Selection, range | Mouse drag, Shift+arrows                                    | Built in                          |
| Editing          | One shared input, type to replace, F2, Enter, Tab, Esc      | Built in                          |
| Clipboard        | Copy and paste of tab-separated blocks                      | Built in                          |
| Cell states      | Read-only columns, error cells                              | `readonly`, `cellProperties`      |

The sheet is the price-update scenario: product, SKU, current price, new price, change, currency,
date, note, then filler columns. One cell in a hundred is drawn as an error. Both pages get exactly
the same rows from a seeded generator ([`src/data.ts`](src/data.ts)).

## Timings

Median of three runs per case. Edge 157, headless, 1440 × 900, on an Intel Core i5-10400T
(6 cores, 12 threads, 2.0 GHz) with 32 GB of memory. "4× slower" is the browser's own CPU
throttle. Run-to-run differences of up to a third were seen on the same case, so only the larger
gaps below mean anything.

**As the machine is**

| Sheet       | Page   | First paint | Scroll down: late frames | Main thread per frame | Jump  | Memory |
| ----------- | ------ | ----------- | ------------------------ | --------------------- | ----- | ------ |
| 10,000 × 12 | own    | 69 ms       | 0 of 300                 | 8.2 ms                | 29 ms | 0.6 MB |
|             | engine | 255 ms      | 4 of 300                 | 10.1 ms               | 33 ms | 1.8 MB |
| 50,000 × 10 | own    | 67 ms       | 0 of 300                 | 8.3 ms                | 25 ms | 0.6 MB |
|             | engine | 379 ms      | 1 of 300                 | 9.3 ms                | 27 ms | 2.2 MB |
| 5,000 × 60  | own    | 61 ms       | 0 of 300                 | 7.2 ms                | 29 ms | 0.6 MB |
|             | engine | 234 ms      | 0 of 300                 | 8.2 ms                | 23 ms | 1.8 MB |

Scrolling right across the 60-column sheet, neither page had a late frame in 200. The engine did it
in 3.6 ms of main-thread time a frame, ours in 6.9 ms.

**4× slower**

| Sheet       | Page   | First paint | Scroll down: typical / 95th / worst frame | Late frames | Jump   |
| ----------- | ------ | ----------- | ----------------------------------------- | ----------- | ------ |
| 10,000 × 12 | own    | 483 ms      | 33 / 83 / 150 ms                          | 280 of 300  | 173 ms |
|             | engine | 1,368 ms    | 33 / 150 / 267 ms                         | 177 of 300  | 198 ms |
| 50,000 × 10 | own    | 309 ms      | 33 / 67 / 133 ms                          | 252 of 300  | 136 ms |
|             | engine | 1,193 ms    | 33 / 100 / 183 ms                         | 158 of 300  | 167 ms |
| 5,000 × 60  | own    | 434 ms      | 33 / 67 / 100 ms                          | 282 of 300  | 202 ms |
|             | engine | 1,154 ms    | 50 / 100 / 217 ms                         | 158 of 300  | 268 ms |

Neither page holds sixty frames a second here. Ours settles at a steady thirty with shorter worst
frames; the engine gets more frames in on time, and its worst are about twice as long.

**What the browser downloads** (Vue's runtime included in both): own 78 kB, 30 kB compressed, in
3 files; engine 410 kB, 132 kB compressed, in 12 files.

How the numbers are taken:

- **First paint** is the time from mounting until the first row's text is in the page, plus one
  frame.
- **Scroll down** moves 120 px on every frame for 300 frames — four rows a frame, a fast drag of
  the scrollbar. A frame is late when it takes more than 25 ms.
- **Main thread per frame** is the browser's own task-time counter over that run, divided by the
  frames. It is what separates two pages that both hold sixty frames a second.
- **Jump** sets the scroll position to twenty places far apart and gives the main-thread time per
  jump: nothing on screen can be reused.
- **Memory** is the heap after mounting minus the heap before, both after a forced collection. The
  sheet itself is in neither figure.
- After every scroll the script checks that the row which should now be on screen really is. A
  page that did not follow the scroll would otherwise post excellent numbers.

## User actions

The same six actions on both pages, with a real keyboard, mouse and clipboard
([`check.ts`](check.ts)). Both pages pass all six, in two runs each:

- type over a cell, Enter commits
- paste a 2 × 2 block
- Shift+arrows select a range, copy gives tab-separated text
- a read-only column refuses typing
- three keys and Enter sent with no gap at all, ten cells in a row
- Page Down scrolls the view

One difference showed up on the way. With no pause at all between one action and the next — paste
straight after Enter, copy straight after Shift+arrow — the engine dropped the second action, and
our renderer did not. With 150 ms between actions, which is less than a person needs, the engine is
fine. It applies input asynchronously; ours applies it in the key handler.

## What the engine is, and is not

From its own README (4.31.5):

- **In the MIT core:** virtual rows and columns, keyboard navigation, copy and paste, range
  selection and range autofill, pinned rows and columns, column resize and reorder, sorting,
  filtering, grouping, custom cell templates and editors, an accessibility layer, RTL.
- **In the paid Pro tier:** undo and redo history, cell and input validation, the formula engine
  and formula bar, multi-range selection, smart autofill, the dropdown editor, context menus,
  tooltips, Excel import and export.
- **Attribution:** the core shows one. The property that hides it is documented as "please only
  hide the attribution if you are subscribed to Pro version".

## Why our own renderer

1. **No decisive gap in speed.** At the machine's own speed the two are level on scrolling; ours is
   three to five times quicker to first paint and a quarter of the download. Under the throttle
   both fall short, in different ways.
2. **What we need most is not in the free core.** Undo and redo, validation shown on cells, and
   formulas are the centre of this product, and in the engine they are Pro features. We would write
   them ourselves either way, on top of someone else's event and rendering model.
3. **Attribution.** A public MIT library that embeds the core either ships the engine's attribution
   in every consumer's screen or asks each consumer to buy Pro.
4. **Control over input.** Bulk data entry is the use case. A renderer of our own handles a key in
   the handler that receives it.

## What this did not show

- The engine does far more today than the prototype: pinned columns, column resize, row headers,
  autofill, accessibility roles, RTL. Each of those is work we are choosing to do.
- The prototype is one component with fixed row heights, written to be measured, not kept.
- Headless Edge on one machine, three runs a case. No Firefox, no Safari, no touch.
- Programmatic scrolling. A wheel or a trackpad scrolls on the compositor, ahead of the main
  thread; whether either page shows blank rows while catching up was not measured.
- Formula recalculation, validation of large pastes and real edits at 50,000 rows are untouched.
- The 4× figures say both would need work on slow machines. How far our renderer can be pushed
  there is not measured either.
