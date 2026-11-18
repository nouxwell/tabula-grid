import { describe, expect, it } from "vitest"
import { ModuleSchema, RowStore, RowView, rowsChanged, SheetChanges, UndoHistory, type RowInit } from "../src/index"

const schema = ModuleSchema.from({
	module: "changes",
	schemaVersion: 1,
	fields: [
		{ key: "product", type: "lookup", lookup: "product", required: true },
		{ key: "sku", type: "string", editable: false, submit: false },
		{ key: "price", type: "money", decimals: 2 },
		{
			key: "channels",
			type: "options",
			multiple: true,
			options: [{ value: "store" }, { value: "web" }]
		},
		{ key: "doubled", type: "money", submit: false, formula: "[price] * 2" }
	]
})

const loaded: RowInit[] = [1, 2, 3].map(id => ({
	values: {
		product: { id, label: `Ürün ${id}` },
		sku: `SKU-${id}`,
		price: `${id}0.50`,
		channels: ["store", "web"]
	}
}))

function setup(options: { baseline?: boolean } = {}) {
	let next = 0
	const store = new RowStore({ createRowId: () => `row_${++next}`, rows: loaded })
	const changes = new SheetChanges({
		schema,
		store,
		...(options.baseline ? { baseline: loaded, key: "product" } : {})
	})

	return { store, changes }
}

describe("SheetChanges", () => {
	it("marks a cell that holds other than it did, and only the fields that are sent", () => {
		const { store, changes } = setup()

		expect(changes.summary()).toEqual({ rows: 0, cells: 0, added: 0, missing: 0 })

		store.setCell("row_2", "price", "25")
		store.setCell("row_2", "sku", "SKU-X")

		expect(changes.isChanged("row_2", "price")).toBe(true)
		expect(changes.isChanged("row_2", "sku")).toBe(false)
		expect(changes.hasChanges("row_1")).toBe(false)
		expect(changes.changedRows()).toEqual(["row_2"])
		expect(changes.summary()).toEqual({ rows: 1, cells: 1, added: 0, missing: 0 })
	})

	it("compares values as the backend reads them, and drops the mark when the value comes back", () => {
		const { store, changes } = setup()

		// The same number written another way, the same options in another order.
		store.setCell("row_1", "price", "10.5")
		store.setCell("row_1", "channels", ["web", "store"])

		expect(changes.hasChanges("row_1")).toBe(false)

		store.setCell("row_1", "price", "11")
		expect(changes.isChanged("row_1", "price")).toBe(true)

		store.setCell("row_1", "price", "10.50")
		expect(changes.hasChanges("row_1")).toBe(false)
	})

	it("counts a row added as changed, and one taken out as missing, until an undo brings it back", () => {
		const { store, changes } = setup()
		const history = new UndoHistory(store)
		const versions: number[] = []

		changes.subscribe(each => versions.push(each.version))

		const [added] = store.appendRows([{ values: { product: { id: 9, label: "Ürün 9" }, price: "5" } }])

		expect(changes.isAdded(added!)).toBe(true)
		expect(changes.isChanged(added!, "product")).toBe(true)
		// Nothing typed in it: nothing to send.
		expect(changes.isChanged(added!, "channels")).toBe(false)

		store.removeRows(["row_3"])

		expect(changes.summary()).toEqual({ rows: 1, cells: 2, added: 1, missing: 1 })

		history.undo()

		expect(changes.summary()).toMatchObject({ missing: 0 })
		expect(versions.length).toBeGreaterThan(0)
	})

	it("matches rows by a key against the rows as loaded, so a draft opened later shows its changes", () => {
		// The draft's rows have ids of their own; the product says which loaded row each one is.
		const draft = new RowStore({
			rows: [
				{ rowId: "d1", values: { ...loaded[0]!.values } },
				{ rowId: "d2", values: { ...loaded[1]!.values, price: "99" } },
				{ rowId: "d3", values: { ...loaded[2]!.values, product: { id: 7, label: "Ürün 7" } } }
			]
		})
		const changes = new SheetChanges({ schema, store: draft, baseline: loaded, key: "product" })

		expect(changes.hasChanges("d1")).toBe(false)
		expect(changes.isChanged("d2", "price")).toBe(true)
		// Another product: another row, added, while product 3's goes missing.
		expect(changes.isAdded("d3")).toBe(true)
		expect(changes.summary()).toEqual({ rows: 2, cells: 4, added: 1, missing: 1 })
	})

	it("filters a view to the changed rows, and starts again from the sheet as it is", () => {
		const { store, changes } = setup({ baseline: true })
		const view = new RowView(store)

		store.setCell("row_3", "price", "1")
		view.filter(rowsChanged(changes), "changed")

		expect(view.size).toBe(1)
		expect(view.rowIdAt(0)).toBe("row_3")

		changes.reset()

		expect(changes.summary()).toEqual({ rows: 0, cells: 0, added: 0, missing: 0 })
	})
})
