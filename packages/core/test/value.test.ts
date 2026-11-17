import { describe, expect, it } from "vitest"
import { TabulaError } from "../src/errors"
import { sameValue, toCellValue, type CellValue } from "../src/value"

describe("toCellValue", () => {
	it("keeps what JSON keeps", () => {
		expect(toCellValue("Çelik Termos")).toBe("Çelik Termos")
		expect(toCellValue(129.9)).toBe(129.9)
		expect(toCellValue(true)).toBe(true)
		expect(toCellValue(null)).toBeNull()
		expect(toCellValue({ id: 1842, label: "Çelik Termos", tags: ["mutfak"] })).toEqual({
			id: 1842,
			label: "Çelik Termos",
			tags: ["mutfak"]
		})
	})

	it("turns what JSON turns into something else the way JSON does", () => {
		expect(toCellValue(undefined)).toBeNull()
		expect(Object.is(toCellValue(-0), 0)).toBe(true)
		// eslint-disable-next-line no-sparse-arrays
		expect(toCellValue([1, , 3])).toEqual([1, null, 3])
		expect(toCellValue({ a: 1, b: undefined })).toEqual({ a: 1 })
	})

	it("hands back a frozen copy, so neither side can change the other", () => {
		const tags = ["mutfak"]
		const value = toCellValue({ tags }) as { tags: string[] }

		tags.push("banyo")

		expect(value.tags).toEqual(["mutfak"])
		expect(Object.isFrozen(value)).toBe(true)
		expect(Object.isFrozen(value.tags)).toBe(true)
	})

	it("keeps a key named __proto__ as an ordinary key", () => {
		const value = toCellValue(JSON.parse('{"__proto__": "x"}')) as Record<string, CellValue>

		expect(Object.keys(value)).toEqual(["__proto__"])
		expect(value["__proto__"]).toBe("x")
	})

	it.each([
		["NaN", Number.NaN],
		["Infinity", Number.POSITIVE_INFINITY],
		["a Date", new Date(0)],
		["a Map", new Map()],
		["a function", () => 1],
		["a bigint", 1n],
		["a symbol", Symbol("x")]
	])("refuses %s, and says what it got", (got, input) => {
		expect(() => toCellValue(input, 'The value of "price"')).toThrowError(
			new TabulaError(
				"invalid_value",
				`The value of "price" must be null, a boolean, a finite number, a string, or an array or plain object of these; got ${got}.`
			)
		)
	})

	it("refuses a value that contains itself instead of recursing forever", () => {
		const loop: Record<string, unknown> = {}
		loop.self = loop

		expect(() => toCellValue(loop)).toThrow(/nested more than 32 levels deep/)
	})
})

describe("sameValue", () => {
	it("compares arrays and objects by what is in them", () => {
		expect(sameValue(["a", 1], ["a", 1])).toBe(true)
		expect(sameValue({ id: 1, label: "x" }, { label: "x", id: 1 })).toBe(true)
		expect(sameValue({ list: [1, { a: null }] }, { list: [1, { a: null }] })).toBe(true)
	})

	it("tells apart what only looks alike", () => {
		expect(sameValue(["a"], ["a", "b"])).toBe(false)
		expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false)
		expect(sameValue(["a"], { 0: "a" })).toBe(false)
		expect(sameValue("1", 1)).toBe(false)
		expect(sameValue(null, "")).toBe(false)
		expect(sameValue(0, false)).toBe(false)
	})
})
