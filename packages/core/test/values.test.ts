import { describe, expect, it } from "vitest"
import {
	defineValueSettings,
	editText,
	formatCell,
	isFieldValue,
	ModuleSchema,
	readInput,
	SchemaError,
	TabulaError,
	VALUE_SETTINGS,
	valueProblem,
	type FieldSchema
} from "../src/index"

const tr = VALUE_SETTINGS.tr
const en = VALUE_SETTINGS.en

const schema = ModuleSchema.from({
	module: "values",
	schemaVersion: 1,
	fields: [
		{ key: "name", type: "string" },
		{ key: "count", type: "integer" },
		{ key: "amount", type: "decimal", decimals: 2 },
		{ key: "price", type: "money", currency: "TRY" },
		{ key: "share", type: "percent", decimals: 1 },
		{ key: "active", type: "bool" },
		{ key: "day", type: "date" },
		{ key: "at", type: "datetime" },
		{
			key: "status",
			type: "options",
			options: [
				{ value: "open", label: "Açık" },
				{ value: "closed", label: "Kapalı" }
			]
		},
		{ key: "product", type: "lookup", lookup: "product" }
	]
})

const field = (key: string): FieldSchema => schema.field(key)

describe("value settings", () => {
	it("starts from nouxwell/tabula's defaults in Turkish, and from English separators and ISO dates in English", () => {
		expect(tr).toMatchObject({
			decimalSeparator: ",",
			thousandSeparator: ".",
			datePattern: "d.m.Y",
			trueWord: "Evet"
		})
		expect(en).toMatchObject({
			decimalSeparator: ".",
			thousandSeparator: ",",
			datePattern: "Y-m-d",
			trueWord: "Yes"
		})
		expect(Object.isFrozen(tr)).toBe(true)
	})

	it("changes what it is told to and keeps the rest", () => {
		const settings = defineValueSettings({ datePattern: "d/m/Y", moneyDigits: 4 })

		expect(settings.datePattern).toBe("d/m/Y")
		expect(settings.moneyDigits).toBe(4)
		expect(settings.decimalSeparator).toBe(",")
	})

	it("refuses settings that would make a value mean two things", () => {
		expect(() => defineValueSettings({ thousandSeparator: "," })).toThrowError(
			new TabulaError("invalid_argument", 'Value settings: "," cannot separate both decimals and thousands.')
		)
		expect(() => defineValueSettings({ trueWord: "Evet", falseWord: "EVET" })).toThrow(/must differ/)
		expect(() => defineValueSettings({ datePattern: "D, d M Y" })).toThrow(/uses a letter/)
		expect(() => defineValueSettings({ moneyDigits: -1 })).toThrow(TabulaError)
		expect(() => defineValueSettings({ decimalSeparator: "1" })).toThrow(TabulaError)
	})
})

describe("readInput", () => {
	it("keeps text it cannot read, with the problem in nouxwell/tabula's words and params", () => {
		expect(readInput(field("amount"), " on iki ", tr)).toEqual({
			value: "on iki",
			problem: {
				code: "not_a_number",
				message: '"on iki" could not be read as a number.',
				params: { field: "amount", type: "decimal", value: "on iki" }
			}
		})
		expect(readInput(field("day"), "31.02.2026", tr).problem).toMatchObject({
			code: "not_a_date",
			message: '"31.02.2026" could not be read as a date; expected format: d.m.Y',
			params: { format: "d.m.Y" }
		})
		expect(readInput(field("active"), "belki", tr).problem?.message).toBe(
			'"belki" is not a Yes/No value. Accepted: Evet, Hayır, 1, 0, true, false'
		)
		expect(readInput(field("status"), "Yarı açık", tr).problem?.message).toBe(
			'"Yarı açık" is not in the list. Options: Açık, Kapalı'
		)
	})

	it("matches an option by its label before its value, as nouxwell/tabula does", () => {
		const crossed = ModuleSchema.from({
			module: "crossed",
			schemaVersion: 1,
			fields: [
				{
					key: "o",
					type: "options",
					options: [
						{ value: "a", label: "b" },
						{ value: "b", label: "c" }
					]
				}
			]
		}).field("o")

		// "b" is one option's label and the other's value: the label wins, as it is what the user sees.
		expect(readInput(crossed, "b", tr).value).toBe("a")
	})

	it("reads empty text as an empty cell, never as a problem", () => {
		expect(readInput(field("amount"), "  ", tr)).toEqual({ value: null, problem: null })
		expect(readInput(field("day"), "\u00a0", tr)).toEqual({ value: null, problem: null })
	})

	it("reads a date field's own pattern before the sheet's", () => {
		const own = ModuleSchema.from({
			module: "own",
			schemaVersion: 1,
			fields: [{ key: "day", type: "date", pattern: "Y/m/d" }]
		}).field("day")

		expect(readInput(own, "2026/12/31", tr).value).toBe("2026-12-31")
		expect(formatCell(own, "2026-12-31", tr)).toBe("2026/12/31")
	})
})

describe("formatCell and editText", () => {
	it("shows values the sheet's way", () => {
		expect(formatCell(field("count"), "1234567", tr)).toBe("1.234.567")
		expect(formatCell(field("amount"), 1234.5, tr)).toBe("1.234,50")
		expect(formatCell(field("price"), "1234.5", tr)).toBe("1.234,50 ₺")
		expect(formatCell(field("price"), "1234.5", en)).toBe("₺ 1,234.50")
		expect(formatCell(field("share"), "12.25", tr)).toBe("12,3")
		expect(formatCell(field("active"), false, tr)).toBe("Hayır")
		expect(formatCell(field("day"), "2026-12-31", tr)).toBe("31.12.2026")
		expect(formatCell(field("at"), "2026-12-31T09:05:00", tr)).toBe("31.12.2026 09:05")
		expect(formatCell(field("status"), "closed", tr)).toBe("Kapalı")
		expect(formatCell(field("product"), { id: 1842, label: "Çelik Termos" }, tr)).toBe("Çelik Termos")
	})

	it("shows text it could not read as it was typed", () => {
		expect(formatCell(field("amount"), "on iki", tr)).toBe("on iki")
		expect(formatCell(field("day"), "31.02.2026", tr)).toBe("31.02.2026")
		expect(formatCell(field("day"), "2026-02-30", tr)).toBe("2026-02-30")
	})

	it("opens a number with every digit, so editing never rounds it", () => {
		expect(editText(field("price"), "1571.4125", tr)).toBe("1571,4125")
		expect(editText(field("price"), "1571.4125", en)).toBe("1571.4125")
		expect(editText(field("count"), "-7", tr)).toBe("-7")
	})

	it("opens every value with text that reads back to the same value", () => {
		const values: [string, unknown][] = [
			["count", "1234567"],
			["amount", "1234.5678"],
			["price", "-0.5"],
			["share", "12.25"],
			["active", true],
			["day", "2026-02-28"],
			["at", "2026-02-28T23:59:00"],
			["status", "open"],
			["name", "  sözcük  ".trim()]
		]

		for (const settings of [tr, en]) {
			for (const [key, value] of values) {
				const text = editText(field(key), value as never, settings)

				expect(readInput(field(key), text, settings)).toEqual({ value, problem: null })
			}
		}
	})
})

describe("valueProblem", () => {
	it("accepts what the grid writes and what a backend sends", () => {
		expect(valueProblem(field("price"), "1234.5600", tr)).toBeNull()
		expect(valueProblem(field("price"), 1234.56, tr)).toBeNull()
		expect(valueProblem(field("count"), 12, tr)).toBeNull()
		expect(valueProblem(field("product"), { id: 1, label: "x" }, tr)).toBeNull()
		// A name is not a record: until one is matched, the backend has no id to take.
		expect(valueProblem(field("product"), "not yet found", tr)?.code).toBe("not_matched")
		expect(isFieldValue(field("day"), "2026-12-31")).toBe(true)
	})

	it("reports what a cell holds that its type cannot", () => {
		expect(valueProblem(field("count"), "12,5", tr)?.code).toBe("not_an_integer")
		expect(valueProblem(field("count"), "12.5", tr)?.code).toBe("not_an_integer")
		expect(valueProblem(field("day"), "2026-02-30", tr)?.code).toBe("not_a_date")
		expect(valueProblem(field("active"), "belki", tr)?.code).toBe("not_a_boolean")
		expect(valueProblem(field("status"), "pending", tr)?.code).toBe("not_an_option")
	})

	it("lets a readable value a host loaded in another form pass", () => {
		expect(valueProblem(field("price"), "1.234,56", tr)).toBeNull()
		expect(isFieldValue(field("price"), "1.234,56")).toBe(false)
	})
})

describe("the schema's date pattern", () => {
	it("refuses a pattern with a letter it cannot read", () => {
		expect(() =>
			ModuleSchema.from({
				module: "x",
				schemaVersion: 1,
				fields: [{ key: "d", type: "date", pattern: "D d.m.Y" }]
			})
		).toThrow(SchemaError)
	})

	it("refuses a pattern on a field that is not a date", () => {
		expect(() =>
			ModuleSchema.from({
				module: "x",
				schemaVersion: 1,
				fields: [{ key: "d", type: "string", pattern: "d.m.Y" } as never]
			})
		).toThrow(/pattern: does not apply to a string field/)
	})
})
