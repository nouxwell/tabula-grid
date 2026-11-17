import { describe, expect, it } from "vitest"
import { ModuleSchema, RowStore, SheetValidator, VALUE_SETTINGS, type RowId } from "../src/index"

const schema = ModuleSchema.from({
	module: "validation",
	schemaVersion: 1,
	fields: [
		{ key: "code", type: "string", required: true, rules: [{ rule: "unique" }, { rule: "maxLength", value: 8 }] },
		{
			key: "price",
			type: "money",
			required: true,
			rules: [
				{ rule: "min", value: "0" },
				{ rule: "max", value: "1000" }
			]
		},
		{ key: "note", type: "string", rules: [{ rule: "minLength", value: 3 }] },
		{ key: "day", type: "date" },
		{ key: "product", type: "lookup", lookup: "product", rules: [{ rule: "unique" }] }
	]
})

function ids(): () => RowId {
	let next = 0

	return () => `row_${++next}`
}

/** A sheet of `count` valid rows: codes A1, A2, …, prices 10, 20, … */
function sheet(count: number): { store: RowStore; validator: SheetValidator } {
	const store = new RowStore({
		createRowId: ids(),
		rows: Array.from({ length: count }, (_, index) => ({
			values: { code: `A${index + 1}`, price: String((index + 1) * 10) }
		}))
	})

	return { store, validator: new SheetValidator(schema, store) }
}

function codes(validator: SheetValidator, rowId: RowId, field: string): string[] {
	return validator.issuesAt(rowId, field).map(issue => issue.code)
}

describe("SheetValidator", () => {
	it("finds nothing in a sheet that keeps its rules", () => {
		const { validator } = sheet(3)

		expect(validator.issues()).toEqual([])
		expect(validator.summary()).toEqual({ errors: 0, warnings: 0, stale: 0, rows: 0 })
	})

	it("reports an empty required cell", () => {
		const { store, validator } = sheet(2)

		store.setCell("row_1", "price", null)

		expect(validator.issuesAt("row_1", "price")).toEqual([
			{
				id: "local|required|row_1|price",
				scope: "cell",
				source: "local",
				rowId: "row_1",
				field: "price",
				targets: [],
				code: "required",
				severity: "error",
				blocking: true,
				stale: false,
				message: "This field is required and cannot be left empty.",
				params: { field: "price", type: "money" }
			}
		])
	})

	it("reports a value outside its limits, compared as decimals rather than floats", () => {
		const { store, validator } = sheet(1)

		store.setCell("row_1", "price", "-0.01")
		expect(validator.issuesAt("row_1", "price")[0]).toMatchObject({
			code: "min_value",
			params: { value: "-0.01", min: "0" }
		})

		store.setCell("row_1", "price", "1000.00")
		expect(codes(validator, "row_1", "price")).toEqual([])

		store.setCell("row_1", "price", 1000.000001)
		expect(codes(validator, "row_1", "price")).toEqual(["max_value"])
	})

	it("counts text length in characters a reader sees", () => {
		const { store, validator } = sheet(1)

		store.setCell("row_1", "note", "📦📦")
		expect(validator.issuesAt("row_1", "note")[0]).toMatchObject({ code: "min_length", params: { length: "2" } })

		store.setCell("row_1", "note", "📦📦📦")
		expect(codes(validator, "row_1", "note")).toEqual([])

		store.setCell("row_1", "code", "ABCDEFGHI")
		expect(codes(validator, "row_1", "code")).toEqual(["max_length"])
	})

	it("reports a value that is not of its type, and only that", () => {
		const { store, validator } = sheet(1)

		store.setCell("row_1", "price", "on iki")
		store.setCell("row_1", "day", "31.02.2026")

		expect(codes(validator, "row_1", "price")).toEqual(["not_a_number"])
		expect(codes(validator, "row_1", "day")).toEqual(["not_a_date"])
	})

	it("marks every row holding the same value, and points each at the others", () => {
		const { store, validator } = sheet(4)

		store.setCells([
			{ rowId: "row_2", field: "code", value: "A1" },
			{ rowId: "row_4", field: "code", value: "A1" }
		])

		expect(validator.issuesAt("row_1", "code")).toMatchObject([
			{
				code: "not_unique",
				params: { value: "A1", count: "3" },
				targets: [
					{ rowId: "row_2", field: "code" },
					{ rowId: "row_4", field: "code" }
				]
			}
		])
		expect(codes(validator, "row_2", "code")).toEqual(["not_unique"])
		expect(codes(validator, "row_3", "code")).toEqual([])

		// Fixing one leaves the other two; fixing a second clears the last.
		store.setCell("row_2", "code", "B2")
		expect(validator.issuesAt("row_4", "code")[0]?.params.count).toBe("2")

		store.removeRows(["row_4"])
		expect(codes(validator, "row_1", "code")).toEqual([])
	})

	it("calls two lookups the same by id, and two numbers the same however they are written", () => {
		const { store, validator } = sheet(3)

		store.setCell("row_1", "product", { id: 7, label: "Çelik Termos" })
		store.setCell("row_2", "product", { id: 7, label: "Termos (eski ad)" })
		store.setCell("row_3", "product", { id: "7", label: "Çelik Termos" })

		expect(codes(validator, "row_1", "product")).toEqual(["not_unique"])
		expect(codes(validator, "row_3", "product")).toEqual([])
	})

	it("checks rows as they are inserted, and forgets them as they are removed", () => {
		const { store, validator } = sheet(2)

		const [added] = store.insertRows(0, [{ values: { code: "A2" } }])

		expect(codes(validator, added ?? "", "price")).toEqual(["required"])
		expect(codes(validator, "row_2", "code")).toEqual(["not_unique"])

		store.removeRows([added ?? ""])

		expect(validator.issues()).toEqual([])
	})

	it("lists issues in the order the rows stand, then by column", () => {
		const { store, validator } = sheet(3)

		store.setCell("row_3", "price", null)
		store.setCell("row_1", "note", "x")
		store.setCell("row_1", "price", "-1")
		store.insertRows(0, [{ rowId: "top", values: { code: "T", price: "-5" } }])

		expect(validator.issues().map(issue => `${issue.rowId}.${issue.field}.${issue.code}`)).toEqual([
			"top.price.min_value",
			"row_1.price.min_value",
			"row_1.note.min_length",
			"row_3.price.required"
		])
		expect(validator.summary()).toEqual({ errors: 4, warnings: 0, stale: 0, rows: 3 })
	})

	it("tells its listeners once per change and moves its version", () => {
		const { store, validator } = sheet(3)
		let calls = 0

		validator.subscribe(() => calls++)
		store.setCells([
			{ rowId: "row_1", field: "price", value: null },
			{ rowId: "row_2", field: "price", value: null }
		])

		expect(calls).toBe(1)
		expect(validator.version).toBe(1)
	})

	it("checks everything again when the settings change what reads as a value", () => {
		const { store, validator } = sheet(1)

		store.setCell("row_1", "day", "31.12.2026")
		expect(codes(validator, "row_1", "day")).toEqual([])

		validator.setSettings(VALUE_SETTINGS.en)
		expect(codes(validator, "row_1", "day")).toEqual(["not_a_date"])
	})

	it("stops listening once disposed", () => {
		const { store, validator } = sheet(1)

		validator.dispose()
		store.setCell("row_1", "price", null)

		expect(validator.issues()).toEqual([])
	})

	it("points a repeated value at the first ten others only, and counts them all", () => {
		const { store, validator } = sheet(30)

		store.setCells(store.rowIds().map(rowId => ({ rowId, field: "code", value: "SAME" })))

		const issue = validator.issuesAt("row_15", "code")[0]

		expect(issue?.params.count).toBe("30")
		expect(issue?.targets.map(target => target.rowId)).toEqual([
			"row_1",
			"row_2",
			"row_3",
			"row_4",
			"row_5",
			"row_6",
			"row_7",
			"row_8",
			"row_9",
			"row_10"
		])
		expect(validator.issuesAt("row_1", "code")[0]?.targets[0]?.rowId).toBe("row_2")
	})

	it("checks 50,000 rows and keeps up with one paste over all of them", () => {
		const store = new RowStore({
			rows: Array.from({ length: 50_000 }, (_, index) => ({ values: { code: `C${index}`, price: "1" } }))
		})
		const validator = new SheetValidator(schema, store)

		store.setCells(store.rowIds().map(rowId => ({ rowId, field: "code", value: "SAME" })))

		expect(validator.summary()).toEqual({ errors: 50_000, warnings: 0, stale: 0, rows: 50_000 })
		expect(validator.issues()).toHaveLength(50_000)
	})
})
