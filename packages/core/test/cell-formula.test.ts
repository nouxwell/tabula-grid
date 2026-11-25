import { describe, expect, it } from "vitest"
import {
	formulaCaret,
	FormulaSyntaxError,
	ModuleSchema,
	parseFormula,
	VALUE_SETTINGS,
	workOutCell,
	type CellValue
} from "../src/index"

const schema = ModuleSchema.from({
	module: "product.price_update",
	schemaVersion: 1,
	fields: [
		{ key: "product", type: "lookup", lookup: "product" },
		{ key: "currentPrice", type: "money", currency: "TRY", decimals: 2 },
		{ key: "newPrice", type: "money", currency: "TRY", decimals: 2 },
		{ key: "stock", type: "integer" },
		{ key: "currency", type: "options", options: [{ value: "TRY" }, { value: "USD" }] },
		{ key: "active", type: "bool" },
		{ key: "note", type: "string" }
	]
})

const row: Readonly<Record<string, CellValue>> = {
	product: { id: 1, label: "Ürün 000001" },
	currentPrice: "1496.66",
	newPrice: "1533.80",
	stock: "0",
	currency: "TRY",
	active: true,
	note: null
}

function cell(field: string, formula: string, locale: "tr" | "en" = "tr") {
	return workOutCell(formula, { schema, field, read: key => row[key] ?? null, settings: VALUE_SETTINGS[locale] })
}

describe("a formula typed into a cell", () => {
	it("works out for its row, to the field's places, with Turkish numbers", () => {
		expect(cell("newPrice", "=[currentPrice] * 1,1")).toEqual({ status: "value", value: "1646.33" })
		expect(cell("newPrice", "=ROUND([currentPrice] * 1,1; 0)")).toEqual({ status: "value", value: "1646" })
		expect(cell("newPrice", "=ROUND([currentPrice] * 1.1, 0)", "en")).toEqual({ status: "value", value: "1646" })
	})

	it("says where a formula stops making sense, a comma between arguments among them", () => {
		expect(cell("newPrice", "=ROUND([currentPrice], 0)")).toMatchObject({ status: "invalid", at: 21 })
		expect(cell("newPrice", "=[currentPrice] * 1.1")).toMatchObject({ status: "invalid", at: 19 })
	})

	it("names a field the schema has not, and gives an error value as it is", () => {
		expect(cell("newPrice", "=[price] * 2")).toEqual({ status: "unknown", name: "price" })
		expect(cell("newPrice", "=[currentPrice] / [stock]")).toEqual({ status: "error", error: "#DIV/0!" })
	})

	it("reads a result as typed into the field: an option, a yes, text with the sheet's decimal comma", () => {
		expect(cell("currency", '=IF([active]; "USD"; "TRY")')).toEqual({ status: "value", value: "USD" })
		expect(cell("currency", '=CONCAT("T"; "L")')).toMatchObject({
			status: "unfit",
			problem: { code: "not_an_option" }
		})
		expect(cell("active", "=[currentPrice] > 1000")).toEqual({ status: "value", value: true })
		expect(cell("note", "=[currentPrice] * 2")).toEqual({ status: "value", value: "2993,32" })
	})

	it("empties the cell for an empty result, and gives a record field nothing", () => {
		expect(cell("note", "=[note]")).toEqual({ status: "value", value: null })
		expect(cell("product", '="Ürün 000002"')).toMatchObject({ status: "unfit", problem: { code: "not_matched" } })
	})
})

describe("a decimal comma", () => {
	it("makes 1,1 a number and leaves ; the only separator", () => {
		expect(parseFormula("ROUND(1,25; 1)", { decimalSeparator: "," })).toEqual(parseFormula("ROUND(1.25, 1)"))
		expect(() => parseFormula("ROUND(1, 1)", { decimalSeparator: "," })).toThrow(FormulaSyntaxError)
		expect(parseFormula("ROUND(1,1)")).toEqual(parseFormula("ROUND(1; 1)"))
	})

	it("moves the caret's argument on at a semicolon only", () => {
		expect(formulaCaret("ROUND([a] * 1,1; 0", 18, { decimalSeparator: "," }).call).toEqual({
			name: "ROUND",
			argument: 1
		})
		expect(formulaCaret("ROUND([a] * 1,1", 15, { decimalSeparator: "," }).call).toEqual({
			name: "ROUND",
			argument: 0
		})
	})
})
