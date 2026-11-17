import { fileURLToPath } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url))

export default defineConfig({
	plugins: [vue()],
	build: {
		rolldownOptions: {
			input: {
				own: page("own.html"),
				engine: page("engine.html")
			}
		},
		target: "es2022"
	}
})
