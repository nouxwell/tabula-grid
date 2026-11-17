import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

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
	}
})
