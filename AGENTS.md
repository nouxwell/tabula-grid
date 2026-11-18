# AGENTS.md

Rules for working in this repository, for any coding agent. `CLAUDE.md` holds the same text; change
both together.

> Bu dosyada yazanlar her işte geçerlidir; tekrar sorulmaz, tekrar söyletilmez.

## Read first

- **Any UI, styling or design work: read [DESIGN.md](DESIGN.md) first.** It has the palette, the
  layout chosen for desktop and phone, the `App*` atoms, motion, and what was decided against.
- What changed and when: [CHANGELOG.md](CHANGELOG.md). How it all fits: [README.md](README.md).

## Working with the user

- **The user writes Turkish; answer in Turkish.** Code, comments, commit messages and the docs in
  the repository are English.
- **Every commit and every push needs the user's yes, each time.** Finish the work, run the
  checks, report, then ask: "Commit edip GitHub'a göndereyim mi?". An earlier yes does not carry
  over to the next commit.
- **npm publishing is the user's.** Prepare a release (versions, changelog, tag on approval); never
  run `pnpm publish` or `npm publish`.
- **Other repositories are read only** unless the user says otherwise for that task:
  `crm-frontend` and `crm-backend` (a CRM trial needs the user's approval first), and the PHP
  library `nouxwell/tabula` in WSL (`\\wsl.localhost\ubuntu\home\hbalin\tabula`; write to it only
  when approved, and with WSL's git, since Git Bash's git turns its files into CRLF).
- **Never enter credentials or sign in** for the user.
- The user moves the work along with "sıradaki adıma geç": after a step, say what is next and
  wait.

## Project overview

An Excel-like workspace for preparing, validating and processing bulk data in ERP and CRM screens,
for Vue and Nuxt: the browser side of the PHP library `nouxwell/tabula`. Public, MIT, released as
three packages versioned together.

| Path            | What it is                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/core` | `@nouxwell/tabula-core`: schema, rows, values, checks, formulas, session, drafts, CSV. No Vue, no DOM. |
| `packages/vue`  | `@nouxwell/tabula-vue`: `TabulaGrid`, `TabulaIssues`, `TabulaFormulaBar`, `TabulaStatusBar`.           |
| `packages/nuxt` | `@nouxwell/tabula-nuxt`: registers the components, client side only.                                   |
| `playground`    | A Vite app on the packages' sources, and the browser tests.                                            |
| `examples/nuxt` | Nuxt 4 + Naive UI + Tailwind 4, set up as the CRM, on the packages' builds; its SSR test.              |
| `conformance`   | Cases both this repository and `nouxwell/tabula` must pass alike.                                      |
| `scripts`       | `check-packages.mjs`: the packages packed, installed and used as published.                            |
| `spikes`        | Experiments kept for their numbers.                                                                    |

## Commands

pnpm runs through Corepack: prefix every command with `corepack` (and
`COREPACK_ENABLE_DOWNLOAD_PROMPT=0` in scripts).

```bash
corepack pnpm install
corepack pnpm -r build                           # packages first, then the example
corepack pnpm -r typecheck
corepack pnpm -r test                            # core and vue units, the example's SSR test
corepack pnpm lint
corepack pnpm format:check
corepack pnpm check:packages                     # after a build
corepack pnpm --filter playground test:browser   # 79+ tests in Edge
corepack pnpm --filter playground dev
corepack pnpm --filter example-nuxt dev
php conformance/php/check.php /path/to/tabula    # the PHP side of the shared cases
```

Done means all of these pass. CI runs them on Node 22, 24 and 26.

## Code rules

- **Prettier**: tabs, no semicolons, 120 columns; Markdown and YAML with two spaces.
- **Comments say why**, in whole sentences, for someone reading the code cold. No ticket talk.
- **Packages import relative files with `.js`** (`from "./rows.js"`): Node's module resolution
  needs it, and `check:packages` checks the types under it. A `.vue` component's declarations are
  fixed by `packages/vue/scripts/fix-declarations.mjs`.
- **The core has no DOM and no Vue**; it compiles against `platform.d.ts` alone.
- **No BigInt literals** (`10n`): Nuxt's server build warns on them. Use `BigInt(10)`.
- **Values are canonical in the store and on the wire**: decimal text with a point, ISO dates,
  booleans, an option's value, a lookup's id. What reads text into a value is in `values/`;
  what is sent goes through `canonicalValue`.
- **Reading, checking and writing values must agree with `nouxwell/tabula`.** A change there adds
  cases to `conformance/values.json` and passes on both sides.
- **Waiting is shown where it happens** (DESIGN.md, "Loading"): an action's button spins by itself
  when its click returns the promise, a part waiting for data shows `AppSpin` alone, a failure
  offers to try again. No spinner over a whole page, none that turns forever.
- **Rows shown are a `RowView` with named filters**: the grid's column filters are `"columns"`,
  the issue panel's switch `"issues"`; take one away with `clear(name)`, never `clear()`, which
  takes every filter and the sort.
- **The grid exposes what other parts read** (`cell`, `selected`, `rows`, `issueSummary`,
  `goToAddress`, `writeCell`, `formatValue`); a new bar or panel reads these rather than reaching
  into the grid.
- **Every visible behaviour has a browser test** in `playground/test/grid.test.ts`; class names
  the tests read stay stable.
- **`\uXXXX` written through an editor tool lands as the character itself**, invisible ones too.
  After writing such text, scan for U+FEFF, U+00A0, U+200B and friends and escape them.
- **pnpm's build scripts stay off** (`allowBuilds` in `pnpm-workspace.yaml`); a dependency that
  needs one is a decision for the user.

## Releases

On `main`, one commit: the version in the three `package.json` files and in `version` in
`packages/core/src/index.ts`, the changelog's Unreleased turned into the version's heading with
its link at the bottom. Then an annotated tag `vX.Y.Z`, pushed with the commit, on the user's yes.
Below 1.0 a minor version is where a breaking change lands. Publishing (`corepack pnpm -r
publish`) is the user's.
