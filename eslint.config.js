import js from "@eslint/js"
import { defineConfig, globalIgnores } from "eslint/config"
import prettier from "eslint-config-prettier"
import pluginVue from "eslint-plugin-vue"
import tseslint from "typescript-eslint"

export default defineConfig(
	globalIgnores(["**/dist/**", "**/node_modules/**", "**/.nuxt/**", "**/.output/**"]),
	js.configs.recommended,
	tseslint.configs.recommended,
	pluginVue.configs["flat/recommended"],
	{
		files: ["**/*.vue"],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser
			}
		},
		rules: {
			// The type checker already knows which names exist; this rule only knows the ones it is told about.
			"no-undef": "off"
		}
	},
	{
		files: ["scripts/**/*.mjs", "packages/*/scripts/**/*.mjs"],
		languageOptions: {
			globals: { process: "readonly", console: "readonly" }
		}
	},
	prettier
)
