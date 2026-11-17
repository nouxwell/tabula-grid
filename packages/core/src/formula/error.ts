import type { CellValue } from "../value"

/**
 * What a formula gives when it cannot give a value, as Excel writes it: `#DIV/0!` for a division by
 * zero, `#VALUE!` for a value of the wrong kind (text where a number goes), `#NAME?` for a function
 * nobody defined, `#NUM!` for a number that cannot be (a fractional power).
 */
export type FormulaErrorCode = "#DIV/0!" | "#VALUE!" | "#NAME?" | "#NUM!"

/** A cell holding a formula's error: kept in the cell, as the value it shows, and reported as an issue. */
// A type rather than an interface, so it is a cell value as it stands.
export type FormulaErrorValue = { readonly formulaError: FormulaErrorCode }

export function isFormulaError(value: CellValue): value is FormulaErrorValue {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as Record<string, CellValue>).formulaError === "string"
	)
}

export function formulaErrorValue(code: FormulaErrorCode): FormulaErrorValue {
	return Object.freeze({ formulaError: code })
}
