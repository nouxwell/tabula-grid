import { describe, expect, it } from "vitest"
import {
	compareValues,
	distinctValues,
	filterKey,
	ModuleSchema,
	RowStore,
	rowOrder,
	rowsContaining,
	rowsMatching,
	RowView,
	rowsWithIssues,
	SheetValidator
} from "../src/index"

const schema = ModuleSchema.from({
	module: "filters",
	schemaVersion: 1,
	fields: [
		{ key: "name", type: "string", required: true },
		{ key: "price", type: "money", decimals: 2 },
		{ key: "day", type: "date" },
		{ key: "active", type: "bool" },
		{
			key: "currency",
			type: "options",
			options: [
				{ value: "TRY", label: "Türk lirası" },
				{ value: "EUR", label: "Avro" }
			]
		},
		{ key: "product", type: "lookup", lookup: "product" }
	]
})

function setup() {
	let next = 0
	const store = new RowStore({
		createRowId: () => `r${++next}`,
		rows: [
			{ values: { name: "Ürün 10", price: "12.5", day: "2026-12-01", active: true, currency: "TRY" } },
			{ values: { name: "ürün 9", price: "100", day: "2026-01-15", active: false, currency: "EUR" } },
			{ values: { name: "Çay", price: null, day: null, active: true, currency: "TRY" } },
			{ values: { name: "Ayva", price: "12.50", day: "2026-06-30", active: null, currency: null } },
			{ values: { name: "Zeytin", price: "on iki", day: "2026-03-03", active: true, currency: "EUR" } }
		]
	})

	return { store, view: new RowView(store) }
}

function names(view: RowView): unknown[] {
	return Array.from({ length: view.size }, (_, index) => view.store.get(view.rowIdAt(index)!, "name"))
}

describe("filterKey", () => {
	it("tells values apart by what they are, not how they are written", () => {
		const price = schema.field("price")
		const product = schema.field("product")

		expect(filterKey(price, "12.5")).toBe(filterKey(price, "12.50"))
		expect(filterKey(price, 12.5)).toBe(filterKey(price, "12.5"))
		expect(filterKey(price, null)).toBe("")
		expect(filterKey(product, { id: 7, label: "Termos" })).toBe(filterKey(product, { id: 7, label: "Termos 500" }))
		expect(filterKey(product, { id: 7, label: "Termos" })).not.toBe(
			filterKey(product, { id: "7", label: "Termos" })
		)
		expect(filterKey(product, "Termos")).not.toBe(filterKey(product, { id: 7, label: "Termos" }))
	})
})

describe("rowsMatching", () => {
	it("keeps the rows whose value is among those chosen, empty ones by the empty key", () => {
		const { store, view } = setup()
		const currency = schema.field("currency")

		view.filter(
			rowsMatching(store, schema, { currency: { kind: "values", keys: [filterKey(currency, "TRY"), ""] } }),
			"columns"
		)

		expect(names(view)).toEqual(["Ürün 10", "Çay", "Ayva"])
	})

	it("keeps the numbers and dates in a range, both ends in, and leaves out what is not one", () => {
		const { store, view } = setup()

		view.filter(rowsMatching(store, schema, { price: { kind: "range", from: "12.5", to: "99.99" } }), "columns")
		expect(names(view)).toEqual(["Ürün 10", "Ayva"])

		view.filter(rowsMatching(store, schema, { day: { kind: "range", from: "2026-03-01", to: null } }), "columns")
		expect(names(view)).toEqual(["Ürün 10", "Ayva", "Zeytin"])
	})

	it("needs every column's condition met, and passes over a column the schema no longer has", () => {
		const { store, view } = setup()
		const active = schema.field("active")

		view.filter(
			rowsMatching(store, schema, {
				active: { kind: "values", keys: [filterKey(active, true)] },
				day: { kind: "range", from: null, to: "2026-12-31" },
				gone: { kind: "values", keys: [] }
			}),
			"columns"
		)

		expect(names(view)).toEqual(["Ürün 10", "Zeytin"])
	})
})

describe("rowsContaining", () => {
	it("finds text as the cells show it, case aside the Turkish way, and numbers as typed too", () => {
		const { store, view } = setup()
		const search = (text: string): unknown[] => {
			view.filter(rowsContaining(store, schema, text), "search")

			return names(view)
		}

		expect(search("ÜRÜN")).toEqual(["Ürün 10", "ürün 9"])
		// "I" lowers to "ı" in Turkish: "AYVA" and "ayva" alike.
		expect(search("ayva")).toEqual(["Ayva"])
		// As the cell shows it, and as it is typed.
		expect(search("12,50")).toEqual(["Ürün 10", "Ayva"])
		expect(search("100")).toEqual(["ürün 9"])
		expect(search("01.12.2026")).toEqual(["Ürün 10"])
		// An option by its label.
		expect(search("avro")).toEqual(["ürün 9", "Zeytin"])
		expect(search("  ")).toHaveLength(5)
		expect(search("yok böyle")).toEqual([])
	})

	it("searches only the fields it is given", () => {
		const { store, view } = setup()

		view.filter(rowsContaining(store, schema, "avro", { fields: ["name"] }), "search")

		expect(names(view)).toEqual([])
	})
})

describe("rowOrder", () => {
	it("sorts text in the language's order, with the numbers in it read as numbers", () => {
		const { store, view } = setup()

		view.sort(rowOrder(store, schema, { key: "name", direction: "asc" }))

		expect(names(view)).toEqual(["Ayva", "Çay", "ürün 9", "Ürün 10", "Zeytin"])
	})

	it("sorts numbers by their value and keeps empty cells last, whichever way it goes", () => {
		const { store, view } = setup()

		view.sort(rowOrder(store, schema, { key: "price", direction: "asc" }))
		expect(names(view)).toEqual(["Ürün 10", "Ayva", "ürün 9", "Zeytin", "Çay"])

		view.sort(rowOrder(store, schema, { key: "price", direction: "desc" }))
		expect(names(view)).toEqual(["ürün 9", "Ürün 10", "Ayva", "Zeytin", "Çay"])
	})

	it("sorts dates in time, no before yes, and options by their labels", () => {
		const { store, view } = setup()

		view.sort(rowOrder(store, schema, { key: "day", direction: "asc" }))
		expect(names(view)).toEqual(["ürün 9", "Zeytin", "Ayva", "Ürün 10", "Çay"])

		view.sort(rowOrder(store, schema, { key: "active", direction: "asc" }))
		expect(names(view)).toEqual(["ürün 9", "Ürün 10", "Çay", "Zeytin", "Ayva"])

		view.sort(rowOrder(store, schema, { key: "currency", direction: "asc" }))
		expect(names(view)).toEqual(["ürün 9", "Zeytin", "Ürün 10", "Çay", "Ayva"])
	})

	it("ranks a value not of the column's type after the others, before the empty ones", () => {
		const price = schema.field("price")

		expect(compareValues(price, "on iki", "5")).toBeGreaterThan(0)
		expect(compareValues(price, "on iki", null)).toBeLessThan(0)
	})
})

describe("distinctValues", () => {
	it("lists each value once, counted, in the column's order, the empty cells last", () => {
		const { store } = setup()
		const { values, more } = distinctValues(store, schema.field("price"), store.rowIds())

		expect(values.map(entry => [entry.value, entry.count])).toEqual([
			["12.5", 2],
			["100", 1],
			["on iki", 1],
			[null, 1]
		])
		expect(more).toBe(0)
	})

	it("counts what it leaves out past its limit", () => {
		const { store } = setup()
		const { values, more } = distinctValues(store, schema.field("name"), store.rowIds(), { limit: 2 })

		expect(values.map(entry => entry.value)).toEqual(["Ayva", "Çay"])
		expect(more).toBe(3)
	})
})

describe("RowView with names and a sort", () => {
	it("keeps the rows every named filter keeps, and takes one away alone", () => {
		const { store, view } = setup()
		const validator = new SheetValidator(schema, store)

		store.setCell("r2", "name", null)
		view.filter(rowsWithIssues(validator), "issues")
		view.filter(rowsMatching(store, schema, { price: { kind: "range", from: "50", to: null } }), "columns")

		expect(view.size).toBe(1)
		expect(view.rowIdAt(0)).toBe("r2")

		view.clear("columns")

		// "on iki" in a price is an issue too.
		expect(view.filtered).toBe(true)
		expect([view.rowIdAt(0), view.rowIdAt(1)]).toEqual(["r2", "r5"])

		view.clear()

		expect(view.filtered).toBe(false)
		expect(view.arranged).toBe(false)
		expect(view.size).toBe(5)
	})

	it("sorts at a moment: a changed value keeps its row's place, rows added come after the others", () => {
		const { store, view } = setup()

		view.sort(rowOrder(store, schema, { key: "name", direction: "asc" }))
		store.setCell("r4", "name", "Zzz")

		expect(view.rowIdAt(0)).toBe("r4")

		store.appendRows([{ rowId: "new", values: { name: "Aaa" } }])

		expect(view.rowIdAt(view.size - 1)).toBe("new")
		expect(view.sorted).toBe(true)
		expect(view.arranged).toBe(true)

		view.refresh()

		expect(view.rowIdAt(0)).toBe("new")
	})

	it("shows a row a filter left out where the sort puts it", () => {
		const { store, view } = setup()

		view.sort(rowOrder(store, schema, { key: "name", direction: "asc" }))
		view.filter(rowsMatching(store, schema, { currency: { kind: "values", keys: ["text:EUR"] } }), "columns")

		expect(names(view)).toEqual(["ürün 9", "Zeytin"])

		view.show("r3")

		expect(names(view)).toEqual(["Çay", "ürün 9", "Zeytin"])
	})
})

describe("a multi-select column", () => {
	const multi = ModuleSchema.from({
		module: "channels",
		schemaVersion: 1,
		fields: [
			{
				key: "channels",
				type: "options",
				multiple: true,
				options: [
					{ value: "store", label: "Mağaza" },
					{ value: "web", label: "Web" },
					{ value: "market", label: "Pazar yeri" }
				]
			}
		]
	})
	const field = multi.field("channels")

	function sheet() {
		let next = 0

		return new RowStore({
			createRowId: () => `r${++next}`,
			rows: [
				{ values: { channels: ["web", "store"] } },
				{ values: { channels: ["web"] } },
				{ values: { channels: [] } },
				{ values: {} },
				{ values: { channels: ["market"] } }
			]
		})
	}

	it("lists each option once, with the rows that hold it, and the empty cells", () => {
		const store = sheet()
		const { values } = distinctValues(store, field, store.rowIds())

		expect(values.map(entry => [entry.value, entry.count])).toEqual([
			["store", 1],
			["market", 1],
			["web", 2],
			[null, 2]
		])
	})

	it("keeps a row that holds any option ticked, whatever else it holds", () => {
		const store = sheet()
		const keep = rowsMatching(store, multi, { channels: { kind: "values", keys: [filterKey(field, "web")] } })

		expect(store.rowIds().filter(keep)).toEqual(["r1", "r2"])

		const empty = rowsMatching(store, multi, { channels: { kind: "values", keys: [""] } })

		expect(store.rowIds().filter(empty)).toEqual(["r3", "r4"])
	})
})
