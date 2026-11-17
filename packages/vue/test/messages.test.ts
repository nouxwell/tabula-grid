import { ModuleSchema, RowStore, SheetValidator, VALUE_SETTINGS, type Issue } from "@nouxwell/tabula-core"
import { describe, expect, it } from "vitest"
import { dateExample, issueText } from "../src/messages"

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

describe("issueText", () => {
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
