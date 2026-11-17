import { createApp, markRaw, type App } from "vue"
import { generate, rowMarker, type SpikeData } from "../data"
import { installTools, waitForText } from "../harness"
import OwnGrid from "./OwnGrid.vue"

let data: SpikeData | null = null
let app: App | null = null

installTools()

window.__spike = {
	prepare(rows, columns) {
		data = generate(rows, columns)
	},

	async mount() {
		if (!data) {
			throw new Error("prepare() comes first")
		}

		const started = performance.now()

		app = createApp(OwnGrid, {
			columns: data.columns,
			rows: markRaw(data.rows),
			errors: markRaw(data.errors)
		})
		app.mount("#app")
		await waitForText(rowMarker(0))

		return performance.now() - started
	},

	unmount() {
		app?.unmount()
		app = null
	}
}

// Opened by hand rather than by the measuring script: show something.
if (new URLSearchParams(location.search).has("demo")) {
	window.__spike.prepare(10000, 12)
	void window.__spike.mount()
}
