import { fileURLToPath } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
	plugins: [vue()],
	resolve: {
		// Straight to the sources, so an edit in a package shows up here without a build in between.
		alias: {
			"@nouxwell/tabula-core": source("../packages/core/src/index.ts"),
			"@nouxwell/tabula-vue": source("../packages/vue/src/index.ts")
		}
	}
})
