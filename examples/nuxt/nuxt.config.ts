import tailwindcss from "@tailwindcss/vite"

/**
 * Tabula Grid in a Nuxt application set up as the IONSIS CRM is: Naive UI, Tailwind 4 and
 * TypeScript, drawn on the server. The grid comes in through @nouxwell/tabula-nuxt, as it would
 * from npm: the workspace links the packages' builds, not their sources.
 */
export default defineNuxtConfig({
	compatibilityDate: "2026-11-01",
	devtools: { enabled: false },
	modules: ["@nouxwell/tabula-nuxt"],
	// <AppButton> rather than <AtomsAppButton>: the atoms are named for what they are, wherever they live.
	components: [{ path: "~/components", pathPrefix: false }],
	css: ["~/assets/css/main.css"],
	// Built in with the app, as Naive UI's guide for Nuxt says, so Naive UI and the plugin that
	// gathers its styles on the server (app/plugins/naive-ui.server.ts) share one css-render.
	build: {
		transpile: ["naive-ui", "vueuc", "@css-render/vue3-ssr", "@juggle/resize-observer"]
	},
	vite: {
		plugins: [tailwindcss()]
	},
	app: {
		head: {
			title: "Tabula Grid · Nuxt",
			htmlAttrs: { lang: "tr" }
		}
	},
	typescript: {
		strict: true
	},
	nitro: {
		// The templates users save or make, on disk beside the app, so a restart loses none of them. A
		// backend keeps them in its database.
		storage: {
			templates: { driver: "fs", base: "./.data/templates" }
		}
	}
})
