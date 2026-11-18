import { isFormulaError } from "../formula/error.js"
import type { FieldSchema } from "../schema.js"
import type { CellValue } from "../value.js"
import { formatDate } from "./date.js"
import { decimalText, editNumber, formatNumber, symbolFor } from "./number.js"
import { datePatternOf, describeValue, isFieldValue, isLookupValue } from "./read.js"
import type { ValueSettings } from "./settings.js"

/** How one column is drawn over its field's own way: a column's format. */
export interface CellFormatOptions {
	/** Digits after the point a number shows, in place of its field's. The value is not rounded. */
	readonly decimals?: number
}

/**
 * What a cell shows: its value written the sheet's way, "1.571,41 ₺", "31.12.2026", "Evet". A cell
 * still holding text that could not be read shows that text as it was typed.
 */
export function formatCell(
	field: FieldSchema,
	value: CellValue,
	settings: ValueSettings,
	options: CellFormatOptions = {}
): string {
	if (value === null) {
		return ""
	}

	// A formula that could not be worked out shows its error, as a spreadsheet's cell does.
	if (isFormulaError(value)) {
		return value.formulaError
	}

	if (!isFieldValue(field, value)) {
		return describeValue(value)
	}

	switch (field.type) {
		case "integer":
		case "decimal":
		case "quantity":
		case "percent":
			return formatNumber(decimalText(value) ?? "0", options.decimals ?? digitsFor(field, settings), settings)
		case "money": {
			const number = formatNumber(
				decimalText(value) ?? "0",
				options.decimals ?? digitsFor(field, settings),
				settings
			)
			const symbol = symbolFor(field.currency, settings)

			if (symbol === null || symbol === "") {
				return number
			}

			return settings.symbolPosition === "before" ? `${symbol} ${number}` : `${number} ${symbol}`
		}
		case "bool":
			return value ? settings.trueWord : settings.falseWord
		case "date":
		case "datetime":
			return (
				formatDate(value as string, field.type === "datetime", datePatternOf(field, settings)) ??
				describeValue(value)
			)
		case "options": {
			const values = Array.isArray(value) ? (value as readonly CellValue[]) : [value]

			return values
				.map(item => field.options.find(option => option.value === item)?.label ?? describeValue(item))
				.join(", ")
		}
		case "lookup":
			return isLookupValue(value) ? value.label : describeValue(value)
		case "string":
			return describeValue(value)
	}
}

/**
 * The text an editor opens with. A number keeps every digit it has and drops the grouping and the
 * symbol, "1571,4125" rather than "1.571,41 ₺", so editing it never rounds it. The rest is what the
 * cell shows. Either way, reading the text back gives the same value.
 */
export function editText(field: FieldSchema, value: CellValue, settings: ValueSettings): string {
	if (value === null) {
		return ""
	}

	if (isFormulaError(value)) {
		return value.formulaError
	}

	switch (field.type) {
		case "integer":
		case "decimal":
		case "quantity":
		case "percent":
		case "money": {
			const number = isFieldValue(field, value) ? decimalText(value) : null

			return number === null ? describeValue(value) : editNumber(number, settings)
		}
		default:
			return formatCell(field, value, settings)
	}
}

/** Digits after the point: the field's own, or the settings' default for its type. An integer has none. */
export function digitsFor(field: FieldSchema, settings: ValueSettings): number {
	switch (field.type) {
		case "decimal":
			return field.decimals ?? settings.decimalDigits
		case "quantity":
			return field.decimals ?? settings.quantityDigits
		case "percent":
			return field.decimals ?? settings.percentDigits
		case "money":
			return field.decimals ?? settings.moneyDigits
		default:
			return 0
	}
}
