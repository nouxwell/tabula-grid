import Grid, { type ColumnRegular } from "@revolist/vue3-datagrid"
import { createApp, h, markRaw, type App } from "vue"
import { generate, rowMarker } from "../data"
import { installTools, waitForText } from "../harness"

/** A row as RevoGrid wants it: one property per column, plus the row's own number. */
type Model = Record<string, string | number>

/** The property that carries the row number, so a cell can be matched to the error set. */
const ROW = "_row"

let columns: ColumnRegular[] = []
let source: Model[] = []
let app: App | null = null

installTools()

window.__spike = {
	prepare(rowCount, columnCount) {
		const data = generate(rowCount, columnCount)

		columns = data.columns.map((column, index) => ({
			prop: column.key,
			name: column.title,
			size: column.width,
			readonly: column.readonly,
			cellProperties: ({ model }) => ({
				class: {
					"is-numeric": column.numeric,
					"is-error": data.errors.has(Number(model[ROW]) * columnCount + index)
				}
			})
		}))

		source = data.rows.map((row, rowIndex) => {
			const model: Model = { [ROW]: rowIndex }

			row.forEach((value, index) => {
				model[`c${index}`] = value
			})

			return model
		})
	},

	async mount() {
		if (source.length === 0) {
			throw new Error("prepare() comes first")
		}

		const started = performance.now()

		app = createApp({
			render: () =>
				h(Grid, {
					source: markRaw(source),
					columns: markRaw(columns),
					range: true,
					resize: true,
					rowSize: 30,
					theme: "compact"
				})
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
