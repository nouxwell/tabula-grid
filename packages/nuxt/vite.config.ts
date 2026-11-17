import { defineConfig } from "vite"

export default defineConfig({
	build: {
		lib: {
			entry: "src/module.ts",
			formats: ["es"],
			fileName: "module"
		},
		rolldownOptions: {
			external: [/^@nuxt\//, /^@nouxwell\//]
		},
		sourcemap: true,
		target: "es2022"
	}
})
