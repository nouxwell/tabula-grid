import { describe, expect, it } from "vitest"
import { formulaCaret, formulaWithKeys, formulaWithLabels, parseFormula } from "../src/index"

const fields = [
	{ key: "currentPrice", label: "Mevcut fiyat" },
	{ key: "newPrice", label: "Aralık fiyatı" },
	{ key: "note", label: "Not" },
	{ key: "remark", label: "Not" }
]

/** The caret where "|" stands, and the text without it. */
function at(marked: string) {
	const caret = marked.indexOf("|")

	return formulaCaret(marked.replace("|", ""), caret)
}

describe("formula help", () => {
	it("knows a field being typed after its bracket, and what a completion replaces", () => {
		expect(at("ROUND([Mev|")).toEqual({
			token: { kind: "field", query: "Mev", start: 6, end: 10 },
			call: { name: "ROUND", argument: 0 }
		})
		// Inside a reference already closed: the whole of it.
		expect(at("[Mev|cut fiyat] * 2").token).toEqual({ kind: "field", query: "Mev", start: 0, end: 14 })
	})

	it("knows a function name being typed, and the argument of the call around the caret", () => {
		expect(at("1 + RO|").token).toEqual({ kind: "function", query: "RO", start: 4, end: 6 })
		expect(at("ROUND(([newPrice] - [currentPrice]) / [currentPrice], |").call).toEqual({
			name: "ROUND",
			argument: 1
		})
		// A plain parenthesis is no call: the call around it is.
		expect(at("ROUND((|").call).toEqual({ name: "ROUND", argument: 0 })
		expect(at('IF([note] = "a, b"; 1|').call).toEqual({ name: "IF", argument: 1 })
		expect(at("ROUND(1, 2)|").call).toBeNull()
	})

	it("suggests nothing inside quotes, or for a number", () => {
		expect(at('"ROU|').token).toBeNull()
		expect(at("1.2|").token).toBeNull()
	})

	it("writes fields by their labels and back by their keys, leaving quotes and doubtful names alone", () => {
		const formula = 'ROUND([newPrice] * 1.2, 2) & "[newPrice]"'
		const shown = formulaWithLabels(formula, fields)

		expect(shown).toBe('ROUND([Aralık fiyatı] * 1.2, 2) & "[newPrice]"')
		expect(formulaWithKeys(shown, fields)).toBe(formula)
		// Two fields are labelled "Not": the label names neither, and stays for the parser to refuse.
		expect(formulaWithKeys("[Not] & [note]", fields)).toBe("[Not] & [note]")
		expect(() => parseFormula(formulaWithKeys(shown, fields))).not.toThrow()
	})
})
