import { normalizeDecimal } from "./decimal.js"
import { TabulaError } from "./errors.js"
import {
	add,
	compare,
	decimalToText,
	divide,
	multiply,
	ONE,
	parseDecimal,
	round,
	ZERO,
	type Decimal
} from "./formula/decimal.js"
import type { FieldSchema } from "./schema.js"
import type { CellValue } from "./value.js"
import { digitsFor } from "./values/format.js"
import { decimalText } from "./values/number.js"
import { canonicalValue } from "./values/read.js"
import { VALUE_SETTINGS, type ValueSettings } from "./values/settings.js"

/**
 * A change made to many numbers at once, as a price list is raised. Amounts are decimal text, so a
 * rise of 5% is worked out exactly.
 *
 * - `percent`: `by` percent more: "5" raises by 5%, "-10" takes a tenth off.
 * - `add`: `by` more: "10", "-2.5".
 * - `round`: to a multiple of `step` ("0.05", "1", "10"): the nearest (`half`, the default, with a
 *   five going away from zero), the one away from zero (`up`), or the one towards it (`down`).
 */
export type Adjustment =
	| { readonly kind: "percent"; readonly by: string }
	| { readonly kind: "add"; readonly by: string }
	| { readonly kind: "round"; readonly step: string; readonly mode?: "half" | "up" | "down" }

const NUMERIC: ReadonlySet<FieldSchema["type"]> = new Set(["integer", "decimal", "money", "quantity", "percent"])
const HUNDRED: Decimal = Object.freeze({ units: BigInt(100), scale: 0 })

/** Whether the field holds numbers an adjustment can change. */
export function isAdjustable(field: FieldSchema): boolean {
	return NUMERIC.has(field.type)
}

/**
 * The value a number cell holds after `adjustment`, as decimal text with no more digits after the
 * point than the field shows (rounded half away from zero). Null when there is nothing to change:
 * an empty cell, one that holds no number, a field that does not hold numbers, or a value the
 * adjustment leaves as it was.
 *
 * @throws TabulaError `invalid_argument` for an amount that is not decimal text, or a step that is
 *   not above zero
 */
export function adjustValue(
	field: FieldSchema,
	value: CellValue,
	adjustment: Adjustment,
	settings: ValueSettings = VALUE_SETTINGS.tr
): string | null {
	const operand = operandOf(adjustment)

	if (!isAdjustable(field) || value === null) {
		return null
	}

	const text = decimalText(canonicalValue(field, value, settings))
	const number = text === null ? null : parseDecimal(text)

	if (text === null || number === null) {
		return null
	}

	let result: Decimal

	switch (adjustment.kind) {
		case "percent":
			result = multiply(number, add(ONE, divide(operand, HUNDRED) ?? ZERO))
			break
		case "add":
			result = add(number, operand)
			break
		case "round":
			result = multiply(round(divide(number, operand) ?? ZERO, 0, adjustment.mode ?? "half"), operand)
			break
	}

	const written = decimalToText(round(result, digitsFor(field, settings), "half"))

	return written === normalizeDecimal(text) ? null : written
}

/** The amount or step, read and checked before any cell is. */
function operandOf(adjustment: Adjustment): Decimal {
	const text = adjustment.kind === "round" ? adjustment.step : adjustment.by
	const operand = typeof text === "string" ? parseDecimal(text) : null

	if (operand === null) {
		throw new TabulaError(
			"invalid_argument",
			`An adjustment's ${adjustment.kind === "round" ? "step" : "amount"} must be decimal text such as "5" or "0.05"; got ${JSON.stringify(text)}.`
		)
	}

	if (adjustment.kind === "round" && compare(operand, ZERO) <= 0) {
		throw new TabulaError("invalid_argument", `A rounding step must be above zero; got "${text}".`)
	}

	return operand
}
