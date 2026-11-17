import { describe, expect, it } from "vitest"
import {
	ModuleSchema,
	RowStore,
	RowView,
	rowsWithIssues,
	rowsWithResult,
	SheetSession,
	SheetValidator,
	type CheckResponse,
	type ProcessResponse
} from "../src/index"

const schema = ModuleSchema.from({
	module: "product.price_update",
	schemaVersion: 1,
	fields: [
		{ key: "name", type: "string", required: true },
		{ key: "price", type: "money", rules: [{ rule: "min", value: "0" }] }
	]
})

/** row_1 … row_6; rows 2 and 5 have no name, so an issue each. */
function setup() {
	let next = 0
	const store = new RowStore({
		createRowId: () => `row_${++next}`,
		rows: Array.from({ length: 6 }, (_, index) => ({
			values: { name: index === 1 || index === 4 ? null : `Ürün ${index + 1}`, price: "10" }
		}))
	})

	return { store, view: new RowView(store), validator: new SheetValidator(schema, store) }
}

function shown(view: RowView): string[] {
	return Array.from({ length: view.size }, (_, index) => view.rowIdAt(index) ?? "?")
}

describe("RowView", () => {
	it("shows every row, as the store has them, while nothing filters", () => {
		const { store, view } = setup()

		expect(view.filtered).toBe(false)
		expect(shown(view)).toEqual(store.rowIds())
		expect(view.indexOf("row_4")).toBe(3)

		store.insertRows(0, [{ rowId: "first" }])

		expect(view.rowIdAt(0)).toBe("first")
		expect(view.size).toBe(7)
	})

	it("shows only the rows a filter keeps, in sheet order, each at its place in the view", () => {
		const { view, validator } = setup()

		view.filter(rowsWithIssues(validator))

		expect(view.filtered).toBe(true)
		expect(shown(view)).toEqual(["row_2", "row_5"])
		expect(view.indexOf("row_5")).toBe(1)
		expect(view.indexOf("row_1")).toBe(-1)
	})

	it("keeps a row the filter would now leave out, until it is applied again", () => {
		const { store, view, validator } = setup()

		view.filter(rowsWithIssues(validator))
		store.setCell("row_2", "name", "Düzeltildi")

		expect(shown(view)).toEqual(["row_2", "row_5"])

		view.refresh()

		expect(shown(view)).toEqual(["row_5"])
	})

	it("shows rows added while it filters, in their places, and drops rows removed", () => {
		const { store, view, validator } = setup()

		view.filter(rowsWithIssues(validator))
		store.insertRows(3, [{ rowId: "pasted", values: { name: "Yeni" } }])
		store.appendRows([{ rowId: "last" }])

		expect(shown(view)).toEqual(["row_2", "pasted", "row_5", "last"])

		store.removeRows(["row_2"])

		expect(shown(view)).toEqual(["pasted", "row_5", "last"])
	})

	it("shows a row it left out when asked, in its place among the others", () => {
		const { view, validator } = setup()

		view.filter(rowsWithIssues(validator))

		expect(view.show("row_3")).toBe(true)
		expect(shown(view)).toEqual(["row_2", "row_3", "row_5"])
		expect(view.show("no_such_row")).toBe(false)
	})

	it("shows every row again once cleared", () => {
		const { store, view, validator } = setup()

		view.filter(rowsWithIssues(validator))
		view.clear()

		expect(view.filtered).toBe(false)
		expect(shown(view)).toEqual(store.rowIds())
	})

	it("tells its listeners when the rows shown change, not when a cell does", () => {
		const { store, view, validator } = setup()
		let calls = 0

		view.subscribe(() => calls++)
		view.filter(rowsWithIssues(validator))
		store.setCell("row_1", "price", "11")
		store.appendRows(1)
		view.refresh()
		view.clear()

		expect(calls).toBe(4)
	})

	it("filters by the backend's issues and results too", async () => {
		const { store, view, validator } = setup()
		const checks: ((response: CheckResponse) => void)[] = []
		const runs: ((response: ProcessResponse) => void)[] = []
		const session = new SheetSession({
			schema,
			store,
			validator,
			adapters: {
				preflight: () => new Promise(resolve => checks.push(resolve)),
				process: () => new Promise(resolve => runs.push(resolve))
			}
		})

		const checking = session.check()

		checks[0]?.({ issues: [{ rowId: "row_3", code: "price_locked" }] })
		await checking

		view.filter(rowsWithIssues(session.issues))
		expect(shown(view)).toEqual(["row_2", "row_3", "row_5"])

		store.setCell("row_2", "name", "x")
		store.setCell("row_5", "name", "y")
		store.setCell("row_3", "price", "12")

		const running = session.process()

		runs[0]?.({
			status: "partial",
			rows: [
				{ rowId: "row_1", result: "succeeded" },
				{ rowId: "row_4", result: "failed" }
			]
		})
		await running

		view.filter(rowsWithResult(session.results, ["failed", "skipped"]))
		expect(shown(view)).toEqual(["row_2", "row_3", "row_4", "row_5", "row_6"])
	})
})
