import { clean, escapeRegex } from "./text.js"

/**
 * Dates as a cell holds them: ISO text, "2026-12-31" for a date and "2026-12-31T09:30:00" for a
 * date and time, with no time zone. What the user typed is what is kept, as on the PHP side: a cell
 * reading 09:00 is never moved to 06:00 by an offset.
 */

interface Parts {
	year: number
	month: number
	day: number
	hour: number
	minute: number
	second: number
}

type Token = "day" | "month" | "year" | "shortYear" | "hour" | "minute" | "second"

interface CompiledPattern {
	readonly regex: RegExp
	readonly tokens: readonly Token[]
}

const TOKENS: Readonly<Record<string, readonly [Token, string]>> = {
	d: ["day", "(\\d{1,2})"],
	j: ["day", "(\\d{1,2})"],
	m: ["month", "(\\d{1,2})"],
	n: ["month", "(\\d{1,2})"],
	Y: ["year", "(\\d{4})"],
	y: ["shortYear", "(\\d{2})"],
	H: ["hour", "(\\d{1,2})"],
	G: ["hour", "(\\d{1,2})"],
	i: ["minute", "(\\d{2})"],
	s: ["second", "(\\d{2})"]
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/
const ISO_INPUT = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

/** Where the Unix epoch sits in Excel's day count, and the last day Excel still reads as a date. */
const EXCEL_EPOCH_OFFSET = 25569
const MAX_EXCEL_SERIAL = 2958465
/** A digits-only text below this is a year or a code, not a serial number: "2024" is not 1905-07-16. */
const MIN_TEXT_SERIAL = 10000

const compiled = new Map<string, CompiledPattern | null>()

/**
 * A pattern in PHP's notation as a regular expression, or null when it uses a letter this reader
 * does not know. Every other character must match itself, a space matches any run of spaces, and a
 * backslash makes the next letter literal.
 */
export function compilePattern(pattern: string): CompiledPattern | null {
	if (compiled.has(pattern)) {
		return compiled.get(pattern) ?? null
	}

	let source = ""
	const tokens: Token[] = []
	let result: CompiledPattern | null = null
	let index = 0

	for (; index < pattern.length; index++) {
		const char = pattern.charAt(index)
		const token = TOKENS[char]

		if (token) {
			tokens.push(token[0])
			source += token[1]
		} else if (char === "\\") {
			index++
			source += escapeRegex(pattern.charAt(index))
		} else if (char === "!" || char === "|") {
			// PHP's markers for "reset what the pattern leaves out", which is what happens here anyway.
		} else if (char === " ") {
			source += "[ \\t\\u00A0\\u202F]*"
		} else if (/[A-Za-z]/.test(char)) {
			break
		} else {
			source += escapeRegex(char)
		}
	}

	if (index >= pattern.length) {
		result = Object.freeze({ regex: new RegExp(`^${source}$`), tokens: Object.freeze(tokens) })
	}

	compiled.set(pattern, result)

	return result
}

/**
 * Reads a date as a person wrote it. In order: the pattern; a digits-only Excel serial number; the
 * other pattern (the date and time pattern for a date, and the other way round); ISO. A date that
 * does not exist, such as 31.02.2026, is refused rather than rolled into March.
 *
 * @returns ISO text, with the time for a date-time field and without it for a date field
 */
export function readDate(raw: string, withTime: boolean, pattern: string, otherPattern: string): string | null {
	const text = clean(raw)

	if (text === "" || isZeroDate(text)) {
		return null
	}

	const parts =
		fromPattern(text, pattern) ??
		(/^\d+$/.test(text) ? fromSerial(Number(text)) : null) ??
		fromPattern(text, otherPattern) ??
		fromIso(text)

	return parts === null ? null : toIso(parts, withTime)
}

/** Whether a value is a date, or a date and time, in the ISO form a cell holds. */
export function isIsoDate(value: unknown, withTime: boolean): value is string {
	return typeof value === "string" && parseIso(value, withTime) !== null
}

/** An ISO date written with a pattern, or null when it is not one. */
export function formatDate(value: string, withTime: boolean, pattern: string): string | null {
	const parts = parseIso(value, withTime)

	if (parts === null) {
		return null
	}

	const two = (number: number): string => String(number).padStart(2, "0")
	let text = ""

	for (let index = 0; index < pattern.length; index++) {
		const char = pattern.charAt(index)

		switch (char) {
			case "d":
				text += two(parts.day)
				break
			case "j":
				text += String(parts.day)
				break
			case "m":
				text += two(parts.month)
				break
			case "n":
				text += String(parts.month)
				break
			case "Y":
				text += String(parts.year).padStart(4, "0")
				break
			case "y":
				text += two(parts.year % 100)
				break
			case "H":
				text += two(parts.hour)
				break
			case "G":
				text += String(parts.hour)
				break
			case "i":
				text += two(parts.minute)
				break
			case "s":
				text += two(parts.second)
				break
			case "\\":
				index++
				text += pattern.charAt(index)
				break
			case "!":
			case "|":
				break
			default:
				text += char
		}
	}

	return text
}

function parseIso(value: string, withTime: boolean): Parts | null {
	const match = (withTime ? ISO_DATE_TIME : ISO_DATE).exec(value)

	if (!match) {
		return null
	}

	const [, year, month, day, hour = "0", minute = "0", second = "0"] = match

	return valid({
		year: Number(year),
		month: Number(month),
		day: Number(day),
		hour: Number(hour),
		minute: Number(minute),
		second: Number(second)
	})
}

function fromPattern(text: string, pattern: string): Parts | null {
	const compiledPattern = compilePattern(pattern)
	const match = compiledPattern?.regex.exec(text)

	if (!compiledPattern || !match) {
		return null
	}

	// What the pattern leaves out starts from the epoch, as PHP's "!" does: a pattern without a day
	// reads the first, never today.
	const parts: Parts = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

	compiledPattern.tokens.forEach((token, index) => {
		const number = Number(match[index + 1])

		switch (token) {
			case "shortYear":
				// As PHP reads "y": 70 to 99 are the 1900s, 00 to 69 the 2000s.
				parts.year = number < 70 ? 2000 + number : 1900 + number
				break
			default:
				parts[token] = number
		}
	})

	return valid(parts)
}

function fromSerial(serial: number): Parts | null {
	if (!Number.isFinite(serial) || serial < MIN_TEXT_SERIAL || serial > MAX_EXCEL_SERIAL) {
		return null
	}

	const date = new Date(Math.round((serial - EXCEL_EPOCH_OFFSET) * 86400) * 1000)

	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
		hour: date.getUTCHours(),
		minute: date.getUTCMinutes(),
		second: date.getUTCSeconds()
	}
}

function fromIso(text: string): Parts | null {
	const match = ISO_INPUT.exec(text)

	if (!match) {
		return null
	}

	const [, year, month, day, hour = "0", minute = "0", second = "0"] = match

	return valid({
		year: Number(year),
		month: Number(month),
		day: Number(day),
		hour: Number(hour),
		minute: Number(minute),
		second: Number(second)
	})
}

/** The parts when they make a real moment, or null: no 31 February, no 24:00. */
function valid(parts: Parts): Parts | null {
	const days = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate()

	if (
		parts.year < 1 ||
		parts.month < 1 ||
		parts.month > 12 ||
		parts.day < 1 ||
		parts.day > days ||
		parts.hour > 23 ||
		parts.minute > 59 ||
		parts.second > 59
	) {
		return null
	}

	return parts
}

function toIso(parts: Parts, withTime: boolean): string {
	const two = (number: number): string => String(number).padStart(2, "0")
	const date = `${String(parts.year).padStart(4, "0")}-${two(parts.month)}-${two(parts.day)}`

	return withTime ? `${date}T${two(parts.hour)}:${two(parts.minute)}:${two(parts.second)}` : date
}

/** MySQL's zero date, the broken output of another system rather than a date. */
function isZeroDate(text: string): boolean {
	const digits = text.replace(/\D/g, "")

	return digits.length >= 8 && /^0+$/.test(digits)
}
