import { describe, expect, it } from "vitest"
import { fillValues, ModuleSchema } from "../src/index"

const schema = ModuleSchema.from({
	module: "fill",
	schemaVersion: 1,
	fields: [
		{ key: "name", type: "string" },
		{ key: "price", type: "money", decimals: 2 },
		{ key: "count", type: "integer" },
		{ key: "day", type: "date" },
		{ key: "at", type: "datetime" },
		{ key: "active", type: "bool" },
		{
			key: "currency",
			type: "options",
			options: [
				{ value: "TRY", label: "Türk lirası" },
				{ value: "EUR", label: "Avro" }
			]
		}
	]
})
const name = schema.field("name")
const price = schema.field("price")
const count = schema.field("count")
const day = schema.field("day")
const at = schema.field("at")
const active = schema.field("active")
const currency = schema.field("currency")

describe("fillValues", () => {
	it("copies one number, and counts from it with Ctrl", () => {
		expect(fillValues(price, ["12.5"], 3)).toEqual(["12.5", "12.5", "12.5"])
		expect(fillValues(count, ["7"], 3, { mode: "alternate" })).toEqual(["8", "9", "10"])
		expect(fillValues(count, ["7"], 2, { mode: "alternate", backward: true })).toEqual(["6", "5"])
	})

	it("goes on by the step between several numbers, exactly", () => {
		expect(fillValues(count, ["10", "20"], 3)).toEqual(["30", "40", "50"])
		expect(fillValues(price, ["0.1", "0.2"], 2)).toEqual(["0.3", "0.4"])
		expect(fillValues(price, [1.5, "1"], 2)).toEqual(["0.5", "0"])
		expect(fillValues(count, ["10", "20", "30"], 2, { backward: true })).toEqual(["0", "-10"])
	})

	it("repeats numbers with no single step between them, and with Ctrl", () => {
		expect(fillValues(count, ["1", "3", "2"], 4)).toEqual(["1", "3", "2", "1"])
		expect(fillValues(count, ["10", "20"], 3, { mode: "alternate" })).toEqual(["10", "20", "10"])
		expect(fillValues(count, ["1", null], 2)).toEqual(["1", null])
	})

	it("repeats going back so the pattern stays in step", () => {
		// a b c | a b c: the cell above "a" holds "c".
		expect(fillValues(name, ["a", "b", "c"], 4, { backward: true })).toEqual(["c", "b", "a", "c"])
	})

	it("counts on text that ends in a number, keeping its leading zeros", () => {
		expect(fillValues(name, ["Ürün 9"], 2)).toEqual(["Ürün 10", "Ürün 11"])
		expect(fillValues(name, ["A009"], 2)).toEqual(["A010", "A011"])
		expect(fillValues(name, ["Hafta 1"], 2, { backward: true })).toEqual(["Hafta 0", "Hafta 1"])
		expect(fillValues(name, ["Ürün 9"], 2, { mode: "alternate" })).toEqual(["Ürün 9", "Ürün 9"])
		expect(fillValues(name, ["Q1", "Q3"], 2)).toEqual(["Q5", "Q7"])
	})

	it("treats text of digits alone as a number, and other text as text", () => {
		expect(fillValues(name, ["100"], 2)).toEqual(["100", "100"])
		expect(fillValues(name, ["100"], 2, { mode: "alternate" })).toEqual(["101", "102"])
		expect(fillValues(name, ["Elma"], 2)).toEqual(["Elma", "Elma"])
		// A name before the number that changes is no series.
		expect(fillValues(name, ["A1", "B2"], 2)).toEqual(["A1", "B2"])
	})

	it("counts a barcode past what a float holds", () => {
		expect(fillValues(name, ["SKU-86900000000000001"], 1)).toEqual(["SKU-86900000000000002"])
	})

	it("goes on a day at a time from one date, and by the days between several", () => {
		expect(fillValues(day, ["2026-12-30"], 3)).toEqual(["2026-12-31", "2027-01-01", "2027-01-02"])
		expect(fillValues(day, ["2026-03-01"], 1, { backward: true })).toEqual(["2026-02-28"])
		expect(fillValues(day, ["2026-01-01", "2026-01-08"], 2)).toEqual(["2026-01-15", "2026-01-22"])
		expect(fillValues(day, ["2026-12-30"], 2, { mode: "alternate" })).toEqual(["2026-12-30", "2026-12-30"])
	})

	it("goes on by months from dates on one day of the month, ending a short month at its last day", () => {
		expect(fillValues(day, ["2026-01-15", "2026-02-15"], 2)).toEqual(["2026-03-15", "2026-04-15"])
		expect(fillValues(day, ["2025-12-31", "2026-01-31"], 2)).toEqual(["2026-02-28", "2026-03-31"])
		expect(fillValues(day, ["2025-06-30", "2026-06-30"], 1)).toEqual(["2027-06-30"])
	})

	it("steps a date and time by a day, or by the time between several", () => {
		expect(fillValues(at, ["2026-12-31T09:30:00"], 1)).toEqual(["2027-01-01T09:30:00"])
		expect(fillValues(at, ["2026-12-31T09:00:00", "2026-12-31T09:45:00"], 2)).toEqual([
			"2026-12-31T10:30:00",
			"2026-12-31T11:15:00"
		])
	})

	it("writes nothing past the years a cell can hold", () => {
		expect(fillValues(day, ["9999-12-31"], 1)).toEqual([null])
	})

	it("repeats yes and no, options, and values of different fields", () => {
		expect(fillValues(active, [true, false], 3)).toEqual([true, false, true])
		expect(fillValues(currency, ["EUR"], 2)).toEqual(["EUR", "EUR"])
		expect(fillValues(null, ["Ürün 9", "12.5"], 3)).toEqual(["Ürün 9", "12.5", "Ürün 9"])
	})

	it("only copies when told to, and gives nothing for nothing", () => {
		expect(fillValues(day, ["2026-12-30"], 2, { mode: "copy" })).toEqual(["2026-12-30", "2026-12-30"])
		expect(fillValues(price, [], 3)).toEqual([])
		expect(fillValues(price, ["1"], 0)).toEqual([])
	})
})
