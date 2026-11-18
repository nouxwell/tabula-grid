import { compareDecimal, normalizeDecimal } from "../decimal.js"
import type { ValueSettings } from "./settings.js"
import { clean, escapeRegex, phpTrim } from "./text.js"

/**
 * Numbers as a cell holds them: decimal text such as "1234.56", never a float, so a price is
 * exactly what was typed. Reading follows nouxwell/tabula's `NumberFormatter::parse()` rule for rule.
 * Where PHP turns the text into a float, this keeps the digits: same value, no rounding.
 */

/** How a number is written by machines: an optional minus, digits, and a point with digits after it. */
const MACHINE_DECIMAL = /^-?\d+(?:\.\d+)?$/

/** The largest whole number PHP keeps as an integer, PHP_INT_MAX. */
const LARGEST_INTEGER = "9223372036854775807"

/** A number value as decimal text, or null when it is not one. Strings must be in machine form. */
export function decimalText(value: unknown): string | null {
	if (typeof value === "string") {
		return MACHINE_DECIMAL.test(value) ? value : null
	}

	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null
	}

	const text = String(value)

	// String() writes 1e21 and 1e-7 with an exponent; spelled out, they are decimal text again.
	return /e/i.test(text) ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 }) : text
}

export function isWholeNumberText(text: string): boolean {
	return /^-?\d+$/.test(text)
}

/** Whether a whole number is past what PHP can hold as an integer. */
export function isTooLarge(text: string): boolean {
	return compareDecimal(text.replace(/^-/, ""), LARGEST_INTEGER) > 0
}

/**
 * Reads a number as a person wrote it, with the sheet's separators.
 *
 * "1.234,56", "1,234.56", "1.234 ₺", "(1.234,56)" and "1.234,56-" are all understood, and a lone
 * thousands separator followed by three digits is grouping: "1.234" is 1234 with Turkish settings.
 * Letters and symbols around the number are dropped, as on the PHP side: "12 adet" is 12.
 */
export function readNumber(raw: string, settings: ValueSettings): string | null {
	const text = phpTrim(raw)

	if (text === "") {
		return null
	}

	const negative = isNegative(text)
	const separators = separatorsOf(settings)
	const spaced = text.replace(/[\u00A0\u202F\u2009]/g, " ")
	const cleaned = spaced.replace(new RegExp(`[^0-9${escapeRegex(separators.join(""))}]`, "gu"), "")

	if (cleaned === "") {
		return null
	}

	const [last, at] = lastSeparator(cleaned, separators)

	if (last === null) {
		return signed(digitsOnly(cleaned), negative)
	}

	const head = cleaned.slice(0, at)
	const tail = cleaned.slice(at + last.length)

	if (!isDecimalSeparator(last, head, tail, separators, settings)) {
		return signed(digitsOnly(removeAll(cleaned, separators)), negative)
	}

	const whole = removeAll(head, separators) || "0"

	if (!/^\d+$/.test(whole) || !/^\d+$/.test(tail)) {
		return null
	}

	return signed(normalizeDecimal(`${whole}.${tail}`), negative)
}

/**
 * Reads an amount: the currency symbols and codes the settings know, and the field's own, are taken
 * off either end first. Taken off rather than left to the number reader, because a symbol holding a
 * point, such as "S/.", would leave a point behind and multiply the amount by a hundred.
 */
export function readMoney(raw: string, currency: string | null, settings: ValueSettings): string | null {
	let text = clean(raw)

	for (const symbol of symbolCandidates(currency, settings)) {
		const quoted = escapeRegex(symbol)

		text = text.replace(new RegExp(`^\\s*${quoted}\\s*|\\s*${quoted}\\s*$`, "giu"), "")
	}

	return readNumber(phpTrim(text), settings)
}

/** Reads a percentage written with or without its sign, before or after: "%15", "15 %", "15". */
export function readPercent(raw: string, settings: ValueSettings): string | null {
	return readNumber(clean(raw).replace(/^%\s*|\s*%$/g, ""), settings)
}

/** The symbol a currency is shown with, or null when symbols are not shown. */
export function symbolFor(currency: string | null, settings: ValueSettings): string | null {
	if (currency === null || settings.symbolPosition === "none") {
		return null
	}

	return settings.currencySymbols[currency] ?? currency
}

/**
 * Decimal text rounded to `digits` places and written the sheet's way: "1234.565" with Turkish
 * settings and two digits is "1.234,57". Rounded half away from zero, on the digits themselves.
 */
export function formatNumber(value: string, digits: number, settings: ValueSettings): string {
	const rounded = roundDecimal(value, digits)
	const negative = rounded.startsWith("-")
	const [whole = "0", fraction] = (negative ? rounded.slice(1) : rounded).split(".")
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, settings.thousandSeparator)

	return `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : settings.decimalSeparator + fraction}`
}

/** Decimal text as a person edits it: every digit kept, the sheet's decimal separator, no grouping. */
export function editNumber(value: string, settings: ValueSettings): string {
	return value.replace(".", settings.decimalSeparator)
}

/** Rounds decimal text to exactly `digits` places, half away from zero. "-0.001" to two places is "0.00". */
export function roundDecimal(value: string, digits: number): string {
	const negative = value.startsWith("-")
	const [rawWhole = "0", rawFraction = ""] = (negative ? value.slice(1) : value).split(".")
	let whole = rawWhole.replace(/^0+(?=\d)/, "")
	let fraction = rawFraction

	if (fraction.length <= digits) {
		fraction = fraction.padEnd(digits, "0")
	} else {
		const roundUp = (fraction.charAt(digits) || "0") >= "5"

		fraction = fraction.slice(0, digits)

		if (roundUp) {
			const bumped = increment(whole + fraction)

			whole = bumped.slice(0, bumped.length - digits) || "0"
			fraction = bumped.slice(bumped.length - digits)
		}
	}

	const zero = /^0*$/.test(whole + fraction)

	return `${negative && !zero ? "-" : ""}${whole}${digits > 0 ? `.${fraction}` : ""}`
}

function increment(digits: string): string {
	const list = digits.split("")

	for (let index = list.length - 1; index >= 0; index--) {
		if (list[index] === "9") {
			list[index] = "0"
		} else {
			list[index] = String(Number(list[index]) + 1)

			return list.join("")
		}
	}

	return `1${list.join("")}`
}

/**
 * The negative notations: a leading or trailing minus, accounting parentheses, and a minus right
 * before the digits after a symbol ("₺ -1.234,56"). Looked for before the cleanup, which loses them.
 */
function isNegative(text: string): boolean {
	if (text.includes("(") && text.includes(")")) {
		return true
	}

	if (text.startsWith("-") || text.endsWith("-")) {
		return true
	}

	return /^\D*-\s*\d/u.test(text)
}

/**
 * Whether the right-most separator is the decimal point, in the order nouxwell/tabula decides it:
 * another kind of separator before it; the same one twice; the configured decimal separator; the
 * configured thousands separator with exactly three digits after it; anything else is decimal.
 */
function isDecimalSeparator(
	separator: string,
	head: string,
	tail: string,
	separators: readonly string[],
	settings: ValueSettings
): boolean {
	if (tail === "" || !/^\d+$/.test(tail)) {
		return false
	}

	if (separators.some(other => other !== separator && head.includes(other))) {
		return true
	}

	if (head.includes(separator)) {
		return false
	}

	if (separator === settings.decimalSeparator) {
		return true
	}

	if (separator === settings.thousandSeparator) {
		return tail.length !== 3
	}

	return true
}

/** The configured separators, then the universal point and comma: "1,234.56" is read with Turkish settings too. */
function separatorsOf(settings: ValueSettings): string[] {
	return [...new Set([settings.decimalSeparator, settings.thousandSeparator, ".", ","].filter(Boolean))]
}

function lastSeparator(text: string, separators: readonly string[]): [string | null, number] {
	let found: string | null = null
	let at = -1

	for (const separator of separators) {
		const position = text.lastIndexOf(separator)

		if (position > at) {
			found = separator
			at = position
		}
	}

	return [found, at]
}

function removeAll(text: string, separators: readonly string[]): string {
	return separators.reduce((result, separator) => result.split(separator).join(""), text)
}

function digitsOnly(text: string): string | null {
	return /^\d+$/.test(text) ? normalizeDecimal(text) : null
}

function signed(text: string | null, negative: boolean): string | null {
	return text === null || !negative || text === "0" ? text : `-${text}`
}

/**
 * Every symbol and code that could stand around an amount, longest first, so "US$" goes before "$"
 * and leaves no "US" behind. One that could be part of a number, such as a separator, is never one.
 */
function symbolCandidates(currency: string | null, settings: ValueSettings): string[] {
	const candidates = [...Object.values(settings.currencySymbols), ...Object.keys(settings.currencySymbols)]

	if (currency !== null) {
		candidates.push(currency)

		const symbol = symbolFor(currency, settings)

		if (symbol !== null) {
			candidates.push(symbol)
		}
	}

	const separators = [settings.decimalSeparator, settings.thousandSeparator]
	const usable = candidates
		.map(candidate => phpTrim(candidate))
		.filter(candidate => candidate !== "" && !separators.includes(candidate) && !/^[0-9.,\s]+$/u.test(candidate))

	return [...new Set(usable)].sort((a, b) => Array.from(b).length - Array.from(a).length)
}
