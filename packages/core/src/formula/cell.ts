import type { ModuleSchema } from "../schema.js"
import type { CellValue } from "../value.js"
import { readInput, type ValueProblem } from "../values/read.js"
import type { ValueSettings } from "../values/settings.js"
import { decimalToText, round } from "./decimal.js"
import { rowContext, upperKeys, type FormulaSheets } from "./engine.js"
import type { FormulaErrorCode } from "./error.js"
import { evaluate, toBool, toNumber, toText, type FormulaFunction, type FormulaValue } from "./evaluate.js"
import { formulaFields, FormulaSyntaxError, parseFormula } from "./parse.js"

/**
 * A formula typed into a cell, as a spreadsheet takes "=" there: worked out once, for the cell's
 * row, and its result written as the cell's value. The formula is not kept; what is written is a
 * value like any typed one, checked, sent and taken back with Ctrl+Z as one.
 */
export interface CellFormulaOptions {
	readonly schema: ModuleSchema
	/** The key of the field the result goes into. */
	readonly field: string
	/** A field of the cell's row, by key, as the store holds it. */
	readonly read: (key: string) => CellValue
	/**
	 * How the formula's numbers are written and how its result is read: with a decimal comma, `1,1`
	 * is a number and `;` separates arguments, as in a Turkish Excel.
	 */
	readonly settings: ValueSettings
	readonly functions?: Readonly<Record<string, FormulaFunction>>
	/** The workbook's other sheets, for SHEET. */
	readonly sheets?: FormulaSheets | null
}

export type CellFormulaResult =
	/** The value to write; null empties the cell. */
	| { readonly status: "value"; readonly value: CellValue }
	/** The formula does not parse; `at` is where it stopped, from 0, in the formula as given. */
	| { readonly status: "invalid"; readonly message: string; readonly at: number }
	/** It reads a field the schema has not, by the name written. */
	| { readonly status: "unknown"; readonly name: string }
	/** It works out to an error value, such as `#DIV/0!`. */
	| { readonly status: "error"; readonly error: FormulaErrorCode }
	/** Its result is not a value of the field, such as text that is none of an options field's options. */
	| { readonly status: "unfit"; readonly problem: ValueProblem }

/**
 * Works a formula typed into a cell out for that cell's row. The formula reads fields by key, in
 * brackets; a leading "=" is allowed. Nothing is written: the caller writes `value` when it is one.
 * A record field, such as a lookup, takes no formula: its result is `unfit`.
 */
export function workOutCell(formula: string, options: CellFormulaOptions): CellFormulaResult {
	const { schema, settings } = options
	const field = schema.field(options.field)
	let tree

	try {
		tree = parseFormula(formula, { decimalSeparator: settings.decimalSeparator === "," ? "," : "." })
	} catch (error) {
		if (error instanceof FormulaSyntaxError) {
			return { status: "invalid", message: error.message, at: error.at }
		}

		throw error
	}

	const unknown = formulaFields(tree).find(key => !schema.has(key))

	if (unknown !== undefined) {
		return { status: "unknown", name: unknown }
	}

	const result = evaluate(
		tree,
		rowContext(schema, options.read, upperKeys(options.functions ?? {}), options.sheets ?? null)
	)

	if (result.type === "error") {
		return { status: "error", error: result.code }
	}

	if (result.type === "empty") {
		return { status: "value", value: null }
	}

	switch (field.type) {
		case "integer":
		case "decimal":
		case "quantity":
		case "money":
		case "percent": {
			const number = toNumber(result)

			if ("type" in number) {
				return { status: "error", error: number.code }
			}

			const places = field.type === "integer" ? 0 : field.decimals

			return { status: "value", value: decimalToText(places === null ? number : round(number, places, "half")) }
		}
		case "bool": {
			const truth = toBool(result)

			return typeof truth === "boolean"
				? { status: "value", value: truth }
				: { status: "error", error: truth.code }
		}
		default:
			return asTyped(options, result)
	}
}

/** A result read as the user would have typed it: text, a date, an option. */
function asTyped(options: CellFormulaOptions, result: FormulaValue): CellFormulaResult {
	const field = options.schema.field(options.field)
	const text = toText(result)

	if (typeof text !== "string") {
		return { status: "error", error: text.code }
	}

	// A number is written as the sheet writes numbers: "2993,32" in Turkish, not "2993.32".
	const typed = result.type === "number" ? text.replace(".", options.settings.decimalSeparator) : text
	const read = readInput(field, typed, options.settings)

	return read.problem ? { status: "unfit", problem: read.problem } : { status: "value", value: read.value }
}
