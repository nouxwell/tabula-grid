import { describe, expect, it } from "vitest"
import {
	applyTemplate,
	ModuleSchema,
	readTemplate,
	rowsBreaking,
	RowStore,
	SchemaError,
	SheetValidator,
	templateProblems,
	VALUE_SETTINGS,
	type CheckInput,
	type ModuleSchemaInput
} from "../src/index"

const input: ModuleSchemaInput = {
	module: "product.price_update",
	schemaVersion: 1,
	customization: "controlled",
	fields: [
		{ key: "currentPrice", type: "money", label: "Mevcut fiyat", editable: false, decimals: 2 },
		{ key: "newPrice", type: "money", label: "Yeni fiyat", decimals: 2 },
		{ key: "currency", type: "options", label: "Para birimi", options: [{ value: "TRY" }, { value: "USD" }] },
		{ key: "validFrom", type: "date", label: "Geçerlilik" },
		{ key: "active", type: "bool", label: "Aktif" },
		{ key: "note", type: "string", label: "Not" }
	]
}

/** "Not is required when Aktif is no." */
const noteWhenInactive: CheckInput = {
	id: "note-when-inactive",
	assert: { field: "note", op: "filled" },
	when: [{ field: "active", op: "=", value: false }]
}

/** "Yeni fiyat cannot be below Mevcut fiyat", only a warning. */
const notBelowCost: CheckInput = {
	id: "not-below-cost",
	assert: { field: "newPrice", op: ">=", other: "currentPrice" },
	severity: "warning"
}

function withChecks(checks: unknown[]): ModuleSchema {
	return ModuleSchema.from({ ...input, checks })
}

function problemsOf(checks: unknown[]): string[] {
	try {
		withChecks(checks)
	} catch (error) {
		if (error instanceof SchemaError) {
			return error.problems.map(problem => `${problem.path}: ${problem.message}`)
		}

		throw error
	}

	return []
}

function setup(checks: CheckInput[], values: Record<string, unknown>) {
	const schema = withChecks(checks)
	const store = new RowStore({ createRowId: () => "r1", rows: [{ values: values as never }] })
	const validator = new SheetValidator(schema, store)

	return { schema, store, validator }
}

describe("row checks", () => {
	it("reads checks from the schema and writes them back unchanged", () => {
		const schema = withChecks([noteWhenInactive, notBelowCost])

		expect(schema.checks.map(check => [check.id, check.severity])).toEqual([
			["note-when-inactive", "error"],
			["not-below-cost", "warning"]
		])
		expect(schema.checks[0]?.when[0]).toEqual({ field: "active", op: "=", value: false, other: null })
		expect(ModuleSchema.from(schema.toJSON()).toJSON()).toEqual(schema.toJSON())
	})

	it("refuses a check it cannot apply, saying where", () => {
		expect(
			problemsOf([
				{ id: "a", assert: { field: "price", op: "filled" } },
				{ id: "b", assert: { field: "note", op: "<", value: "x" } },
				{ id: "c", assert: { field: "currency", op: "=", value: "EUR" } },
				{ id: "d", assert: { field: "newPrice", op: ">=", value: "1", other: "currentPrice" } },
				{ id: "e", assert: { field: "newPrice", op: ">=", other: "validFrom" } },
				{ id: "f", assert: { field: "note", op: "filled" }, severity: "info" },
				{ id: "ok", assert: { field: "note", op: "empty" } },
				{ id: "ok", assert: { field: "note", op: "filled" } }
			])
		).toEqual([
			'checks[0].assert.field: "price" is not a field of this schema',
			"checks[1].assert.op: < needs an order; a string field only takes = and !=",
			'checks[2].assert.value: "EUR" is not a value of the options field "currency"',
			"checks[3].assert: >= compares with a value or with another field: give one of value and other",
			"checks[4].assert.other: a money field cannot be compared with a date field",
			'checks[5].severity: must be "error" or "warning"; got "info"',
			'checks[7].id: "ok" is already the id of checks[6]; an id names one check only'
		])
	})

	it("requires a field when another holds a value, and lets go when either changes", () => {
		const { store, validator } = setup([noteWhenInactive], { active: false })

		expect(validator.issuesAt("r1", "note").map(issue => issue.code)).toEqual(["check_filled"])
		expect(validator.hasErrors("r1")).toBe(true)

		store.setCell("r1", "note", "Satıştan kalktı")
		expect(validator.issuesAt("r1", "note")).toEqual([])

		store.setCell("r1", "note", null)
		store.setCell("r1", "active", true)
		expect(validator.issuesAt("r1", "note")).toEqual([])
		validator.dispose()
	})

	it("compares two fields of a row, as a warning that blocks nothing", () => {
		const { store, validator } = setup([notBelowCost], { currentPrice: "100", newPrice: "99.90" })
		const [issue] = validator.issuesAt("r1", "newPrice")

		expect(issue).toMatchObject({
			code: "check_compare",
			severity: "warning",
			blocking: false,
			targets: [{ rowId: "r1", field: "currentPrice" }],
			params: { op: ">=", operand: "Mevcut fiyat" },
			message: "Yeni fiyat must be at least Mevcut fiyat."
		})
		expect(validator.summary()).toMatchObject({ errors: 0, warnings: 1, rows: 1 })
		expect(validator.hasErrors("r1")).toBe(false)
		expect(validator.hasIssues("r1")).toBe(true)

		// A change to the other field checks again too.
		store.setCell("r1", "currentPrice", "90")
		expect(validator.issuesAt("r1", "newPrice")).toEqual([])
		validator.dispose()
	})

	it("compares nothing with an empty side or a value that cannot be read", () => {
		const { store, validator } = setup([notBelowCost], { currentPrice: "100" })

		expect(validator.issuesAt("r1", "newPrice")).toEqual([])

		store.setCell("r1", "newPrice", "on iki")
		expect(validator.issuesAt("r1", "newPrice").map(issue => issue.code)).toEqual(["not_a_number"])
		validator.dispose()
	})

	it("orders dates and words its conditions as the sheet writes them, with a check's own words", () => {
		const check: CheckInput = {
			id: "early",
			assert: { field: "note", op: "filled" },
			when: [
				{ field: "validFrom", op: "<", value: "2026-12-01" },
				{ field: "currency", op: "=", value: "USD" }
			],
			message: { tr: "Erken tarihli döviz fiyatına not yazın.", en: "Write a note for an early foreign price." }
		}
		const { store, validator } = setup([check], { validFrom: "2026-11-30", currency: "USD" })
		const [issue] = validator.issuesAt("r1", "note")

		expect(issue?.params).toMatchObject({
			when: "2",
			when0Field: "Geçerlilik",
			when0Op: "<",
			// The condition's own limit, as the sheet writes a date.
			when0Value: "01.12.2026",
			when1Field: "Para birimi",
			when1Value: "USD",
			"message.tr": "Erken tarihli döviz fiyatına not yazın."
		})
		expect(issue?.message).toBe("Write a note for an early foreign price.")

		store.setCell("r1", "validFrom", "2026-12-01")
		expect(validator.issuesAt("r1", "note")).toEqual([])
		validator.dispose()
	})

	it("lists the rows a check breaks, in sheet order, for an editor to count", () => {
		const schema = withChecks([notBelowCost])
		let next = 0
		const store = new RowStore({
			createRowId: () => `r${++next}`,
			rows: [
				{ values: { currentPrice: "100", newPrice: "90" } },
				{ values: { currentPrice: "100", newPrice: "120" } },
				{ values: { currentPrice: "50", newPrice: "49.99" } }
			]
		})

		expect(rowsBreaking(schema, store, schema.checks[0]!, VALUE_SETTINGS.tr)).toEqual(["r1", "r3"])
	})

	it("takes a template's checks after the schema's, its problems where the template wrote them", () => {
		const template = (checks: unknown[]) =>
			readTemplate(
				{
					format: "tabula-grid.template",
					version: 1,
					module: "product.price_update",
					id: "t1",
					name: "Aralık",
					checks
				},
				"product.price_update"
			)
		const schema = withChecks([notBelowCost])

		expect(applyTemplate(schema, template([noteWhenInactive])).checks.map(check => check.id)).toEqual([
			"not-below-cost",
			"note-when-inactive"
		])
		expect(
			templateProblems(schema, template([{ id: "not-below-cost", assert: { field: "note", op: "empty" } }])).map(
				problem => `${problem.path}: ${problem.message}`
			)
		).toEqual(['checks[0].id: "not-below-cost" is already the id of checks[0]; an id names one check only'])
	})
})
