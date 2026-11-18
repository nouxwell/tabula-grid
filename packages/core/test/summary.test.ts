import { describe, expect, it } from "vitest"
import { ModuleSchema, summarizeCells } from "../src/index"

const schema = ModuleSchema.from({
	module: "summary",
	schemaVersion: 1,
	fields: [
		{ key: "price", type: "money", decimals: 2 },
		{ key: "count", type: "integer" },
		{ key: "note", type: "string" }
	]
})
const price = schema.field("price")
const count = schema.field("count")
const note = schema.field("note")

describe("summarizeCells", () => {
	it("sums and averages a numeric field's numbers exactly", () => {
		expect(
			summarizeCells([
				{ field: price, value: "723.02" },
				{ field: price, value: "2812.8" },
				{ field: price, value: "283.98" }
			])
		).toEqual({
			filled: 3,
			numbers: 3,
			sum: "3819.8",
			average: "1273.2666666667",
			min: "283.98",
			max: "2812.8"
		})
		expect(summarizeCells([0.1, 0.2].map(value => ({ field: price, value })))).toMatchObject({ sum: "0.3" })
	})

	it("counts text, empty cells and what could not be read apart from the numbers", () => {
		expect(
			summarizeCells([
				{ field: count, value: 4 },
				{ field: count, value: null },
				{ field: count, value: "iki" },
				{ field: note, value: "123" },
				{ field: price, value: { formulaError: "#DIV/0!" } }
			])
		).toEqual({ filled: 4, numbers: 1, sum: "4", average: "4", min: "4", max: "4" })
	})

	it("has no sum when no cell holds a number", () => {
		expect(summarizeCells([{ field: note, value: "a" }])).toEqual({
			filled: 1,
			numbers: 0,
			sum: null,
			average: null,
			min: null,
			max: null
		})
		expect(summarizeCells([])).toEqual({ filled: 0, numbers: 0, sum: null, average: null, min: null, max: null })
	})
})
