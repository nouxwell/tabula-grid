/**
 * Decimal arithmetic for formulas, exact where floats are not: a number is an integer and a count of
 * places after the point, so 0.1 + 0.2 is 0.3 and a price times a quantity is what a till says.
 */

/** `units / 10^scale`. */
export interface Decimal {
	readonly units: bigint
	readonly scale: number
}

/** Places after the point a division is carried to before it is rounded. */
export const DIVISION_PLACES = 20

const TEXT = /^([+-]?)(\d+)(?:\.(\d+))?$/

// BigInt(…) rather than literals such as 10n: a build that aims at an older JavaScript, as Nuxt's
// server build does, warns that the literals may not run, though anything that runs this has BigInt.
const B0 = BigInt(0)
const B1 = BigInt(1)
const B2 = BigInt(2)
const B10 = BigInt(10)
const B1000 = BigInt(1000)

export const ZERO: Decimal = Object.freeze({ units: B0, scale: 0 })
export const ONE: Decimal = Object.freeze({ units: B1, scale: 0 })

/** A decimal from text such as `"-12.50"`; null for anything else. */
export function parseDecimal(text: string): Decimal | null {
	const match = TEXT.exec(text.trim())

	if (!match) {
		return null
	}

	const fraction = match[3] ?? ""
	const units = BigInt(`${match[2] ?? "0"}${fraction}`)

	return simplify({ units: match[1] === "-" ? -units : units, scale: fraction.length })
}

/** The decimal as `normalizeDecimal` writes numbers: `"-12.5"`, `"0"`. */
export function decimalToText(value: Decimal): string {
	const negative = value.units < B0
	const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, "0")
	const whole = digits.slice(0, digits.length - value.scale)
	const fraction = digits.slice(digits.length - value.scale).replace(/0+$/, "")
	const body = fraction === "" ? whole : `${whole}.${fraction}`

	return negative && body !== "0" ? `-${body}` : body
}

export function add(a: Decimal, b: Decimal): Decimal {
	const [x, y, scale] = aligned(a, b)

	return simplify({ units: x + y, scale })
}

export function subtract(a: Decimal, b: Decimal): Decimal {
	const [x, y, scale] = aligned(a, b)

	return simplify({ units: x - y, scale })
}

export function multiply(a: Decimal, b: Decimal): Decimal {
	return simplify({ units: a.units * b.units, scale: a.scale + b.scale })
}

/** Null when dividing by zero. Carried to `DIVISION_PLACES` places, rounded half away from zero. */
export function divide(a: Decimal, b: Decimal): Decimal | null {
	if (b.units === B0) {
		return null
	}

	// a / b = (a.units / 10^a.scale) / (b.units / 10^b.scale); one place more than kept, to round on.
	const places = DIVISION_PLACES + 1
	const numerator = a.units * B10 ** BigInt(places + b.scale)
	const denominator = b.units * B10 ** BigInt(a.scale)

	return round({ units: numerator / denominator, scale: places }, DIVISION_PLACES, "half")
}

export function negate(value: Decimal): Decimal {
	return { units: -value.units, scale: value.scale }
}

export function absolute(value: Decimal): Decimal {
	return value.units < B0 ? negate(value) : value
}

/** -1, 0 or 1. */
export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
	const [x, y] = aligned(a, b)

	return x < y ? -1 : x > y ? 1 : 0
}

export function isZero(value: Decimal): boolean {
	return value.units === B0
}

export function isInteger(value: Decimal): boolean {
	return value.scale === 0
}

/**
 * Rounded to `places` after the point (negative rounds to tens, hundreds…). `half` is away from zero
 * at five, as Excel and nouxwell/tabula round; `up` is away from zero, `down` towards it.
 */
export function round(value: Decimal, places: number, mode: "half" | "up" | "down"): Decimal {
	if (value.scale <= places) {
		return value
	}

	const drop = B10 ** BigInt(value.scale - places)
	const negative = value.units < B0
	const magnitude = negative ? -value.units : value.units
	let kept = magnitude / drop
	const rest = magnitude % drop

	if (rest !== B0 && (mode === "up" || (mode === "half" && rest * B2 >= drop))) {
		kept += B1
	}

	const units = negative ? -kept : kept

	return places >= 0
		? simplify({ units, scale: places })
		: simplify({ units: units * B10 ** BigInt(-places), scale: 0 })
}

/** A whole power: exact for a whole exponent, null for any other, which the caller reports. */
export function power(base: Decimal, exponent: Decimal): Decimal | null {
	if (!isInteger(exponent) || exponent.units > B1000 || exponent.units < -B1000) {
		return null
	}

	const times = Number(exponent.units < B0 ? -exponent.units : exponent.units)
	let result: Decimal = ONE

	for (let step = 0; step < times; step++) {
		result = multiply(result, base)
	}

	return exponent.units < B0 ? divide(ONE, result) : result
}

/** Both as integers of the same scale. */
function aligned(a: Decimal, b: Decimal): [bigint, bigint, number] {
	const scale = Math.max(a.scale, b.scale)

	return [a.units * B10 ** BigInt(scale - a.scale), b.units * B10 ** BigInt(scale - b.scale), scale]
}

/** Without trailing zeros after the point. */
function simplify(value: Decimal): Decimal {
	let { units, scale } = value

	while (scale > 0 && units % B10 === B0) {
		units /= B10
		scale--
	}

	return Object.freeze({ units, scale })
}
