import { setup } from "@css-render/vue3-ssr"

/**
 * Naive UI's styles, written into the head of the page the server draws, so the page arrives
 * styled rather than turning so a moment later.
 *
 * nuxtjs-naive-ui (1.0.2, the module the CRM has) hands them to Nuxt as `ssrContext.styles`, which
 * Nuxt 4 no longer writes into the page; the CRM runs without server rendering and never meets
 * this. The head takes them instead, gathered once the page has been drawn. In the browser, Naive
 * UI finds them by their `cssr-id` and does not add them twice.
 */
export default defineNuxtPlugin(nuxtApp => {
	const { collect } = setup(nuxtApp.vueApp)

	useServerHead({
		style: () =>
			collect()
				.split("</style>")
				.map(chunk => /<style cssr-id="([^"]*)">([\s\S]*)/.exec(chunk))
				.filter(match => match !== null)
				.map(match => ({ "cssr-id": match[1], textContent: match[2] }))
	})
})
