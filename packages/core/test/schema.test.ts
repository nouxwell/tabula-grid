import { describe, expect, it } from "vitest"
import { ModuleSchema, SchemaError, TabulaError, type ModuleSchemaInput } from "../src/index"

const priceUpdate: ModuleSchemaInput = {
	module: "product.price_update",
	schemaVersion: 3,
	title: "Toplu fiyat güncelleme",
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
			currency: "TRY",
			rules: [{ rule: "min", value: "0" }]
		},
		{
			key: "currency",
			type: "options",
			label: "Para birimi",
			options: [{ value: "TRY", label: "Türk lirası" }, { value: "USD" }]
		},
		{ key: "validFrom", type: "date", label: "Geçerlilik" },
		{ key: "note", type: "string", rules: [{ rule: "maxLength", value: 200 }], example: "Kampanya sonrası fiyat" }
	]
}

/** The schema's problems as "path: message", or a failure when it was accepted. */
function problemsOf(input: unknown): string[] {
	try {
		ModuleSchema.from(input)
	} catch (error) {
		if (error instanceof SchemaError) {
			return error.problems.map(problem => `${problem.path}: ${problem.message}`)
		}

		throw error
	}

	throw new Error("the schema was accepted")
}

/** The price-update schema with one field replaced. */
function withField(index: number, field: unknown): unknown {
	const fields: unknown[] = [...priceUpdate.fields]
	fields[index] = field

	return { ...priceUpdate, fields }
}

describe("ModuleSchema", () => {
	it("reads a schema and fills in what was left out", () => {
		const schema = ModuleSchema.from(priceUpdate)
		const note = schema.field("note")

		expect(schema.module).toBe("product.price_update")
		expect(schema.schemaVersion).toBe(3)
		expect(schema.customization).toBe("controlled")
		expect(schema.keys()).toEqual(["productId", "currentPrice", "newPrice", "currency", "validFrom", "note"])
		expect(note).toEqual({
			key: "note",
			type: "string",
			label: "note",
			required: false,
			editable: true,
			submit: true,
			rules: [{ rule: "maxLength", value: 200 }],
			example: "Kampanya sonrası fiyat",
			formula: null
		})
		expect(schema.field("currentPrice")).toMatchObject({ editable: false, submit: false, currency: null })
		expect(schema.field("currency")).toMatchObject({
			options: [
				{ value: "TRY", label: "Türk lirası" },
				{ value: "USD", label: "USD" }
			],
			multiple: false
		})
	})

	it("starts a module in fixed mode when it does not say otherwise", () => {
		const fixed: ModuleSchemaInput = { ...priceUpdate }
		delete fixed.customization

		expect(ModuleSchema.from(fixed).customization).toBe("fixed")
	})

	it("refuses an unknown key rather than answering undefined, and names the ones it has", () => {
		const schema = ModuleSchema.from(priceUpdate)

		expect(() => schema.field("price")).toThrowError(
			new TabulaError(
				"unknown_field",
				'Module "product.price_update" has no field "price". Its fields are: productId, currentPrice, newPrice, currency, validFrom, note.'
			)
		)
		expect(schema.has("price")).toBe(false)
		expect(schema.has("newPrice")).toBe(true)
	})

	it("writes rule limits one way, whichever way they arrived", () => {
		const schema = ModuleSchema.from(
			withField(2, {
				key: "newPrice",
				type: "money",
				rules: [
					{ rule: "min", value: "0010.500" },
					{ rule: "max", value: 99999 }
				]
			})
		)

		expect(schema.field("newPrice").rules).toEqual([
			{ rule: "min", value: "10.5" },
			{ rule: "max", value: "99999" }
		])
	})

	it("reports every problem at once, each with where it is", () => {
		expect(
			problemsOf({
				module: "product.price_update",
				schemaVersion: 0,
				fields: [
					{ key: "price", type: "money2" },
					{ key: "price", type: "money" },
					{ key: "product", type: "lookup" }
				]
			})
		).toEqual([
			"schemaVersion: must be a whole number, 1 or more; got 0",
			'fields[1].key: "price" is already the key of fields[0]; a key names one field only',
			'fields[0].type: "money2" is not a field type; expected one of string, integer, decimal, money, quantity, percent, bool, date, datetime, options, lookup',
			"fields[2].lookup: is required"
		])
	})

	it("names the module in the error when it can", () => {
		expect(() => ModuleSchema.from({ ...priceUpdate, schemaVersion: "3" })).toThrowError(
			'Module schema "product.price_update" is not valid:\n  schemaVersion: must be a whole number, 1 or more; got "3"'
		)
	})

	it("refuses something that is not a schema at all", () => {
		expect(problemsOf(null)).toEqual(["(root): must be an object; got null"])
		expect(problemsOf([])).toEqual(["(root): must be an object; got an array"])
		expect(problemsOf({ module: "x", schemaVersion: 1, fields: [] })).toEqual([
			"fields: must be a non-empty array of fields; got an array"
		])
	})

	it("refuses a property it does not know, rather than dropping it", () => {
		expect(problemsOf(withField(5, { key: "note", type: "string", requird: true }))).toEqual([
			"fields[5].requird: is not a field property; a string field takes key, type, label, required, editable, submit, rules, example, formula"
		])
		expect(problemsOf({ ...priceUpdate, version: 3 })).toEqual([
			"version: is not a module schema property; expected one of module, schemaVersion, title, customization, fields"
		])
	})

	it("refuses a property that belongs to another type", () => {
		expect(problemsOf(withField(5, { key: "note", type: "string", decimals: 2 }))).toEqual([
			"fields[5].decimals: does not apply to a string field"
		])
		expect(problemsOf(withField(5, { key: "note", type: "integer", decimals: 0 }))).toEqual([
			"fields[5].decimals: does not apply to an integer field"
		])
		expect(problemsOf(withField(0, { key: "productId", type: "lookup", lookup: "product", options: [] }))).toEqual([
			"fields[0].options: does not apply to a lookup field"
		])
	})

	it("refuses a rule on a type it cannot apply to, and a rule it does not know", () => {
		expect(
			problemsOf(withField(2, { key: "newPrice", type: "money", rules: [{ rule: "minLength", value: 1 }] }))
		).toEqual(["fields[2].rules[0]: minLength does not apply to a money field"])
		expect(problemsOf(withField(5, { key: "note", type: "string", rules: [{ rule: "min", value: "0" }] }))).toEqual(
			["fields[5].rules[0]: min does not apply to a string field"]
		)
		expect(
			problemsOf(withField(5, { key: "note", type: "string", rules: [{ rule: "pattern", value: "^A" }] }))
		).toEqual([
			'fields[5].rules[0].rule: "pattern" is not a rule; expected one of min, max, minLength, maxLength, unique'
		])
	})

	it("refuses limits that no value can satisfy", () => {
		expect(
			problemsOf(
				withField(2, {
					key: "newPrice",
					type: "money",
					rules: [
						{ rule: "min", value: "10" },
						{ rule: "max", value: "9.99" }
					]
				})
			)
		).toEqual(["fields[2].rules: min 10 is above max 9.99; no value can satisfy both"])
		expect(
			problemsOf(
				withField(5, {
					key: "note",
					type: "string",
					rules: [
						{ rule: "minLength", value: 5 },
						{ rule: "maxLength", value: 2 }
					]
				})
			)
		).toEqual(["fields[5].rules: minLength 5 is above maxLength 2; no text can satisfy both"])
	})

	it("refuses a rule given twice, and a limit it cannot read exactly", () => {
		expect(
			problemsOf(
				withField(2, {
					key: "newPrice",
					type: "money",
					rules: [
						{ rule: "min", value: "0" },
						{ rule: "min", value: "1" }
					]
				})
			)
		).toEqual(["fields[2].rules[1]: min is already given at fields[2].rules[0]; give each rule once"])
		expect(
			problemsOf(withField(2, { key: "newPrice", type: "money", rules: [{ rule: "max", value: 1e21 }] }))
		).toEqual([
			'fields[2].rules[0].value: must be a decimal number such as "0" or "12.5", with a point and no exponent; got 1e+21'
		])
		expect(
			problemsOf(withField(2, { key: "newPrice", type: "money", rules: [{ rule: "max", value: "1,5" }] }))
		).toEqual([
			'fields[2].rules[0].value: must be a decimal number such as "0" or "12.5", with a point and no exponent; got "1,5"'
		])
	})

	it("refuses an options field without options, and two options a cell cannot tell apart", () => {
		expect(problemsOf(withField(3, { key: "currency", type: "options" }))).toEqual([
			"fields[3].options: is required for an options field"
		])
		expect(
			problemsOf(
				withField(3, {
					key: "currency",
					type: "options",
					options: [{ value: 1 }, { value: "1" }]
				})
			)
		).toEqual(['fields[3].options[1].value: "1" is already the value of fields[3].options[0]'])
	})

	it("colours a number by its sign when a numeric field asks for it, and nowhere else", () => {
		const schema = ModuleSchema.from(
			withField(1, { key: "currentPrice", type: "money", decimals: 2, tone: "sign", editable: false })
		)

		expect(schema.field("currentPrice")).toMatchObject({ type: "money", tone: "sign" })
		expect(schema.field("newPrice")).toMatchObject({ tone: null })
		expect(ModuleSchema.from(JSON.parse(JSON.stringify(schema))).field("currentPrice")).toMatchObject({
			tone: "sign"
		})
		expect(problemsOf(withField(5, { key: "note", type: "string", tone: "sign" }))).toEqual([
			"fields[5].tone: does not apply to a string field"
		])
		expect(problemsOf(withField(2, { key: "newPrice", type: "money", tone: "green" }))).toEqual([
			'fields[2].tone: must be "sign"; got "green"'
		])
	})

	it("refuses a key with spaces around it", () => {
		expect(problemsOf(withField(5, { key: "note ", type: "string" }))).toEqual([
			'fields[5].key: "note " starts or ends with a space; a key is an identifier, not a label'
		])
	})

	it("writes itself out in a form it reads back unchanged", () => {
		const schema = ModuleSchema.from(priceUpdate)
		const again = ModuleSchema.from(JSON.parse(JSON.stringify(schema)))

		expect(again.toJSON()).toEqual(schema.toJSON())
		expect(again.fields).toEqual(schema.fields)
	})

	it("cannot be changed once read", () => {
		const schema = ModuleSchema.from(priceUpdate)
		const field = schema.field("newPrice")

		expect(Object.isFrozen(schema)).toBe(true)
		expect(Object.isFrozen(schema.fields)).toBe(true)
		expect(Object.isFrozen(field)).toBe(true)
		expect(Object.isFrozen(field.rules)).toBe(true)
		expect(() => {
			;(field as { required: boolean }).required = false
		}).toThrow(TypeError)
	})
})
