import { addComponent, defineNuxtModule } from "@nuxt/kit"
import type { NuxtModule } from "@nuxt/schema"

export interface ModuleOptions {
	/** Put in front of every component this module registers: `App` gives `AppTabulaGrid`, `AppTabulaIssues` and the rest. */
	prefix: string
}

// Annotated by hand: left to inference, the declaration file would have to name a type through
// the package manager's own folder layout, which no consumer shares.
const module: NuxtModule<ModuleOptions, ModuleOptions, false> = defineNuxtModule<ModuleOptions>({
	meta: {
		name: "@nouxwell/tabula-nuxt",
		configKey: "tabula",
		compatibility: {
			nuxt: ">=4.0.0"
		}
	},
	defaults: {
		prefix: ""
	},
	setup(options, nuxt) {
		// Client only: the grid measures text and reads the clipboard, and a server has neither.
		for (const component of [
			"TabulaGrid",
			"TabulaIssues",
			"TabulaFormulaBar",
			"TabulaStatusBar",
			"TabulaPreview"
		]) {
			addComponent({
				name: `${options.prefix}${component}`,
				export: component,
				filePath: "@nouxwell/tabula-vue",
				mode: "client"
			})
		}

		nuxt.options.css.push("@nouxwell/tabula-vue/style.css")
	}
})

export default module
