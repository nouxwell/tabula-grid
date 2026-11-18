import {
	FORMULA_FUNCTIONS,
	ModuleSchema,
	RowStore,
	SheetValidator,
	VALUE_SETTINGS,
	type Issue
} from "@nouxwell/tabula-core"
import { describe, expect, it } from "vitest"
import { dateExample, describeCheck, functionHelp, issueText } from "../src/messages"

const schema = ModuleSchema.from({
	module: "messages",
	schemaVersion: 1,
	fields: [
		{ key: "price", type: "money", required: true, rules: [{ rule: "min", value: "0.5" }] },
		{ key: "day", type: "date" }
	]
})

function issuesFor(values: Record<string, unknown>): Issue[] {
	const store = new RowStore({ rows: [{ values: values as never }] })

	return new SheetValidator(schema, store).issues()
}

describe("functionHelp", () => {
	it("helps with every function a formula has, in both languages", () => {
		for (const name of FORMULA_FUNCTIONS) {
			for (const locale of ["tr", "en"] as const) {
				const help = functionHelp(name, locale)

				expect(help, `${name} in ${locale}`).not.toBeNull()
				expect(help?.params.length).toBeGreaterThan(0)
				expect(help?.text.length).toBeGreaterThan(10)
			}
		}

		expect(functionHelp("round", "tr")?.params).toEqual(["sayı", "basamak"])
		expect(functionHelp("VLOOKUP", "tr")).toBeNull()
	})
})

describe("describeCheck", () => {
	const schema = ModuleSchema.from({
		module: "prices",
		schemaVersion: 1,
		fields: [
			{ key: "currentPrice", type: "money", label: "Mevcut fiyat" },
			{ key: "newPrice", type: "money", label: "Aralık fiyatı" },
			{ key: "currency", type: "options", label: "Para birimi", options: [{ value: "TRY" }, { value: "USD" }] },
			{ key: "validFrom", type: "date", label: "Geçerlilik" },
			{ key: "note", type: "string", label: "İç not" }
		],
		checks: [
			{
				id: "below",
				assert: { field: "newPrice", op: ">=", other: "currentPrice" },
				when: [{ field: "currency", op: "=", value: "TRY" }]
			},
			{
				id: "early",
				assert: { field: "note", op: "filled" },
				when: [{ field: "validFrom", op: "<", value: "2026-12-01" }]
			}
		]
	})
	const [below, early] = schema.checks

	it("says a check as a sentence, with labels and values as the sheet writes them", () => {
		expect(describeCheck(below!, schema, "tr", VALUE_SETTINGS.tr)).toBe(
			"Aralık fiyatı, Mevcut fiyat değerinden küçük olamaz (Para birimi = TRY olduğunda)"
		)
		expect(describeCheck(early!, schema, "tr", VALUE_SETTINGS.tr)).toBe(
			"İç not dolu olmalı (Geçerlilik < 01.12.2026 olduğunda)"
		)
		expect(describeCheck(below!, schema, "en", VALUE_SETTINGS.en)).toBe(
			"Aralık fiyatı: cannot be less than Mevcut fiyat when Para birimi = TRY"
		)
	})
})

describe("issueText", () => {
	it("words a row check from its comparison and conditions, or says its own words", () => {
		const compare = {
			source: "local",
			code: "check_compare",
			message: "Yeni fiyat must be at least Mevcut fiyat.",
			params: {
				op: ">=",
				operand: "Mevcut fiyat",
				when: "1",
				when0Field: "Para birimi",
				when0Op: "=",
				when0Value: "TRY"
			}
		}
		const filled = {
			source: "local",
			code: "check_filled",
			message: "Not is required when Aktif = No.",
			params: {
				op: "filled",
				when: "2",
				when0Field: "Aktif",
				when0Op: "=",
				when0Value: "Hayır",
				when1Field: "Not",
				when1Op: "empty"
			}
		}
		const own = { ...filled, params: { ...filled.params, "message.tr": "Satıştan kalkan ürüne not yazın." } }

		expect(issueText(compare as unknown as Issue, "tr", VALUE_SETTINGS.tr)).toBe(
			"Mevcut fiyat değerinden küçük olamaz (Para birimi = TRY olduğunda)."
		)
		expect(issueText(compare as unknown as Issue, "en", VALUE_SETTINGS.en)).toBe(
			"Cannot be less than Mevcut fiyat when Para birimi = TRY."
		)
		expect(issueText(filled as unknown as Issue, "tr", VALUE_SETTINGS.tr)).toBe(
			"Bu alan zorunlu (Aktif = Hayır ve Not boş olduğunda)."
		)
		expect(issueText(own as unknown as Issue, "tr", VALUE_SETTINGS.tr)).toBe("Satıştan kalkan ürüne not yazın.")
		// No English words of its own: the grid's.
		expect(issueText(own as unknown as Issue, "en", VALUE_SETTINGS.en)).toBe(
			"This field is required when Aktif = Hayır and Not is empty."
		)
	})

	it("words an issue in Turkish, with limits written the sheet's way", () => {
		const [low] = issuesFor({ price: "0.1" })
		const [missing] = issuesFor({})

		expect(issueText(low as Issue, "tr", VALUE_SETTINGS.tr)).toBe("En az 0,5 olmalı.")
		expect(issueText(missing as Issue, "tr", VALUE_SETTINGS.tr)).toBe("Bu alan zorunlu.")
	})

	it("words the same issue in English", () => {
		const [low] = issuesFor({ price: "0.1" })

		expect(issueText(low as Issue, "en", VALUE_SETTINGS.en)).toBe("Must be at least 0.5.")
	})

	it("shows a date pattern as a date", () => {
		const [wrong] = issuesFor({ price: "1", day: "31.02.2026" })

		expect(issueText(wrong as Issue, "tr", VALUE_SETTINGS.tr)).toBe(
			"“31.02.2026” tarih olarak okunamadı. Örnek: 31.12.2026"
		)
		expect(dateExample("Y-m-d H:i")).toBe("2026-12-31 13:45")
		expect(dateExample("d \\d\\e m")).toBe("31 de 12")
	})

	it("falls back on an issue's own message for a code it does not know", () => {
		const issue: Issue = {
			id: "preflight|product_inactive|r1|price",
			scope: "cell",
			source: "preflight",
			rowId: "r1",
			field: "price",
			targets: [],
			code: "product_inactive",
			severity: "error",
			blocking: true,
			stale: false,
			message: "Ürün pasif durumda.",
			params: {}
		}

		expect(issueText(issue, "tr", VALUE_SETTINGS.tr)).toBe("Ürün pasif durumda.")
	})
})
