import { defineConfig } from "vitest/config"

export default defineConfig({
	build: {
		lib: {
			entry: "src/index.ts",
			formats: ["es"],
			fileName: "index"
		},
		sourcemap: true,
		target: "es2022"
	},
	test: {
		include: ["test/**/*.test.ts"]
	}
})
