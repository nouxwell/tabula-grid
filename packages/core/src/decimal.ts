/**
 * Decimal numbers written as text, compared without ever becoming a float.
 *
 * A limit such as a minimum price arrives from the backend as text ("0.30") so that it means what it
 * says. As floats, 0.1 + 0.2 is not 0.3, and a rule saying "at least 0.30" would refuse a sum that
 * meets it.
 */

const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/

/**
 * One way of writing each number: no sign on zero, no leading zeros, no trailing zeros after the
 * point, no point with nothing after it. `"-0012.3400"` becomes `"-12.34"`.
 *
 * Null for anything else, exponents (`1e21`), thousands separators and a decimal comma included.
 * Those belong to what a user types, and are read elsewhere with the sheet's own number settings.
 */
export function normalizeDecimal(input: string | number): string | null {
	let text: string

	if (typeof input === "number") {
		if (!Number.isFinite(input)) {
			return null
		}

		text = String(input)
	} else {
		text = input.trim()
	}

	const match = DECIMAL.exec(text)

	if (!match) {
		return null
	}

	const whole = (match[2] ?? "0").replace(/^0+(?=\d)/, "")
	const fraction = (match[3] ?? "").replace(/0+$/, "")
	const body = fraction === "" ? whole : `${whole}.${fraction}`

	if (body === "0") {
		return "0"
	}

	return match[1] === "-" ? `-${body}` : body
}

/** -1, 0 or 1 as `a` is below, equal to or above `b`. Both must be as `normalizeDecimal()` writes them. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
	const negativeA = a.startsWith("-")
	const negativeB = b.startsWith("-")

	if (negativeA !== negativeB) {
		return negativeA ? -1 : 1
	}

	const magnitude = compareMagnitude(negativeA ? a.slice(1) : a, negativeB ? b.slice(1) : b)

	// 0 - magnitude, not -magnitude: the latter turns an equal pair into -0.
	return negativeA ? ((0 - magnitude) as -1 | 0 | 1) : magnitude
}

function compareMagnitude(a: string, b: string): -1 | 0 | 1 {
	const [wholeA = "", fractionA = ""] = a.split(".")
	const [wholeB = "", fractionB = ""] = b.split(".")

	// No leading zeros, so the longer whole part is the larger number.
	if (wholeA.length !== wholeB.length) {
		return wholeA.length < wholeB.length ? -1 : 1
	}

	if (wholeA !== wholeB) {
		return wholeA < wholeB ? -1 : 1
	}

	const length = Math.max(fractionA.length, fractionB.length)
	const paddedA = fractionA.padEnd(length, "0")
	const paddedB = fractionB.padEnd(length, "0")

	if (paddedA === paddedB) {
		return 0
	}

	return paddedA < paddedB ? -1 : 1
}
