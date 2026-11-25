import { describe, expect, it } from "vitest"
import { ModuleSchema, RowStore, sharedRecords, VALUE_SETTINGS, type RowInit } from "../src/index"

const schema = ModuleSchema.from({
	module: "product.price_update",
	schemaVersion: 1,
	fields: [
		{ key: "product", type: "lookup", lookup: "product", required: true },
		{ key: "sku", type: "string", editable: false, submit: false },
		{ key: "price", type: "money", required: true },
		{ key: "note", type: "string" }
	]
})

function product(id: number, price: string, note: string | null = null): RowInit {
	return { values: { product: { id, label: `Ürün ${id}` }, sku: `SKU-${id}`, price, note } }
}

function sheet(sheetId: string, rows: readonly RowInit[]) {
	let next = 0

	return { sheetId, schema, store: new RowStore({ rows, createRowId: () => `${sheetId}_${++next}` }) }
}

describe("sharedRecords", () => {
	it("finds a record two sheets hold, and the fields they hold differently", () => {
		const march = sheet("march", [product(1, "10"), product(2, "20"), product(3, "30", "kampanya")])
		const april = sheet("april", [product(2, "20"), product(3, "35"), product(4, "40")])

		const shared = sharedRecords([march, april], { key: "product", settings: VALUE_SETTINGS.tr })

		expect(shared.map(record => [record.label, record.differs])).toEqual([
			["Ürün 2", []],
			["Ürün 3", ["price", "note"]]
		])
		expect(shared[1]?.rows.map(row => [row.sheetId, row.rowId, row.values.price])).toEqual([
			["march", "march_3", "30"],
			["april", "april_2", "35"]
		])
	})

	it("reads values as the backend would, so the same price written two ways is the same", () => {
		const one = sheet("one", [product(1, "12,5")])
		const two = sheet("two", [product(1, "12,50")])

		expect(sharedRecords([one, two], { key: "product", fields: ["price"], settings: VALUE_SETTINGS.tr })).toEqual([
			expect.objectContaining({ key: "id:1", differs: [] })
		])
	})

	it("looks only at the rows it is given, passes over a row with no record, and counts a sheet once", () => {
		const one = sheet("one", [product(1, "10"), product(1, "11"), { values: { price: "5" } }])
		const two = sheet("two", [product(1, "12"), product(2, "20")])

		expect(sharedRecords([one, two], { key: "product" })).toHaveLength(1)
		expect(sharedRecords([one, { ...two, rows: ["two_2"] }], { key: "product" })).toEqual([])
	})

	it("refuses a sheet without the key field", () => {
		const other = ModuleSchema.from({ module: "x", schemaVersion: 1, fields: [{ key: "price", type: "money" }] })

		expect(() =>
			sharedRecords([{ sheetId: "x", schema: other, store: new RowStore({ rows: [] }) }], { key: "product" })
		).toThrow(/no field "product"/)
	})
})
