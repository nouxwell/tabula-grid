import { fileURLToPath } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [vue()],
	build: {
		lib: {
			entry: "src/index.ts",
			formats: ["es"],
			fileName: "index",
			cssFileName: "style"
		},
		rolldownOptions: {
			external: ["vue", "@nouxwell/tabula-core"]
		},
		sourcemap: true,
		target: "es2022"
	},
	test: {
		include: ["test/**/*.test.ts"],
		// The core's sources, so the tests do not depend on it having been built first. Only for the
		// tests: in the build the core stays an import.
		alias: {
			"@nouxwell/tabula-core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url))
		}
	}
})
