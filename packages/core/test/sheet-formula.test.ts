import { describe, expect, it } from "vitest"
import {
	FormulaEngine,
	formulaFields,
	formulaParts,
	formulaSheets,
	ModuleSchema,
	parseFormula,
	RowStore,
	SheetValidator,
	sheetRecords,
	VALUE_SETTINGS,
	withSheetRenamed,
	type FormulaSheets,
	type RowInit
} from "../src/index"

function schemaWith(formula: string): ModuleSchema {
	return ModuleSchema.from({
		module: "product.price_update",
		schemaVersion: 1,
		fields: [
			{ key: "product", type: "lookup", lookup: "product" },
			{ key: "price", type: "money", currency: "TRY" },
			{ key: "newPrice", type: "money", currency: "TRY" },
			{ key: "march", type: "money", currency: "TRY", formula, editable: false, submit: false }
		]
	})
}

function product(id: number, price: string, newPrice: string | null = null): RowInit {
	return { values: { product: { id, label: `Ürün ${id}` }, price, newPrice } }
}

/** "Mart" holds products 1 and 3; the workbook has no other sheet. */
function workbook(): FormulaSheets {
	const march = sheetRecords([product(1, "10", "12"), product(3, "30", "33"), product(1, "10", "99")], "product")

	return { key: "product", sheet: name => (name === "Mart" ? march : undefined) }
}

function engine(formula: string, rows: readonly RowInit[], sheets: FormulaSheets | null = workbook()) {
	let next = 0
	const schema = schemaWith(formula)
	const store = new RowStore({ rows, createRowId: () => `row_${++next}` })

	return { schema, store, engine: new FormulaEngine({ schema, store, ...(sheets ? { sheets } : {}) }) }
}

describe("SHEET", () => {
	it("reads this row's product's field in another sheet, the first row of it there", () => {
		const { store } = engine('SHEET("Mart"; [newPrice])', [product(1, "10"), product(2, "20"), product(3, "30")])

		expect(store.get("row_1", "march")).toBe("12")
		expect(store.get("row_2", "march")).toBeNull()
		expect(store.get("row_3", "march")).toBe("33")
	})

	it("gives its third argument when the product is not in that sheet", () => {
		const { store } = engine('SHEET("Mart", [newPrice], [price])', [product(2, "20"), product(3, "30")])

		expect(store.get("row_1", "march")).toBe("20")
		expect(store.get("row_2", "march")).toBe("33")
	})

	it("is #REF! for a sheet the workbook lacks, and #VALUE! when the field is not named", () => {
		expect(engine('SHEET("Nisan"; [newPrice])', [product(1, "10")]).store.get("row_1", "march")).toEqual({
			formulaError: "#REF!"
		})
		expect(engine('SHEET("Mart"; [newPrice])', [product(1, "10")], null).store.get("row_1", "march")).toEqual({
			formulaError: "#REF!"
		})
		expect(engine('SHEET("Mart"; 5)', [product(1, "10")]).store.get("row_1", "march")).toEqual({
			formulaError: "#VALUE!"
		})
	})

	it("works out again when the row's product changes, and when the sheets do", () => {
		const { store, engine: formulas } = engine('SHEET("Mart"; [newPrice])', [product(2, "20")])

		expect(store.get("row_1", "march")).toBeNull()

		store.setCell("row_1", "product", { id: 3, label: "Ürün 3" })
		expect(store.get("row_1", "march")).toBe("33")

		formulas.refreshSheets({
			key: "product",
			sheet: name => (name === "Mart" ? sheetRecords([product(3, "30", "31")], "product") : undefined)
		})
		expect(store.get("row_1", "march")).toBe("31")
	})

	it("warns of #REF! and holds nothing back", () => {
		const { schema, store } = engine('SHEET("Nisan"; [newPrice])', [product(1, "10")])
		const validator = new SheetValidator(schema, store, VALUE_SETTINGS.tr)

		expect(validator.issuesAt("row_1", "march")).toEqual([
			expect.objectContaining({ code: "formula_error", severity: "warning", blocking: false })
		])
	})

	it("does not count the other sheet's field as one this row reads, and names the sheets", () => {
		const tree = parseFormula('[price] - SHEET("Mart"; [newPrice]; [price])')

		expect(formulaFields(tree)).toEqual(["price"])
		expect(formulaSheets(tree)).toEqual(["Mart"])
	})

	it("draws the sheet's name as a piece of its own", () => {
		expect(
			formulaParts('[price] - SHEET( "Mart ""2"""; [newPrice]) & "Mart"', [{ key: "price", label: "Fiyat" }])
		).toEqual([
			{ text: "[Fiyat]", field: "price" },
			{ text: " - SHEET( ", field: null },
			{ text: '"Mart ""2"""', field: null, sheet: 'Mart "2"' },
			{ text: "; ", field: null },
			{ text: "[newPrice]", field: "newPrice", sheet: 'Mart "2"' },
			{ text: ') & "Mart"', field: null }
		])
	})

	it("follows a tab's new name in the formulas that name it, and nothing else", () => {
		expect(withSheetRenamed('SHEET("Mart"; [newPrice]) & "Mart"', "Mart", "Mart kampanyası")).toBe(
			'SHEET("Mart kampanyası"; [newPrice]) & "Mart"'
		)
		expect(withSheetRenamed('sheet( "Mart" , [newPrice])', "Mart", 'Mart "2"')).toBe(
			'sheet( "Mart ""2""" , [newPrice])'
		)
	})
})
