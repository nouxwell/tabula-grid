import { describe, expect, it } from "vitest"
import {
	applyImport,
	exportTable,
	importTable,
	isBlankRow,
	matchRows,
	ModuleSchema,
	RowStore,
	SheetSession,
	SheetValidator,
	suggestColumns,
	suggestMatch,
	UndoHistory,
	VALUE_SETTINGS,
	type CellValue,
	type ModuleSchemaInput
} from "../src/index"

const input: ModuleSchemaInput = {
	module: "product.price_update",
	schemaVersion: 1,
	fields: [
		{ key: "productId", type: "integer", label: "Ürün no", editable: false },
		{ key: "sku", type: "string", label: "SKU", editable: false },
		{ key: "name", type: "string", label: "Ürün", editable: false },
		{ key: "currentPrice", type: "money", label: "Mevcut fiyat", editable: false, submit: false, decimals: 2 },
		{ key: "newPrice", type: "money", label: "Yeni fiyat", required: true, decimals: 2 },
		{
			key: "currency",
			type: "options",
			label: "Para birimi",
			options: [{ value: "TRY" }, { value: "USD" }, { value: "EUR" }],
			default: "TRY"
		},
		{ key: "validFrom", type: "date", label: "Geçerlilik" },
		{ key: "note", type: "string", label: "Not" },
		{ key: "difference", type: "money", label: "Fark", submit: false, formula: "[newPrice] - [currentPrice]" }
	]
}
const schema = ModuleSchema.from(input)
const settings = VALUE_SETTINGS.tr

function sheet(): RowStore {
	return new RowStore({
		rows: [
			{
				rowId: "a",
				values: { productId: 1001, sku: "SKU-1", name: "Kupa", newPrice: "1500", currency: "USD", note: "x" }
			},
			{ rowId: "b", values: { productId: 1002, sku: "SKU-2", name: "Termos", newPrice: "2750" } }
		]
	})
}

describe("importing a table", () => {
	const table = [
		["Stok Kodu", "Fiyat", "Döviz", "Başlangıç", "Sorunlar"],
		["SKU-1", "1.600,00", "USD", "01.12.2026", "eski"],
		["", "", "", "", ""],
		[" sku-2 ", "2.800,50", "TRY", "yarın", ""],
		["SKU-9", "99", "TRY", "15.12.2026", ""]
	]

	it("gives each column its first values and what of it cannot be read, and keeps the key column's text", () => {
		const imported = importTable(table, {
			schema,
			settings,
			columns: { 1: "newPrice", 2: "currency", 3: "validFrom", 4: null },
			key: 0
		})

		expect(imported.columns.map(column => column.status)).toEqual([
			"key",
			"matched",
			"matched",
			"matched",
			"skipped"
		])
		expect(imported.columns[1]?.samples).toEqual(["1.600,00", "2.800,50", "99"])
		expect(imported.columns[3]?.unreadable).toBe(1)
		expect(imported.unreadable).toBe(1)
		expect(imported.keys).toEqual(["SKU-1", "sku-2", "SKU-9"])
		expect(imported.rows).toHaveLength(3)
	})

	it("suggests where columns go: as remembered, by name, by a word shared, by values only one field reads", () => {
		const suggested = suggestColumns(
			[
				["Stok Kodu", "Fiyat", "Döviz", "Başlangıç", "Ürün", "Not", "Sorunlar"],
				...table.slice(1).map(row => [...row.slice(0, 4), "Kupa", "", ""])
			],
			{ schema, settings, remembered: { başlangıç: "validFrom", sorunlar: null } }
		)

		expect(suggested).toEqual([
			{ field: null, reason: null },
			{ field: "newPrice", reason: "similar" },
			{ field: "currency", reason: "values" },
			{ field: "validFrom", reason: "remembered" },
			// "Ürün" names a field no one types into: never suggested.
			{ field: null, reason: null },
			{ field: "note", reason: "name" },
			{ field: null, reason: "remembered" }
		])
	})

	it("finds the column and the field that name the sheet's rows, or none", () => {
		const store = sheet()

		expect(suggestMatch(table, store, { schema, settings })).toEqual({ column: 0, field: "sku" })
		expect(suggestMatch([["Kod"], ["Z-1"], ["Z-2"]], store, { schema, settings })).toBeNull()
	})

	it("finds rows by a key's text without regard to case or spaces, and a number however it is written", () => {
		const store = sheet()

		expect(matchRows(store, schema.field("sku"), ["SKU-1", " sku-2", "SKU-9", ""], settings)).toEqual([
			["a"],
			["b"],
			[],
			[]
		])
		expect(matchRows(store, schema.field("productId"), ["1.001", "1002"], settings)).toEqual([["a"], ["b"]])
	})

	it("writes into the rows found and adds the rest, as one step to take back", () => {
		const store = sheet()
		const history = new UndoHistory(store)
		const update = [
			["SKU", "Fiyat", "Döviz", "Not"],
			["SKU-1", "1.600,00", "TRY", ""],
			["SKU-9", "50", "EUR", "yeni"]
		]
		const imported = importTable(update, {
			schema,
			settings,
			columns: { 1: "newPrice", 2: "currency", 3: "note" },
			key: 0
		})
		const matches = matchRows(store, schema.field("sku"), imported.keys, settings)
		const applied = applyImport(store, schema, imported, { matches })

		expect(applied).toMatchObject({ updated: 1, skipped: 0 })
		expect(applied.added).toHaveLength(1)
		expect(store.get("a", "currency")).toBe("TRY")
		// An empty cell in the file empties the cell it lands in.
		expect(store.get("a", "note")).toBeNull()
		expect(store.get(applied.added[0]!, "currency")).toBe("EUR")

		history.undo()
		expect(store.size).toBe(2)
		expect(store.get("a", "currency")).toBe("USD")
		expect(store.get("a", "note")).toBe("x")
	})

	it("leaves out the rows that find none, or find only rows locked", () => {
		const store = sheet()
		const update = [
			["SKU", "Fiyat"],
			["SKU-1", "10"],
			["SKU-9", "50"]
		]
		const imported = importTable(update, { schema, settings, columns: { 1: "newPrice" }, key: 0 })
		const matches = matchRows(store, schema.field("sku"), imported.keys, settings)

		expect(
			applyImport(store, schema, imported, { matches, unmatched: "skip", locked: rowId => rowId === "a" })
		).toEqual({
			added: [],
			updated: 0,
			skipped: 2
		})
		expect(store.get("a", "newPrice")).toBe("1500")
	})
})

describe("rows nobody filled", () => {
	it("calls a row blank when nothing but defaults and worked-out values is in it", () => {
		const read =
			(values: Record<string, CellValue>) =>
			(key: string): CellValue =>
				values[key] ?? null

		expect(isBlankRow(schema, read({ currency: "TRY", difference: "0" }))).toBe(true)
		expect(isBlankRow(schema, read({ currency: "TRY", note: "x" }))).toBe(false)
	})

	it("checks no blank row, checks one whole once something is in it, and sends none", () => {
		const store = new RowStore({ rows: [{ rowId: "n", values: { currency: "TRY" } }] })
		const validator = new SheetValidator(schema, store, settings)
		const session = new SheetSession({ schema, store, validator, adapters: {} })

		expect(validator.summary().errors).toBe(0)
		expect(session.unfinishedRows()).toEqual([])

		store.setCell("n", "note", "Kupa")
		// The new price is required, now that the row holds something.
		expect(validator.hasErrors("n")).toBe(true)
		expect(session.unfinishedRows()).toEqual(["n"])

		store.setCell("n", "note", null)
		expect(validator.summary().errors).toBe(0)
	})
})

describe("exporting with columns of the host's own", () => {
	it("writes them before or after the fields', as text a spreadsheet will not run", () => {
		const store = sheet()
		const table = exportTable({
			store,
			fields: [schema.field("sku"), schema.field("newPrice")],
			rowIds: ["b"],
			settings,
			extra: [
				{ header: "Satır", at: "start", text: rowId => String(store.indexOf(rowId) + 1) },
				{ header: "Sorunlar", text: () => "=Yeni fiyat en az 1 olmalı" }
			]
		})

		expect(table).toEqual([
			["Satır", "SKU", "Yeni fiyat", "Sorunlar"],
			["2", "SKU-2", "2750", "'=Yeni fiyat en az 1 olmalı"]
		])
	})
})
