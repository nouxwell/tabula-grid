import { describe, expect, it } from "vitest"
import {
	applyTemplate,
	ModuleSchema,
	readTemplate,
	RowStore,
	SheetValidator,
	TabulaError,
	templateProblems,
	withDefaults,
	type GridTemplate,
	type ModuleSchemaInput
} from "../src/index"

const input: ModuleSchemaInput = {
	module: "product.price_update",
	schemaVersion: 1,
	customization: "controlled",
	fields: [
		{ key: "productId", type: "lookup", label: "Ürün", required: true, lookup: "product" },
		{ key: "currentPrice", type: "money", label: "Mevcut fiyat", editable: false, submit: false, decimals: 2 },
		{
			key: "newPrice",
			type: "money",
			label: "Yeni fiyat",
			required: true,
			decimals: 2,
			rules: [
				{ rule: "min", value: "0" },
				{ rule: "max", value: "100000" }
			]
		},
		{ key: "currency", type: "options", label: "Para birimi", options: [{ value: "TRY" }, { value: "USD" }] },
		{ key: "note", type: "string", label: "Not", rules: [{ rule: "maxLength", value: 60 }] }
	]
}
const schema = ModuleSchema.from(input)

/** A template as the backend would send it, with whatever the test changes. */
function template(changes: Partial<GridTemplate> = {}): GridTemplate {
	return readTemplate(
		{
			format: "tabula-grid.template",
			version: 1,
			module: "product.price_update",
			id: "t1",
			name: "Aralık zam listesi",
			fields: {},
			columns: [],
			...changes
		},
		"product.price_update"
	)
}

function problems(changes: Partial<GridTemplate>): string[] {
	return templateProblems(schema, template(changes)).map(item => `${item.path}: ${item.message}`)
}

describe("templates", () => {
	it("narrows the schema: a header, a field required, a column closed, limits tightened, a default", () => {
		const applied = applyTemplate(
			schema,
			template({
				fields: {
					newPrice: { label: "Aralık fiyatı", rules: [{ rule: "min", value: "1" }, { rule: "unique" }] },
					currency: { required: true, default: "TRY" },
					note: { editable: false, rules: [{ rule: "maxLength", value: 40 }] }
				}
			})
		)

		expect(applied.field("newPrice")).toMatchObject({
			key: "newPrice",
			label: "Aralık fiyatı",
			rules: [{ rule: "min", value: "1" }, { rule: "max", value: "100000" }, { rule: "unique" }]
		})
		expect(applied.field("currency")).toMatchObject({ required: true, default: "TRY" })
		expect(applied.field("note")).toMatchObject({ editable: false, rules: [{ rule: "maxLength", value: 40 }] })
		// The schema it came from is as it was.
		expect(schema.field("newPrice").label).toBe("Yeni fiyat")
	})

	it("adds columns of its own after the schema's, never sent, a helper or a formula", () => {
		const applied = applyTemplate(
			schema,
			template({
				columns: [
					{ key: "internalNote", type: "string", label: "İç not" },
					{
						key: "withTax",
						type: "money",
						label: "KDV dahil",
						decimals: 2,
						formula: "ROUND([newPrice] * 1.2, 2)"
					}
				]
			})
		)

		expect(applied.keys()).toEqual([
			"productId",
			"currentPrice",
			"newPrice",
			"currency",
			"note",
			"internalNote",
			"withTax"
		])
		expect(applied.field("internalNote")).toMatchObject({ submit: false, editable: true })
		expect(applied.field("withTax")).toMatchObject({
			submit: false,
			editable: false,
			formula: "ROUND([newPrice] * 1.2, 2)"
		})
	})

	it("refuses to loosen what the schema asks, saying where", () => {
		expect(
			problems({
				fields: {
					productId: { required: false },
					currentPrice: { editable: true },
					newPrice: {
						rules: [
							{ rule: "min", value: "-5" },
							{ rule: "max", value: "200000" }
						]
					},
					note: { rules: [{ rule: "maxLength", value: 80 }] }
				}
			})
		).toEqual([
			"fields.productId.required: would make the field optional; the schema requires it, and a template only narrows.",
			"fields.currentPrice.editable: would open the column for typing; the schema keeps it read-only, and a template only narrows.",
			"fields.newPrice.rules[0]: min -5 would let through what the schema's min 0 refuses; a template only narrows.",
			"fields.newPrice.rules[1]: max 200000 would let through what the schema's max 100000 refuses; a template only narrows.",
			"fields.note.rules[0]: maxLength 80 would let through what the schema's maxLength 60 refuses; a template only narrows."
		])
	})

	it("says when its limits leave no value possible", () => {
		expect(problems({ fields: { newPrice: { rules: [{ rule: "min", value: "200000" }] } } })).toEqual([
			"fields.newPrice.rules: min 200000 is above max 100000; no value can satisfy both"
		])
	})

	it("refuses a field the module does not have, a column with a field's key, a lookup column", () => {
		expect(
			problems({
				fields: { price: { label: "Fiyat" } },
				columns: [
					{ key: "note", type: "string" },
					{ key: "supplier", type: "lookup", lookup: "supplier" }
				]
			})
		).toEqual([
			'fields.price: is not a field of module "product.price_update".',
			'columns[0].key: "note" is a field of the module; a template\'s column needs a key of its own.',
			"columns[1].type: cannot be lookup: a record is something the backend gives, and a template's column is never sent."
		])
	})

	it("puts the schema's own complaints back where the template wrote them", () => {
		expect(
			problems({
				fields: { currency: { default: "EUR" } },
				columns: [{ key: "withTax", type: "money", formula: "[gross] * 1.2" }]
			})
		).toEqual([
			'fields.currency.default: "EUR" is not a value of an options field; it takes one of "TRY", "USD"',
			"columns[0].formula: reads [gross], which is not a field of this schema"
		])
	})

	it("is refused whole by a module whose schema is fixed", () => {
		const fixed = ModuleSchema.from({ ...input, customization: "fixed" })

		expect(() => applyTemplate(fixed, template({ fields: { note: { label: "Açıklama" } } }))).toThrow(
			/fixed: its schema says no template may change it/
		)
	})

	it("reads a template's shape, every problem at once", () => {
		try {
			readTemplate(
				{ format: "tabula-grid.template", version: 2, module: "stock", id: "", fields: [] },
				"product.price_update"
			)
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(TabulaError)
			expect((error as TabulaError).code).toBe("invalid_template")
			expect((error as TabulaError).message).toMatch(/version[\s\S]*module[\s\S]*id[\s\S]*name[\s\S]*fields/)
		}

		const read = template({ view: { columns: { hidden: ["note"] }, columnWidths: {}, filters: {}, sort: null } })

		expect(read.view?.columns).toEqual({ hidden: ["note"] })
	})

	it("gives new rows the defaults, keeping a value given, even an empty one", () => {
		const applied = applyTemplate(
			schema,
			template({ fields: { currency: { default: "TRY" }, note: { default: "Aralık" } } })
		)

		expect(withDefaults(applied, 2)).toEqual([
			{ values: { currency: "TRY", note: "Aralık" } },
			{ values: { currency: "TRY", note: "Aralık" } }
		])
		expect(
			withDefaults(applied, [{ rowId: "r9", values: { currency: "USD", note: null, newPrice: undefined } }])
		).toEqual([{ rowId: "r9", values: { currency: "USD", note: null } }])
		expect(withDefaults(schema, 1)).toEqual([{}])
	})

	it("checks rows against the tightened rules", () => {
		const applied = applyTemplate(
			schema,
			template({ fields: { newPrice: { rules: [{ rule: "min", value: "1" }] } } })
		)
		const store = new RowStore({ rows: [{ values: { productId: { id: 1, label: "Ürün 1" }, newPrice: "0.5" } }] })
		const validator = new SheetValidator(applied, store)

		expect(validator.issues().map(issue => issue.code)).toEqual(["min_value"])
		validator.dispose()
	})
})
