import { add, compare, decimalToText, divide, parseDecimal, round, ZERO, type Decimal } from "./formula/decimal.js"
import { isFormulaError } from "./formula/error.js"
import type { FieldSchema, FieldType } from "./schema.js"
import type { CellValue } from "./value.js"
import { decimalText } from "./values/number.js"

/**
 * What a status bar says about the cells selected, as a spreadsheet's does: how many hold
 * something, how many hold numbers, and their sum and average, worked out exactly.
 */
export interface CellSummary {
	/** Cells holding anything. */
	readonly filled: number
	/** Cells of a numeric field holding a number. */
	readonly numbers: number
	/** Decimal text, such as `"3819.8"`; null when no cell holds a number. */
	readonly sum: string | null
	/** Decimal text, to 10 places at most; null when no cell holds a number. */
	readonly average: string | null
	/** The smallest number, as decimal text; null when no cell holds a number. */
	readonly min: string | null
	/** The largest number, as decimal text; null when no cell holds a number. */
	readonly max: string | null
}

const NUMERIC: ReadonlySet<FieldType> = new Set(["integer", "decimal", "money", "quantity", "percent"])
const AVERAGE_PLACES = 10

/**
 * Sums the numbers among the cells given, each with its field. Only a numeric field's numbers
 * count: "123" typed into a text column is text, as in a spreadsheet, and so is what a cell holds
 * that could not be read as its field's number.
 */
export function summarizeCells(
	cells: Iterable<{ readonly field: FieldSchema; readonly value: CellValue }>
): CellSummary {
	let filled = 0
	let numbers = 0
	let sum: Decimal = ZERO
	let min: Decimal | null = null
	let max: Decimal | null = null

	for (const { field, value } of cells) {
		if (value === null) {
			continue
		}

		filled++

		if (!NUMERIC.has(field.type) || isFormulaError(value)) {
			continue
		}

		const text = decimalText(value)
		const number = text === null ? null : parseDecimal(text)

		if (number !== null) {
			numbers++
			sum = add(sum, number)
			min = min === null || compare(number, min) < 0 ? number : min
			max = max === null || compare(number, max) > 0 ? number : max
		}
	}

	if (numbers === 0 || min === null || max === null) {
		return Object.freeze({ filled, numbers, sum: null, average: null, min: null, max: null })
	}

	const average = divide(sum, parseDecimal(String(numbers)) ?? ZERO)

	return Object.freeze({
		filled,
		numbers,
		sum: decimalToText(sum),
		average: average === null ? null : decimalToText(round(average, AVERAGE_PLACES, "half")),
		min: decimalToText(min),
		max: decimalToText(max)
	})
}
