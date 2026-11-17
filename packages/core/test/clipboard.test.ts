import { describe, expect, it } from "vitest"
import { parseTsv, toTsv } from "../src/index"

describe("parseTsv", () => {
	it("reads cells by tabs and rows by line breaks of any kind", () => {
		expect(parseTsv("a\tb\r\nc\td")).toEqual([
			["a", "b"],
			["c", "d"]
		])
		expect(parseTsv("a\nb\rc")).toEqual([["a"], ["b"], ["c"]])
	})

	it("ends the last row at a trailing line break rather than starting another", () => {
		expect(parseTsv("a\tb\r\n")).toEqual([["a", "b"]])
		expect(parseTsv("a\r\n\r\n")).toEqual([["a"], [""]])
	})

	it("keeps empty cells where they are", () => {
		expect(parseTsv("\tb\t\r\nc\t\t")).toEqual([
			["", "b", ""],
			["c", "", ""]
		])
	})

	it("reads a quoted cell whole, line breaks, tabs and doubled quotes included", () => {
		expect(parseTsv('"Çelik ""Termos""\n500 ml"\t2\r\nx\t"a\tb"')).toEqual([
			['Çelik "Termos"\n500 ml', "2"],
			["x", "a\tb"]
		])
	})

	it("writes a line break inside a cell one way, as the Windows clipboard does not", () => {
		expect(parseTsv('"iki\r\nsatır"\t"üç\rsatır"\r\n')).toEqual([["iki\nsatır", "üç\nsatır"]])
	})

	it("takes a quote in the middle of a cell as a character", () => {
		expect(parseTsv('5" boru\t3')).toEqual([['5" boru', "3"]])
	})

	it("reads a quote that never closes as a character, without swallowing the rows after it", () => {
		expect(parseTsv('"açık\tb\r\nc\td')).toEqual([
			['"açık', "b"],
			["c", "d"]
		])
	})

	it("has no rows for no text", () => {
		expect(parseTsv("")).toEqual([])
	})
})

describe("toTsv", () => {
	it("writes rows of cells, quoting only the cells that need it", () => {
		expect(
			toTsv([
				["Çelik Termos", "349,90"],
				['5" boru', "iki\nsatır"]
			])
		).toBe('Çelik Termos\t349,90\r\n"5"" boru"\t"iki\nsatır"')
	})

	it("is read back by parseTsv exactly as it was written", () => {
		const rows = [
			["a", "", 'say "x"'],
			["tab\there", "line\nbreak", '"quoted"'],
			["", "", ""]
		]

		expect(parseTsv(toTsv(rows))).toEqual(rows)
	})
})
