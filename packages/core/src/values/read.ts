import type { FieldSchema, OptionsField } from "../schema"
import type { CellValue } from "../value"
import { isIsoDate, readDate } from "./date"
import { decimalText, isTooLarge, isWholeNumberText, readMoney, readNumber, readPercent } from "./number"
import type { ValueSettings } from "./settings"
import { clean, fold } from "./text"

/**
 * Reading what a person typed or pasted into a cell, and telling whether what a cell holds is a
 * value of its field's type.
 *
 * Text that cannot be read is not thrown away. The cell keeps it as typed, so the user can see it
 * and fix it, and the problem says what was expected. The codes and their params are nouxwell/tabula's
 * `RowErrorCode`: an application that words the import's errors already words these.
 */

/**
 * `not_matched` is this package's own, for a lookup holding text no record was matched to; the rest
 * are nouxwell/tabula's.
 */
export type ValueProblemCode =
	"not_a_number" | "not_an_integer" | "not_a_date" | "not_a_boolean" | "not_an_option" | "not_matched"

export interface ValueProblem {
	readonly code: ValueProblemCode
	/** English, as nouxwell/tabula words it. An application in another language words it from code and params. */
	readonly message: string
	/** `field`, `type` and `value` always; `format`, `accepted` or `options` as the code needs. */
	readonly params: Readonly<Record<string, string>>
}

export interface ReadResult {
	/** What the cell should hold: the value, or the text as typed when it could not be read. */
	readonly value: CellValue
	readonly problem: ValueProblem | null
}

/** The words accepted for yes and no besides the settings' own, as nouxwell/tabula's BoolParser accepts them. */
const TRUE_WORDS = new Set(["1", "true", "yes", "on", "y", "t", "evet", "e"])
const FALSE_WORDS = new Set(["0", "false", "no", "off", "n", "f", "hayır", "hayir", "h"])

/**
 * Reads text into the field's type.
 *
 * Text with nothing in it is an empty cell, never a problem: whether a field may be empty is a rule,
 * checked with the other rules.
 */
export function readInput(field: FieldSchema, input: string, settings: ValueSettings): ReadResult {
	const text = clean(input)

	if (text === "") {
		return { value: null, problem: null }
	}

	switch (field.type) {
		case "string":
			return { value: text, problem: null }
		case "lookup":
			// Text is a record's name, not the record: a `LookupResolver` matches it to one, and until
			// then the backend has no id to take.
			return refused(field, text, "not_matched")
		case "integer": {
			const number = readNumber(input, settings)

			if (number === null) {
				return refused(field, text, "not_a_number")
			}

			return isWholeNumberText(number) && !isTooLarge(number)
				? { value: number, problem: null }
				: refused(field, text, "not_an_integer")
		}
		case "decimal":
		case "quantity":
			return numberResult(field, text, readNumber(input, settings))
		case "money":
			return numberResult(field, text, readMoney(input, field.currency, settings))
		case "percent":
			return numberResult(field, text, readPercent(input, settings))
		case "bool":
			return readBool(field, text, settings)
		case "date":
		case "datetime":
			return readDateValue(field, text, settings)
		case "options":
			return readOptions(field, text)
	}
}

/**
 * The problem with what a cell holds, or null when it holds a value of its field's type.
 *
 * A value in the form the grid writes is fine as it is. Anything else is read as text, so a value
 * a host loaded as "1.234,56" into a money column is accepted, and a cell still holding what a user
 * typed and the grid could not read reports why.
 */
export function valueProblem(field: FieldSchema, value: CellValue, settings: ValueSettings): ValueProblem | null {
	if (value === null || isFieldValue(field, value)) {
		return null
	}

	return readInput(field, describeValue(value), settings).problem
}

/** Whether a value is already in the form a cell of this field holds. */
export function isFieldValue(field: FieldSchema, value: CellValue): boolean {
	switch (field.type) {
		case "string":
			return typeof value === "string"
		case "integer":
			return (
				(typeof value === "number" && Number.isSafeInteger(value)) ||
				(typeof value === "string" && isWholeNumberText(value) && !isTooLarge(value))
			)
		case "decimal":
		case "quantity":
		case "money":
		case "percent":
			return decimalText(value) !== null
		case "bool":
			return typeof value === "boolean"
		case "date":
			return isIsoDate(value, false)
		case "datetime":
			return isIsoDate(value, true)
		case "options":
			return field.multiple
				? Array.isArray(value) && value.every(item => isOptionValue(field, item))
				: isOptionValue(field, value)
		case "lookup":
			return isLookupValue(value)
	}
}

/** A value as text, for reading it again or for showing it as it stands. */
export function describeValue(value: CellValue): string {
	if (value === null) {
		return ""
	}

	switch (typeof value) {
		case "string":
			return value
		case "number":
			return decimalText(value) ?? String(value)
		case "boolean":
			return value ? "true" : "false"
	}

	return JSON.stringify(value)
}

export function isLookupValue(value: CellValue): value is { readonly id: string | number; readonly label: string } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false
	}

	const record = value as Readonly<Record<string, CellValue>>

	return (typeof record.id === "string" || typeof record.id === "number") && typeof record.label === "string"
}

function isOptionValue(field: OptionsField, value: CellValue): boolean {
	return field.options.some(option => option.value === value)
}

function numberResult(field: FieldSchema, text: string, number: string | null): ReadResult {
	return number === null ? refused(field, text, "not_a_number") : { value: number, problem: null }
}

function readBool(field: FieldSchema, text: string, settings: ValueSettings): ReadResult {
	const needle = fold(text)

	// The settings' own words first: they are what the grid shows, and what a template's list offers.
	if (needle === fold(settings.trueWord)) {
		return { value: true, problem: null }
	}

	if (needle === fold(settings.falseWord)) {
		return { value: false, problem: null }
	}

	if (TRUE_WORDS.has(needle)) {
		return { value: true, problem: null }
	}

	if (FALSE_WORDS.has(needle)) {
		return { value: false, problem: null }
	}

	const accepted = unique([settings.trueWord, settings.falseWord, "Evet", "Hayır", "1", "0", "true", "false"])

	return refused(field, text, "not_a_boolean", { accepted: accepted.join(", ") })
}

function readDateValue(
	field: FieldSchema & { type: "date" | "datetime" },
	text: string,
	settings: ValueSettings
): ReadResult {
	const withTime = field.type === "datetime"
	const pattern = datePatternOf(field, settings)
	const other = withTime ? settings.datePattern : settings.dateTimePattern
	const value = readDate(text, withTime, pattern, other)

	return value === null ? refused(field, text, "not_a_date", { format: pattern }) : { value, problem: null }
}

/** The pattern a date field is shown and read with: its own, or the settings' for its type. */
export function datePatternOf(field: FieldSchema & { type: "date" | "datetime" }, settings: ValueSettings): string {
	return field.pattern ?? (field.type === "datetime" ? settings.dateTimePattern : settings.datePattern)
}

/**
 * An option by its label first, then by its value, as nouxwell/tabula matches them: if one option's
 * label is another's value, the label wins, because it is what the user sees. A field that holds
 * several takes them separated by commas.
 */
function readOptions(field: OptionsField, text: string): ReadResult {
	const parts = field.multiple
		? text
				.split(",")
				.map(part => clean(part))
				.filter(part => part !== "")
		: [text]
	const values: (string | number)[] = []

	for (const part of parts) {
		const needle = fold(part)
		const option =
			field.options.find(candidate => fold(candidate.label) === needle) ??
			field.options.find(candidate => fold(String(candidate.value)) === needle)

		if (!option) {
			return refused(field, text, "not_an_option", {
				options: unique(field.options.map(candidate => candidate.label)).join(", ")
			})
		}

		values.push(option.value)
	}

	return { value: field.multiple ? Object.freeze(values) : (values[0] ?? null), problem: null }
}

function refused(
	field: FieldSchema,
	text: string,
	code: ValueProblemCode,
	extra: Readonly<Record<string, string>> = {}
): ReadResult {
	const params = Object.freeze({ field: field.key, type: field.type, value: text, ...extra })

	return { value: text, problem: Object.freeze({ code, message: messageFor(code, params), params }) }
}

/** The same sentences as nouxwell/tabula's ParseException. */
function messageFor(code: ValueProblemCode, params: Readonly<Record<string, string>>): string {
	const value = params.value ?? ""

	switch (code) {
		case "not_a_number":
			return `"${value}" could not be read as a number.`
		case "not_an_integer":
			return `"${value}" is not a whole number.`
		case "not_a_date":
			return `"${value}" could not be read as a date; expected format: ${params.format ?? ""}`
		case "not_a_boolean":
			return `"${value}" is not a Yes/No value. Accepted: ${params.accepted ?? ""}`
		case "not_an_option":
			return `"${value}" is not in the list. Options: ${params.options || "(no options defined)"}`
		case "not_matched":
			return `"${value}" is not matched to a record; pick one from the list.`
	}
}

/** Without repeats, comparing as `fold()` does, keeping the first spelling of each. */
function unique(words: readonly string[]): string[] {
	const seen = new Map<string, string>()

	for (const word of words) {
		const key = fold(word)

		if (key !== "" && !seen.has(key)) {
			seen.set(key, word)
		}
	}

	return [...seen.values()]
}
