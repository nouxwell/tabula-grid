import { TabulaError } from "./errors.js"

/**
 * What a cell holds.
 *
 * Anything JSON can carry, and nothing else. A draft is the store's own content written out, so a
 * value that does not survive `JSON.stringify` would come back from a draft as something else, or
 * not at all: a `Date` as a string, a `Map` as `{}`, `NaN` as `null`.
 */
export type CellValue = null | boolean | number | string | readonly CellValue[] | CellObject

export interface CellObject {
	readonly [key: string]: CellValue
}

const MAX_DEPTH = 32

/**
 * A frozen copy of the input as a cell value, or an error saying why it cannot be one.
 *
 * A copy, so a caller who changes their array afterwards does not change the sheet behind its back.
 * Frozen, so a caller holding what the sheet returned cannot either. `undefined` is an empty cell,
 * `-0` is `0`, and an object's `undefined` properties are dropped: what `JSON.stringify` does.
 *
 * @param subject how the error names the value, such as `The value of "price" in row "r_7"`
 */
export function toCellValue(input: unknown, subject = "A cell value"): CellValue {
	return convert(input, subject, 0)
}

function convert(input: unknown, subject: string, depth: number): CellValue {
	if (input === null || input === undefined) {
		return null
	}

	switch (typeof input) {
		case "boolean":
		case "string":
			return input
		case "number":
			if (!Number.isFinite(input)) {
				throw refused(subject, String(input))
			}

			// JSON writes -0 as 0. Kept as -0, two cells that read the same would not be equal.
			return input === 0 ? 0 : input
		case "object":
			break
		default:
			throw refused(subject, `a ${typeof input}`)
	}

	if (depth >= MAX_DEPTH) {
		throw new TabulaError(
			"invalid_value",
			`${subject} is nested more than ${MAX_DEPTH} levels deep. A value that contains itself never ends.`
		)
	}

	if (Array.isArray(input)) {
		// Array.from, not map: map skips the holes of a sparse array and keeps them as holes.
		return Object.freeze(Array.from(input as unknown[], item => convert(item, subject, depth + 1)))
	}

	const prototype: unknown = Object.getPrototypeOf(input)

	if (prototype !== Object.prototype && prototype !== null) {
		const name = (input as { constructor?: { name?: string } }).constructor?.name

		throw refused(subject, name ? `a ${name}` : "an object that is not a plain object")
	}

	// No prototype: a key named "__proto__" is then an ordinary key rather than a way to replace it.
	const copy = Object.create(null) as Record<string, CellValue>

	for (const [key, item] of Object.entries(input)) {
		if (item !== undefined) {
			copy[key] = convert(item, subject, depth + 1)
		}
	}

	return Object.freeze(copy)
}

function refused(subject: string, got: string): TabulaError {
	return new TabulaError(
		"invalid_value",
		`${subject} must be null, a boolean, a finite number, a string, or an array or plain object of these; got ${got}.`
	)
}

/** Whether two cell values are the same, comparing arrays and objects by content. */
export function sameValue(a: CellValue, b: CellValue): boolean {
	if (a === b) {
		return true
	}

	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
		return false
	}

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false
		}

		const other: readonly CellValue[] = b

		return a.every((item: CellValue, index) => sameValue(item, other[index] ?? null))
	}

	const left = a as CellObject
	const right = b as CellObject
	const keys = Object.keys(left)

	if (keys.length !== Object.keys(right).length) {
		return false
	}

	return keys.every(key => Object.hasOwn(right, key) && sameValue(left[key] ?? null, right[key] ?? null))
}
