import { describe, expect, it } from "vitest"
import {
	addSheet,
	createDraft,
	createWorkbook,
	ModuleSchema,
	openSheet,
	readWorkbook,
	removeSheet,
	RowStore,
	TabulaError,
	withSheet,
	type Workbook
} from "../src/index"

const schema = ModuleSchema.from({
	module: "product.price_update",
	schemaVersion: 1,
	fields: [{ key: "price", type: "money" }]
})

function draftOf(id: string) {
	return createDraft({ id, schema, store: new RowStore({ rows: [{ values: { price: "10" } }] }) })
}

function codeOf(fn: () => unknown): string | undefined {
	try {
		fn()
	} catch (error) {
		return error instanceof TabulaError ? error.code : "other"
	}

	return undefined
}

/** As storage gives it back: through JSON and out again. */
function stored(workbook: Workbook): unknown {
	return JSON.parse(JSON.stringify(workbook))
}

describe("workbooks", () => {
	it("starts with one sheet, open, and takes more after any sheet, each opening as it is added", () => {
		let workbook = createWorkbook({ id: "w1", module: "product.price_update", sheet: { name: "Fiyat listesi" } })

		expect(workbook.sheets).toEqual([
			{ sheetId: "sheet-1", name: "Fiyat listesi", template: null, draft: null, meta: {} }
		])
		expect(workbook.active).toBe("sheet-1")

		const added = addSheet(workbook, { name: " Mart kampanyası ", template: "march" })

		workbook = added.workbook
		expect(added.sheetId).toBe("sheet-2")
		expect(workbook.active).toBe("sheet-2")

		workbook = addSheet(workbook, { name: "Arada" }, "sheet-1").workbook

		expect(workbook.sheets.map(sheet => `${sheet.sheetId}:${sheet.name}`)).toEqual([
			"sheet-1:Fiyat listesi",
			"sheet-3:Arada",
			"sheet-2:Mart kampanyası"
		])
	})

	it("renames a sheet, keeps its draft and what the application notes on it, and reads back the same", () => {
		let workbook = createWorkbook({ id: "w1", module: "product.price_update", sheet: { name: "Fiyat listesi" } })

		workbook = withSheet(workbook, "sheet-1", {
			name: "Aralık",
			draft: draftOf("d1"),
			meta: { errors: 3, done: false }
		})
		workbook = openSheet(workbook, "sheet-1")

		expect(workbook.sheets[0]).toMatchObject({ name: "Aralık", meta: { errors: 3, done: false } })
		expect(readWorkbook(stored(workbook))).toEqual(workbook)
		expect(codeOf(() => withSheet(workbook, "sheet-1", { name: "  " }))).toBe("invalid_argument")
		expect(codeOf(() => withSheet(workbook, "sheet-9", { name: "X" }))).toBe("invalid_argument")
	})

	it("takes a sheet out and opens its neighbour, but never the last one", () => {
		let workbook = createWorkbook({ id: "w1", module: "m", sheet: { name: "A" } })

		workbook = addSheet(workbook, { name: "B" }).workbook
		workbook = addSheet(workbook, { name: "C" }).workbook
		workbook = openSheet(workbook, "sheet-2")
		workbook = removeSheet(workbook, "sheet-2")

		expect(workbook.sheets.map(sheet => sheet.name)).toEqual(["A", "C"])
		expect(workbook.active).toBe("sheet-3")

		workbook = removeSheet(workbook, "sheet-3")

		expect(workbook.active).toBe("sheet-1")
		expect(codeOf(() => removeSheet(workbook, "sheet-1"))).toBe("invalid_argument")
	})

	it("reads a draft of one sheet, from before workbooks, as a workbook of that sheet", () => {
		const draft = draftOf("d1")
		const workbook = readWorkbook(JSON.parse(JSON.stringify(draft)), { name: "Fiyat listesi" })

		expect(workbook).toMatchObject({
			id: "d1",
			module: "product.price_update",
			active: draft.sheetId,
			sheets: [{ sheetId: draft.sheetId, name: "Fiyat listesi", template: null, meta: {} }]
		})
		expect(workbook.sheets[0]?.draft).toEqual(draft)
	})

	it("refuses what is not a workbook, with every problem at once", () => {
		const error = (() => {
			try {
				readWorkbook({
					format: "tabula-grid.workbook",
					version: 1,
					id: "w1",
					module: "product.price_update",
					active: "nowhere",
					sheets: [
						{ sheetId: "a", name: "A", template: null, draft: null, meta: { note: [] } },
						{ sheetId: "a", name: "", template: null, draft: { format: "nope" } }
					]
				})
			} catch (caught) {
				return caught as TabulaError
			}

			return null
		})()

		expect(error?.code).toBe("invalid_workbook")
		expect(error?.message).toContain("sheets[0].meta.note")
		expect(error?.message).toContain('sheets[1].sheetId: "a" is another sheet\'s too.')
		expect(error?.message).toContain("sheets[1].name")
		expect(error?.message).toContain("sheets[1].draft")
		expect(codeOf(() => readWorkbook([]))).toBe("invalid_workbook")
	})
})
