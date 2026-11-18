import { add, compare, decimalToText, multiply, parseDecimal, subtract, type Decimal } from "./formula/decimal.js"
import type { FieldSchema, FieldType } from "./schema.js"
import type { CellValue } from "./value.js"
import { isIsoDate } from "./values/date.js"
import { decimalText } from "./values/number.js"

/**
 * Filling cells from those selected, as a spreadsheet's fill handle does: the values go on as a
 * series where they make one, and repeat where they do not.
 *
 * - **One number** is copied; **one date** goes on a day at a time; **one text ending in a number**
 *   counts on, "Ürün 9" to "Ürün 10", keeping leading zeros, "A009" to "A010".
 * - **Several values with one step between them** go on by that step: 10, 20 gives 30, 40; dates a
 *   week apart go on by weeks, and dates on one day of the month go on by months.
 * - **Anything else repeats**, in its order: yes, no, yes, no; or 1, 3, 2, 1, 3, 2.
 *
 * A number is worked out exactly, as decimal text, so 0.1 steps never drift to 0.30000000000000004.
 */

/**
 * - `auto`: as above.
 * - `alternate`: as with Ctrl held in Excel. A fill that would count repeats instead, and one number,
 *   which would be copied, counts by one.
 * - `copy`: the values repeat, whatever they are, as Ctrl+D fills.
 */
export type FillMode = "auto" | "alternate" | "copy"

export interface FillOptions {
	/** Filling up or left: the values are worked out going back from the first. */
	readonly backward?: boolean
	readonly mode?: FillMode
}

const NUMERIC: ReadonlySet<FieldType> = new Set(["integer", "decimal", "money", "quantity", "percent"])
const DAY_MS = 86_400_000
const DAY_SECONDS = 86_400
/** Text that ends in a number: what comes before it, and its digits. */
const TRAILING_NUMBER = /^([\s\S]*?)(\d+)$/
const ISO_PARTS = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/

/**
 * The values for `count` cells beyond those given, in the field's own form. `values[0]` goes next
 * to the source and each after it one cell further away: below the last value, or, `backward`,
 * above the first.
 *
 * `field` is the field of every cell given, or null when they come from fields of different kinds,
 * as a fill across columns can: the values then repeat.
 */
export function fillValues(
	field: FieldSchema | null,
	source: readonly CellValue[],
	count: number,
	options: FillOptions = {}
): CellValue[] {
	const length = source.length
	const backward = options.backward ?? false
	const mode = options.mode ?? "auto"

	if (length === 0 || count <= 0) {
		return []
	}

	const series = mode === "copy" || field === null ? null : seriesOf(field, source, mode)

	return Array.from({ length: count }, (_, index) => {
		const distance = index + 1

		if (series !== null) {
			return series(backward ? -distance : length - 1 + distance)
		}

		// Repeating backwards keeps the pattern in step: the cell above the first holds the last.
		return source[backward ? (length - (distance % length)) % length : index % length] ?? null
	})
}

/**
 * The value at a place in the series the source starts, the first value at 0, or null when the
 * values make none and are to repeat.
 */
type Series = (place: number) => CellValue

function seriesOf(field: FieldSchema, source: readonly CellValue[], mode: FillMode): Series | null {
	if (NUMERIC.has(field.type)) {
		return numberSeries(source, mode)
	}

	if (field.type === "date" || field.type === "datetime") {
		return dateSeries(source, field.type === "datetime", mode)
	}

	if (field.type === "string") {
		return textSeries(source, mode)
	}

	return null
}

function numberSeries(source: readonly CellValue[], mode: FillMode): Series | null {
	const numbers = decimals(source.map(value => decimalText(value)))

	if (numbers === null) {
		return null
	}

	const step = stepOf(numbers, mode)

	return step === null ? null : place => decimalToText(at(numbers, step, place))
}

/**
 * Text that ends in a number counts on its own, where a number does not: "Ürün 9" is a name in a
 * row of names. Text that is only digits fills as a number does.
 */
function textSeries(source: readonly CellValue[], mode: FillMode): Series | null {
	const matches = source.map(value => (typeof value === "string" ? TRAILING_NUMBER.exec(value) : null))
	const prefix = matches[0]?.[1]

	if (prefix === undefined || matches.some(match => match === null || match[1] !== prefix)) {
		return null
	}

	const digits = matches.map(match => match?.[2] ?? "")
	const numbers = decimals(digits)
	// Alone, a number with a name before it counts; digits alone are copied, as a number is.
	const step = numbers === null ? null : stepOf(numbers, mode, prefix !== "")

	if (numbers === null || step === null) {
		return null
	}

	// "A009" keeps its three digits; "A9" grows to "A10" as a number does.
	const width = digits.some(text => text.length > 1 && text.startsWith("0"))
		? Math.max(...digits.map(d => d.length))
		: 0

	return place => {
		// As Excel does, a count going below zero is written without its sign: "Hafta 1", "Hafta 0", "Hafta 1".
		const number = decimalToText(at(numbers, step, place)).replace(/^-/, "")

		return prefix + number.padStart(width, "0")
	}
}

function dateSeries(source: readonly CellValue[], withTime: boolean, mode: FillMode): Series | null {
	const dates = source.map(value => (isIsoDate(value, withTime) ? partsOf(value) : null))

	if (dates.some(date => date === null)) {
		return null
	}

	const parts = dates as DateParts[]
	const months = monthSeries(parts, withTime, mode)

	if (months !== null) {
		return months
	}

	// One date goes on a day at a time; several, by the days (or seconds) between them.
	const points = decimals(parts.map(date => String(withTime ? secondOf(date) : dayOf(date))))
	const step = points === null ? null : stepOf(points, mode, true, withTime ? DAY_SECONDS : 1)

	if (points === null || step === null) {
		return null
	}

	return place => {
		const point = Number(decimalToText(at(points, step, place)))

		return withTime ? isoOf(fromSecond(point), true) : isoOf(fromDay(point), false)
	}
}

/**
 * Dates on one day of the month, at one time, months apart: the 15th of January, then of February,
 * go on to the 15th of March, as a day count could not. A month too short for the day ends the
 * date at its last: 31 January a month on is 28 February.
 */
function monthSeries(dates: readonly DateParts[], withTime: boolean, mode: FillMode): Series | null {
	const first = dates[0]

	if (mode !== "auto" || dates.length < 2 || first === undefined) {
		return null
	}

	const sameDay = dates.every(
		date =>
			date.day === first.day &&
			date.hour === first.hour &&
			date.minute === first.minute &&
			date.second === first.second
	)
	const months = dates.map(date => date.year * 12 + date.month - 1)
	const step = (months[1] ?? 0) - (months[0] ?? 0)

	if (!sameDay || step === 0 || months.some((month, index) => month - (months[0] ?? 0) !== step * index)) {
		return null
	}

	return place => {
		const month = (months[0] ?? 0) + step * place
		const year = Math.floor(month / 12)
		const inMonth = (month % 12) + 1
		const day = Math.min(first.day, daysIn(year, inMonth))

		return isoOf({ ...first, year, month: inMonth, day }, withTime)
	}
}

// ---------------------------------------------------------------- steps

/**
 * The step between the values, or null when they repeat instead. One value has none of its own:
 * it counts by `single` when `counts` says a lone value of its kind does, and repeats otherwise;
 * `alternate` turns that round, and makes several values repeat.
 */
function stepOf(numbers: readonly Decimal[], mode: FillMode, counts = false, single = 1): Decimal | null {
	const [first, second] = numbers

	if (first === undefined) {
		return null
	}

	if (second === undefined) {
		const counting = mode === "alternate" ? !counts : counts

		return counting ? (parseDecimal(String(single)) ?? null) : null
	}

	if (mode === "alternate") {
		return null
	}

	const step = subtract(second, first)

	for (let index = 2; index < numbers.length; index++) {
		const value = numbers[index]
		const before = numbers[index - 1]

		if (value === undefined || before === undefined || compare(subtract(value, before), step) !== 0) {
			return null
		}
	}

	return step
}

/** The value at a place in the series: the first plus so many steps. */
function at(numbers: readonly Decimal[], step: Decimal, place: number): Decimal {
	const first = numbers[0] as Decimal

	return add(first, multiply(step, parseDecimal(String(place)) as Decimal))
}

function decimals(texts: readonly (string | null)[]): Decimal[] | null {
	const numbers: Decimal[] = []

	for (const text of texts) {
		const number = text === null ? null : parseDecimal(text)

		if (number === null) {
			return null
		}

		numbers.push(number)
	}

	return numbers
}

// ---------------------------------------------------------------- dates

interface DateParts {
	readonly year: number
	readonly month: number
	readonly day: number
	readonly hour: number
	readonly minute: number
	readonly second: number
}

function partsOf(iso: string): DateParts | null {
	const match = ISO_PARTS.exec(iso)

	if (!match) {
		return null
	}

	const [, year, month, day, hour = "0", minute = "0", second = "0"] = match

	return {
		year: Number(year),
		month: Number(month),
		day: Number(day),
		hour: Number(hour),
		minute: Number(minute),
		second: Number(second)
	}
}

/** Days since 1970-01-01. Set field by field: Date.UTC reads the years 0 to 99 as 1900 to 1999. */
function dayOf(date: DateParts): number {
	const moment = new Date(0)

	moment.setUTCFullYear(date.year, date.month - 1, date.day)

	return Math.round(moment.getTime() / DAY_MS)
}

function secondOf(date: DateParts): number {
	return dayOf(date) * DAY_SECONDS + date.hour * 3600 + date.minute * 60 + date.second
}

function fromDay(day: number): DateParts {
	const moment = new Date(day * DAY_MS)

	return {
		year: moment.getUTCFullYear(),
		month: moment.getUTCMonth() + 1,
		day: moment.getUTCDate(),
		hour: 0,
		minute: 0,
		second: 0
	}
}

function fromSecond(second: number): DateParts {
	const day = Math.floor(second / DAY_SECONDS)
	const rest = second - day * DAY_SECONDS

	return {
		...fromDay(day),
		hour: Math.floor(rest / 3600),
		minute: Math.floor((rest % 3600) / 60),
		second: rest % 60
	}
}

function daysIn(year: number, month: number): number {
	return fromDay(dayOf({ year, month: month + 1, day: 1, hour: 0, minute: 0, second: 0 }) - 1).day
}

/** ISO text, or null past what a cell can hold: the years 1 to 9999. */
function isoOf(date: DateParts, withTime: boolean): string | null {
	if (date.year < 1 || date.year > 9999) {
		return null
	}

	const two = (value: number): string => String(value).padStart(2, "0")
	const day = `${String(date.year).padStart(4, "0")}-${two(date.month)}-${two(date.day)}`

	return withTime ? `${day}T${two(date.hour)}:${two(date.minute)}:${two(date.second)}` : day
}
