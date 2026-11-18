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
		files: ["scripts/**/*.mjs", "packages/*/scripts/**/*.mjs", "examples/*/test/**/*.mjs"],
		languageOptions: {
			globals: {
				process: "readonly",
				console: "readonly",
				fetch: "readonly",
				setTimeout: "readonly",
				URL: "readonly"
			}
		}
	},
	{
		// An atom's props are Naive UI's, passed through: `interface AppButtonProps extends /* @vue-ignore */
		// ButtonProps {}` says so to the type checker without Vue declaring each of them again.
		files: ["examples/*/app/components/atoms/**/*.vue"],
		rules: { "@typescript-eslint/no-empty-object-type": "off" }
	},
	{
		// Nuxt names a page after its route: pages/index.vue is "/".
		files: ["examples/*/app/pages/**/*.vue"],
		rules: { "vue/multi-word-component-names": "off" }
	},
	prettier
)
