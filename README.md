# Tabula Grid

An Excel-like workspace for preparing, validating and processing bulk data in ERP and CRM screens,
for Vue and Nuxt. It is the browser side of [nouxwell/tabula](https://github.com/nouxwell/tabula),
the PHP library that defines a column once and uses that one definition to export, to build
templates and to import.

> **Status: skeleton.** The packages build, and that is all they do. No release has been made and
> none of the three packages is on npm; each is marked `private` until its first release.

## Packages

| Package                 | What it is                                                          |
| ----------------------- | ------------------------------------------------------------------- |
| `@nouxwell/tabula-core` | The framework-free core. No Vue, no DOM.                            |
| `@nouxwell/tabula-vue`  | Vue 3 components built on the core.                                 |
| `@nouxwell/tabula-nuxt` | A thin Nuxt module that registers the components, client-side only. |

`playground/` is a small Vite app that runs the packages from source. It is not published.

`spikes/` holds throwaway experiments that settled a design question, kept for their numbers.
[spikes/render](spikes/render/README.md) is why the grid is drawn by a renderer of our own rather
than by an existing engine.

## Where the line is drawn

The packages never talk to a database and never choose an HTTP client. The application that embeds
them supplies the adapters for lookups, pre-flight checks, processing and drafts, and stays in
charge of authorisation, transactions and the final business rules. What the browser calculates is
never to be trusted by the backend.

## Development

Needs Node 22.13 or later (22, 24 or 26+) and pnpm, run through Corepack, which ships with Node:

```bash
corepack pnpm install
corepack pnpm -r build                 # the three packages, in dependency order
corepack pnpm -r typecheck
corepack pnpm -r test
corepack pnpm lint
corepack pnpm format:check
corepack pnpm --filter playground dev  # the playground
```

With pnpm installed globally, drop the `corepack` in front. The recursive commands are spelled out
rather than wrapped in root scripts on purpose: a script that calls `pnpm` again only works where
`pnpm` is on the `PATH`, which under Corepack it is not.

## Versioning

The same rule as `nouxwell/tabula`: below 1.0, a **minor** bump is where a breaking change lands.
The three packages are versioned together, one `vX.Y.Z` tag per release.
[CHANGELOG.md](CHANGELOG.md) says what each release changed.

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 [IONSIS](https://ionsis.com).
