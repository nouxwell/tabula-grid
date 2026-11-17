import { describe, expect, it } from "vitest"
import { compareDecimal, normalizeDecimal } from "../src/decimal"

describe("normalizeDecimal", () => {
	it.each([
		["0", "0"],
		["-0", "0"],
		["+0.000", "0"],
		["0012.3400", "12.34"],
		["-0012.3400", "-12.34"],
		["+7", "7"],
		["12.", null],
		[".5", null],
		["1,5", null],
		["1.234,56", null],
		["1e3", null],
		["", null],
		["  42.10 ", "42.1"],
		[0, "0"],
		[-0, "0"],
		[12.5, "12.5"],
		[-3, "-3"],
		[1e21, null],
		[5e-7, null],
		[Number.NaN, null],
		[Number.POSITIVE_INFINITY, null]
	])("reads %j as %j", (input, expected) => {
		expect(normalizeDecimal(input)).toBe(expected)
	})
})

describe("compareDecimal", () => {
	it("orders numbers the way they are, not the way their text sorts", () => {
		const ordered = [
			"-100",
			"-12.5",
			"-12.05",
			"-1",
			"-0.3",
			"0",
			"0.1",
			"0.3",
			"0.30001",
			"2",
			"9.99",
			"10",
			"100"
		]
		const shuffled = [...ordered].reverse()

		expect(shuffled.sort(compareDecimal)).toEqual(ordered)
	})

	it("calls two ways of writing a number equal once both are normalised", () => {
		expect(compareDecimal(normalizeDecimal("0.30") ?? "", normalizeDecimal("0.3") ?? "")).toBe(0)
		expect(compareDecimal("-5", "-5")).toBe(0)
	})
})
